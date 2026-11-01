# H0 — ambiente isolado de homologação (estado)

Data: 2026-10-29/30 · Branch `claude/blocks34-port-beta-v1` · Complementa `H0_HOMOLOGATION_PLAN.md`.
Estado em 2026-11-01: **H0 criado, banco em 0112, frontend Preview READY, Auth configurado, empresas e vínculos preparados e validados.** Falta só o teste humano: a Fase 1 continua **NOT READY**. Roteiro: `H0_HUMAN_SCRIPT.md`.

## 1. Identidade dos ambientes (por configuração, não por nome)

| Projeto Supabase (org `tpdweuaunwqeuptphrhr`) | Região | Papel | Prova |
| --- | --- | --- | --- |
| `diztevlpbcfqleizswxr` "Ziistec 1" | ca-central-1 | **Production** (baseline 0049) | `PROD_SUPABASE_URL` em `src/lib/supabase.js` e `api/_supabaseServerConfig.js`; hosts da `main` em `PROD_SUPABASE_HOSTS` |
| `xadoktssibuuebzzjrhv` "ZiisTec V2 Staging" | sa-east-1 | **Beta Live** (0099), **pausado**, intocado | `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_HOSTS` (inclui `beta.ziistec.com`) |
| `uvjovxrpnvxsxrlvngpj` "ziistec" | us-west-2 | **Não usar**: sem referência no repo, nas docs, no git nem na memória; só se descobre restaurando | — |
| `auojcljfahhpkfqqbygd` "ziistec-h0" | sa-east-1 | **H0** (descartável), criado em 2026-10-29 23:27 UTC, plano Free (US$ 0/mês) | `get_project`: mesma org, `ACTIVE_HEALTHY`, ref diferente dos três acima, banco vazio no momento da criação |

O Free permite 2 projetos ativos: Production + H0 ocupam os dois. Reativar o Beta Live exigiria pausar o H0 ou mudar de plano (decisão do proprietário; nada foi restaurado).

## 2. Frontend (Preview)

- Preview: `https://ziistec-git-claude-blocks34-port-beta-v1-js-connect.vercel.app` (branch `claude/blocks34-port-beta-v1`).
- O H0 entra como **terceiro par isolado**: `H0_SUPABASE_HOSTS` (um único host) e ramo `h0` no resolvedor do cliente; `H0_BRANCHES` (uma branch, fora de `STAGING_BRANCHES`) no resolvedor do servidor; raiz HTTPS do host em `authRedirect`; CSP com o H0 em `connect-src` (https e wss) e `img-src`. Nenhuma lista de Production/Beta mudou.
- Falha fechada: o par do H0 só vale no host/branch do H0; qualquer outro par, env parcial, deploy de produção ou host parecido resolve para `unconfigured`/`environment-project-mismatch`. Prova: `tests/blockers/h0_environment_isolation.test.mjs` (8 testes).
- Variáveis da Vercel: nenhuma `VITE_SUPABASE_*`/`SUPABASE_*` existe para esta branch (todas são de outras branches), então o Preview usa o fallback do H0 sem conflito. **Sem IA externa**: `ENABLE_EXTERNAL_AI`/`GEMINI_API_KEY` não existem para esta branch; o relatório usa o texto padrão e a conclusão da OS não depende de IA.
- O Preview tem a **Vercel Authentication** ligada (302 para `vercel.com/sso-api`). Quem abrir precisa estar logado em uma conta com acesso ao time `js-connect`; para outro aparelho (iPhone do técnico) use "Compartilhar" da Vercel ou o mesmo login. A proteção do projeto não foi alterada.
- **Bloqueador de merge/deploy:** as guardas e a CSP do H0 existem só nesta branch. O último teste de `h0_environment_isolation.test.mjs` falha em PR com base `main`, em push na `main`, em `VERCEL_ENV=production` e em build da `main`. Por isso o `verify` do PR #20 (draft, base `main`) fica **vermelho de propósito** até as guardas do H0 saírem do caminho da `main`.

## 3. Banco do H0

Aplicação feita **por uma função de borda temporária** (`h0-apply`), porque o conector não aceita o arquivo da baseline (~1 MB) inline. A função ficou presa ao SHA `60f8342` do repositório, conferia o `sha256` de cada arquivo e executava um arquivo por vez em uma transação, parando no primeiro erro. Agora é um **stub inerte (HTTP 410)**. Não foi usada `service_role` do Beta/Production nem segredo copiado.

Ordem (130 passos): baseline de produção na ordem do `production_baseline_manifest.csv` + `supabase/tests/ci_local_bootstrap.sql` (fornece `public.rls_auto_enable()`, o gatilho `ensure_rls` e o schema `zt_private`; necessário porque a 0003 revoga execute dessa função) + `production_baseline_reconciliation.sql` + 0050–0099 (definers 134), depois **0100 → 0112 uma por vez**. `ci_local_seed.sql` **não** foi aplicado (identidades sintéticas só do CI).

Definers por passo (conta `public` + `zt_private`, a mesma do ensaio local; só `public` seriam 96 em 0112): 0100 135 · 0101 135 · 0102 136 · 0103 136 · 0104 138 · 0105 140 · 0106 140 · 0107 140 · 0108 140 · 0109 141 · 0110 142 · 0111 149 · 0112 149. Todos como no plano, nenhuma falha.

Invariantes do plano §4 conferidas no H0 (somente leitura): as três tabelas da 0111 com RLS, `anon` sem privilégio, `authenticated` sem INSERT/UPDATE/DELETE e `work_order_ai_reports` sem policy; `work_orders` sem SELECT na tabela inteira, 34 colunas legíveis, as 4 `approved_*` ilegíveis; `user_route_preferences` com RLS, três policies com `auth.uid()` (`qual` e `with_check`), sem DELETE; FKs de fornecedor por empresa (2); overload antigo de `zt_adjust_product_stock` sem EXECUTE para `authenticated` e o novo com; gatilho de identidade do vínculo; 0 definers sem `search_path` (public e zt_private); 0 definers de `public` executáveis por `anon`; `team_invite_email_sends` sem privilégio para `authenticated`.

Prova de equivalência com o laboratório (PGlite com 0099 reconstruído como no CI, 0100–0112 aplicadas): as 8 impressões do catálogo (tabelas 50, colunas 616, funções 239, policies 92, constraints 417, índices 274, triggers 82, flags de RLS 50) e o hash dos corpos das 239 funções são **idênticos**.

## 4. Desvios do plano (declarados)

1. Plano §3 passos 2–3 (frontend antigo e "modo reduzido" com o banco em 0099) **não foram feitos**: ninguém usa o H0, então a regra "frontend novo antes da 0105" foi cumprida publicando o Preview novo (READY em `64a15bd`) antes de aplicar a 0100.
2. `team-invite-email` **não foi publicada no H0**: a lista de origens dela é fixa e não inclui o host do H0, e o plano §6 diz "sem convites reais" no H0. O convite de equipe grava no banco; só o envio do e-mail não existe. Para convidar o técnico no H0 basta o dono criar o usuário em Auth (roteiro).
3. `api/work-order-report` vai junto com o Preview (pasta `api/`); sem chave de IA responde com o texto padrão.
4. O e-mail embutido do Supabase só entrega para membros da organização e tem limite baixo: a recuperação de senha pode não chegar a endereços com `+`. É limitação de SMTP, não do produto; SMTP próprio é item de pré-lançamento.

## 5. Auth e vínculos (2026-11-01)

O proprietário configurou Site URL/Redirect URL e criou 3 usuários com e-mail confirmado (as senhas nunca passaram por aqui). Verificado no H0: exatamente 3 usuários, todos confirmados, nenhum bloqueado. Provedores externos desligados; cadastro público aberto (`disable_signup=false`) e `mailer_autoconfirm=false`: quem se cadastrar sozinho precisa confirmar o e-mail e **não cria empresa sem convite beta** (beta fechado); o Preview ainda fica atrás da Vercel Authentication.

Vínculos feitos pelo caminho real do produto, sem escrever tabelas à mão: convite beta (um por dono) → `zt_create_company` como cada dono → `company_invites` criado pelo dono A sob RLS → `zt_accept_invites` pelo técnico. Resultado: **H0 Demo A** (dono A + técnico A, trial Profissional R$ 79,90 até 2026-11-15) e **H0 Demo B** (dono B). Nomes de perfil sintéticos. Nenhum e-mail pessoal vai para o repositório.

Validação como cada pessoa (RLS real), com cliente → orçamento → OS → conclusão → cobrança → pagamento → comprovante → histórico criados **dentro de uma transação desfeita no fim** (H0 continua sem dados de negócio):
- dono A: vê só a H0 Demo A e a equipe dela (2); cobrança R$ 680 paga; comprovante `CS-` "Documento não fiscal" de R$ 680, reemissão com o mesmo pedido devolve o mesmo comprovante; histórico do cliente com valor e pagamento; escrever na empresa B é negado (42501); reescrever o `user_id` do vínculo é negado (0112).
- técnico A: vê só a H0 Demo A e a OS atribuída; lê `approved_total` e `select *` em `work_orders` → negado (42501); financeiro, itens com preço e comprovantes → 0 linhas; itens de campo sem `unit_price`/`total`; emitir comprovante e ler histórico → negado (42501).
- dono B: vê só a H0 Demo B; cliente, OS, cobrança e comprovante da empresa A → 0 linhas; emitir comprovante, ler histórico e gravar na empresa A → negado (42501).
- técnico desativado pelo dono A: 0 empresas, 0 OS e 0 clientes visíveis na hora.

Isso não substitui o teste humano em aparelho real, câmera, microfone, PDF e WhatsApp.

## 6. O que falta (depende de pessoas)

Executar `H0_HUMAN_SCRIPT.md` nos aparelhos e devolver PASSOU/FALHOU/NÃO TESTÁVEL por teste. O trial do H0 termina em 2026-11-15.

## 7. Descarte

O H0 é descartável: apagar o projeto `ziistec-h0` no painel Supabase e remover as guardas do H0 (commits `64a15bd` e `a7622e3`) antes de qualquer PR para a `main`.
