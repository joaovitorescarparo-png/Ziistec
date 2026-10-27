# Auditoria de segurança V1 (hardening)

Base: branch `claude/blocks34-port-beta-v1`, HEAD de partida `1c43b5e` (Onda 1 + Onda 2 concluídas, Vite 6.4.5, migrations 0100–0106 no repositório e **não aplicadas em nenhum ambiente real**). Esta rodada acrescenta a migration `0107`, que também **não foi aplicada em banco real**. Beta Live (`xadoktssibuuebzzjrhv` / `beta.ziistec.com`) segue congelado em 0099, Production e `main` intocados, nenhum dado real usado.

Método: leitura do código e das migrations; laboratório local (PGlite) que reexecuta as migrations na ordem da CI e permite atacar RPCs, DML direto e Storage com papéis reais (`anon`, `authenticated`) e `auth.uid()` simulado; ataques diferenciais com marcadores (`ZZVITIMA`) e números secretos antes/depois; testes JS com rede bloqueada. Os resultados do laboratório valem como evidência de comportamento do SQL versionado; a prova final em Postgres/Supabase real é a CI (`sql-rls`).

## 1. Modelo de ameaça

**Atores:** visitante anônimo; usuário autenticado sem empresa; proprietário (`owner`); técnico (`technician`); colaborador desativado; usuário de outra empresa; atacante externo; atacante com conta legítima (dono ou técnico malicioso na própria empresa); cliente do navegador manipulado (Network tab, Data API direta, RPC direta).

**Ativos:** dados de clientes (nome, telefone, e-mail, endereço); OS, fotos e evidências; financeiro, custos, margens, valores aprovados; orçamentos, PDFs e comprovantes; estoque e compras; equipe e convites; preferências; Assistente; chaves e API de IA; Storage; contratos de manutenção e futuros dados fiscais.

**Fronteiras de confiança:** o navegador nunca é autoridade. Autoridade é o banco (RLS + RPC) e, nas rotas `api/*`, a checagem de papel no banco antes de quota, dado ou provedor de IA. Papel e empresa nunca vêm do corpo da requisição nem de `user_metadata`.

**Cenários priorizados:** leitura/escrita cross-tenant (A→B); técnico lendo ou alterando custo, margem, financeiro, fornecedor; técnico escalando para dono; usuário desativado ainda operando; IDOR/BOLA por troca de ids; upload malicioso; segredo no bundle; XSS/URL maliciosa; instrução maliciosa ao Assistente; duplicidade financeira por retry; abuso de custo (IA, PDF, e-mail).

## 2. Superfícies auditadas

| Superfície | Como foi auditada | Resultado |
|---|---|---|
| Tabelas `public` (RLS) | Catálogo: RLS ligado em todas; sem policy `true`; toda policy de UPDATE com `WITH CHECK`; `anon` sem privilégio de tabela; DELETE/INSERT/UPDATE de `authenticated` dentro de lista permitida | OK (invariantes no teste SQL) |
| Isolamento entre empresas | Dono A e técnico A contra a empresa B: SELECT, UPDATE, DELETE em toda tabela com `company_id`; INSERT com referências cruzadas; instantâneo da empresa B antes/depois de todos os ataques | 0 vazamento, 0 alteração (exceção registrada: SEC-03, referência de fornecedor sem leitura) |
| RPCs (`public.*`) | Barragem de RPCs sensíveis com ids da empresa B e marcadores; ~367 chamadas em 4 contextos (dono A, técnico A, sem empresa, técnico desativado) | 0 vazamento; erros genéricos |
| `SECURITY DEFINER` | Inventário por catálogo: `search_path` explícito, nenhum executável por `anon`/PUBLIC; amostra de corpos (0012, 0031, 0033, 0044, 0052, 0063, 0066, 0068, 0100–0105); `0106` não cria definer; sem revogação em massa por nome | 1 achado (SEC-01) + higiene (SEC-07). Revisão linha a linha das 140 funções **não** foi feita (ver §9) |
| Técnico × dono | Matriz de leitura/escrita; marcadores secretos de custo/margem/pagamento nas tabelas e nas projeções da 0105 | Sem exposição; 1 escrita indevida (SEC-01) |
| Usuário desativado | Mesma barragem como colaborador `inactive` | Sem acesso |
| Storage | Policies de `storage.objects` (select/insert/update por prefixo de empresa), buckets privados, limite de tamanho e MIME (30/20/2/2 MiB), sem SVG/HTML/JS permitidos, caminho com `..` | OK |
| Rotas `api/*` | `ai`, `finance-ai`, `quote-pdf`, `assistant`: método, content-type, tamanho, UUID, sessão, **papel antes de quota/dado/provedor**, filtros `company_id`, erros genéricos, nenhum segredo/tenant ao provedor | OK, agora com teste (`security_audit_v1_api.test.mjs`) |
| Assistente (IA) | Provedor simulado que "obedece" ao atacante: pedir outra empresa, mudar papel, apagar tudo, ver custo; técnico forçando ferramenta de dono; execute com campos extras | Tudo negado; nada executa sem prévia + hash + confirmação |
| Auth e redirecionamentos | `authRedirect`, allowlist da função de convite, `user_metadata` não usado para autorização | OK |
| Função `team-invite-email` | JWT obrigatório, origem permitida, dono ativo antes da chave de serviço, redirect fixo, convite aceito/expirado | OK; SEC-05 e SEC-06 corrigidos na V1.1 |
| Segredos | Repositório, `dist/`, `VITE_*` (públicas), uso de `service_role` | Sem segredo; varredura de bundle agora no build (SEC-08) |
| Links e mapas | `window.open`, `location.assign`, rotas (Google Maps/Waze/Apple Maps com host fixo e query codificada), `maps_url` | 1 achado (SEC-02) e 3 registros P3 |
| XSS e injeção | Sinks (`innerHTML`, `eval`, `dangerouslySetInnerHTML`, `document.write`); SQL dinâmico em definers | Nenhum sink; SQL dinâmico só em `rls_auto_enable` (já auditado) |
| Cabeçalhos / CSP | `vercel.json` | CSP sem script inline/eval, `frame-ancestors 'none'`, `object-src 'none'`; contrato agora testado |
| PDFs e comprovantes | Filtro por empresa, item sem custo, nome de arquivo sem injeção de cabeçalho; Comprovante segue **não fiscal** | OK |
| Dependências | `npm audit`, `security:audit` | 0 HIGH/CRITICAL; 1 moderate de build (SEC-13) |
| Idempotência | Finalização, cobrança, comprovante, Assistente (`requestId` + hash) vs. ajuste de estoque direto | Estoque direto sem chave (SEC-04), corrigido na V1.1 (0109) |

## 3–8. Achados

Escala: **P0** exploração crítica; **P1** falha séria de autorização/financeiro; **P2** hardening importante sem exploração imediata; **P3** preventivo. Contagem: **P0 = 0, P1 = 1, P2 = 5, P3 = 8**. Estado depois da V1.1: P1 corrigido (SEC-01) e **os cinco P2 corrigidos** (SEC-02 a SEC-06); P3 segue registrado.

| ID | Severidade | Área | Vulnerabilidade | Exploração | Correção | Teste | Status |
|---|---|---|---|---|---|---|---|
| SEC-01 | **P1** | Banco · OS/contrato | O guard de UPDATE do técnico (0012/0031) não lista `maintenance_contract_id` nem `contract_cycle` | Técnico atribuído grava na própria OS o contrato e um ciclo futuro; ao gerar esse ciclo, `zt_generate_maintenance_contract_cycle` acha a OS, responde `reused` e **não cria a cobrança** | Migration `0107` (mesmo corpo da 0031 + 2 campos) | SQL: `sec01_tecnico_nao_planta_ciclo_de_contrato`, `sec01_tecnico_nao_troca_contrato_da_os` (+ controles positivos: campo operacional continua editável, dono edita vínculo e gera ciclo); JS: contrato da 0107 | **Corrigido no repositório; 0107 não aplicada em banco real** |
| SEC-02 | P2 | Frontend · mapas | `clients.maps_url` só tem limite de tamanho no banco; `openMap` abria o valor cru | Quem grava o cliente (dono, ou Data API) salva `javascript:`; ao clicar "abrir mapa" o link executa na origem do app | `openMap` só abre HTTPS de hosts Google validados (`normalizeGoogleMapsUrl`) com `noopener,noreferrer` | JS estático + comportamento (javascript:, data:, http:, hosts parecidos) | Corrigido |
| SEC-03 | P2 | Banco · FK entre empresas | `products.supplier_id` e `purchases.supplier_id` tinham FK simples para `suppliers(id)` | Dono A apontava produto/compra para o fornecedor da empresa B (reproduzido no laboratório). O fornecedor de B seguia ilegível (0 linhas); efeitos: oráculo de existência de UUID e vínculo anulado se B apagasse o fornecedor | **Migration `0108`**: FK composta `(supplier_id, company_id)` → `suppliers(id, company_id)` com `ON DELETE SET NULL (supplier_id)`; `supplier_id` nulo continua permitido; **falha fechada** (aborta sem alterar nada, com a consulta de somente leitura para tratar dado antigo; nunca corrige nem apaga) | SQL `v2_security_v11_supplier_tenant_fk_rollback.sql` (27): A→A ok, A→B negado em produto e compra (INSERT e UPDATE), nulo ok, dono B normal, apagar fornecedor anula só o vínculo, guarda da migration abortando com vínculo cruzado semeado; controle negativo no banco sem a 0108; JS: texto da 0108 e igualdade do guarda | **Corrigido no repositório; 0108 não aplicada em banco real** |
| SEC-04 | P2 | Banco · estoque | `zt_adjust_product_stock(p_delta)` não tinha chave de idempotência | Retry, duplo clique ou timeout aplicava o delta duas vezes (só o dono, só na própria empresa; integridade, não vazamento) | **Migration `0109`**: overload `zt_adjust_product_stock(..., p_request uuid)` — o mesmo pedido altera o estoque uma vez e a repetição devolve o saldo do primeiro ajuste; o mesmo pedido com outro produto/delta é recusado (23505); trava da linha do produto antes de conferir e gravar; o overload antigo perde o EXECUTE do navegador (a execução do Assistente o chama por dentro e já é idempotente). Frontend: um id por operação (`src/lib/stockAdjustment.js`), reaproveitado em cada tentativa; num banco sem a 0109 cai para o ajuste antigo | SQL `v2_security_v11_stock_idempotency_rollback.sql` (24): +10, −3, retry, duplo clique, timeout, pedido reutilizado, saldo insuficiente, isolamento; `scripts/test-stock-adjustment-concurrency.sh` (CI, conexões reais); JS: id estável, `p_request` sempre enviado, fallback só para função inexistente | **Corrigido no repositório; 0109 não aplicada em banco real** |
| SEC-05 | P2 | Edge function · e-mail | `team-invite-email` não limitava reenvios | Dono disparava `inviteUserByEmail` em laço (custo e reputação do remetente) | **Migration `0110`** + função: `zt_claim_team_invite_email` reserva o envio no banco antes de a chave de serviço existir — 60 s por convite e por destinatário na empresa, 5/h por destinatário, 30/h por empresa; lock por empresa; guarda só o hash do e-mail; sem leitura/escrita direta; resposta 429 amigável com o tempo de espera (sem revelar outras empresas); sem a reserva a função recusa o envio (503) | SQL `v2_security_v11_invite_email_throttle_rollback.sql` (31): primeiro envio, reenvio bloqueado, convite recriado, outro destinatário, outra empresa isolada, limites por hora, técnico/anon negados, erro idêntico para convite inexistente e alheio, poda; `scripts/test-invite-email-throttle-concurrency.sh` (CI); JS `security_v11_invite_email.test.mjs` (14) com a função real e e-mail simulado | **Corrigido no repositório; 0110 e a função não implantadas em ambiente real** |
| SEC-06 | P2 | Edge function · e-mail | `company_name` e `invitee_name` (texto livre do dono) entravam no HTML do convite sem tratamento próprio | Dono malicioso injetava HTML em e-mail legítimo. O Auth atual já escapa na renderização (ver §V1.1), então a exploração dependia de uma regressão do provedor | Neutralização **explícita** na função: `& < > " '` viram caracteres inertes equivalentes (＆ ＜ ＞ ” ’), controles, separadores de linha e sobreposições bidi saem, acentos/emoji/CJK passam, limites 120/160. Não é escape para entidades: o Auth escaparia de novo e o convidado veria `&amp;lt;` | JS: `<b>x</b>`, `<img src=x onerror=alert(1)>`, `"&<>'"` e outros; o `invite.html` real renderizado com e sem o escape do Auth mantém exatamente as mesmas tags; texto legítimo preservado | **Corrigido na função; exige implantar a função** |
| SEC-07 | P3 | Banco · ACL | `zt_guard_locked_document_parent/child` (0044) executáveis por PUBLIC | Chamada direta falha por serem funções de trigger; só higiene de inventário | `revoke execute` na 0107 | SQL: nenhuma função do app executável por `anon`/PUBLIC | Corrigido (0107) |
| SEC-08 | P3 | Build | Nada impedia segredo de servidor de entrar no bundle | Um `VITE_*` ou import errado publicaria chave privada | `scripts/verify-dist-secrets.mjs` em `postbuild` (JWT só passa se `role=anon`) | JS: segredos sintéticos montados em runtime, `scanDist` em pasta temporária | Corrigido |
| SEC-09 | P3 | Frontend | 7 `window.open("https://wa.me/…", "_blank")` do legado sem `noopener` | Sem exploração: host fixo `wa.me`, número só dígitos, texto codificado | Nenhuma | Inventário trava novos destinos externos | Registrado |
| SEC-10 | P3 | Frontend · mapas | `normalizeGoogleMapsUrl` aceita credenciais na URL (`https://u:p@www.google.com/…`) | Destino continua `www.google.com`; só aparência | Nenhuma | — | Registrado |
| SEC-11 | P3 | PDF | `\r`/`\n` em campo de linha única (número do orçamento, nome do cliente) derruba o PDF com 500 genérico | Reproduzido; afeta só o próprio dono e não vaza dado | Nenhuma | — | Registrado |
| SEC-12 | P3 | Storage | URLs assinadas de evidência/documentos valem 1 h (5 pontos); PDFs 15 min | Link vazado funciona por até 1 h | Nenhuma | — | Registrado (decisão §10) |
| SEC-13 | P3 | Dependências | `npm audit`: 1 moderate, `postcss-selector-parser <6.1.5` (transitiva do Tailwind, só build) | Exige CSS hostil no build; o CSS é nosso | Nenhuma (sem `audit fix`) | `security:audit` (0 HIGH/CRITICAL) | Registrado |
| SEC-14 | P3 | Infra · CSP | `style-src 'unsafe-inline'`; sem `media-src` próprio; sem relatório de violação | Estilo inline não executa script; hoje só o leitor de código de barras usa `<video>` (MediaStream) | Nenhuma | Contrato da CSP | Registrado (decisão §10) |

Reprodução do SEC-01 (laboratório, antes/depois): como técnico atribuído, `update work_orders set maintenance_contract_id=<contrato>, contract_cycle=<mês futuro> where id=<minha OS>` era aceito pelo guard da 0031 e passa a falhar com `42501` ("Técnicos não podem alterar campos administrativos ou financeiros da OS") com a 0107. Controle negativo: com o corpo da 0031 as duas verificações `sec01_*` falham.

## V1.1 · fechamento dos P2 e reprodutibilidade

Base da V1.1: HEAD `9de3546` (V1 entregue e com CI verde). Migrations novas **0108**, **0109** e **0110**, sem aplicar em nenhum banco real; definers 140 → **142** (a 0109 e a 0110 criam uma função pública cada; a 0108 nenhuma).

- **SEC-06 — por que não é escape para entidades.** O código atual do Auth (`supabase/auth`, `internal/mailer/templatemailer/template.go`) importa `html/template` tanto para o assunto quanto para o corpo, então `{{ .Data.company_name }}` já sai escapado. Escapar de novo na função produziria `&amp;lt;` para quem digitar `<` e `&amp;` para "Silva & Filhos". A neutralização explícita troca só as cinco marcas por caracteres inertes equivalentes e funciona com ou sem o escape do provedor. A evidência é o código-fonte público (branch principal), não a versão hospedada do projeto; o teste renderiza o `invite.html` real nos dois regimes.
- **Estoque e o modo reduzido.** O frontend novo usa o overload com `p_request`; num banco ainda na 0099/0108 (função inexistente: `PGRST202`/`42883`) cai para o ajuste antigo, sem idempotência, como hoje. Qualquer outro erro é repassado, nunca vira fallback.
- **Ordem de publicação.** Migrations 0100–0110 juntas e o frontend novo antes (a 0105 quebra o frontend antigo); a função `team-invite-email` desta branch só depois da 0110, pois sem a reserva ela recusa o envio (falha fechada).
- **Reprodutibilidade no Windows (CRLF).** Causa comprovada: com `core.autocrlf=true` um clone limpo extraía a `0100` com CRLF e o teste `block3_service_receipt` (regex multilinha) falhava — `verify:v2` dava 520/521 no clone limpo e 521/521 no CI Linux. Correção de repositório: `.gitattributes` com `*.sql text eol=lf` (causa) e `*.sh text eol=lf` (preventivo: a falha de `bad interpreter` em Linux/WSL é conhecida, mas o Git Bash do Windows tolera CR e não foi reproduzida aqui). Nenhum binário é tocado e os blobs já estavam em LF, então nenhum arquivo muda de conteúdo. Teste: `repo_line_endings.test.mjs` (atributos aplicados, nenhum `.sql`/`.sh` com CRLF no índice). Validado em worktree limpo no Windows: ver o relatório da entrega.

## 4–6. Severidade e impacto (resumo)

- **SEC-01 (P1)** é a única falha de autorização com efeito financeiro: um técnico (ator interno legítimo) suprime o faturamento de um ciclo de contrato sem erro visível. Exige a OS de contrato atribuída ao técnico; não cruza empresas.
- **SEC-02 (P2)** é o único sink de execução de script encontrado; o alcance é pequeno (quem grava é o dono) e foi fechado na origem do clique.
- Os demais P2/P3 não têm exploração imediata com impacto de dados entre empresas ou de privilégio.

## 8. Testes adicionados

| Arquivo | O que prova |
|---|---|
| `supabase/tests/v2_security_audit_v1_rollback.sql` (93 verificações, rollback-safe, no runner de CI) | Invariantes de catálogo; isolamento A×B (leitura/escrita/DELETE/RPC/referência cruzada); matriz dono×técnico; técnico desativado; Storage; `anon`; SEC-01 com controles positivos; empresa B idêntica no fim |
| `tests/blockers/security_audit_v1_api.test.mjs` (36) | Portões de `ai`, `finance-ai`, `quote-pdf` (ordem método → tipo → tamanho → sessão → papel → IA paga → quota → provedor); técnico 403 sem tocar quota/dado/provedor; erros sem segredo; custo/margem fora do prompt; PDF sem custo e sem injeção de cabeçalho; Assistente com provedor malicioso (outra empresa, papel, "apagar tudo", custo), campos extras, `execute` fechado, nada de tenant/sessão ao provedor |
| `tests/blockers/security_audit_v1_static.test.mjs` (15) | Cabeçalhos e CSP; `maps_url`; inventário de `window.open`/`location.assign`; ausência de sinks de XSS; `VITE_*` públicas; `service_role` fora do navegador; varredura do bundle; função de convite; 0107 |

**V1.1:**

| Arquivo | O que prova |
|---|---|
| `supabase/tests/v2_security_v11_supplier_tenant_fk_rollback.sql` (27) | SEC-03 |
| `supabase/tests/v2_security_v11_stock_idempotency_rollback.sql` (24) | SEC-04 |
| `supabase/tests/v2_security_v11_invite_email_throttle_rollback.sql` (31) | SEC-05 |
| `scripts/test-stock-adjustment-concurrency.sh`, `scripts/test-invite-email-throttle-concurrency.sh` | Concorrência real (só na CI): mesmo pedido em duas sessões aplica uma vez; pedidos diferentes entram os dois; pedido reutilizado em dois produtos tem um vencedor; duas reservas simultâneas do mesmo convite, uma passa |
| `tests/blockers/security_v11_invite_email.test.mjs` (14) | SEC-05/SEC-06 com a função real e e-mail simulado |
| `tests/blockers/security_v11_contracts.test.mjs` (13) | Frontend do estoque (id estável, fallback), texto das migrations 0108–0110, fiação no gate, inventário de definers |
| `tests/blockers/repo_line_endings.test.mjs` (4) | EOL |

Controle negativo da V1.1: 14 falhas injetadas (neutralização removida nos dois campos, limite ignorado, reserva indisponível liberando o envio, técnico passando, id novo a cada tentativa, `p_request` removido, fallback para erro de negócio, tela sem id estável, guarda da 0108 removido, overload antigo ainda chamável, intervalo de 1 s, policy aberta no registro, `.gitattributes` sem a regra de SQL) — todas reprovadas e revertidas. O teste SQL de estoque reprova com a função antiga (+10 repetido dá 20; −3 repetido dá 17/14/11/8) e o de fornecedor reprova no banco sem a 0108.

Os testes JS foram validados com **controle negativo**: 10 falhas injetadas (checagem de dono removida em `api/ai.js`, custo por OS sempre enviado em `finance-ai`, filtro de empresa removido e `unit_cost` pedido em `quote-pdf`, `openMap` cru, `unsafe-inline` em `script-src`, 0107 sem `contract_cycle`, ferramenta de outro papel aceita no Assistente, `execute` aceitando ação do navegador, campo `role` permitido) — todas reprovadas e revertidas.

## 9. Riscos remanescentes e limites desta auditoria

- **Não exaustivo:** os ~140 `SECURITY DEFINER` foram cobertos por invariantes de catálogo, pela barragem diferencial e por amostra de corpos, não por leitura linha a linha de todos.
- **Laboratório ≠ produção:** PGlite replica as migrations, mas não é o Supabase real (GoTrue, PostgREST, Storage API, pooler). A prova definitiva do SQL é a CI com Postgres/Supabase local.
- **Não testado:** navegador real e dispositivo móvel; Auth real (política de senha, limites de login, SMTP, escape do template de e-mail); versão implantada e allowlist de origens da função de convite; configuração de rate limit da plataforma; CORS efetivo no ambiente.
- **Migrations 0100–0110 não aplicadas em nenhum ambiente real:** o ganho de SEC-01, SEC-03, SEC-04 e SEC-05 só existe depois do pacote ser aplicado (a 0105 quebra o frontend antigo: frontend novo primeiro, migrations juntas, função de convite por último).
- **Concorrência real só na CI:** os dois scripts de conexões paralelas não rodam no laboratório local (uma conexão só); a prova de serialização é a execução do gate sql-rls.
- **SEC-06 apoiado no código público do Auth,** não na versão hospedada; por isso a neutralização é explícita e vale nos dois casos.
- **Sem limitação de taxa própria** nas consultas locais do Assistente e na Data API (dependem da plataforma); as rotas de custo (IA, PDF) têm quota por empresa no banco.

## 10. Itens que pedem decisão futura

SEC-03 a SEC-06 estão fechados no repositório (V1.1). Sobram decisões de produto/infra:

1. **Antes de aplicar a 0108 num ambiente com dados:** rodar a consulta de somente leitura do cabeçalho da migration; se houver vínculo cruzado, decidir com o dono do dado e anular manualmente.
2. **SEC-12:** reduzir a validade de URL assinada de evidência (ex.: 10–15 min) ou assinar sob demanda a cada abertura.
3. **SEC-14:** incluir `media-src` explícito se um dia houver vídeo embutido; avaliar `Content-Security-Policy-Report-Only` com relatório.
4. Definir rate limit/CAPTCHA do Auth e confirmar o SMTP antes de convites reais (relacionado ao H0). O limite de reenvio da 0110 protege a função de convite, não o endpoint de login.
