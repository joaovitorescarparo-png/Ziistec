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
| Função `team-invite-email` | JWT obrigatório, origem permitida, dono ativo antes da chave de serviço, redirect fixo, convite aceito/expirado | OK; 2 pontos registrados (SEC-05, SEC-06) |
| Segredos | Repositório, `dist/`, `VITE_*` (públicas), uso de `service_role` | Sem segredo; varredura de bundle agora no build (SEC-08) |
| Links e mapas | `window.open`, `location.assign`, rotas (Google Maps/Waze/Apple Maps com host fixo e query codificada), `maps_url` | 1 achado (SEC-02) e 3 registros P3 |
| XSS e injeção | Sinks (`innerHTML`, `eval`, `dangerouslySetInnerHTML`, `document.write`); SQL dinâmico em definers | Nenhum sink; SQL dinâmico só em `rls_auto_enable` (já auditado) |
| Cabeçalhos / CSP | `vercel.json` | CSP sem script inline/eval, `frame-ancestors 'none'`, `object-src 'none'`; contrato agora testado |
| PDFs e comprovantes | Filtro por empresa, item sem custo, nome de arquivo sem injeção de cabeçalho; Comprovante segue **não fiscal** | OK |
| Dependências | `npm audit`, `security:audit` | 0 HIGH/CRITICAL; 1 moderate de build (SEC-13) |
| Idempotência | Finalização, cobrança, comprovante, Assistente (`requestId` + hash) vs. ajuste de estoque direto | Estoque direto sem chave (SEC-04) |

## 3–8. Achados

Escala: **P0** exploração crítica; **P1** falha séria de autorização/financeiro; **P2** hardening importante sem exploração imediata; **P3** preventivo. Contagem: **P0 = 0, P1 = 1, P2 = 5, P3 = 8**.

| ID | Severidade | Área | Vulnerabilidade | Exploração | Correção | Teste | Status |
|---|---|---|---|---|---|---|---|
| SEC-01 | **P1** | Banco · OS/contrato | O guard de UPDATE do técnico (0012/0031) não lista `maintenance_contract_id` nem `contract_cycle` | Técnico atribuído grava na própria OS o contrato e um ciclo futuro; ao gerar esse ciclo, `zt_generate_maintenance_contract_cycle` acha a OS, responde `reused` e **não cria a cobrança** | Migration `0107` (mesmo corpo da 0031 + 2 campos) | SQL: `sec01_tecnico_nao_planta_ciclo_de_contrato`, `sec01_tecnico_nao_troca_contrato_da_os` (+ controles positivos: campo operacional continua editável, dono edita vínculo e gera ciclo); JS: contrato da 0107 | **Corrigido no repositório; 0107 não aplicada em banco real** |
| SEC-02 | P2 | Frontend · mapas | `clients.maps_url` só tem limite de tamanho no banco; `openMap` abria o valor cru | Quem grava o cliente (dono, ou Data API) salva `javascript:`; ao clicar "abrir mapa" o link executa na origem do app | `openMap` só abre HTTPS de hosts Google validados (`normalizeGoogleMapsUrl`) com `noopener,noreferrer` | JS estático + comportamento (javascript:, data:, http:, hosts parecidos) | Corrigido |
| SEC-03 | P2 | Banco · FK entre empresas | `products.supplier_id` e `purchases.supplier_id` têm FK simples para `suppliers(id)` | Dono A aponta produto/compra para o fornecedor da empresa B (reproduzido no laboratório). O fornecedor de B segue ilegível (0 linhas); efeitos: oráculo de existência de UUID e referência anulada se B apagar o fornecedor | Nenhuma nesta rodada | Reprodução em laboratório (sonda); sem teste novo | **Registrado** (decisão §10) |
| SEC-04 | P2 | Banco · estoque | `zt_adjust_product_stock(p_delta)` não tem chave de idempotência (`src/lib/v2Api.js:86`) | Retry/duplo clique/timeout aplica o delta duas vezes. Só o dono, só na própria empresa; integridade, não vazamento. O caminho do Assistente já é idempotente (`requestId` + hash) | Nenhuma | — | **Registrado** (decisão §10) |
| SEC-05 | P2 | Edge function · e-mail | `team-invite-email` não limita reenvios por convite/empresa | Dono dispara `inviteUserByEmail` em loop (custo/reputação do remetente). Atenuado pelo limite de e-mails do Auth/SMTP, cuja configuração real não foi verificada | Nenhuma | — | **Registrado** |
| SEC-06 | P2 | Edge function · e-mail | `company_name` e `invitee_name` (texto livre do dono) entram no HTML do convite (`{{ .Data.* }}`) | Dono malicioso injeta HTML em e-mail legítimo da ZiisTec para o convidado. Depende do escape do renderizador de templates do Auth, **não verificado** | Nenhuma (verificar em Staging com `<b>x</b>`; se não escapar, limpar `<>&"` na função) | — | **Registrado / não verificável sem Auth real** |
| SEC-07 | P3 | Banco · ACL | `zt_guard_locked_document_parent/child` (0044) executáveis por PUBLIC | Chamada direta falha por serem funções de trigger; só higiene de inventário | `revoke execute` na 0107 | SQL: nenhuma função do app executável por `anon`/PUBLIC | Corrigido (0107) |
| SEC-08 | P3 | Build | Nada impedia segredo de servidor de entrar no bundle | Um `VITE_*` ou import errado publicaria chave privada | `scripts/verify-dist-secrets.mjs` em `postbuild` (JWT só passa se `role=anon`) | JS: segredos sintéticos montados em runtime, `scanDist` em pasta temporária | Corrigido |
| SEC-09 | P3 | Frontend | 7 `window.open("https://wa.me/…", "_blank")` do legado sem `noopener` | Sem exploração: host fixo `wa.me`, número só dígitos, texto codificado | Nenhuma | Inventário trava novos destinos externos | Registrado |
| SEC-10 | P3 | Frontend · mapas | `normalizeGoogleMapsUrl` aceita credenciais na URL (`https://u:p@www.google.com/…`) | Destino continua `www.google.com`; só aparência | Nenhuma | — | Registrado |
| SEC-11 | P3 | PDF | `\r`/`\n` em campo de linha única (número do orçamento, nome do cliente) derruba o PDF com 500 genérico | Reproduzido; afeta só o próprio dono e não vaza dado | Nenhuma | — | Registrado |
| SEC-12 | P3 | Storage | URLs assinadas de evidência/documentos valem 1 h (5 pontos); PDFs 15 min | Link vazado funciona por até 1 h | Nenhuma | — | Registrado (decisão §10) |
| SEC-13 | P3 | Dependências | `npm audit`: 1 moderate, `postcss-selector-parser <6.1.5` (transitiva do Tailwind, só build) | Exige CSS hostil no build; o CSS é nosso | Nenhuma (sem `audit fix`) | `security:audit` (0 HIGH/CRITICAL) | Registrado |
| SEC-14 | P3 | Infra · CSP | `style-src 'unsafe-inline'`; sem `media-src` próprio; sem relatório de violação | Estilo inline não executa script; hoje só o leitor de código de barras usa `<video>` (MediaStream) | Nenhuma | Contrato da CSP | Registrado (decisão §10) |

Reprodução do SEC-01 (laboratório, antes/depois): como técnico atribuído, `update work_orders set maintenance_contract_id=<contrato>, contract_cycle=<mês futuro> where id=<minha OS>` era aceito pelo guard da 0031 e passa a falhar com `42501` ("Técnicos não podem alterar campos administrativos ou financeiros da OS") com a 0107. Controle negativo: com o corpo da 0031 as duas verificações `sec01_*` falham.

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

Os testes JS foram validados com **controle negativo**: 10 falhas injetadas (checagem de dono removida em `api/ai.js`, custo por OS sempre enviado em `finance-ai`, filtro de empresa removido e `unit_cost` pedido em `quote-pdf`, `openMap` cru, `unsafe-inline` em `script-src`, 0107 sem `contract_cycle`, ferramenta de outro papel aceita no Assistente, `execute` aceitando ação do navegador, campo `role` permitido) — todas reprovadas e revertidas.

## 9. Riscos remanescentes e limites desta auditoria

- **Não exaustivo:** os ~140 `SECURITY DEFINER` foram cobertos por invariantes de catálogo, pela barragem diferencial e por amostra de corpos, não por leitura linha a linha de todos.
- **Laboratório ≠ produção:** PGlite replica as migrations, mas não é o Supabase real (GoTrue, PostgREST, Storage API, pooler). A prova definitiva do SQL é a CI com Postgres/Supabase local.
- **Não testado:** navegador real e dispositivo móvel; Auth real (política de senha, limites de login, SMTP, escape do template de e-mail); versão implantada e allowlist de origens da função de convite; configuração de rate limit da plataforma; CORS efetivo no ambiente.
- **Migrations 0100–0107 não aplicadas em nenhum ambiente real:** o ganho de SEC-01 só existe depois do pacote ser aplicado (a 0105 quebra o frontend antigo: frontend novo primeiro, migrations juntas).
- **Sem limitação de taxa própria** nas consultas locais do Assistente e na Data API (dependem da plataforma); as rotas de custo (IA, PDF) têm quota por empresa no banco.

## 10. Itens que pedem decisão futura

1. **SEC-03:** trocar as FKs de fornecedor por FK composta `(company_id, supplier_id)`, com saneamento prévio dos dados existentes (migration própria, primeiro em Staging).
2. **SEC-04:** chave de idempotência (ou versão otimista) em `zt_adjust_product_stock` e uso na tela de estoque.
3. **SEC-05/06:** limite de reenvio por convite e limpeza de HTML dos campos livres; confirmar o escape do template em Staging.
4. **SEC-12:** reduzir a validade de URL assinada de evidência (ex.: 10–15 min) ou assinar sob demanda a cada abertura.
5. **SEC-14:** incluir `media-src` explícito se um dia houver vídeo embutido; avaliar `Content-Security-Policy-Report-Only` com relatório.
6. Definir rate limit/CAPTCHA do Auth e confirmar o SMTP antes de convites reais (relacionado ao H0).
