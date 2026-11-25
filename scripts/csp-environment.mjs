/*
  CSP por ambiente — segunda trava, depois do resolvedor.

  Por que existe. O cabeçalho Content-Security-Policy do `vercel.json` é
  estático: a Vercel o aplica igual em todo deploy do projeto, então ele precisa
  citar os dois projetos Supabase (Production e Beta) para que cada ambiente
  consiga falar com o seu. Isso significa que, só pelo cabeçalho, um Preview do
  Beta teria permissão de rede para abrir conexão com Production.

  Como esta trava funciona. O navegador aplica TODAS as políticas que recebe, e
  um pedido precisa passar em cada uma: o resultado é a interseção. Então, além
  do cabeçalho, o build injeta no HTML uma política com UM único projeto — o do
  ambiente daquele deploy. O Preview do Beta passa a poder falar só com o Beta, e
  Production só com Production, mesmo que o cabeçalho continue mais largo.

  Preview e development declaram apenas `connect-src` e `img-src`, as duas
  diretivas que nomeiam projeto Supabase; o resto continua com o cabeçalho.

  Production declara a política INTEIRA (as mesmas diretivas do cabeçalho, só
  com o projeto de Production). Motivo: o mesmo build também é servido como site
  estático fora da Vercel (Hostinger, `ziistec.com`), onde o cabeçalho do
  `vercel.json` não existe. Na Vercel isso não muda a política efetiva: cada
  diretiva do <meta> é igual ou mais estreita que a do cabeçalho. A única
  diretiva que fica de fora é `frame-ancestors`, que o navegador ignora em <meta>
  (ela vai no cabeçalho: `vercel.json` na Vercel, `.htaccess` fora dela).

  Build sem VERCEL_ENV (`production-static`). Antes era tratado como build local
  que não chega a usuário; com a Hostinger, um build fora da Vercel É o site
  publicado. Então o padrão é fail-closed: sem VERCEL_ENV o artefato recebe a
  política de Production e só ela. Somente o servidor de desenvolvimento do Vite
  (`servidorDev`) fica sem política, como antes.

  Fail-closed. Preview de branch que não está em nenhuma allowlist não recebe
  projeto nenhum: a tela não conecta, que é a mesma postura do resolvedor
  (`unconfigured`). Nada de curinga, nada de prefixo — a comparação é por
  igualdade, igual às allowlists.

  Roda somente no build (Node). Não vai para o pacote do navegador.
*/

import {
  PROD_SUPABASE_URL,
  STAGING_BRANCHES, STAGING_SUPABASE_URL,
} from '../api/_supabaseServerConfig.js';

const limpo = (v) => String(v || '').trim();
const semBarra = (v) => limpo(v).replace(/\/+$/, '');
const wss = (url) => semBarra(url).replace(/^https:/, 'wss:');

/* Qual projeto este deploy pode alcançar. */
export function ambienteDoDeploy({ vercelEnv, branch, servidorDev = false } = {}) {
  const env = limpo(vercelEnv).toLowerCase();
  const ref = limpo(branch);
  if (!env) {
    // Servidor de desenvolvimento: nada a injetar. Build fora da Vercel: é Production estático.
    return servidorDev ? { ambiente: 'local', url: '' } : { ambiente: 'production-static', url: PROD_SUPABASE_URL };
  }
  if (env === 'production') return { ambiente: 'production', url: PROD_SUPABASE_URL };
  if (env === 'development') return { ambiente: 'development', url: STAGING_SUPABASE_URL };
  if (env === 'preview') {
    if (STAGING_BRANCHES.includes(ref)) return { ambiente: 'staging', url: STAGING_SUPABASE_URL };
    // Branch fora das allowlists: sem projeto, como no resolvedor.
    return { ambiente: 'preview-sem-projeto', url: '' };
  }
  return { ambiente: 'desconhecido', url: '' };
}

/* Diretivas de Production que não nomeiam projeto, na mesma ordem e com os
   mesmos valores do cabeçalho do vercel.json (o teste compara um com o outro). */
const DIRETIVAS_FIXAS_PRODUCTION = Object.freeze({
  antes: [
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['form-action', "'self'"],
    ['script-src', "'self'"],
    ['style-src', "'self' 'unsafe-inline'"],
  ],
  depois: [
    ['font-src', "'self' data:"],
    ['manifest-src', "'self'"],
    ['worker-src', "'self' blob:"],
    ['upgrade-insecure-requests', ''],
  ],
});

const PRODUCTION = new Set(['production', 'production-static']);
const juntar = (lista) => lista.map(([nome, valor]) => (valor ? `${nome} ${valor}` : nome)).join('; ');

/* A política do deploy, ou null quando não há política a injetar (só o servidor
   de desenvolvimento do Vite). */
export function politicaCspDoAmbiente({ vercelEnv, branch, servidorDev = false } = {}) {
  const { ambiente, url } = ambienteDoDeploy({ vercelEnv, branch, servidorDev });
  if (ambiente === 'local') return null;

  const projeto = semBarra(url);
  const conexao = ["'self'"];
  const imagem = ["'self'", 'data:', 'blob:'];
  if (projeto) {
    conexao.push(projeto, wss(projeto));
    imagem.push(projeto);
  }
  const comProjeto = [['img-src', imagem.join(' ')], ['connect-src', conexao.join(' ')]];
  const completa = PRODUCTION.has(ambiente);
  const politica = completa
    ? juntar([...DIRETIVAS_FIXAS_PRODUCTION.antes, ...comProjeto, ...DIRETIVAS_FIXAS_PRODUCTION.depois])
    : `connect-src ${conexao.join(' ')}; img-src ${imagem.join(' ')}`;
  return { ambiente, url: projeto, completa, politica };
}

/* A tag para o <head>. O texto é controlado por este módulo e os únicos valores
   variáveis são URLs de projeto conhecidas, mas o escape fica aqui de todo
   jeito: nada vindo de fora entra no HTML sem passar por ele. */
export function metaCspDoAmbiente({ vercelEnv, branch, servidorDev = false } = {}) {
  const r = politicaCspDoAmbiente({ vercelEnv, branch, servidorDev });
  if (!r) return '';
  const seguro = r.politica.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  return `<meta http-equiv="Content-Security-Policy" content="${seguro}" />`;
}
