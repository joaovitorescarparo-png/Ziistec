# Consolidação do sistema V1

Revisão ampla antes de novas funcionalidades. Ponto de partida: `61bfd83` (branch `claude/blocks34-port-beta-v1`). Método: leitura de código, varreduras roteirizadas (grafo de imports, mapa RPC×tabela, catálogo das migrations) e testes. **Nada foi aplicado em banco real, nada foi publicado, nenhuma migration foi renumerada.** Limites desta revisão: sem homologação em dispositivo; SQL/RLS roda só na CI (não há `psql` local).

Convenções de classificação do inventário: **CANÔNICO** (fonte única viva) · **DUPLICADO** (mesma regra em dois lugares) · **LEGADO** (vivo, mas candidato a absorção) · **TESTE/HOMOLOGAÇÃO** · **MORTO** (sem nenhuma referência) · **DESCONHECIDO** (não provado).

## 1. Arquitetura atual

| Camada | O que é | Classe |
|---|---|---|
| `src/legacy/ZiisTecApp.jsx` (6.983 linhas) | Shell do dono/técnico, fonte canônica compilada. Abas: início, agenda, clientes, catálogo, orçamentos, ordens, compras, financeiro, garantias, equipe, config, assinatura | CANÔNICO (refatorar é trabalho separado) |
| `src/App.jsx` | Sessão, papel (`owner`), 13 rotas técnicas `?v2=` com lazy-load; `abrirRecursoV2` liga o shell às telas V2 | CANÔNICO |
| `src/screens/v2/*` (18 arquivos) | 13 telas roteadas + 5 subcomponentes; nenhuma órfã | ver §Anexo C |
| `src/lib/*` (64 módulos) | Clientes de dados e regras de apresentação; o dado autoritativo vem do banco | CANÔNICO |
| `api/*` (9 arquivos, funções Vercel) | IA (`_aiGateway.js` é o único cliente de provedor), PDF de orçamento, finanças com IA | CANÔNICO |
| `supabase/*.sql` (127 arquivos, 0001–0111) | Schema, RLS, RPCs `SECURITY DEFINER` com `search_path` fixo; definers = **149** (travado por teste) | CANÔNICO |
| `tests/blockers` (71) + `supabase/tests` (44 SQL, rollback-safe) | Gates de `verify:v2` e do runner SQL/RLS da CI | CANÔNICO |

Números históricos: 17 números de migration têm mais de um arquivo (0014–0021, 0025–0032 e 0044), todos anteriores à regra "nunca reutilize número" e ao baseline de produção (0049). A faixa 0100–0111 é sequencial, sem repetição nem lacuna. Não renumerar.

Caminhos únicos confirmados (por teste novo em `consolidation_v1_structure.test.mjs`): conclusão de OS (`finalizarOSDB` → `zt_finalize_work_order_with_warranty_overrides`), cliente de IA no servidor (`api/_aiGateway.js`), reconhecimento de voz no app (`useSpeechInput`), e toda RPC chamada em `src/` e `api/` existe em alguma migration (69 RPCs, 13 só a partir da 0100).

## 2. Duplicações encontradas (14)

Os 18 pontos pedidos foram todos verificados. Os que não geraram duplicação aparecem no fim da tabela.

| # | Duplicação | Arquivos | Canônico | Risco de consolidar | Teste | Decisão |
|---|---|---|---|---|---|---|
| D1 | "Hoje" calculado em UTC (`toISOString().slice(0,10)`) em 11 pontos; das 21h às 24h no Brasil gravava o dia seguinte | `dataApi*`, `quote*V2Api`, `reciboPdf`, 6 telas V2 | `src/lib/dates.js` | Baixo | `consolidation_v1_dates` (7) | **Removida** (bug P2) |
| D2 | Formatação de moeda copiada (`brl`/`money`) em 12 arquivos + 1 chamada inline | 11 telas/componentes, `ProductStockV2`, `fieldSalesApi` | `src/lib/money.js` | Baixo (equivalência provada) | `consolidation_v1_money` (3) | **Removida** (13 pontos; 3 exceções abaixo) |
| D3 | Venda na OS consultava `company_members` de novo, embora o App já soubesse o papel | `WorkOrderSaleV2.jsx`, `App.jsx` | `owner` do App | Baixo | `consolidation_v1_structure` | **Removida**; sem a prop o comportamento antigo continua |
| D4 | Segundo cliente do RPC de venda em OS (`venderProdutoNaOSDB`, id aleatório por chamada) ao lado de `fieldSalesApi` (`ensureRequestId`) | `v2Api.js` | `fieldSalesApi.js` | Baixo (zero chamadas) | F09 ajustado | **Removida** |
| D5 | Helpers `check` (21 cópias) e `n` (8 cópias) idênticos por arquivo | `src/lib/*` | — | Baixo benefício, 29 arquivos tocados | — | Mantida |
| D6 | Compras: aba do shell e `PurchasesV2`. **Escrita única**: `salvarCompraV2DB` delega a `salvarCompraDB` → `zt_save_purchase_idempotent` | `ZiisTecApp.jsx`, `PurchasesV2.jsx` | RPC | Médio (UX) | `f05_archived_creation_sources`, `block7_mobile_resilience` | Mantida; decidir a tela na homologação |
| D7 | Configurações: o shell salva via `contexto.salvarEmpresa`; `SettingsV2` salva `companies` com outra validação (`clean`/`clampInt`). Dois escritores da mesma tabela | `App.jsx`, `settingsV2Api.js` | indefinido | Médio | — | Mantida; unificar depois de escolher a tela |
| D8 | Voz: hook único, mas `public/speech-patch.js` força `continuous`/`interimResults=false` globalmente e conflita com `interimResults=true` do hook | `public/speech-patch.js`, `useSpeechInput.js` | hook | Alto sem aparelho | — | **Mantida**: depende de teste em iOS/Android |
| D9 | IA: gateway único, mas autenticação, owner e cota repetidas em `api/ai.js` e `api/finance-ai.js` (guardadas por `verify-ai-owner-guard` e `verify-paid-ai-gate`, regex sobre o texto) | `api/*` | `_aiGateway.js` | Médio (gates textuais) | os dois gates | Mantida; extrair junto com os gates |
| D10 | PDF: 4 geradores `pdf-lib` (`api/quote-pdf`, `reciboPdf`, `serviceReportPdf`, `serviceReceiptPdf`); logo compartilhada (`pdfLogoBox`) | `src/lib/*Pdf.js`, `api/quote-pdf.js` | — | Médio (layout) | `quote_pdf_totals_layout`, `rc1c_quote_pdf_pagination`, `block3_service_receipt`, `field_workflow_wave2_contract` | Mantida |
| D11 | Rótulos de status da assinatura em duas tabelas (shell e `SettingsV2`); a autoridade de escrita é o banco | `ZiisTecApp.jsx`, `SettingsV2.jsx`, `subscriptionDisplay.js` | `subscriptionDisplay.js` | Baixo | `beta_access_hardening` | Mantida |
| D12 | Mapas: `routeApps.js` (Google/Waze/Apple, preferência por usuário) e outro montador de URL do Google em `clientLocationsV2Api.js` | dois módulos | `routeApps.js` | Baixo | `wave2_routes` | Mantida |
| D13 | Erros: `mensagemErro` em 23 arquivos e 44 `catch` em telas `.jsx` que leem `.message` direto | `src/**` | `mensagemErro` | Médio (textos mudam) | — | Mantida |
| D14 | `company_members` lido ou escrito em 6 pontos com finalidades diferentes (sessão, equipe, plataforma) | `useSessao`, `dataApiExtras`, `platformApi` | por finalidade | — | — | Mantida: não é a mesma regra |

Exceções da D2 (não tocadas de propósito): `ZiisTecApp.jsx` (fonte canônica compilada), `PlatformAdmin.jsx` (`Intl.NumberFormat`, mesma saída) e `serviceReportPdf.js` (formato "R$ 1.234,56" com espaço comum, escolha do PDF).

**Pontos pedidos sem duplicação real:** estoque (três fluxos, cada um com sua RPC: ajuste do dono `zt_adjust_product_stock`, venda em campo, compra); conclusão de OS (um caminho); cliente/local (um RPC de contexto por origem); Financeiro principal × V2 (`FinanceV2` só lê e gera análise; as escritas ficam no shell); V1/V2 de orçamento (mesmo RPC `zt_save_quote_idempotent`, não aprofundado além disso).

## 3. Duplicações removidas

D1, D2, D3 e D4 (4 de 14). Cada uma com teste de equivalência antes de remover. Commits: `9fc770a`, `8b8f5cf`, `1abd995`.

## 4. Código morto removido

8 funções em 4 arquivos, todas com zero chamadas em `src`, `api`, `scripts` e comportamento coberto por outro caminho:

- `v2Api.js`: `venderProdutoNaOSDB`, `excluirContratoDB`, `v2Seguro` (e o import `mensagemErro`, só dela)
- `checklistReturnV2Api.js`: `marcarChecklistItemV2DB`, `carregarRetornosOSV2DB`
- `settingsV2Api.js`: `cancelarAssinaturaSettingsV2DB`, `reativarAssinaturaSettingsV2DB` (o proprietário **não** cancela/reativa; a tela diz isso)
- `dataApiExtras.js`: `atualizarFuncaoColaboradorDB`

Efeitos colaterais, todos tratados: dois testes liam o texto dos arquivos (F09 e `security_v11_contracts`) e um gate estático exigia os marcadores `cancelarAssinaturaDB`/`reativarAssinaturaDB` em `settingsV2Api.js`. Os três foram ajustados em `542a0fe`; o gate manteve `companies` e `subscriptions`. A prova inicial de "zero referências" não olhou o texto dos testes; por isso a falha apareceu no `verify:v2`, não em produção. **Os commits `ae42444`, `1abd995` e `8b8f5cf` não passam `verify:v2` isoladamente; `542a0fe` e o HEAD passam.**

Não removido de propósito: migrations (histórico), codemods Round 3.x (arqueologia), `public/speech-patch.js` (D8).

## 5. Bugs encontrados (4)

| # | Sev. | Bug | Estado |
|---|---|---|---|
| B1 | **P2** | "Hoje" em UTC: entre 21h e 24h (Brasil) lançamentos, orçamentos, compras e recibos recebiam a data do dia seguinte; validade e vencimento derivados eram deslocados | **Corrigido** com teste em `TZ=America/Sao_Paulo` |
| B2 | P3 | Moeda com entrada não numérica aparecia como "R$ NaN" | **Corrigido** (R$ 0,00) |
| B3 | P3 | Shell: `HOJE` é calculado uma vez, na carga do módulo; app aberto atravessando a meia-noite mostra o dia anterior até recarregar | Documentado, não corrigido (toca o legado compilado) |
| B4 | P3 | Somar meses a uma data nos dias 29–31 transborda (31/jan + 1 mês = 3/mar), como no `Date` do JS | Preservado e testado; regra de negócio a decidir |

P0: 0 · P1: 0 · P2: 1 · P3: 3. Risco não reproduzido (não contado como bug): conflito do `speech-patch` (D8).

Varredura de duplo clique: nenhum handler de escrita sem trava em `src/screens/v2` (os 7 handlers analisados têm guarda; `FinanceV2` é só leitura e o botão de IA desabilita durante a chamada). Sem laços com `await` em consulta (N+1), sem polling (o único `setInterval` é o relógio da interface).

## 6. Bugs corrigidos

B1 e B2. Evidência: `consolidation_v1_dates.test.mjs` (7) e `consolidation_v1_money.test.mjs` (3), ambos escritos antes da troca e verdes depois.

## 7. Decisões preservadas

- RLS/RPC é autoridade; nenhuma política, grant ou função foi alterada nesta rodada.
- Conclusão de OS, venda em campo, comprovante não fiscal, Base Técnica e relatório com IA mantêm os caminhos atuais.
- O proprietário não cancela nem reativa a própria assinatura (Beta); `SettingsV2` continua sem checkout.
- Nenhum redesenho visual; o legado compilado não foi refatorado.
- Beta Live congelado em 0099; 0100–0111 seguem **não aplicadas** em qualquer ambiente real.

## 8. Dívidas técnicas

1. Escolher a tela principal de Compras, Configurações e Orçamentos (D6, D7) depois da homologação H0 e então apagar a outra.
2. `speech-patch.js` × `useSpeechInput` (D8): testar em aparelho antes de mexer.
3. Extrair a autenticação/cota repetida de `api/ai.js` e `api/finance-ai.js`, atualizando os dois gates textuais no mesmo commit.
4. `check` e `n` repetidos (D5) e `select('*')` em ~26 pontos de `src/lib` (a segurança vem de RLS/projeções, não do `select`).
5. Marcador textual dos gates `verify-*`: vários validam strings, não comportamento.
6. Legado de 6.983 linhas com tela, estado e regra no mesmo arquivo.

## 9. Riscos

- **Compatibilidade antigo/novo (ver Anexo B):** o frontend novo precisa de 13 RPCs que só existem a partir da 0100. Contra um banco em 0099 ele entra em modo reduzido; a ordem segura continua *frontend novo → migrations juntas, em ordem*. A 0109 retira o EXECUTE do overload antigo de `zt_adjust_product_stock`: o **frontend antigo** perde o ajuste de estoque depois dela.
- SQL/RLS desta rodada só roda na CI; sem execução local.
- Cobertura dos gates é textual em parte (item 5 das dívidas).

## 10. Próximos passos

1. H0 conforme `H0_HOMOLOGATION_PLAN.md` (não executado; exige autorização).
2. Decidir D6/D7 com o roteiro de homologação na mão.
3. Fase F1 fiscal (sandbox) só depois de H0 e de decisão de provedor (`FISCAL_ARCHITECTURE_V1.md`).

---

## Anexo A. Permissões consolidadas

A autoridade é o banco. A tabela resume o que RLS e RPCs impõem (varredura das migrations + 44 testes SQL; 19 deles exercitam membro desativado e o canário de isolamento entre empresas).

| Capacidade | Dono ativo | Técnico ativo | Anônimo | Usuário sem empresa | Desativado |
|---|---|---|---|---|---|
| Clientes, catálogo com custo, fornecedores, compras | Lê/escreve | **Não** (só projeções: `zt_technician_catalog`, `zt_field_work_order_items`) | Não | Não | Não |
| Financeiro, lançamentos, margem, contratos | Lê/escreve | Não | Não | Não | Não |
| Equipe, convites (e-mail com limite, 0110), configurações da empresa | Sim | Não | Não | Cria empresa/aceita convite | Não |
| Ajuste de estoque (0109, idempotente) | Sim | Não | Não | Não | Não |
| Comprovante de Serviço (0100, não fiscal) | Emite/lê | Não | Não | Não | Não |
| OS | Todas da empresa | Só as atribuídas | Não | Não | Não |
| Base Técnica, confirmação de atendimento, relatório com IA (0111) | Sim | Só OS atribuída | Não | Não | Não |
| Venda em campo | Sim | Só OS atribuída, produto liberado; preço resolvido pelo banco | Não | Não | Não |
| Preferência de rota (0106, `user_id = auth.uid()`) | Própria | Própria | Não | — | — |
| Assistente | Ferramentas de dono | Ferramentas limitadas | Não | Não | Não |
| Convites beta / assinaturas (plataforma) | Não | Não | Não | Não | Só administrador da plataforma |

Anônimo: nenhum `GRANT` de função ou tabela para `anon` em 0001–0111 (varredura de linhas) e o teste de catálogo `v2_rc1b_security_definer_audit_rollback.sql` falha se algum definer for executável por `anon`. **Frontend esconde, mas o backend permite:** nenhum caso provado. Resíduo já aceito e documentado: `subscriptions.amount` é legível por membro ativo (preço público do plano). `recursosV2DaAba`, `owner` no App e a escolha `TechnicianSalesV2`/`FieldSalesAdminV2` são só conveniência de interface.

## Anexo B. Migrations 0100–0111 como pacote — PASS

| Verificação | Resultado |
|---|---|
| Ordem e numeração | 0100–0111 sequenciais, sem repetição; ordem numérica é a de aplicação |
| `SECURITY DEFINER` | 16 funções em 8 das 12 migrations (0101, 0106, 0107 e 0108 não criam definer), todas com `set search_path = ''` (as de `zt_private` também); o gate de catálogo exige `search_path` explícito em todo definer e total = 149 |
| Grants | `revoke all … from public, anon` em toda função pública nova; `grant execute … to authenticated` só onde o app chama; nenhum grant a `anon` |
| Tabelas novas (6) | RLS ligada em todas: `service_receipts`, `user_route_preferences`, `team_invite_email_sends`, `work_order_technical_base`, `work_order_attendance_confirmations`, `work_order_ai_reports`. As duas últimas e a de envio de e-mail não têm `GRANT` ao navegador (acesso só por definer) |
| Tenant FK | 0108 troca FK simples por `(supplier_id, company_id)`; aborta sem alterar dados se houver referência cruzada |
| Idempotência | `if not exists` / `create or replace`; 0109 usa índice único `(company_id, client_request_id)`; 0102 e 0111 usam `request_id` |
| Testes | cada função tem teste SQL rollback-safe no runner; `production_baseline_contract.sql` e `v2_post_migration_contract.sql` ficam fora do runner por desenho (usados em `verify-v2-homologation` e no provisionamento) |
| Compatibilidade | Frontend novo × banco 0099: modo reduzido (recua para o comportamento antigo onde a RPC nova não existe). Frontend antigo × banco 0109+: perde ajuste de estoque. A ordem e o plano de reversão já estão em `H0_HOMOLOGATION_PLAN.md` — **sem alteração necessária** |

RPCs que o frontend novo exige (13, primeira migration): `zt_issue_service_receipt` (0100), `zt_save_work_order_report` (0102), `zt_client_service_history` e `zt_work_order_history_detail` (0104), `zt_get_service_report` e `zt_field_work_order_items` (0105), e as sete de 0111 (Base Técnica, confirmação, fatos do relatório, claim/complete/mark-used e uso).

## Anexo C. Telas V2

18 arquivos, nenhum órfão.

| Situação | Telas |
|---|---|
| **Roteadas** (13, via `?v2=`) | `WorkspaceV2Home` (home), `ProductStockV2` (produtos), `PurchasesV2` (compras), `ClientLocationsV2` (clientes-locais), `QuotesManagementV2` (orcamentos), `QuoteAIV2` (orcamento-ia), `ManualWarrantyV2` (garantias), `MaintenanceContractsV2` (contratos), `FinanceV2` (financeiro), `SettingsV2` (configuracoes), `PostSaleV2` (pos-venda), `WorkOrderSaleV2` (venda-os), `WorkOrderMemoryV2` (memoria-os) |
| **Subcomponentes** (5) | `FieldSalesAdminV2`, `TechnicianSalesV2` (sob `WorkOrderSaleV2`), `QuoteAIBaseV2`, `QuoteReuseEditorV2` (sob `QuoteAIV2`), `WorkOrderMemoryBaseV2` (sob `WorkOrderMemoryV2`) |
| **Integradas ao shell do dono** (6, `recursosV2.js`) | produtos, clientes-locais, garantias, pós-venda, contratos, financeiro; mais `venda-os` pelo atalho "Venda em campo" |
| **Sem entrada direta no shell** | compras, configurações, orçamentos (gestão), home (só por URL); orçamento com IA (aberto a partir de garantia e da memória da OS); memória da OS (aberta pelo pós-venda, pelo Assistente e pela home). O dono usa as abas do shell; a V2 equivalente existe e é a candidata de D6/D7 |
| **Obsoletas comprovadas** | nenhuma. Nada sem importador; remover uma tela exige decidir D6/D7 primeiro |

## Anexo D. Performance (só o óbvio)

Sem N+1 (nenhum `await` de consulta dentro de laço em `src/lib`), sem polling (um `setInterval` de relógio), sem recarga de página após salvar. `select('*')` em ~26 pontos (`runtimeApi` 8, `dataApi` 7, `dataApiExtras` 3): não alterado, a segurança é de RLS/projeção; revisar com volume real. Nenhuma otimização especulativa.

## Anexo E. Revisão de experiência

Por leitura de código e dos fluxos entregues em Field Execution V1; **não substitui a homologação em aparelho.**

- **Técnico** (login → Meu dia → OS → rota → iniciar → Base Técnica → materiais → evidências → relatório → confirmação → concluir): caminho único de conclusão; o fechamento nunca depende da IA nem da Base Técnica (cai para "indisponível"); nenhum valor financeiro na tela; datas agora usam o dia local do aparelho (B1). Ponto a testar em aparelho: ditado por voz (D8).
- **Dono** (uma função, um lugar principal): hoje há duas telas para Compras, Configurações e Orçamentos (D6, D7). Produtos/estoque, locais, garantias, pós-venda, contratos e financeiro já têm entrada única no shell.
