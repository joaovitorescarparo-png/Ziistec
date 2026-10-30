# Assistente ZiisTec — cobertura do proprietário

Matriz da auditoria de 2026-10-12 (base `7f0a0a4`, Staging com 0095). Mostra o que existe de verdade na plataforma, o que o Assistente cobre e qual caminho canônico ele usa. A IA só interpreta: toda leitura e toda escrita passam por uma ferramenta conhecida (`src/lib/assistantTools.js`) e por uma RPC do banco que revalida usuário, empresa, papel, assinatura e estado.

Legenda: **L** leitura, **E** escrita, **O** owner, **T** technician. RPC canônica significa uma função do banco que já valida a regra de negócio. "Direto" significa que a tela grava na tabela via RLS, sem RPC.

| Área | Tela | Tabela/RPC atual | L | E | O | T | Assistente antes | Assistente agora (V1) | Caminho seguro |
|---|---|---|---|---|---|---|---|---|---|
| Clientes | ClientLocationsV2, legado | `clients` (direto) | ✔ | direto | ✔ | — | buscar, telefone, cadastrar | + histórico, equipamentos, garantias, saldo devedor, inativos | leitura: `zt_assistant_read`; cadastro: `zt_assistant_execute` (existente) |
| Locais do cliente | ClientLocationsV2 | `client_locations`, `zt_create_client_location_for_quote` | ✔ | RPC | ✔ | — | — | local aparece no histórico | edição: **GAP** (cliente/local gravam direto) |
| Agenda | legado, mobile | `work_orders` | ✔ | direto + `zt_save_work_order_idempotent` | ✔ | atribuídas | hoje, próximo, agendar, reagendar, desagendar, cancelar | + semana, dia, OS sem agenda | `zt_assistant_read`; escritas existentes |
| OS | legado, WorkOrderMemoryV2 | `work_orders`, `zt_save_work_order_idempotent` | ✔ | RPC | ✔ | atribuídas | buscar por número, criar | + detalhe completo da OS | `zt_assistant_read` |
| Memória técnica/relatos | WorkOrderMemoryV2 | `work_order_reports` (`report`, `history`, `service_report`) | ✔ | direto (relato) | ✔ | atribuídas | técnico registra relato | relato aparece no histórico/detalhe | leitura |
| Evidências/fotos | WorkOrderMemoryV2 | `attachments`, `zt_register_work_order_evidence` | ✔ | RPC + Storage | ✔ | atribuídas | — | contagem no detalhe da OS | upload por voz: **GAP** (arquivo binário) |
| Equipamentos instalados | InstalledEquipmentPanel | `installed_equipment`, `zt_register_installed_equipment` | ✔ | RPC | ✔ | atribuídas | — | equipamentos por cliente e por OS | leitura |
| Orçamentos | QuotesManagementV2, QuoteAIV2 | `quotes`, `zt_save_quote_idempotent` | ✔ | RPC | ✔ | — | criar, buscar, editar, duplicar, arquivar | + gerar OS do orçamento aprovado | `zt_create_work_order_from_quote`; aprovar: **GAP** (status gravado direto) |
| Produtos | ProductStockV2 | `products` (direto) | ✔ | direto | ✔ | catálogo de campo | buscar, cadastrar | + estoque, estoque baixo | edição de produto: **GAP** |
| Serviços | legado | `services` (direto) | ✔ | direto | ✔ | — | buscar, cadastrar | — | edição: **GAP** |
| Estoque | ProductStockV2 | `inventory_movements`, `zt_adjust_product_stock` | ✔ | RPC | ✔ | — | — | saldo, baixo estoque, movimentos, ajuste | `zt_adjust_product_stock` |
| Compras | PurchasesV2 | `purchases`, `purchase_items`, `zt_save_purchase_idempotent` | ✔ | RPC | ✔ | — | — | últimas compras, compras a vencer, compras do produto no mês | lançar compra: **GAP** (fornecedor, itens e custo exigem formulário) |
| Fornecedores | — | `suppliers` (sem tela) | — | — | — | — | — | nome do fornecedor nas compras | **GAP**: não há tela nem RPC |
| Garantias | ManualWarrantyV2 | `warranties`, `zt_create_manual_warranty` | ✔ | RPC | ✔ | atribuídas | — | garantias do cliente, a vencer, garantia manual | `zt_create_manual_warranty` |
| Retornos | legado/mobile | `work_order_returns`, `zt_mark_work_order_needs_return` | ✔ | RPC | ✔ | atribuídas | técnico marca retorno | retornos no histórico/detalhe | leitura |
| Financeiro | FinanceV2 | `financial_entries`, `zt_save_manual_financial_entry`, `zt_set_financial_paid` | ✔ | RPC | ✔ | — | lançar receita | + resumo do mês, a receber, em atraso, saldo do cliente | `zt_assistant_read`; dar baixa: **GAP** nesta versão (a RPC existe, mas a escrita financeira ainda depende de homologação própria) |
| Despesas | legado | `financial_entries` (expense) | ✔ | RPC | ✔ | — | — | despesas no resumo, compras a vencer | lançar despesa: **GAP** (ferramenta só de receita hoje) |
| Contratos/preventivas | MaintenanceContractsV2 | `maintenance_contracts` (upsert direto), `zt_generate_maintenance_contract_cycle` | ✔ | direto + RPC | ✔ | — | — | contratos ativos, próximas visitas/cobranças, visitas atrasadas | criar/editar contrato: **GAP** (gravado direto) |
| Pós-venda | PostSaleV2 | `post_sale_followups`, `zt_list_post_sale_followups`, `zt_update_post_sale_followup` | ✔ | RPC | ✔ | — | — | pendências da semana, clientes inativos, concluir/dispensar | `zt_update_post_sale_followup` |
| Relatórios | FinanceV2 (rentabilidade), memória | agregações do front | ✔ | — | ✔ | — | — | OS concluídas no mês, clientes e serviços mais atendidos | `zt_assistant_read` (agregação no banco) |
| Configurações | SettingsV2 | `companies` (update direto), assinatura | ✔ | direto | ✔ | — | — | — | **GAP** proposital: configuração não é operação por voz |
| Equipe | legado | `company_members`, `zt_update_team_member`, convites diretos | ✔ | RPC/direto | ✔ | — | — | — | **GAP**: convite e permissão exigem fluxo próprio |
| Vendas em campo | TechnicianSalesV2, WorkOrderSaleV2 | `field_sales`, `zt_sell_product_direct`, `zt_sell_product_on_work_order` | ✔ | RPC | ✔ | ✔ | — | — | **GAP** nesta versão: pagamento + estoque + Pix pedem a tela própria |

## Implementado nesta versão (0096/0097, sem aplicar no Staging)

- **Consultas do proprietário** (`zt_assistant_read`, só leitura):
  - clientes e OS: histórico do cliente, detalhes da OS, equipamentos do cliente, garantias do cliente e garantias a vencer;
  - agenda: semana, dia e OS sem agenda;
  - estoque: saldo, estoque baixo e movimentações;
  - compras: últimas, a pagar e compras de um produto no mês;
  - contratos (ativos e com visita atrasada), pós-venda pendente e clientes inativos;
  - financeiro: resumo do mês, a receber e clientes em atraso;
  - relatório operacional do mês.
- **Escritas com prévia e confirmação** (`zt_assistant_plan` → `zt_assistant_execute`):
  - gerar a OS de um orçamento aprovado;
  - ajustar estoque, com confirmação reforçada;
  - registrar garantia manual;
  - concluir ou dispensar um pós-venda.
- **Continuidade sem IA** pela referência ativa: "puxe o histórico desse cliente", "o que foi feito no último", "quem foi o técnico", "qual equipamento foi instalado", "mostra os últimos 10" e "tem alguma garantia ativa".
- **Fica de fora (GAP):**
  - aprovar orçamento;
  - editar cliente, local, produto, serviço ou contrato;
  - lançar compra ou despesa;
  - dar baixa em recebimento;
  - venda em campo;
  - evidência por voz;
  - equipe e configurações.

## Regras que o Assistente segue

- Leitura do proprietário: `public.zt_assistant_read` (0096). Ela valida a ação, filtra por `company_id`, aplica limite e ordenação no banco e grava a auditoria `read`. Nunca devolve custo nem margem: compras mostram o total da nota, porque esse é o próprio documento da compra.
- O resultado vai só para a tela do usuário. O provedor de IA nunca recebe o resultado das consultas. Recebe apenas a `REFERÊNCIA_ATIVA`, revalidada e sem IDs.
- Escrita nova só entra quando já existe RPC canônica e passa por `zt_assistant_plan` → prévia → confirmação → `zt_assistant_execute`, com `requestId`, `previewHash` e execução única.
- O Financeiro usa as definições da tela FinanceV2:
  - faturado = receitas com vencimento no mês;
  - recebido = receitas pagas no mês (`paid_at`, ou o vencimento quando não há data de pagamento);
  - a receber = receitas do mês em aberto;
  - em atraso = receitas em aberto vencidas antes de hoje;
  - resultado de caixa = recebido − despesas pagas.
