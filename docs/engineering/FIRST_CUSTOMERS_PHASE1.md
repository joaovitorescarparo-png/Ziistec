# ZiisTec V1 — First 10 Customers · Fase 1 (produto vendável)

Data: 2026-10-29 · Branch: `claude/blocks34-port-beta-v1` · Base: `054fc74`.
Escopo: confirmar, com evidência executável, que o fluxo principal funciona e que o Comprovante de Serviço não fiscal está completo. Nada foi aplicado em Staging/Beta/Production.

## 1. Fluxo crítico → evidência

Nenhum bug antigo foi presumido: cada item abaixo foi conferido no código e em teste que passa neste SHA.

| Etapa | Evidência |
|---|---|
| Cliente → orçamento → edição → aprovação | `v2_first_customers_golden_path_rollback.sql` (novo), `v2_f01_quote_financial_snapshot_matrix_rollback.sql`, `quote_edit_hooks_order.test.mjs` |
| PDF do orçamento | `quote_pdf_totals_layout.test.mjs`, `rc1c_quote_pdf_pagination.test.mjs`, `rc1c2_quote_totals_layout.test.mjs` |
| Orçamento → OS com responsável e agendamento (persistem após recarregar) | golden path, `v2_f03_quote_to_wo_flow_rollback.sql`, `rc1c2_schedule_existing_work_order.test.mjs`, `work_order_responsible_name.test.mjs` |
| Execução em campo, fotos, relato, Base Técnica | golden path, `v2_rc1b_attachment_upload_idempotency_rollback.sql`, `field_execution_*.test.mjs` |
| Conclusão atômica → financeiro | golden path, `v2_block4_work_order_lifecycle_rollback.sql` |
| Comprovante não fiscal | golden path, `v2_block3_service_receipts_rollback.sql`, `block3_service_receipt.test.mjs` |
| Histórico do serviço | golden path, `v2_block4_client_service_history_rollback.sql`, `block4_execution_history.test.mjs` |
| Separação por empresa, RLS e papéis | golden path (empresa B e técnico), `v2_release_hardening_v12_rollback.sql`, `v2_block5_technician_exposure_rollback.sql` |
| Scroll e formulários em mobile/tablet | somente testes de contrato estáticos: `modal_viewport`, `rc1c_*`, `mobile_wave*`, `block7_mobile_resilience`. **Não há validação em aparelho real** (ver bloqueador 3) |

O golden path (32 checks) percorre a cadeia inteira pelas RPCs e políticas reais, lendo de volta as colunas que o app lê, e confere: reenvio idempotente do orçamento e do botão "gerar OS", total editado (R$ 680) chegando ao snapshot da OS, ao lançamento financeiro, ao comprovante e ao histórico; técnico sem preço, sem financeiro e sem emissão; empresa B sem leitura nem escrita (0 linhas afetadas).

Contrato frontend ↔ banco (verificação manual, não está no CI): 64 RPCs distintas, 94 leituras e 16 escritas de `src/` e `api/` conferidas contra o esquema 0001–0112 (nomes, argumentos, colunas, privilégios por coluna e embeds contra FKs). Nenhuma divergência.

## 2. O que mudou na Fase 1

- O PDF do comprovante passou a trazer a frase exata **"Comprovante de serviço — documento não fiscal."** no topo (antes: "DOCUMENTO NÃO FISCAL"). O travessão é desenhado direto: `clean()` o trocaria por hífen. O rodapé de cada página continua com "Documento não fiscal · Comprovante CS-000N".
- Novo teste de PDF confere empresa, cliente, OS, data de conclusão, serviço, relato, itens, total, técnico e observações.
- Novo `v2_first_customers_golden_path_rollback.sql`, registrado em `scripts/run-sql-rls-ci.sh`.

## 3. Bloqueadores que não são de código

1. **Migrations 0100–0112 não estão aplicadas em nenhum ambiente.** Comprovante, histórico do cliente, Base Técnica e os endurecimentos V1/V1.1/V1.2 só existem no banco descartável. Staging/Beta Live está congelado em 0099 e tem dados reais: aplicar exige autorização explícita e o roteiro de `H0_HOMOLOGATION_PLAN.md`.
2. **Production está na baseline 0049, vazia.** O go-live exige levar 0050–0112, depois do H0, com aprovação de release.
3. **H0 em aparelhos reais não foi executado** (scroll/formulários em celular e tablet, câmera/fotos, PDF no celular, comprovante por WhatsApp). Depende de pessoa, aparelhos e conta de teste.
4. **Sem E2E de navegador com sessão autenticada**: não há credenciais de teste neste ambiente; a jornada foi provada no banco e nos testes unitários/contratuais.

Regra para os próximos passos: nada disso se resolve improvisando; cada item pede decisão ou credencial humana.
