import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const scanned = [];

const runtimeRoots = ['src', 'api'];
const extensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (extensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const commonPatterns = [
  ['dangerouslySetInnerHTML', /\bdangerouslySetInnerHTML\b/],
  ['eval()', /\beval\s*\(/],
  ['new Function()', /\bnew\s+Function\s*\(/],
  ['document.write()', /\bdocument\.write\s*\(/],
  ['atribuição direta a innerHTML', /\.innerHTML\s*=/],
  ['atribuição direta a outerHTML', /\.outerHTML\s*=/],
  ['user_metadata/raw_user_meta_data sem revisão explícita', /\b(?:user_metadata|raw_user_meta_data)\b/],
  ['token de sessão persistido manualmente', /localStorage\.setItem\s*\([^\n]{0,180}(?:access[_-]?token|refresh[_-]?token|session|jwt)/i],
];

for (const full of runtimeRoots.flatMap((dir) => walk(path.join(root, dir)))) {
  const rel = path.relative(root, full);
  const text = fs.readFileSync(full, 'utf8');
  scanned.push(rel);

  for (const [label, pattern] of commonPatterns) {
    if (pattern.test(text)) failures.push(`${rel}: padrão proibido detectado: ${label}`);
  }

  // Chaves administrativas/secretas jamais pertencem ao bundle do navegador.
  // A palavra "service_role" em comentário é permitida; referência executável a env/variável privilegiada, não.
  if (rel.startsWith(`src${path.sep}`)) {
    const frontendPrivileged = [
      ['variável service role no frontend', /(?:import\.meta\.env|process\.env)[^\n;]{0,120}SERVICE[_-]?ROLE/i],
      ['Supabase secret key no frontend', /sb_secret_[A-Za-z0-9_-]{8,}/],
      ['chave privada no frontend', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ];
    for (const [label, pattern] of frontendPrivileged) {
      if (pattern.test(text)) failures.push(`${rel}: ${label}`);
    }
  }

  // Runtime público não deve introduzir transporte HTTP em produção.
  for (const match of text.matchAll(/https?:\/\/[^'"`\s)]+/g)) {
    const url = match[0];
    if (url.startsWith('http://') && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/.test(url)) {
      failures.push(`${rel}: URL HTTP insegura detectada: ${url}`);
    }
  }
}

if (failures.length) {
  console.error('\nRUNTIME SECURITY CHECK: FAIL\n');
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log('\nRUNTIME SECURITY CHECK: OK');
console.log(`✓ ${scanned.length} arquivos runtime verificados`);
console.log('✓ Sem HTML bruto, eval/new Function, user_metadata, token manual ou segredo privilegiado no frontend');
