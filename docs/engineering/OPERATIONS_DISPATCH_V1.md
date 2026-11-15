# Central de Operações + Command Engine V1 (0116)

Despacho profissional das OS entre a equipe, e a camada de comandos que o futuro
agente (WhatsApp, voz, Assistant, app) vai usar — ambos sobre as **mesmas** OS,
RPCs e regras de tenant. Não há dois sistemas.

## Auditoria antes de construir (Fase 0)

Mapa `CURRENT FIELD -> uso na Central de Operações`:

| Já existia | Uso no despacho |
| --- | --- |
| `work_orders.assigned_to` | coluna do executor; `null` = "Sem responsável" |
| `work_orders.scheduled_date` / `scheduled_time` | hoje/amanhã/semana/atrasadas e a hora do cartão |
| `work_orders.status` (`zt_wo_status`) | filtros aguardando / em andamento / concluídas |
| `work_orders.client_location_id` + `client_locations` (0083) | local do cartão |
| `work_orders.service_place` / `address` | local textual quando não há local cadastrado |
| `work_orders.request` / `problem_report` | resumo do cartão |
| `work_orders.deleted_at` | fora do quadro |
| `company_members` (role + status) | quem pode executar, inclusive o proprietário |
| `zt_is_owner` / `zt_wo_is_mine` / guard 0012+0031 | autorização; o técnico já não podia mudar `assigned_to` |
| `zt_private.assert_operational_write_allowed` | assinatura ativa |
| `client_request_id` (convenção 0109/field_sales) | idempotência por pedido |
| `src/lib/agendaMobile.js` | padrão de regra pura + teste, seguido por `operationsBoard.js` |

O que **faltava** e por isso foi criado na 0116:

- `work_orders.priority` — não existia (`work_order_returns.priority` é outro
  conceito: prioridade do retorno). Três níveis, sem SLA.
- `work_order_dispatch_events` — auditoria por empresa. `platform_audit_logs`
  (0010) é de plataforma e só platform admin lê, então não servia.
- RPCs oficiais de despacho — antes a atribuição era `UPDATE` direto, sem
  auditoria, sem idempotência e sem validar executor ativo.

## Backend (0116)

- `zt_assign_work_order(p_work_order, p_assignee, p_request, p_source)` —
  `p_assignee` nulo devolve para "Sem responsável". Trava a OS para escrita,
  recusa OS concluída/cancelada, exige dono da empresa da OS, exige executor
  membro **ativo** (o proprietário conta: a empresa pode ser só ele), exige
  assinatura ativa, grava auditoria e é idempotente por pedido.
- `zt_schedule_work_order(...)` — data nula remove do calendário; OS em
  andamento não volta de status.
- `zt_set_work_order_priority(...)`.
- `zt_operations_board(p_company, p_from, p_to, p_limit, p_include_done)` — o
  quadro inteiro numa chamada (elenco + cartões), sem N+1. **As colunas
  financeiras não entram no SELECT**: sanitização estrutural. Só o filtro
  "Concluídas" pede histórico.
- `zt_work_order_schedule_conflicts(...)` — conflito é **aviso**, nunca trava.

Idempotência: `uq_wo_dispatch_events_request` por empresa. O mesmo pedido
devolve o mesmo evento (`replayed: true`); o mesmo pedido com outro alvo é
`23505`.

Guard estendido: o técnico também não altera `priority` — nem por RPC, nem por
`UPDATE` direto.

**Pegadinha achada pelos testes:** a 0105 revoga `SELECT` de `work_orders` e
concede coluna por coluna, com a lista da época. Coluna nova nasce **ilegível**
para o app. A 0116 refaz a mesma concessão (tudo menos `approved_*`) incluindo
`priority`. Qualquer migration futura que adicione coluna em `work_orders`
precisa fazer o mesmo.

## Frontend

- `src/lib/operationsBoard.js` — regra pura: filtros, ordenação (urgente, hora,
  número), colunas, carga, atraso, conflito local, validação do movimento e
  aplicação local para rollback. Sem navegador e sem banco, então testável.
- `src/lib/operationsApi.js` — leitura em uma chamada; escrita só pelas RPCs,
  com origem declarada e pedido idempotente. Nenhum `UPDATE` direto.
- `src/components/OperationsBoard.jsx` — coluna por executor + "Sem
  responsável". O proprietário aparece como executor. Técnico sem serviço mantém
  a coluna (é a informação de que está livre). Responsável que saiu do elenco
  não desaparece. O arraste aplica na hora e **volta atrás** se a RPC recusar.
  No celular o arraste não é obrigatório: cada cartão tem "Atribuir".
- Papel: `operacoes` só para o proprietário — despachar é ato administrativo, e
  o banco já recusava o técnico. O técnico mantém a própria Agenda.
- "Hoje" vem de `hojeISO()` (`src/lib/dates.js`), nunca do corte de
  `toISOString()`, que é o dia em UTC e erra das 21h à meia-noite no Brasil.

## Command Engine

`INPUT -> PARSE -> RESOLVE -> PROPOSE -> CONFIRM -> EXECUTE`, com 6 intents:
`create_work_order`, `schedule_work_order`, `assign_work_order`,
`add_work_order_note`, `get_schedule`, `get_work_order`.

- **Empresa sempre da sessão.** `company_id` no payload é recusado
  (`forbidden`). Cross-tenant fica impedido por construção.
- **Ambiguidade nunca é resolvida em silêncio.** Dois "Plaza" ou dois "João"
  param em `needs_clarification` com as opções. Exato vence parcial.
- **Data absoluta antes de confirmar.** "amanhã às 9" vira
  `2026-11-16 09:00` em `America/Sao_Paulo` e a proposta mostra o dia exato.
  Data que o engine não entende é recusada, não chutada.
- **Confirmação obrigatória** para escrita; consulta (`get_*`) não escreve.
- **Execução só pelas RPCs oficiais** — `zt_save_work_order_idempotent`,
  `zt_assign_work_order`, `zt_schedule_work_order`,
  `zt_save_work_order_report`, `zt_operations_board`,
  `zt_work_order_history_detail`. O agente não escreve em tabela.
- O contexto de resolução é só o que a sessão enxerga: cliente que o usuário não
  vê não pode ser alvo de comando.

Detalhe honesto: a RPC oficial de criação atribui a OS a **quem chama**. Quando o
comando não pede responsável, o engine desatribui em seguida pela própria
operação oficial, para a OS cair em "Sem responsável" — e isso fica auditado
como `unassign`, em vez de virar escrita direta.

O simulador (`OperationsCommandSimulator`) usa um extrator determinístico
(`operationsCommandDraft.js`) só para exercitar o engine. Quando houver NLU/LLM,
ele substitui essa função e o resto não muda.

## Testes no gate oficial

- `v2_operations_dispatch_rollback.sql` (64 checks) — matriz de distribuição,
  recusas, idempotência, agenda, conflito como aviso, técnico sem despacho e sem
  quadro, Empresa B sem acesso, e o quadro sem nada financeiro nem PII.
- `v2_operations_golden_path_rollback.sql` (16 checks) — o fluxo inteiro, do
  arraste à OS criada pelo agente e distribuída com origem registrada.
- `tests/blockers/operations_board_contract.test.mjs` (14) e
  `operations_command_engine.test.mjs` (19).

Guards existentes estendidos pelo caminho que eles documentam: inventário de
definers 162 -> 169, listas de migrations pós-0105 com a 0116, e o SEC-01
passando a apontar a definição vigente da trava do técnico (agora cobrindo
`priority`).

## Integração com a Central Técnica segura

A 0116 entra **depois** das 0113-0115 corrigidas pelo security fix, e as duas
features convivem sobre a mesma OS. O que isso implica:

- cadeia de definers: 149 (0112) -> **164** com as 0113-0115 corrigidas ->
  **171** com a 0116. O inventário do gate nomeia os dois catálogos; os guards
  de trigger (`zt_guard_work_order_technician_update`,
  `zt_eq_guard_company_immutable`, `zt_eq_guard_document_official`) seguem
  `SECURITY INVOKER` e não entram nessa conta;
- os casos da Central são **curados**: a Base Técnica interna não vira caso
  sozinha, só o owner publica, e `zt_equipment_cases` devolve apenas o texto
  publicado. O despacho não muda nada disso — ele só coloca a OS na mão do
  técnico certo;
- `v2_operations_central_cross_feature_rollback.sql` (37 checks) prova a jornada
  completa numa OS só e que nada vaza em nenhum ponto: nem texto bruto da OS,
  nem Base Técnica interna, nem PII, nem número/id da OS, nem financeiro — nem
  no caso publicado, nem no quadro de operações.

## Riscos e pendências

- 0116 **não aplicada em nenhum ambiente**. H0 está com outra frente fechando a
  Central Técnica; nada foi publicado aqui e nenhum Preview foi criado.
- Realtime não foi adicionado: o quadro recarrega sob demanda e após cada
  movimento. Com equipes grandes e muitos despachantes simultâneos, avaliar
  depois — não antes de haver necessidade medida.
- Duração estimada por técnico não existe no produto, então a carga mostra
  contagem de serviços, não horas. Nada foi inventado.
- WhatsApp real: ver `WHATSAPP_AGENT_V1_PLAN.md`. Nada implementado.
