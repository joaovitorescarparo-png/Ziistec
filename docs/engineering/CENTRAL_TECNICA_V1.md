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

## Casos resolvidos

`zt_equipment_cases` lê `work_order_technical_base` (0111) — **não**
`work_order_reports`, que é o relato do cliente e pode conter PII. Alcança a OS por
três caminhos (modelo vinculado, unidade vinculada já identificada, unidade
registrada naquela OS), exige `status='done'`, `deleted_at is null` e pelo menos
causa/solução/aprendizado preenchidos.

Sai: número da OS, data de conclusão, sintoma (`problem_report`/`request`), causa,
solução, dificuldade, aprendizado, `needs_return`, nota do vínculo e se a unidade
estava identificada. **Não entram no SELECT** nome, endereço, telefone ou documento
do cliente, nem preço, custo, margem ou financeiro — a sanitização é estrutural, e
nenhuma tabela da Central tem coluna de valor (teste verifica por nome de coluna).

## Storage

Bucket privado `zt-equipment-docs` (50 MB; PDF/JPEG/PNG/WebP), caminho
`company_id/equipment/<model_id>/<arquivo>`. Leitura: membro ativo da empresa (o
técnico precisa do manual em campo). Escrita/remoção: owner com assinatura ativa.
Documento privado sai só por signed URL de 1h. Conteúdo de terceiro não é
re-hospedado: entra como metadado + `official_url` restrito a `https://`.
`is_official` nunca é decidido pelo navegador.

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

- `v2_central_tecnica_rls_rollback.sql` (85 checks) — matriz anon/Owner A/
  Technician A/Owner B/Technician B por SELECT, UPDATE, RPC, JOIN, busca e Storage;
  escrita global só com AAL2; ficha e documento inválidos recusados; unidade de
  outro cliente negada; busca resiste a injeção, símbolos e texto vazio.
- `v2_central_tecnica_golden_path_rollback.sql` (45 checks) — fluxo completo pelas
  RPCs reais (OS idempotente, Base Técnica da 0111, finalização com garantias,
  registro de equipamento instalado da 0083) até o caso aparecer sanitizado.

Dois guards existentes foram estendidos pelo caminho que eles documentam:
inventário de SECURITY DEFINER (149 → 162, com a lista nominal das 13 funções
novas, todas `search_path=''` e sem EXECUTE para anon) e a lista revisada de
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
- 0113–0115 ainda não aplicadas em ambiente real quando este documento foi escrito;
  H0 é o primeiro destino. Production e Beta Live intocados; `main` não mergeada.
- A verificação `verify-consolidated-source.mjs` valida o estado arqueológico
  pós-codemod (roda `apply-round32` antes) e já estava defasada do arquivo vivo
  antes desta onda; não é gate de CI nem de `verify:v2`. Os gates de integridade
  em CI são `verify-foundation-integrity`, `verify-dist-secrets` e
  `verify:reproducible-build`, todos verdes aqui.
- `verify:v2` fecha vermelho no baseline por interação de event loop na suíte do
  Assistant (`ai_gateway.test.mjs` passa isolado). Reproduzido igual no baseline
  intocado; fora do escopo desta onda e da frente em que Claude implementa.
