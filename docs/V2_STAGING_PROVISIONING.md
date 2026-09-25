# ZiisTec V2 — provisionamento seguro de homologação

> Objetivo: validar a Product V2 sem tocar dados, Auth, Storage ou schema de produção.
> A branch `product-v2-review` e a PR #9 continuam fora da `main` até este fluxo ficar verde.

## Regra zero

- **Nunca usar o Supabase de produção em Preview/Staging.**
- **Nunca clonar dados de produção para homologação.**
- **Nunca aplicar 0050→0061 direto em produção para “testar”.**
- **Nunca usar service_role/secret key no frontend.**
- Homologação deve ter projeto, banco, Auth, Storage, URL e publishable key próprios.

O frontend já falha fechado: previews sem `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` não usam o fallback de produção. O fallback público só existe nos hosts oficiais da `main`.

## Política atual de custo

A branch paga de homologação está **adiada** enquanto o ZiisTec não tiver mais de 4 clientes pagantes.

Até existir **5 ou mais clientes pagantes**, ou autorização explícita do proprietário para um custo específico, a regra é usar somente recursos sem custo adicional.

A consulta feita em 26/08/2026 mostrou:

- organização Supabase atual no plano Free;
- projeto Supabase separado: custo informado pelo conector = **US$ 0/mês**;
- branch Supabase: custo informado pelo conector = **US$ 0,01344/hora**.

Portanto, o caminho preferido de homologação durante a fase sem custo é **um projeto Supabase separado e gratuito**, nunca a branch paga. A criação do projeto gratuito só ocorre após escolha/autorização explícita da organização pelo proprietário, conforme exigido pelo Supabase.

Enquanto esse projeto separado ainda não existir, a homologação usa:

- CI/Verify/CodeQL já existentes;
- Preview Vercel já conectado;
- leitura, advisors e logs do Supabase atual;
- testes SQL controlados com `BEGIN ... ROLLBACK`;
- contratos estáticos e testes versionados no repositório.

Nenhuma branch paga deve ser criada apenas para acelerar desenvolvimento. A política completa está em `docs/NO_COST_DEVELOPMENT_POLICY.md`.

## 1. Caminho preferido agora — projeto staging separado e gratuito

Pré-condições:

1. PR #9 continua `OPEN` + `DRAFT`.
2. `main` continua sem as migrations V2.
3. `Verify` e `CodeQL` do HEAD estão verdes.
4. O custo atual do projeto separado foi consultado e continua US$ 0/mês.
5. O proprietário escolheu explicitamente a organização onde o projeto será criado.
6. O staging nasce sem qualquer dado real de produção.

Nome sugerido: `Ziistec Staging`.
Região preferida: `sa-east-1`, acompanhando produção e reduzindo diferenças regionais.

Depois da criação, registrar somente para configuração do ambiente:

- `STAGING_PROJECT_REF`
- `STAGING_SUPABASE_URL`
- `STAGING_PUBLISHABLE_KEY`

Não registrar secret/service key no GitHub, frontend, documentação ou logs.

## 1B. Branch Supabase paga — somente no futuro

A branch nativa permanece proibida durante a política sem custo. Só pode ser considerada quando:

1. O ZiisTec tiver pelo menos 5 clientes pagantes **ou** o proprietário autorizar explicitamente o custo específico.
2. O custo da branch for consultado novamente imediatamente antes da criação.
3. Houver uma razão técnica clara para preferi-la ao projeto staging separado.

Branch sugerida, se um dia necessária: `v2-homologation`.

## 2. Confirmar baseline do staging antes da V2

No projeto separado de staging:

- confirmar `ACTIVE_HEALTHY`;
- confirmar que não há clientes, OS, compras ou anexos reais;
- confirmar Auth/Storage próprios;
- aplicar somente a fundação/migrations necessárias para reproduzir o schema atual de produção;
- conferir migration history/base schema antes de qualquer DDL V2.

Se houver qualquer dado real inesperado, parar e recriar staging vazio.

## 3. Aplicar a stack V2 em ordem

Aplicar **somente no projeto de homologação**, nesta ordem:

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

## 4. Rodar contrato estrutural

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

## 5. Rodar smokes rollback-only

Executar:

- `supabase/tests/v2_access_subscription_rollback_smoke.sql`
- `supabase/tests/v2_technician_sale_rollback_smoke.sql`

Resultados obrigatórios:

- `V2_ACCESS_REVOCATION_OK`
- `V2_SUBSCRIPTION_REACTIVATION_OK`
- `V2_TECHNICIAN_SALE_COST_ISOLATION_OK`

Os arquivos terminam em `ROLLBACK` e devem provar:

- técnico ativo vê sua OS;
- técnico desativado perde acesso na próxima requisição;
- assinatura cancelada bloqueia escrita;
- cancelar não apaga dados;
- reativar dentro do período restaura escrita;
- técnico vende produto somente na OS atribuída;
- tentativa de venda em OS não atribuída recebe bloqueio;
- venda reduz estoque e cria movimento correto;
- `unit_cost` público do item fica zero;
- ledger de custo é invisível ao técnico e visível ao owner.

## 6. Criar identidades de homologação

Usar **somente Auth do staging**.

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

## 7. Conectar a Vercel Preview

O preview da PR deve receber, como par inseparável:

- `VITE_SUPABASE_URL=<URL DO STAGING>`
- `VITE_SUPABASE_ANON_KEY=<PUBLISHABLE KEY DO STAGING>`

Regras:

- nunca configurar apenas uma das duas;
- nunca apontar preview para `diztevlpbcfqleizswxr.supabase.co`;
- depois de configurar, redeployar o HEAD da PR;
- confirmar na tela que o aviso “ZiisTec V2 sem banco de homologação” desapareceu;
- confirmar por rede/logs que as chamadas usam o `project_ref` do staging.

## 8. Homologação funcional real

Seguir `docs/V2_HOMOLOGATION_RUNBOOK.md`.

Obrigatório cobrir no mínimo:

- owner + técnico + cross-tenant;
- cliente/endereço/Maps;
- voz/IA de orçamento (IA paga permanece desligada enquanto a política sem custo estiver ativa);
- aprovação → uma única OS mesmo com retry;
- venda/material/estoque;
- memória técnica com Antes/Durante/Depois/Equipamento;
- foto/vídeo/relato por voz;
- finalização da OS;
- garantia;
- compras→estoque→financeiro;
- Financeiro V2 baseado nos números reais; IA somente quando futuramente habilitada de forma explícita;
- PDF comercial sem custo/margem;
- cancelamento/reativação;
- técnico desativado;
- mobile e tablet.

## 9. Advisors e logs

Depois das migrations e dos testes:

- rodar Security Advisor;
- rodar Performance Advisor;
- revisar Auth, API, Postgres e Storage logs do staging;
- zero erro novo de segurança crítico/alto;
- não remover índices apenas por `unused_index` em ambiente sem carga representativa.

Antes de lançamento comercial com senha disponível, habilitar leaked password protection no Auth.

## 10. Critério para avançar

Só considerar a V2 candidata a merge quando:

- migrations 0050→0061 aplicam limpas em staging do zero;
- contrato estrutural = OK;
- smokes rollback = OK;
- owner/tech/cross-tenant = OK;
- PDF, mídia, GPS, estoque e financeiro = OK;
- recursos pagos permanecem desligados durante a política sem custo;
- Verify + CodeQL + Vercel = verdes no mesmo HEAD;
- nenhum dado de produção foi usado na homologação.

Mesmo depois disso, merge em `main` e migrations de produção continuam sendo uma etapa separada e controlada.
