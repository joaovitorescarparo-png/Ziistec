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

  Esta política declara apenas `connect-src` e `img-src`, as duas diretivas que
  nomeiam projeto Supabase. As outras ficam de fora de propósito: diretiva
  ausente numa política não restringe nada por ela, então `script-src`,
  `frame-ancestors` e companhia continuam sendo governadas pelo cabeçalho, sem
  risco de esta política afrouxar ou quebrar alguma delas.

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
export function ambienteDoDeploy({ vercelEnv, branch } = {}) {
  const env = limpo(vercelEnv).toLowerCase();
  const ref = limpo(branch);
  if (!env) return { ambiente: 'local', url: '' };
  if (env === 'production') return { ambiente: 'production', url: PROD_SUPABASE_URL };
  if (env === 'development') return { ambiente: 'development', url: STAGING_SUPABASE_URL };
  if (env === 'preview') {
    if (STAGING_BRANCHES.includes(ref)) return { ambiente: 'staging', url: STAGING_SUPABASE_URL };
    // Branch fora das allowlists: sem projeto, como no resolvedor.
    return { ambiente: 'preview-sem-projeto', url: '' };
  }
  return { ambiente: 'desconhecido', url: '' };
}

/* A política do deploy, ou null quando não há política a injetar.
   `local` devolve null: build na máquina do desenvolvedor não é servido a
   usuário, e o cabeçalho da Vercel não se aplica fora dela. Todo deploy da
   Vercel recebe VERCEL_ENV, então todo artefato publicado recebe política. */
export function politicaCspDoAmbiente({ vercelEnv, branch } = {}) {
  const { ambiente, url } = ambienteDoDeploy({ vercelEnv, branch });
  if (ambiente === 'local') return null;

  const projeto = semBarra(url);
  const conexao = ["'self'"];
  const imagem = ["'self'", 'data:', 'blob:'];
  if (projeto) {
    conexao.push(projeto, wss(projeto));
    imagem.push(projeto);
  }
  return {
    ambiente,
    url: projeto,
    politica: `connect-src ${conexao.join(' ')}; img-src ${imagem.join(' ')}`,
  };
}

/* A tag para o <head>. O texto é controlado por este módulo e os únicos valores
   variáveis são URLs de projeto conhecidas, mas o escape fica aqui de todo
   jeito: nada vindo de fora entra no HTML sem passar por ele. */
export function metaCspDoAmbiente({ vercelEnv, branch } = {}) {
  const r = politicaCspDoAmbiente({ vercelEnv, branch });
  if (!r) return '';
  const seguro = r.politica.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  return `<meta http-equiv="Content-Security-Policy" content="${seguro}" />`;
}
