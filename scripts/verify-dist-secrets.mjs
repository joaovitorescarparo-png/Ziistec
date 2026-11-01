import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Varredura do bundle publicado (dist/): nada que seja segredo de servidor pode ir para o navegador.
// Roda depois de `vite build` (script `postbuild`). A chave publishable/anon é pública por desenho e não conta.
// Qualquer variável VITE_* também é pública: por isso só o par URL/chave anon do Supabase deve existir no cliente.

const base64urlJson = (part) => {
  try { return JSON.parse(Buffer.from(String(part).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); } catch { return null; }
};

const FIXED = [
  ['chave secreta do Supabase (sb_secret_)', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['chave privada PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['chave de API do Google (AIza…)', /AIza[0-9A-Za-z_-]{35}/],
  ['chave da Anthropic (sk-ant-…)', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['chave de API no formato sk-…', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['token do GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['chave de acesso da AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['token do Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['nome de variável privada de servidor', /\b(?:SUPABASE_SERVICE_ROLE_KEY|GEMINI_API_KEY|ANTHROPIC_API_KEY|SERVICE_ROLE_KEY)\b/],
];

/** Achados de um texto de bundle. JWT só é aceito se o papel for anon (ou ausente); service_role e authenticated bloqueiam. */
export function scanText(text) {
  const found = [];
  for (const [label, pattern] of FIXED) if (pattern.test(text)) found.push(label);
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g)) {
    const payload = base64urlJson(match[1]);
    if (payload && typeof payload === 'object' && payload.role && payload.role !== 'anon') found.push(`JWT com papel "${payload.role}"`);
  }
  return [...new Set(found)];
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|css|html|json|map|txt|webmanifest)$/i.test(entry.name)) yield full;
  }
}

export function scanDist(dist) {
  if (!existsSync(dist) || !statSync(dist).isDirectory()) throw new Error(`pasta de build não encontrada: ${dist}`);
  const findings = [];
  let files = 0;
  for (const file of walk(dist)) {
    files += 1;
    const hits = scanText(readFileSync(file, 'utf8'));
    if (hits.length) findings.push({ file: path.relative(dist, file), hits });
  }
  return { files, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dist = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  const { files, findings } = scanDist(dist);
  if (!files) { console.error('DIST_SECRETS: nenhum arquivo para varrer'); process.exit(1); }
  if (findings.length) {
    for (const item of findings) console.error(`DIST_SECRETS: ${item.file}: ${item.hits.join('; ')}`);
    process.exit(1);
  }
  console.log(`DIST_SECRETS: OK — ${files} arquivos do bundle sem segredo de servidor`);
}
