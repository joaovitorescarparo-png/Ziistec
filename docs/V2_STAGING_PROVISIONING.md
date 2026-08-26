# ZiisTec V2 — provisionamento seguro de homologação

> Objetivo: validar a Product V2 sem tocar dados, Auth, Storage ou schema de produção.
> A branch `product-v2-review` e a PR #9 continuam fora da `main` até este fluxo ficar verde.

## Regra zero

- **Nunca usar o Supabase de produção em Preview/Staging.**
- **Nunca clonar dados de produção para a branch de homologação.**
- **Nunca aplicar 0050→0061 direto em produção para “testar”.**
- **Nunca usar service_role/secret key no frontend.**
- A branch Supabase deve ter projeto, banco, Auth, Storage, URL e publishable key próprios.

O frontend já falha fechado: previews sem `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` não usam o fallback de produção. O fallback público só existe nos hosts oficiais da `main`.

## Política atual de custo

A branch paga de homologação está **adiada** enquanto o ZiisTec não tiver mais de 4 clientes pagantes.

Até existir **5 ou mais clientes pagantes**, ou autorização explícita do proprietário para um custo específico, a homologação usa somente:

- CI/Verify/CodeQL já existentes;
- Preview Vercel já conectado;
- leitura, advisors e logs do Supabase atual;
- testes SQL controlados com `BEGIN ... ROLLBACK`;
- contratos estáticos e testes versionados no repositório.

Nenhuma branch paga deve ser criada apenas para acelerar desenvolvimento. A política completa está em `docs/NO_COST_DEVELOPMENT_POLICY.md`.

## 1. Pré-condições para a futura branch paga

Antes de criar a branch:

1. PR #9 continua `OPEN` + `DRAFT`.
2. `main` continua sem as migrations V2.
3. `Verify` e `CodeQL` do HEAD estão verdes.
4. O ZiisTec já tem pelo menos 5 clientes pagantes **ou** o proprietário autorizou explicitamente esse custo específico.
5. O custo atual da branch foi consultado e aceito antes da criação.
6. Criar branch **sem dados de produção**.

Branch sugerida: `v2-homologation`.

## 2. Criar a branch Supabase

A branch deve ser criada a partir do projeto de produção apenas como ambiente isolado. O conector retorna um `project_ref` próprio para a branch.

Depois da criação, registrar para a homologação:

- `STAGING_PROJECT_REF`
- `STAGING_SUPABASE_URL`
- `STAGING_PUBLISHABLE_KEY`

Não registrar secret/service key no GitHub, frontend, documentação ou logs.

## 3. Confirmar baseline antes da V2

No projeto da branch:

- confirmar que ela está `ACTIVE_HEALTHY`;
- confirmar que não há clientes, OS, compras ou anexos reais vindos de produção;
- confirmar Auth/Storage separados;
- conferir migration history/base schema antes de qualquer DDL V2.

Se houver qualquer dado real inesperado, parar e destruir/recriar a branch sem dados.

## 4. Aplicar a stack V2 em ordem

Aplicar **somente na branch de homologação**, nesta ordem:

1. `0050_product_v2_core_catalog_contracts.sql`
2. `0051_product_v2_stock_sales_manual_warranty.sql`
3. `0052_product_v2_contract_cycles.sql`
4. `0053_v2_security_cost_isolation.sql`
5. `0054_v2_work_order_extra_cost_isolation.sql`
6. `0055_v2_purchase_stock_reconciliation.sql`
7. `0056_security_advisor_hardening.sql`
8. `0057_v2_quote_to_work_order_idempotent.sql`
9. `0058_v2_function_search_path_hardening.sql`
10. `0059_legacy_rpc_tenant_hardening.sql`
11. `0060_preserve_private_extra_cost_on_finalize.sql`
12. `0061_work_order_technical_memory_media.sql`

Se uma migration falhar, **não pular para a próxima**. Investigar a primeira falha, corrigir na branch Git e recriar/resetar staging quando necessário.

## 5. Rodar contrato estrutural

Executar:

`supabase/tests/v2_post_migration_contract.sql`

Resultado obrigatório:

`V2_POST_MIGRATION_CONTRACT_OK`

Esse contrato prova, entre outros pontos:

- ledgers privados de custo presentes;
- índice único orçamento→OS;
- bucket privado de mídia técnica;
- constraints de estoque/mídia;
- policy de negação de `document_usage_events`;
- allowlist por assinatura exata dos `SECURITY DEFINER` autenticados;
- `search_path` explícito;
- wrapper legado `zt_complete_work_order` continua service-only.

## 6. Rodar smoke rollback-only

Executar:

`supabase/tests/v2_access_subscription_rollback_smoke.sql`

Resultados obrigatórios:

- `V2_ACCESS_REVOCATION_OK`
- `V2_SUBSCRIPTION_REACTIVATION_OK`

O arquivo termina em `ROLLBACK` e deve provar:

- técnico ativo vê sua OS;
- técnico desativado perde acesso na próxima requisição;
- assinatura cancelada bloqueia escrita;
- cancelar não apaga dados;
- reativar dentro do período restaura escrita;
- os mesmos dados continuam existentes.

## 7. Criar identidades de homologação

Usar **somente Auth da branch**.

Criar pelo menos:

- `owner-v2-test` — proprietário da Empresa A;
- `tech-v2-test` — técnico ativo da Empresa A;
- `owner-b-v2-test` — proprietário da Empresa B para cross-tenant.

Não reutilizar usuários reais de produção.

Fluxo preferido:

1. owner cria/onboarda Empresa A pelo app;
2. owner adiciona técnico pelo fluxo real;
3. criar Empresa B com usuário separado;
4. popular dados fictícios usando as telas/RPCs reais, não inserts administrativos, exceto quando o próprio teste exigir setup controlado.

## 8. Conectar a Vercel Preview

O preview da PR deve receber, como par inseparável:

- `VITE_SUPABASE_URL=<URL DA BRANCH>`
- `VITE_SUPABASE_ANON_KEY=<PUBLISHABLE KEY DA BRANCH>`

Regras:

- nunca configurar apenas uma das duas;
- nunca apontar preview para `diztevlpbcfqleizswxr.supabase.co`;
- depois de configurar, redeployar o HEAD da PR;
- confirmar na tela que o aviso “ZiisTec V2 sem banco de homologação” desapareceu;
- confirmar por rede/logs que as chamadas usam o `project_ref` da branch.

## 9. Homologação funcional real

Seguir `docs/V2_HOMOLOGATION_RUNBOOK.md`.

Obrigatório cobrir no mínimo:

- owner + técnico + cross-tenant;
- cliente/endereço/Maps;
- voz/IA de orçamento;
- aprovação → uma única OS mesmo com retry;
- venda/material/estoque;
- memória técnica com Antes/Durante/Depois/Equipamento;
- foto/vídeo/relato por voz;
- finalização da OS;
- garantia;
- compras→estoque→financeiro;
- Financeiro V2 e IA baseada somente nos números enviados;
- PDF comercial sem custo/margem;
- cancelamento/reativação;
- técnico desativado;
- mobile e tablet.

## 10. Advisors e logs

Depois das migrations e dos testes:

- rodar Security Advisor;
- rodar Performance Advisor;
- revisar Auth, API, Postgres e Storage logs da branch;
- zero erro novo de segurança crítico/alto;
- não remover índices apenas por `unused_index` em ambiente sem carga representativa.

Antes de lançamento comercial com senha disponível, habilitar leaked password protection no Auth.

## 11. Critério para avançar

Só considerar a V2 candidata a merge quando:

- migrations 0050→0061 aplicam limpas em staging do zero;
- contrato estrutural = OK;
- smoke rollback = OK;
- owner/tech/cross-tenant = OK;
- PDF, IA, mídia, GPS, estoque e financeiro = OK;
- Verify + CodeQL + Vercel = verdes no mesmo HEAD;
- nenhum dado de produção foi usado na homologação.

Mesmo depois disso, merge em `main` e migrations de produção continuam sendo uma etapa separada e controlada.
