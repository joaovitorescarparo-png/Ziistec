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
| `quote-pdf` | **PDF do orçamento (usado)** | **Edge Function `quote-pdf`** do Supabase de Production (abaixo) |
| `work-order-report`, `ai`, `finance-ai`, `assistant` | desligados em Production (IA externa/Assistente) | indisponíveis; telas já escondidas |

## PDF do orçamento: Vercel × Hostinger

- `src/lib/quotePdf.js` escolhe pelo host exato: hosts da Vercel (Production, previews de homologação, localhost) → `/api/quote-pdf`, sem mudança; `ziistec.com`/`www.ziistec.com` → `supabase.functions.invoke('quote-pdf')` com o JWT da sessão; qualquer outro host → nenhuma chamada. Sem fallback entre os dois.
- O arquivo só é baixado se for `application/pdf`, tiver bytes e começar com `%PDF-`. Toque duplo reaproveita o pedido em andamento.
- `supabase/functions/quote-pdf/handler.js` é a rota da Vercel portada (mesmo código de consulta, autorização, cota e desenho; o teste compara linha a linha e o PDF byte a byte). Os helpers são cópias idênticas de `api/quotePdfLayout.js`, `src/lib/pdfLogoBox.js` e `api/_apiErrors.js`. **Alterou o PDF na Vercel, altere aqui** — o teste falha se divergir.
- Regras: `verify_jwt = true`; sessão conferida no Auth (inválida → 401); só proprietário (`zt_is_owner`); orçamento só da empresa confirmada; cota `zt_consume_quote_pdf_quota` (30/min, 300/dia, assinatura ativa) — a única escrita é esse evento de uso, como na Vercel; sem `unit_cost`; sem service role; CORS só para as 5 origens de Production.

### Publicar a função (quando autorizado)

1. Nenhum segredo novo: a função usa `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEYS["default"]` (só no `apikey`), que o Supabase já injeta. Nada de anon legada, secret key ou service role; sem a publishable key ela responde 503.
2. `supabase functions deploy quote-pdf --project-ref diztevlpbcfqleizswxr` a partir da `main` (lê `verify_jwt = true` do `config.toml`).
3. Conferir: `OPTIONS` com `Origin: https://ziistec.com` → 204 com `Access-Control-Allow-Origin` exato; sem `Authorization` → 401; com origem desconhecida → 403.
4. Teste humano em `ziistec.com`: proprietário gera PDF; técnico não vê/gera.
- **Rollback:** a Vercel não usa a função. Para desligar o PDF na Hostinger: `supabase functions delete quote-pdf` (o cliente mostra "ainda não está disponível neste endereço") ou voltar o commit do cliente. Nada no banco muda.

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
