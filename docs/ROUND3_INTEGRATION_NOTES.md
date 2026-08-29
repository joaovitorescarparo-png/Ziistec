# ZiisTec — Rodada 3 — Notas de integração

## Objetivo
Integrar seletivamente a entrega `ZiisTec_Round3_Entrega.zip` sobre a branch `hardening-v2-staging`, preservando todas as correções posteriores à base usada pelo Claude.

## Estratégia
A entrega da Rodada 3 não foi usada como substituição integral do projeto. Foi tratada como uma fonte de alterações de interface/documentos e fundida com a versão atual de homologação.

A versão atual preserva as migrations e hardenings posteriores à base do Claude, incluindo 0062–0065, além das correções de garantia por OS, garantia de materiais, relações explícitas do PostgREST e separação entre produção e homologação.

## Melhorias da Rodada 3 incorporadas
- PDF de orçamento com apresentação comercial mais forte.
- Logo da empresa no cabeçalho.
- Marca d'água da logo da empresa em baixa opacidade.
- Nome do cliente em destaque no orçamento.
- Nome do cliente no nome do arquivo PDF.
- Diferenciação visual de produto, serviço e item livre.
- Total com maior hierarquia visual.
- Rodapé com dados da empresa.
- Mensagem de WhatsApp mais humana e vinculada ao orçamento.
- Melhorias em cobrança/recibo não fiscal.
- Feedback de carregamento/salvamento e proteção contra ações repetidas onde aplicável.
- Tratamento de mensagens técnicas para português onde aplicável.
- Melhorias nos campos monetários sem alterar o valor numérico persistido.

## Correções feitas durante a integração
1. A marca d'água do orçamento é desenhada antes do conteúdo para ficar realmente ao fundo.
2. Item livre não é rotulado como produto ou serviço no PDF.
3. O fluxo monetário foi ajustado para uma digitação mais natural no uso diário, evitando exigir a entrada de centavos artificiais como `20000` para representar R$ 200,00.
4. Foi corrigida uma inconsistência no gerador de recibo em que o título do documento podia ser referenciado sem estar corretamente definido no escopo.
5. A observação da entrega original do Claude sobre garantia por OS é histórica: a necessidade já foi resolvida posteriormente pelas migrations 0063/0064 e não deve ser tratada como pendência atual.

## Integridade da fonte consolidada
O `src/legacy/ZiisTecApp.jsx` integrado é reconstruído a partir de partes gzip/base64 verificadas por SHA-256.

SHA-256 esperado da fonte consolidada:

`ce1523f036d2db33d6bfe24631907ef2bf3d2aca144366c1fc64fbdb0a5e9104`

O script `scripts/reassemble.mjs` valida cada parte, o gzip completo e o arquivo final antes de gravar a fonte. O script `scripts/verify-consolidated-source.mjs` valida novamente o hash consolidado.

## O que NÃO foi feito nesta integração
- Nenhuma migration nova foi criada para a Rodada 3.
- Nenhuma policy/RLS foi afrouxada.
- Nenhum dado de produção foi alterado.
- A branch `main` não foi modificada.
- A identidade visual geral da ZiisTec não foi redesenhada.
- Não foi implementada NFS-e/NF-e oficial; cobrança e recibo continuam sendo documentos não fiscais.

## Validação obrigatória antes de promoção
A branch só deve avançar depois de passar:

1. `node scripts/reassemble.mjs`
2. `npm ci --ignore-scripts --no-fund`
3. `npm run verify:v2`
4. `npm audit --audit-level=high`
5. `npm run build`
6. deploy de preview Vercel em estado READY
7. homologação humana no tablet/celular, especialmente:
   - listagem de clientes/orçamentos/OS/compras;
   - criação de orçamento;
   - PDF com logo/marca d'água/nome do cliente;
   - compartilhamento/WhatsApp;
   - orçamento → OS;
   - garantia padrão, desativada e personalizada;
   - financeiro, cobrança e recibo;
   - visão do técnico sem custos/financeiro.

## Status
Integração de código concluída na `hardening-v2-staging`. A promoção para `main`/produção permanece bloqueada até CI, deploy e homologação humana final.