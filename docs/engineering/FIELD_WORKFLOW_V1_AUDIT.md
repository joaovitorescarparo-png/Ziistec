# FIELD WORKFLOW V1 — AUDITORIA WAVE 0

Base auditada: `f3a9d41412885c0ef67019e33cb0eb8266063013`

Branch de trabalho: `field-workflow-v1`

Objetivo: reutilizar contratos existentes antes de criar schema novo. Esta auditoria não autoriza Production, não altera F11 e não inicia F12.

## Matriz de capacidades

| Capacidade | Estado | Evidência atual | Decisão para o Field Workflow V1 |
| --- | --- | --- | --- |
| Templates de orçamento/serviço | MISSING | Não existe entidade/versionamento de template no schema auditado nem arquivo dedicado na árvore da branch | Criar somente na Wave 4, com escopo por empresa e itens reutilizáveis |
| Kits/combos | MISSING | Não existe entidade de kit no schema auditado | Criar somente na Wave 4; adicionar kit ao orçamento não movimentará estoque |
| Checklist por OS | AVAILABLE | `work_order_checklists` já persiste texto, posição e concluído com RLS para owner/técnico atribuído | Reutilizar |
| Templates de checklist | MISSING | Checklist existe apenas por OS, sem catálogo de templates por tipo de serviço | Completar na Wave 3 sem substituir `work_order_checklists` |
| Equipamentos/ativos instalados | MISSING | Não existe entidade durável de equipamento instalado ligada a cliente/local/OS | Criar arquitetura mínima na Wave 3 |
| Número de série | PARTIAL | `work_order_materials.serial_number` e `warranties.serial_number` existem | Reutilizar os snapshots existentes e adicionar vínculo ao equipamento instalado na Wave 3 |
| Garantias | AVAILABLE | `warranties`, políticas por item/material, overrides e finalização idempotente já existem | Estender vínculo com equipamento; não criar segundo sistema de garantia |
| Anexos/evidências | AVAILABLE | `attachments` + bucket privado `zt-work-orders`; `media_kind`, `media_stage`, `caption` | Reutilizar para Antes/Durante/Depois/Equipamento/Documento-Outro |
| Foto de produto | PARTIAL | `products.image_path` e UI/upload existem, mas usam semanticamente o bucket `zt-branding` | Preservar compatibilidade e mover novos uploads para bucket dedicado `zt-product-images` em Staging |
| SKU/código interno | MISSING | Não existe campo observado em `products` | Adicionar campo por empresa na Wave 1 |
| Código de barras | MISSING | Não existe campo/índice observado em `products` | Adicionar campo na Wave 1; scanner é conveniência de frontend, busca continua tenant-scoped |
| `work_order_reports` | PARTIAL | Tabela existe com `report/history` e corpo textual; conclusão já grava histórico | Reutilizar e estender para snapshot/versionamento do Relatório de Atendimento; não criar tabela paralela com a mesma finalidade |
| Histórico de atendimento | PARTIAL | OS, `work_order_reports`, materiais, anexos, garantias e vendas já formam histórico relacional | Consolidar navegação e vincular relatório imutável sem duplicar CRM |
| Pós-venda | PARTIAL | `post_sale_followups` e `services.followup_days` já geram follow-up idempotente ao concluir OS | Reutilizar e ampliar cadências na Wave 4 |
| Localização do cliente | PARTIAL | Cliente tem `address`, Google Place ID, latitude/longitude e Maps URL; orçamento/OS têm `service_place`/`address` | Preservar. Hoje é um local principal + snapshots textuais; multi-local/unidade durável fica para extensão mínima quando necessária |
| Snapshot de item de orçamento | AVAILABLE | `quote_items` congela nome, quantidade e preço da linha | Reutilizar para PDF e continuidade orçamento → OS |
| Orçamento aprovado → OS | AVAILABLE | Fluxo idempotente já existe e deve permanecer autoridade | Reutilizar; nenhum estoque é movimentado ao montar orçamento |
| Estoque | AVAILABLE | `inventory_movements`, locks/RPCs e catálogo V2 | Backend continua autoridade; novas features não baixam estoque diretamente |
| Financeiro | AVAILABLE | `financial_entries`, vínculo único por OS e finalização transacional | Relatório nunca cria receita nem novo efeito financeiro |
| Catálogo seguro do técnico | AVAILABLE | `zt_technician_catalog` retorna preço comercial e omite custo/margem/fornecedor | Reutilizar para scan/seleção em campo |

## Achados de arquitetura

### Orçamento

`quotes` já guarda validade, condição de pagamento, observações e local. Faltam campos semanticamente separados para mensagem ao cliente, previsão de execução e preferência de imagens no PDF. Esses campos devem ser aditivos; observação interna não será reaproveitada como mensagem comercial.

O orçamento V2 já possui ditado por voz e confirmação humana. A Wave 1 deve reutilizar `useSpeechInput` para a nova mensagem, sem criar uma tela de IA separada.

### PDF de orçamento

`api/quote-pdf.js` é server-side, exige sessão/owner, consome quota e deliberadamente não seleciona `unit_cost`. A reorganização do documento deve acontecer ali, mantendo custo e margem fora do payload do cliente. Imagens de produto serão opcionais e somente quando a preferência do orçamento estiver habilitada.

### Produto e Storage

Imagem de produto já existe na UI e no schema, com JPG/PNG/WEBP e limite de 2 MB, sem base64. O problema é semântico: o upload atual usa `zt-branding`. Como não há bucket dedicado a produto, a Wave 1 deve criar `zt-product-images` em Staging com caminho iniciado por `company_id`, owner como autoridade de escrita e leitura limitada aos membros autorizados. O resolver deve manter fallback para imagens legadas em `zt-branding` para não quebrar dados existentes.

### Relatório de Atendimento

A plataforma já possui `work_order_reports` e a finalização atômica atual é a autoridade para status, garantias e cobrança. O Relatório de Atendimento deve ser acoplado a essa transação por snapshot idempotente, sem recalcular estoque e sem criar `financial_entries`. Um retry da finalização precisa retornar/reutilizar o mesmo relatório.

### Evidências

A classificação técnica já existe: `before`, `during`, `after`, `equipment`, `video`, `other`, além de `media_kind=document`. A Wave 2 deve melhorar a apresentação/seleção, não inventar uma segunda tabela de fotos.

### Equipamentos instalados

Número de série existe como informação de material/garantia, mas falta uma entidade que responda de forma durável “o que está instalado neste cliente/local?”. Essa é uma lacuna real e justifica schema novo na Wave 3.

### Local / condomínio / unidade

Hoje `clients` representa o cadastro do cliente com um local principal e a OS/orçamento preservam `service_place`. Não foi encontrada uma entidade multi-local durável. A Wave 3 pode precisar de um vínculo mínimo para equipamento/local, mas não será criado um segundo cadastro de cliente.

## Autoridades que não podem mudar

- preço de venda: backend/RPC e snapshots autorizados;
- estoque: RPC/movimentos atuais;
- financeiro: finalização/RPCs atuais;
- membership/subscription: banco;
- garantia: contratos atuais;
- visibilidade do técnico: RLS/RPC, nunca apenas UI;
- relatório: deve ser efeito operacional da finalização, nunca autoridade financeira.

## Plano mínimo derivado da auditoria

Wave 1 pode adicionar campos a `quotes` e `products`, criar o bucket dedicado de produto e melhorar UI/PDF/scanner. Não requer tabela nova de orçamento, produto ou histórico.

Wave 2 deve estender `work_order_reports` para snapshot/versionamento do Relatório de Atendimento e reutilizar `attachments`.

Wave 3 é a primeira wave em que uma entidade nova de equipamento instalado é justificada. Checklist base já existe; só o catálogo/template é novo.

Wave 4 pode criar templates/kits porque não há equivalentes atuais; pós-venda deve estender `post_sale_followups`.

## Offline — diagnóstico inicial

Sem internet, as áreas mais críticas hoje são: abertura/atualização da OS do técnico, checklist, relato, upload de evidência e finalização. Não será implementado offline-first nesta fase. Recomendação futura: fila local explicitamente idempotente por operação, cache somente de contexto mínimo da OS atribuída, reconciliação com versão/ETag e nunca cachear custos/financeiro para técnico.
