# Onda 1 da consolidação V2 — entradas no app principal

Decisões da Onda 1 (A1–A4). Fonte do código: `src/lib/recursosV2.js`, `src/App.jsx` (`abrirRecursoV2`), `src/lib/pdfLogoBox.js`, `src/lib/estoque.js`, `src/lib/dashboardInicio.js`. Testes: `tests/blockers/consolidation_wave1.test.mjs`.

## Entradas (somente proprietário)

| Aba do app principal | Tela V2 aberta |
| --- | --- |
| Serviços e produtos (produtos) | Estoque e movimentações (`?v2=produtos`) |
| Clientes e detalhe do cliente | Locais no mapa (`?v2=clientes-locais`, com `client=`) |
| Garantias | Garantia manual, Pós-venda, Contratos e preventivas |
| Financeiro | Visão gerencial (`?v2=financeiro`) |
| Início (alerta de estoque baixo) | Estoque e movimentações |

- O técnico não recebe nenhuma entrada. O owner gate das rotas em `App.jsx` continua sendo a barreira; `abrirRecursoV2` repete a checagem e o banco segue como autoridade.
- Fechar e Voltar numa tela aberta pelo app principal voltam à aba de origem: a origem fica em `history.state` da entrada do app principal e a tela V2 ganha uma entrada própria. Tela aberta por URL direta mantém o fechamento antigo (hub).
- As rotas `?v2=` continuam existindo para teste técnico e homologação.

## Compras V2 e Configurações V2: sem entrada nova

Comparadas com as abas principais antes da decisão:

- **Compras V2** grava pelo mesmo `salvarCompraDB` / `zt_save_purchase_idempotent` da aba Compras. A aba principal tem anexos de documentos e exclusão, que a V2 não tem; a V2 só acrescenta indicadores e busca. Entrada nova duplicaria o fluxo. A rota técnica fica.
- **Configurações V2** repete os campos de Empresa e Padrões de orçamento da aba Configurações, que ainda traz voz, integrações e assinatura. Nada a aproveitar sem duplicar campos. A rota técnica fica.

Se um indicador da Compras V2 fizer falta, o caminho é levá-lo para a aba Compras, não abrir uma segunda tela.

## Compatibilidade com o banco 0099

O frontend novo funciona com o banco no estado do Beta Live: as RPCs e tabelas de 0100–0105 ausentes degradam para mensagem de produto ("ainda não está disponível na sua conta") sem erro técnico, e a carga de OS lista colunas que existem desde a 0086. O inverso não vale: a 0105 continua exigindo o frontend novo.

## Limites conhecidos

- O alerta de estoque baixo usa a mesma regra da tela de estoque, que inclui produtos inativos com controle de estoque.
- "Serviços concluídos recentemente" usa a data de conclusão da OS; OS sem essa data não aparecem. O técnico vê só as OS que o banco já entrega a ele.
- O PDF de orçamento (gerado no servidor) é verificado por inspeção do código; os outros três PDFs são gerados e medidos nos testes.
