# Central Técnica V1

Biblioteca operacional de campo da ZiisTec: fichas rápidas, manuais, esquemas,
favoritos/recentes e casos resolvidos pela própria empresa, integrada às Ordens
de Serviço e à Base Técnica (relato da OS).

## Arquitetura

Um único conjunto de tabelas com **dois escopos**, separados por `company_id`:

| Escopo | `company_id` | Leitura | Escrita |
| --- | --- | --- | --- |
| Biblioteca global ZiisTec | `NULL` | qualquer membro ativo de qualquer empresa | somente platform admin (AAL2) ou `service_role` |
| Conhecimento da empresa | preenchido | membros ativos daquela empresa | owner daquela empresa |

Não existe botão de escrita global no frontend: o caminho administrativo é o
`service_role`/platform admin com AAL2 (`zt_eq_can_write(null)`), auditável e
fora da superfície da API comum.

### Tabelas (migrations `0050`–`0052`)

- `equipment_categories` — categorias (globais seed + privadas), slug único por escopo.
- `equipment_manufacturers` — fabricantes, site/logo opcionais (`https://` only).
- `equipment_models` — modelo (nome, código, descrição, tags, status), FTS e
  `compact_code` gerados; guarda de escopo: modelo global exige fabricante e
  categoria globais; privado nunca referencia conteúdo de outra empresa.
- `equipment_documents` — manual/datasheet/esquema/etc. Três origens
  (`official_url`, `company_upload`, `ziistec_hosted`) com shape validado por
  CHECK; `is_official` só por via administrativa; checksum/size opcionais.
- `equipment_quick_guides` — ficha rápida em JSONB **validado** por trigger
  (`zt_eq_validate_guide_sections`): array de seções com `kind` controlado
  (power, wiring, programming, reset, parameters, diagnostics, codes, alerts,
  other), campos de item permitidos, limites de tamanho (128KB, 40 seções,
  60 itens, passos de 500 chars). `version` incrementa a cada edição de
  conteúdo; `search_text` derivado por trigger alimenta o FTS. Uma ficha
  ATIVA por modelo por escopo (índices únicos parciais).
- `equipment_favorites` / `equipment_recent_views` — por usuário + empresa,
  RLS `user_id = auth.uid() and zt_is_member(company_id)`.
- `company_technical_areas` — áreas técnicas preferidas da empresa (prioriza a
  home; nunca restringe a busca).
- `work_order_equipment` — vínculo OS ↔ modelo. Mesmo recorte das demais
  tabelas de OS: owner tudo; técnico vê/vincula/remove apenas nas próprias OS
  em aberto. Guarda de tenant (OS e modelo da mesma empresa ou global).

### RLS e privilégios

- RLS em todas as tabelas novas; leitura via `zt_eq_can_read`, escrita via
  `zt_eq_can_write` (ambas SECURITY DEFINER, search_path fixo, grant explícito
  conforme a 0022).
- Grants de menor privilégio (padrão 0034): nada para `anon`; `authenticated`
  só alcança linha que a policy permitir.
- Guarda de assinatura (padrão 0044/0045) em todo conteúdo operacional com
  tenant: `zt_guard_subscription_write_if_tenant` — tolerante ao escopo global,
  que não tem assinatura.
- DELETE de conteúdo global é negado até para quem pode escrevê-lo via policy
  (arquivamento por `status`), e UPDATE não consegue "promover" linha privada a
  global (`with check`).

### Storage

Bucket privado `zt-equipment-docs` (50MB; PDF/JPEG/PNG/WebP), caminho
`company_id/equipment/<model_id>/<uuid>-arquivo`:

- leitura: qualquer membro ativo da empresa (técnico consulta manual em campo);
- escrita: owner com assinatura ativa (`zt_subscription_can_write`);
- remoção: owner.

Documento privado sai apenas por **signed URL** (1h). Conteúdo de terceiros
não é re-hospedado: entra como metadado + link oficial (`official_url`,
somente `https://`).

### Busca

RPC `zt_equipment_search(p_company, p_query, p_category, p_limit, p_offset)`
(SECURITY DEFINER, checa `zt_is_member`, paginada, teto de 50):

- FTS `simple` + `unaccent` com prefixo (`fechádura` → `fechadura`), tsquery
  montada defensivamente (`zt_ct_build_tsquery`: só palavras alfanuméricas,
  máx. 8, nunca interpola texto cru);
- código compacto (`zt_ct_compact`): `FR101` ↔ `FR 101` ↔ `fr-101`, com índice
  trigram (`gin_trgm_ops`) sustentando o `LIKE '%…%'`;
- casa também fabricante, título de documento e conteúdo da ficha
  (`search_text`), devolvendo `matched_in`;
- resultado: apenas modelos globais + da própria empresa. Sem `ILIKE`
  indiscriminado; índices GIN confirmados por `EXPLAIN` com 20k modelos.

### OS e Base Técnica

- Na OS, a seção **Equipamento** vincula o modelo (busca → selecionar →
  vincular) e o botão **Ajuda técnica** abre a ficha/manuais/esquemas/casos
  direto do atendimento (`abrirAjudaTecnica` → tela `central` com foco).
- A Base Técnica continua sendo a fonte: nada é duplicado. A RPC
  `zt_equipment_cases(p_company, p_model, …)` (SECURITY DEFINER) media o acesso
  do técnico aos casos da empresa e seleciona **apenas** colunas técnicas:
  número da OS, data de conclusão, sintoma (`problem_report`/`request`),
  relato (`work_order_reports.entry_type='report'`), pendência,
  `needs_return` e a nota do vínculo. Cliente, endereço, telefone, preços e
  financeiro **nunca entram no SELECT** — a sanitização é estrutural, não
  filtro de frontend. `zt_equipment_cases_count` dá o badge da aba.

### Frontend

- `src/lib/centralTecnicaApi.js` — camada de dados (RPCs, tabelas, storage,
  cache offline).
- Telas em `src/legacy/ZiisTecApp.jsx` (fonte consolidada): `CentralTecnica`
  (home/busca/categoria), `CTEquipamento` (abas), `CTFicha`/`CTSecao`
  (renderização da ficha por tipo de seção), gestão do owner (`CTNovoModelo`,
  `CTNovoDocumento`, `CTEditorFicha`), e na OS `OSEquipamentosCT` +
  `OSVincularEquipamentoCT`. Mobile first, cards, botões grandes, erros
  sempre em linguagem de prestador (`mensagemErro`).
- Permissões de papel: `central` (owner + técnico) e `gerirCentral` (owner).
- **Offline**: a última ficha aberta fica em `localStorage` (LRU de 30,
  try/catch em tudo). Leitura sempre tenta a rede; em falha, mostra o cache
  com aviso "exibindo a última versão salva". PDF offline não é requisito V1.

### IA / Assistant (preparação, sem RAG)

O projeto ainda não tem pipeline de retrieval; nada pesado foi adicionado.
Os contratos que o Assistant usará na V1.1 já existem e são seguros por
construção (membership + sanitização no banco):

1. `zt_equipment_search` — localizar o modelo a partir da frase do técnico;
2. `equipment_quick_guides.sections` — JSON estruturado e validado, pronto
   para prompt;
3. `zt_equipment_cases` — casos anteriores sanitizados;
4. `equipment_documents` — metadados + link do manual.

## Testes (banco descartável)

`scripts/ct-test/run.sh` (exige `PGHOST` de um Postgres descartável — **nunca**
Production/Beta): recria o banco, aplica o stub Supabase
(`00_supabase_stub.sql`), roda a cadeia completa de migrations na ordem oficial
(`migration-order.txt`, derivada do histórico; as duplicatas de numeração
antigas foram ordenadas por dependência) e executa:

- `10_central_tecnica_rls.sql` — matriz adversarial: anônimo 0 acesso; Owner A
  cria/vê; Technician A consulta sem administrar; Owner/Technician B 0 acesso
  cruzado (SELECT, UPDATE silencioso, JOIN via RPC, storage, busca); escrita
  global bloqueada; ficha inválida rejeitada; injeção/acentos/busca vazia.
- `20_central_tecnica_golden_path.sql` — os 17 passos do fluxo completo
  (catálogo → busca → ficha → OS → Base Técnica → caso sanitizado → isolamento
  A/B), incluindo idempotência da criação de OS e a prova de que o caso não
  contém preço, nome ou endereço do cliente.

Ambos rodam em transação revertida (re-executáveis). As migrations 0050–0052
são idempotentes (re-aplicação verificada).

## Decisões e trade-offs

1. **Escopo por `company_id NULL`** em vez de tabelas separadas global/privado:
   uma busca, uma RLS, zero duplicação de schema.
2. **Reutilização**: Base Técnica (`work_order_reports` + campos da OS) segue
   como fonte dos casos — view/RPC derivada, sem copiar dados. Não existia
   conceito de ativo/equipamento no produto (o `products` é catálogo de venda),
   então `equipment_models` + `work_order_equipment` foram criados sem paralelo
   duplicado.
3. **RPC em vez de view para casos**: técnico não enxerga OS dos colegas por
   RLS; o caso é conhecimento da empresa, então a mediação SECURITY DEFINER
   com colunas explícitas é o ponto único de sanitização.
4. **JSONB validado para a ficha**: estrutura suficiente para render/busca/IA
   sem explodir em 8 tabelas; validação dura no banco impede blob arbitrário.
5. **Upload**: bucket novo (`zt-documents` é owner-only; manual precisa ser
   lido pelo técnico). SVG continua fora (mesma razão da 0002).
6. **Sem vector DB / OCR / scraping** na V1 (ver riscos e V1.1).

## Riscos conhecidos

- Conteúdo global ainda não tem backoffice; entra por operação administrativa
  (service_role/admin AAL2). Documentado, sem botão escondido no frontend.
- O teste roda em stub local de auth/storage: fiel às policies, mas não cobre
  o PostgREST/GoTrue reais. Validação end-to-end em H0/Preview antes de liberar.
- `zt_ct_norm` declara `IMMUTABLE` sobre `unaccent` (dicionário estável na
  prática; padrão da comunidade). Trocar o dicionário exigiria reindexar.
- Feature fica disponível para validação em H0/Preview; **não liberar em
  Production nesta tarefa** (deploy de `main` é automático — não mergear).

## Roadmap V1.1

- Backoffice de biblioteca global (platform admin) com auditoria.
- Indexação do texto dos PDFs (ver `CENTRAL_TECH_V11_DOCUMENT_INDEXING.md`).
- Assistant consumindo os contratos acima (ficha + casos + manual).
- Ficha offline pró-ativa para favoritos (hoje o cache é das abertas).
- Zoom dedicado para esquemas (pinch) e galeria de imagens.
- Telemetria de busca sem resultado → fila de cadastro para o owner.
