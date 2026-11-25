# Production estática na Hostinger (`ziistec.com`)

O mesmo frontend da `main` roda em dois lugares, os dois apontando para o **mesmo Supabase de Production** (`diztevlpbcfqleizswxr`):

- Vercel: `ziistec.vercel.app` (e os dois aliases da `main`), com `vercel.json` e as Vercel Functions de `/api`.
- Hostinger: `ziistec.com` e `www.ziistec.com`, como **site estático** (o build do Vite servido do `dist/`). Sem Node permanente.

## Como o ambiente é decidido

- **No navegador (resolvedor):** `src/lib/supabaseConfig.js`. `ziistec.com` e `www.ziistec.com` estão em `PROD_SUPABASE_HOSTS`, por igualdade exata. Sem `VITE_VERCEL_ENV` (Hostinger) o ambiente é inferido do host: Production. Qualquer outro host — inclusive o domínio temporário da Hostinger e `app.ziistec.com` — fica `unconfigured` (tela "Ambiente protegido"). `beta.ziistec.com` continua só Staging.
- **No build (CSP):** `scripts/csp-environment.mjs`. Build sem `VERCEL_ENV` é `production-static`: o `index.html` recebe a CSP de Production **inteira** em `<meta>` (só `self` + o projeto de Production; nada do Beta, nenhum script externo, sem inline/eval). O build também gera `dist/.htaccess` (`scripts/static-hosting.mjs`). A guarda `scripts/verify-dist-csp.mjs` (postbuild) reprova o build se a `<meta>` faltar, estiver errada, citar outro projeto ou se o `.htaccess` faltar.
- Na Vercel a política efetiva não muda: a `<meta>` de Production tem as mesmas diretivas do cabeçalho, só mais estreitas.

## Tela da Hostinger

- Framework: Vite · Node.js 24.x · raiz `./` · npm · build `npm run build` · saída `dist`.
- **Variáveis de ambiente: nenhuma.** A Production da Vercel também não usa nenhuma `VITE_*`; o fallback versionado basta.
- Não definir: `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF`, `VITE_VERCEL_ENV`, `VITE_ENABLE_EXTERNAL_AI`, `VITE_ZT_OPERATIONS_SIMULATOR`, `VITE_ENABLE_GOOGLE_AUTH`, nem chave de servidor (Gemini, service role, secret key). Toda `VITE_*` vai para o bundle público.
- Se um dia for preciso declarar `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, só o par exato de Production (URL + publishable key de `src/lib/supabase.js`). Qualquer outro par falha fechado.

## `.htaccess` e rotas

- O `dist/.htaccess` gerado faz o fallback da SPA para o `index.html`, deixa arquivo existente sair como está e devolve **404** para `/api/*` e asset ausente em `/assets/` (nunca HTML com 200). Também repete os cabeçalhos do `vercel.json`, com CSP + `frame-ancestors 'none'`.
- A Hostinger pode gerar o próprio `.htaccess` no deploy. Se isso acontecer, o fallback da SPA dela continua valendo e a segurança não depende do arquivo: a CSP está na `<meta>` e o app se recusa a montar dentro de iframe (`src/main.jsx`).

## `/api` fora da Vercel

| Endpoint | Production hoje | Na Hostinger |
| --- | --- | --- |
| `client-error` | log de erro do navegador | indisponível; o envio para na 1ª resposta 404 (sem efeito na tela) |
| `quote-pdf` | **PDF do orçamento (usado)** | indisponível: aviso "ainda não está disponível neste endereço". Destino: Supabase Edge Function |
| `work-order-report`, `ai`, `finance-ai`, `assistant` | desligados em Production (IA externa/Assistente) | indisponíveis; telas já escondidas |

Antes de colocar clientes em `ziistec.com`, o PDF do orçamento precisa de um destino fora da Vercel (Edge Function `quote-pdf` no mesmo projeto: a CSP já permite o domínio do Supabase de Production).

## Supabase Auth (fazer na hora da virada, não antes)

- Redirect URLs: adicionar `https://ziistec.com/` e `https://www.ziistec.com/` (raiz exata, sem curinga).
- Site URL: trocar para `https://ziistec.com/` só quando `ziistec.com` for o endereço oficial.
- Edge Function `team-invite-email`: o código já aceita as duas origens; precisa ser publicada para valer.

## Depois do primeiro deploy na Hostinger

1. `https://ziistec.com/` e `https://www.ziistec.com/` abrem a tela de login; refresh em `/os/...` não dá 404.
2. No DevTools: `<meta http-equiv="Content-Security-Policy">` presente; pedidos só para `diztevlpbcfqleizswxr.supabase.co`.
3. `curl -I https://ziistec.com/` mostra `X-Frame-Options`/`Content-Security-Policy`? Se não, a Hostinger regenerou o `.htaccess` — a `<meta>` e a trava de iframe continuam valendo.
4. `curl -I https://ziistec.com/api/quote-pdf` devolve 404 (não `text/html` com 200).
5. DNS: manter o registro de `beta.ziistec.com` apontando para a Vercel ao ligar a raiz e o `www` na Hostinger.
