# Central Técnica V1.1 — indexação de documentos (plano)

## O que a V1 pesquisa hoje

Metadados e conteúdo estruturado, tudo com FTS + unaccent no Postgres:
fabricante, modelo, código compacto, categoria, tags, título de documento e o
texto da ficha rápida (incluindo códigos de erro e sintomas). O PDF em si não
é indexado: abre pelo link oficial ou por signed URL.

Decisão V1: **não** introduzir biblioteca pesada de OCR/extração de PDF nem
vector database sem necessidade comprovada. O projeto não possui pipeline de
processamento assíncrono; o único tratamento de PDF existente é geração
(`pdf-lib` no cliente e `api/quote-pdf.js`), não extração.

## Evolução proposta (V1.1)

1. **Extração de texto no upload** (apenas `company_upload` e
   `ziistec_hosted`, nunca scraping de URL de terceiros):
   - função serverless dedicada (Vercel) com `pdfjs-dist` ou `pdf-parse`,
     executada após o upload, com limite de páginas/tempo;
   - saída em `equipment_document_pages (document_id, page, content text,
     search_tsv tsvector)` com a MESMA regra de escopo/RLS do documento;
   - falha de extração não bloqueia o upload (campo `indexed_at`/`index_error`).
2. **Busca**: `zt_equipment_search` ganha um braço em
   `equipment_document_pages` devolvendo `matched_in = ['document_page']` e a
   página, para o viewer abrir direto no trecho.
3. **Direitos autorais**: indexar somente o que a empresa subiu ou que a
   ZiisTec está autorizada a hospedar. URL oficial continua só metadado.
4. **IA/Assistant**: com as páginas extraídas, o retrieval do Assistant pode
   começar com FTS + rerank simples (sem vector DB). Se a qualidade exigir
   embeddings, avaliar `pgvector` no próprio Postgres antes de qualquer
   serviço externo — mantém RLS e tenant isolation no mesmo lugar.
5. **Gates**: mesmos testes do harness (`scripts/ct-test`) estendidos com
   matriz RLS para `equipment_document_pages` e caso de busca por trecho.
