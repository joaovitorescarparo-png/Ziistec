# Central Técnica V1 (0113–0115)

Biblioteca operacional de campo: ficha rápida, manual, esquema, favoritos/recentes
e casos resolvidos pela própria empresa, ligada à OS e à Base Técnica.

Esta é a **integração** da feature sobre a linha pós-0112. A implementação original
ficou em `ccr-1c077ea8-006w2f` (de `3345e4d`, 663 commits atrás) e usava os números
0050–0052, que nesta linha pertencem ao Product V2. Nada dela foi mergeado: o
schema foi reescrito sobre a arquitetura atual e a UI foi portada para
`src/components` + `src/lib`.

## Três conceitos, sem duplicação

| Conceito | Tabela | Autoridade |
| --- | --- | --- |
| Produto vendável (preço, estoque, SKU) | `products` | já existia |
| **Modelo técnico de mercado** ("Intelbras FR 101") | `equipment_models` | **novo** |
| Unidade física instalada no cliente (serial, local, foto, garantia) | `installed_equipment` + `client_locations` (0083) | já existia |
| Conhecimento do atendimento (causa, solução, dificuldade, aprendizado) | `work_order_technical_base` (0111) | já existia |

A auditoria encontrou que **o equipamento instalado já existia** — a afirmação
contrária na documentação da branch antiga estava errada para esta linha. O que
faltava era o MODELO de mercado: é ele que carrega ficha, manual, esquema e casos.

Ligação entre eles:

- `installed_equipment.equipment_model_id` (novo, opcional) aponta a unidade física
  para o modelo técnico. Gravado só pela RPC `zt_set_installed_equipment_model`
  (owner ou técnico da OS, com assinatura ativa); `zt_register_installed_equipment`
  (0083) **não** foi alterada.
- `work_order_equipment` liga a OS ao conhecimento e cobre os dois cenários:
  - **manutenção**: `installed_equipment_id` preenchido — a unidade precisa ser da
    mesma empresa **e do mesmo cliente** da OS, e não pode contradizer o modelo já
    identificado nela;
  - **diagnóstico/instalação nova**: só `model_id`.
  - Índices únicos parciais: um vínculo por modelo sem unidade, um por unidade.
  - A FK da unidade é `on delete cascade` de propósito: removida a unidade física,
    o vínculo àquela unidade perde sentido e sai junto; o vínculo de conhecimento
    (só modelo) é outra linha e sobrevive. Com `set null` o vínculo viraria
    "só modelo" e poderia colidir com um já existente (o teste pegou isso).

## Escopo global × privado

Um conjunto de tabelas, dois escopos por `company_id`:

- `NULL` → biblioteca global ZiisTec: leitura para membro ativo de qualquer
  empresa; escrita **só** platform admin com AAL2 (`zt_eq_can_write`) ou
  `service_role`. Não existe botão de escrita global no frontend; o teste prova
  que até o platform admin com AAL1 é negado.
- preenchido → conteúdo privado da empresa: leitura de membro ativo, escrita do
  owner.

Guarda de escopo por trigger: conteúdo global exige modelo/fabricante/categoria
globais; conteúdo privado nunca referencia outra empresa.

**Escopo imutável (security fix).** A RLS de UPDATE confere o `company_id` antigo
e o novo separadamente: um owner de A **e** de B passaria nas duas ao mover um
fabricante/categoria A → B, deixando modelos de A apontando por ID para um pai de B
— e a busca SECURITY DEFINER atravessaria. Por isso `company_id` é **imutável após
o INSERT** em categoria, fabricante, modelo, documento e ficha
(`zt_eq_guard_company_immutable`, invoker, em todo UPDATE e para todos os papéis,
inclusive `service_role`): privado A → B, privado → global e global → privado são
negados. Migração de escopo, se um dia existir, será operação administrativa
própria que move pai e filhos juntos. Defesa em profundidade:
`zt_equipment_search` só junta fabricante/categoria globais ou do mesmo escopo do
modelo — com um pai corrompido a linha some, nunca expõe nome de outra empresa.

## Ficha rápida

`equipment_quick_guides.sections` é JSONB **validado** por
`zt_private.zt_eq_validate_guide_sections`: lista de seções com `kind` controlado
(power, wiring, programming, reset, parameters, diagnostics, codes, alerts, other),
campos de item permitidos, limites (128KB, 40 seções, 60 itens, passos de 500
caracteres). `version` sobe a cada mudança de conteúdo e `search_text` é derivado
por trigger. Uma ficha ativa por modelo por escopo.

## Busca

`zt_equipment_search` (definer, confere membresia, paginada, teto de 50) segue a
convenção da 0087: **pg_trgm + `lower()`**, sem extensão nova. `zt_ct_norm` dobra
acento em SQL puro (`translate`), então "fechádura" acha "fechadura"; `zt_ct_compact`
faz "FR101" achar "FR 101". O termo mais longo entra como predicado indexável no
índice GIN trigrama e os demais filtram o conjunto já reduzido — mantém o "E" entre
termos sem varrer a tabela. Casa modelo, código, fabricante, ficha e documento, e
devolve `matched_in`.

## Casos técnicos: publicação curada (security fix)

A Base Técnica da OS (`work_order_technical_base`, 0111) é o **registro interno
original**: o técnico escreve em campo e o texto pode citar nome, telefone,
endereço ou valor. Ela **não** vira caso sozinha.

O caso compartilhado com a equipe é **outro texto**, nas colunas `case_*` da mesma
linha (sem tabela nova): `case_public_id`, `case_symptom`, `case_cause`,
`case_solution`, `case_learning`, `case_published_at/by`, `case_updated_at/by`,
`case_revision`, `case_last_request_id`. Só existe quando o owner publica:

- `zt_publish_work_order_technical_case(p_wo, p_symptom, p_cause, p_solution,
  p_learning, p_request)` — owner da empresa da OS (derivada da OS, nunca do
  cliente), OS `done`, assinatura ativa, idempotente por `p_request`, auditável.
  Recebe o texto revisado como parâmetro; **não lê** `cause/solution/learning`,
  `problem_report`, notas, cliente nem financeiro.
- `zt_unpublish_work_order_technical_case(p_wo)` — retira o caso; a Base Técnica
  original fica intacta.
- A tela do owner (`TechnicalCasePublishPanel`, OS concluída) abre o formulário
  **vazio**; usar a Base Técnica como rascunho é um botão explícito, com aviso de
  que o texto será visto por toda a equipe.

`zt_equipment_cases` devolve só: `case_id` (identificador do caso, não o id nem o
número da OS), `published_on`, `completed_on`, `symptom/cause/solution/learning`
**curados**, `difficulty` (valor fechado) e `unit_identified`. De `work_orders`
só participam `id`, `company_id`, `status`, `deleted_at` e `completed_at`.

A garantia é **estrutural**, não de filtro: texto bruto da OS não entra na resposta.
Não se afirma que regex/IA detecte PII em texto livre — o que o owner publica é
responsabilidade dele, e a tela avisa.

## Storage

Bucket privado `zt-equipment-docs` (50 MB; PDF/JPEG/PNG/WebP), caminho
`company_id/equipment/<model_id>/<arquivo>`. Leitura: membro ativo da empresa (o
técnico precisa do manual em campo). Escrita/remoção: owner com assinatura ativa.
Documento privado sai só por signed URL de 1h. Conteúdo de terceiro não é
re-hospedado: entra como metadado + `official_url` restrito a `https://`.
`is_official` é selo da **plataforma**: a constraint
`equipment_documents_official_global_only` o restringe a documento global, e o
trigger `zt_eq_guard_document_official` só deixa `service_role` ou platform admin
AAL2 (`zt_is_platform_admin`, nunca `user_metadata`) ligá-lo ou alterá-lo. Owner
comum que tenta `is_official=true` (INSERT ou UPDATE) recebe 42501.

## Frontend

- `src/lib/centralTecnicaApi.js` — dados, Storage e cache offline. `urlDocumentoCT`
  só devolve destino `https`.
- `src/components/CentralTecnicaScreen.jsx` — busca única, favoritos, recentes,
  categorias (áreas da empresa primeiro), página do equipamento com abas e gestão
  do acervo privado pelo owner.
- `src/components/WorkOrderEquipmentPanel.jsx` — na OS: escolher a unidade já
  instalada no cliente ou buscar o modelo; "Ajuda técnica" abre a ficha direto.
- Papéis: `central` (owner e técnico, consulta) e `gerirCentral` (só owner).
- Offline: a última ficha aberta fica em `localStorage` (LRU de 30, tudo em
  try/catch). A leitura tenta a rede primeiro e só cai para o cache em falha, com
  aviso de versão salva. PDF offline não é requisito V1.

## Testes no gate oficial

Entram em `scripts/run-sql-rls-ci.sh`, que já aplica toda migration ≥ 0050 por
ordem de nome — a prova roda sobre `0001 → … → 0112 → 0113-0115`, sem cadeia
paralela:

- `v2_central_tecnica_rls_rollback.sql` (144 checks) — matriz anon/Owner A/
  Technician A/Owner B/Technician B por SELECT, UPDATE, RPC, JOIN, busca e Storage;
  escrita global só com AAL2; ficha e documento inválidos recusados; unidade de
  outro cliente negada; busca resiste a injeção, símbolos e texto vazio;
  owner A+B não move escopo; busca não vaza pai corrompido; `is_official` negado
  ao owner; corpo das RPCs de caso conferido no catálogo.
- `v2_central_tecnica_golden_path_rollback.sql` (70 checks) — fluxo completo pelas
  RPCs reais (OS idempotente, Base Técnica da 0111, finalização com garantias,
  registro de equipamento instalado da 0083) → owner publica o caso → outro
  técnico da empresa, **não atribuído**, consulta. **Adversarial:** a OS leva
  telefone no `request`, endereço no `problem_report`, e-mail e nome na Base
  Técnica, preço nas notas e cliente com nome/CPF/telefone; nenhum desses valores
  aparece na resposta nem é encontrado pela busca.
- `tests/blockers/central_tech_security_fix.test.mjs` (verify:v2) — contrato
  estático das três correções.

Os testes novos foram validados por mutação: reintroduzir texto bruto na consulta,
desligar o guard de escopo, voltar à busca antiga ou remover o guard do selo faz
os testes falharem.

Dois guards existentes foram estendidos pelo caminho que eles documentam:
inventário de SECURITY DEFINER (149 → 164, com a lista nominal das 15 funções
novas, todas `search_path=''` e sem EXECUTE para anon; as duas guardas novas da
0113 são invoker) e a lista revisada de
escrita direta em `v2_security_audit_v1_rollback.sql`.

## IA / Assistant

Nada de RAG nesta onda e nenhuma dependência nova. Os contratos que o Assistant
usará depois já existem e são seguros por construção (membresia + sanitização no
banco): `zt_equipment_search`, `equipment_quick_guides.sections`,
`zt_equipment_cases` e os metadados de `equipment_documents`. Evolução de busca
dentro do PDF em `CENTRAL_TECH_V11_DOCUMENT_INDEXING.md`.

## Riscos e pendências

- Conteúdo global não tem backoffice: entra por `service_role`/platform admin AAL2.
  Documentado, sem botão escondido.
- 0113–0115 **não aplicadas em nenhum ambiente real**. O H0 (`auojcljfahhpkfqqbygd`)
  está `INACTIVE` (pausado no plano Free): nem a verificação somente leitura do
  baseline roda — a API responde "Database is possibly not accessible at the
  moment". Retomar um projeto pausado é ação de infraestrutura do dono, então foi
  deixada para ele; a sequência a executar depois de retomar está em
  "Próximo passo no H0" abaixo. Production (`diztevlpbcfqleizswxr`) e Beta Live
  (`xadoktssibuuebzzjrhv`) intocados; `main` não mergeada.

## Próximo passo no H0

Com o H0 retomado, nesta ordem:

1. Provar o baseline somente leitura: `work_order_technical_base` (0111),
   `installed_equipment` e `client_locations` (0083), `service_receipts` (0100) e
   `zt_guard_company_member_identity` (0112) presentes; `equipment_models`,
   `equipment_quick_guides` e `work_order_equipment` **ausentes**; contagem de
   definers em 149.
2. Aplicar `0113` → `0114` → `0115`, uma por vez, conferindo o retorno de cada uma.
3. Reconferir: definers em 164, bucket `zt-equipment-docs` privado, as 9 tabelas
   novas com RLS e nenhum privilégio para `anon`.
4. Validar pelo PostgREST/Storage reais com dados sintéticos (Owner A, Technician A,
   Owner B), incluindo signed URL de documento e negativa de acesso cruzado.
5. Preview da branch de integração apontando para o H0 — nunca Production. Host
   exato `ziistec-git-claude-central-tecnica-v1-integration-js-connect.vercel.app`
   e branch exata `claude/central-tecnica-v1-integration` estão nas listas
   fechadas do H0 (cliente e servidor); qualquer outro host/branch, Production ou
   `main` falha fechado.

## Security fix antes do H0 (branch `claude/central-tech-security-fix-v1`)

0113–0115 nunca foram aplicadas em ambiente real; foram corrigidas no lugar,
sem 0116 e sem tocar 0001–0112. Além das seções acima (casos curados, escopo
imutável, selo oficial):

- **CRLF:** `.gitattributes` fixa `supabase/0001_parts/part*.txt text eol=lf` (os
  únicos .txt que entram em hash de gate). O verificador continua comparando bytes
  e o hash esperado não mudou; checkout antigo com CRLF falha com `CRLF_DETECTED`
  e a instrução de refazer o checkout.
- **Advisors (baseline × novo):** `pg_trgm` em `public`, leaked-password
  protection e as tabelas RLS sem policy (`beta_invites`,
  `team_invite_email_sends`, `work_order_ai_reports`, de 0099/0110/0111) são
  baseline. A Central adiciona RPCs SECURITY DEFINER executáveis por
  `authenticated` por arquitetura (membresia/ownership conferidos dentro), nenhuma
  para anon; as 9 tabelas novas têm RLS **com** policies.
- **Operations:** `claude/operations-dispatch-v1` pode ter partido do HEAD inseguro
  `74d18ef`. **Operations branch must rebase/cherry-pick security-fix before H0
  integration.**
- A verificação `verify-consolidated-source.mjs` valida o estado arqueológico
  pós-codemod (roda `apply-round32` antes) e já estava defasada do arquivo vivo
  antes desta onda; não é gate de CI nem de `verify:v2`. Os gates de integridade
  em CI são `verify-foundation-integrity`, `verify-dist-secrets` e
  `verify:reproducible-build`, todos verdes aqui.
- `verify:v2` fecha vermelho no baseline por interação de event loop na suíte do
  Assistant (`ai_gateway.test.mjs` passa isolado). Reproduzido igual no baseline
  intocado; fora do escopo desta onda e da frente em que Claude implementa.
