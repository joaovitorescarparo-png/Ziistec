/*
  Hospedagem estática fora da Vercel (Hostinger, `ziistec.com`).

  Na Vercel, `vercel.json` cuida de três coisas: fallback da SPA para o
  index.html, cabeçalhos de segurança e as Vercel Functions em `/api`. Fora dela
  nada disso existe. Este módulo gera o `.htaccess` (LiteSpeed/Apache) que vai
  junto com o build `production-static`:

  - refresh, link salvo ou rota interna aberta direto entregam o index.html;
  - arquivo que existe (assets, ícones, scripts de public/) sai como está;
  - `/api/*` NÃO cai no index.html: as Functions não existem aqui, e o
    navegador precisa receber um 404 de verdade, nunca HTML com status 200;
  - asset ausente em `/assets/` também é 404 (nunca HTML no lugar de JS/CSS);
  - cabeçalhos de segurança iguais aos do vercel.json, com a CSP de Production
    gerada pelo mesmo módulo da <meta> e mais `frame-ancestors 'none'`;
  - só diretivas de rewrite e de cabeçalho, dentro de <IfModule>: nada de
    `Options`/`DirectoryIndex`, que dão 500 quando a hospedagem restringe o
    AllowOverride.

  O `.htaccess` é reforço, não a trava principal: a Hostinger pode gerar o
  próprio arquivo no deploy. A CSP que vale sempre é a <meta> do index.html, e o
  app se recusa a montar dentro de iframe (src/main.jsx). Por isso nada aqui é
  necessário para o site ser seguro; é necessário para o site ser completo.

  Roda somente no build (Node). Não vai para o pacote do navegador.
*/

import { politicaCspDoAmbiente } from './csp-environment.mjs';

/* Os mesmos cabeçalhos do vercel.json (o teste compara um com o outro). */
export const CABECALHOS_SEGURANCA = Object.freeze([
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['X-Permitted-Cross-Domain-Policies', 'none'],
  ['Cross-Origin-Opener-Policy', 'same-origin'],
  ['Cross-Origin-Resource-Policy', 'same-origin'],
  ['Origin-Agent-Cluster', '?1'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), browsing-topics=()'],
]);

/* A CSP do cabeçalho fora da Vercel: a política de Production inteira + frame-ancestors. */
export function cspCabecalhoEstatico(contexto = {}) {
  const r = politicaCspDoAmbiente(contexto);
  if (!r || r.ambiente !== 'production-static') return '';
  return `${r.politica}; frame-ancestors 'none'`;
}

/* O conteúdo do .htaccess, ou '' quando o build não é `production-static`
   (Vercel e servidor de desenvolvimento não recebem o arquivo). */
export function htaccessDoAmbiente(contexto = {}) {
  const csp = cspCabecalhoEstatico(contexto);
  if (!csp) return '';
  if (/["\r\n]/.test(csp)) throw new Error('CSP com caractere inválido para o .htaccess');
  const cabecalhos = [...CABECALHOS_SEGURANCA, ['Content-Security-Policy', csp]]
    .map(([nome, valor]) => `  Header set ${nome} "${valor}"`);
  return [
    '# ZiisTec — site estático de Production fora da Vercel (Hostinger).',
    '# Gerado pelo build (scripts/static-hosting.mjs). Não editar à mão.',
    '# Sem Options/DirectoryIndex de propósito: com AllowOverride restrito eles derrubam o site com 500.',
    '# A raiz "/" já cai na regra da SPA abaixo.',
    '',
    '<IfModule mod_rewrite.c>',
    '  RewriteEngine On',
    '  RewriteBase /',
    '  # Rota da SPA (refresh, link salvo): entrega o index.html.',
    '  # Exceções: arquivo que existe, /api (as Functions só existem na Vercel) e /assets.',
    '  RewriteCond %{REQUEST_FILENAME} !-f',
    '  RewriteCond %{REQUEST_URI} !^/api(/|$)',
    '  RewriteCond %{REQUEST_URI} !^/assets/',
    '  RewriteRule ^ index.html [L]',
    '</IfModule>',
    '',
    '<IfModule mod_headers.c>',
    ...cabecalhos,
    '  # O index.html muda a cada deploy e aponta para os assets novos: sempre revalidar.',
    '  <FilesMatch "\\.html$">',
    '    Header set Cache-Control "no-cache"',
    '  </FilesMatch>',
    '</IfModule>',
    '',
  ].join('\n');
}
