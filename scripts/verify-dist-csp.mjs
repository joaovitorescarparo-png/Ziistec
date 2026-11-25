import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { metaCspDoAmbiente, politicaCspDoAmbiente } from './csp-environment.mjs';
import { htaccessDoAmbiente } from './static-hosting.mjs';
import { PROD_SUPABASE_URL, STAGING_SUPABASE_URL } from '../api/_supabaseServerConfig.js';

/*
  Guarda do artefato publicado (postbuild): o dist/ só sai com a CSP do seu ambiente.

  O build da Hostinger não tem VERCEL_ENV nem o cabeçalho do vercel.json. Se a <meta>
  de CSP não estiver no index.html, o site iria ao ar sem política nenhuma. Esta
  guarda falha o build nesse caso, e também quando:
  - há mais de uma política <meta>, ou uma diferente da esperada para o ambiente;
  - o index.html ou o .htaccess citam projeto Supabase além do projeto do ambiente;
  - o .htaccess falta no build `production-static`, difere do gerado, ou aparece
    num build da Vercel;
  - qualquer arquivo do bundle cita projeto Supabase fora da lista conhecida
    (Production e Beta; a chave do Beta é publishable e o resolvedor só a usa nos
    hosts de homologação, que a CSP de Production bloqueia).
*/

const ref = (url) => new URL(url).hostname.split('.')[0];
const PROJETOS_CONHECIDOS = new Set([ref(PROD_SUPABASE_URL), ref(STAGING_SUPABASE_URL)]);
const PROJETO_RE = /\b([a-z0-9]{20})\.supabase\.co\b/g;
const projetosEm = (texto) => new Set([...String(texto).matchAll(PROJETO_RE)].map((m) => m[1]));

function* arquivos(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* arquivos(full);
    else if (/\.(js|mjs|css|html|json|map|txt|webmanifest)$/i.test(entry.name) || entry.name === '.htaccess') yield full;
  }
}

export function verificarDistCsp(dist, contexto = {}) {
  const erros = [];
  if (!existsSync(dist) || !statSync(dist).isDirectory()) return { ambiente: '', erros: [`pasta de build não encontrada: ${dist}`] };
  const r = politicaCspDoAmbiente({ ...contexto, servidorDev: false });
  const esperada = metaCspDoAmbiente({ ...contexto, servidorDev: false });
  const ambiente = r?.ambiente || '';

  const indexPath = path.join(dist, 'index.html');
  const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  if (!html) erros.push('index.html ausente no build');
  const metas = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/gi) || [];
  if (!esperada) erros.push(`ambiente ${ambiente || '(nenhum)'} sem política: build publicado nunca sai sem CSP`);
  else if (metas.length !== 1) erros.push(`index.html precisa de exatamente 1 <meta> de CSP; tem ${metas.length}`);
  else if (metas[0] !== esperada) erros.push('a <meta> de CSP do index.html não é a do ambiente deste build');

  const projetoDoAmbiente = r?.url ? ref(r.url) : '';
  const permitidos = new Set(projetoDoAmbiente ? [projetoDoAmbiente] : []);
  for (const p of projetosEm(html)) if (!permitidos.has(p)) erros.push(`index.html cita o projeto ${p}, fora do ambiente ${ambiente}`);

  const htaccessPath = path.join(dist, '.htaccess');
  const htaccessEsperado = htaccessDoAmbiente({ ...contexto, servidorDev: false });
  const temHtaccess = existsSync(htaccessPath);
  if (htaccessEsperado) {
    if (!temHtaccess) erros.push('build production-static sem .htaccess');
    else {
      const atual = readFileSync(htaccessPath, 'utf8');
      if (atual !== htaccessEsperado) erros.push('.htaccess diferente do gerado para o ambiente');
      for (const p of projetosEm(atual)) if (!permitidos.has(p)) erros.push(`.htaccess cita o projeto ${p}, fora do ambiente ${ambiente}`);
    }
  } else if (temHtaccess) {
    erros.push(`.htaccess não pertence ao ambiente ${ambiente}`);
  }

  let total = 0;
  for (const arquivo of arquivos(dist)) {
    total += 1;
    for (const p of projetosEm(readFileSync(arquivo, 'utf8'))) {
      if (!PROJETOS_CONHECIDOS.has(p)) erros.push(`${path.relative(dist, arquivo)} cita projeto Supabase desconhecido: ${p}`);
    }
  }
  if (!total) erros.push('nenhum arquivo no build');
  return { ambiente, erros };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dist = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist');
  const { ambiente, erros } = verificarDistCsp(dist, {
    vercelEnv: process.env.VERCEL_ENV,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
  });
  if (erros.length) {
    for (const erro of erros) console.error(`DIST_CSP: ${erro}`);
    process.exit(1);
  }
  console.log(`DIST_CSP: OK — ${ambiente}: CSP do ambiente no index.html${ambiente === 'production-static' ? ' e .htaccess gerado' : ''}`);
}
