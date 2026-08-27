# ZiisTec — Changelog da Rodada 2

Base: branch `ui-v1-v2-merge`, commit `dc98b73c6ba68d09722f6a6b67b5d21d95af67f4`.

Nenhuma migration, policy, RLS, schema Supabase ou configuração da Vercel foi
alterada. Nenhum secret ou service role entrou no frontend. Nenhum documento
fiscal foi criado.

---

## Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `src/legacy/ZiisTecApp.jsx` | Orçamento (pós-criação, barra fixa, quantidade, cadastro rápido com garantia), finalização da OS (garantias previstas e resultado), garantia (leitura), financeiro (4 abas, documentos, recibo) |
| `src/lib/reciboPdf.js` | **Novo.** Recibo/documento de cobrança não fiscal em PDF, gerado no navegador com `pdf-lib` (dependência já existente) |
| `scripts/verify-consolidated-source.mjs` | Apenas o pin de hash do arquivo consolidado. O guard continua ativo |
| `docs/ROUND2_BACKEND_NEEDS.md` | **Novo.** Necessidade de backend que não pôde ser feita sem migration |
| `CLAUDE_ROUND2_CHANGELOG.md` | **Novo.** Este arquivo |

---

## O que foi implementado

**1. Pós-criação do orçamento.** Ao criar, nada é baixado automaticamente. Uma
confirmação mostra `ORC-XXXX criado` com quatro ações: `Ver orçamento`,
`Gerar PDF`, `Enviar pelo WhatsApp` e `Continuar depois`. O PDF continua vindo do
registro persistido, por `baixarOrcamentoPDF`/`compartilharOrcamentoPDF`, e o
WhatsApp reutiliza a lógica que já existia. A confirmação é renderizada pela
tela de Orçamentos, não pelo editor: `salvarOrcamento` já navega para o
documento e desmontaria o editor antes do modal aparecer.

**2. Resumo e ação no celular/tablet.** Barra inferior fixa (`lg:hidden`) com o
total do orçamento e o botão principal, sempre ao alcance do polegar. Nenhum
campo foi escondido; a coluna de resumo do desktop continua igual.

**3. Itens mais rápidos.** Quantidade com `−`/`+` de 44px ao lado do campo
numérico, preço de venda editável, remoção por item e `Item livre` preservado.

**4. Cadastro rápido com garantia.** Serviço e produto ganharam
`Tem garantia? Sim/Não`; em Sim, atalhos (30/60/90/180/365 dias para serviço,
3/6/12/24/36 meses para produto) e campo personalizado. O prazo é gravado em
`garantiaDias`/`garantiaMeses`, os mesmos campos do cadastro completo. O custo só
aparece para quem tem `verValores` — técnico não vê. Após salvar, o item entra
no orçamento imediatamente.

**5. Finalização da OS mais clara.** O resumo agora mostra relato, materiais,
fotos, adicionais, pendência, **garantias deste atendimento** e o valor a
receber, seguido de `Finalizado` / `Precisa retornar` / `Não finalizado`.
`Precisa retornar` conclui e registra a pendência; `Não finalizado` salva relato,
fotos e pendência sem concluir nada. O RPC de finalização não foi tocado. Para o
técnico, o resumo continua sem custo, margem ou valores.

**6. Garantias na OS.** A prévia mostra item, origem (serviço ou fabricante),
prazo e data final calculada a partir da data de execução — a mesma regra que o
backend aplica. Itens com prazo zero não geram garantia; atendimento em garantia
não gera nova. **Desativar ou alterar o prazo só para aquela OS não foi
implementado**: o contrato do RPC não aceita, e criar migration era proibido. Ver
`docs/ROUND2_BACKEND_NEEDS.md`.

**7. Leitura da garantia.** O detalhe passou a exibir origem e tempo restante,
somados aos campos que já existiam: cliente, local, data inicial, data final,
prazo, série, OS de origem e status Ativa/Expirada. `Gerar orçamento pago` para
garantia expirada foi preservado.

**8. Responsividade.** Melhorias restritas às áreas tocadas: barra fixa no
orçamento, botões de quantidade e de resultado com área de toque confortável,
modais com rolagem adequada. Paleta, sidebar e identidade intactas.

**9. Financeiro operacional.** Reorganizado em `Visão geral`, `A receber`,
`A pagar` e `Documentos`. A Visão geral reúne os indicadores do mês, o fluxo
projetado e o resultado com margem por OS — todos calculados a partir de
`financial_entries` e das OS reais, sem número inventado. `A receber` e `A pagar`
mostram em aberto e já baixado no mesmo lugar. `Documentos` lista os boletos e
notas anexados às compras, usando `purchase.anexos` com URL assinada do bucket
privado `zt-documents` que já existia, e as cobranças que podem virar recibo.

**10. Recibo não fiscal.** Nova ação em cada receita (`Recibo`) e na aba
Documentos. O PDF traz logo quando houver, dados da empresa e do cliente, número
do documento, OS de origem, itens, valor, vencimento ou data de pagamento, forma,
observações ditáveis por voz e data de emissão — com **DOCUMENTO NÃO FISCAL** em
destaque e a frase "não substitui nota fiscal". Gerado no navegador com
`pdf-lib`; nenhum endpoint, bucket ou tabela nova. A área traz o aviso
`Nota fiscal: integração ainda não configurada`, sem botão falso e sem chamada
externa.

---

## Complemento: addendum financeiro (`docs/CLAUDE_ROUND2_FINANCE_ADDENDUM.md`)

Depois das 10 melhorias, completei os pontos do addendum que ainda faltavam.
Tudo em cima de `financial_entries`, `purchases` e das OS que já existiam.

- **Fluxo de caixa 7 / 30 / 60 dias** (item F): a janela virou um seletor. Antes
  era fixa em 30. Contas vencidas continuam fora da previsão e aparecem em
  "Em atraso", para não inflar o projetado.
- **Receber hoje / Pagar hoje** (item F): faixa no topo da Visão geral, exibida
  só quando há algo vencendo hoje, com atalho para a aba correspondente.
- **Filtros em A receber e A pagar** (itens A e B): busca na descrição, situação
  (em dia, vencido, pago/recebido), origem (OS, contrato, compra, manual) e
  cliente. São filtros de leitura: recortam a lista que a RLS já entregou, sem
  alterar nada.
- **Origem visível na linha** (itens A e B): cada lançamento mostra se veio de
  ordem de serviço, compra, contrato ou lançamento manual, além do cliente.
- **Cobrança por WhatsApp** (item A): ação rápida em contas a receber em aberto,
  com valor e vencimento na mensagem. Aparece só quando o cliente tem telefone.
- **Situação fiscal explícita** (item E): o recibo declara
  "Situação fiscal: não emitida · integração com provedor de NFS-e ainda não
  configurada". Nenhum botão de emissão, nenhuma chamada externa, nenhum status
  fiscal inventado.

### Correção encontrada pelos testes

Ao trocar a janela fixa de 30 dias pelo seletor, duas referências a
`entradas30`/`saidas30` ficaram órfãs no bloco de fluxo de caixa. O `vite build`
passava — é JSX válido —, mas a aba quebrava em tempo de execução com
`ReferenceError`. Os testes de comportamento pegaram e a referência foi
corrigida. Vale como lembrete de que build verde não é o mesmo que tela
funcionando.

---

## O que foi testado

- `npm ci`, `npm run verify:v2` e `npm run build`: todos verdes, incluindo a
  reexecução a partir do ZIP extraído em pasta limpa.
- Nove testes de comportamento (Testing Library), todos passando:
  1. criar orçamento oferece PDF/WhatsApp sem baixar sozinho, e a quantidade tem
     `−`/`+`;
  2. cadastro rápido aceita garantia sem sair do orçamento;
  3. financeiro tem as quatro abas e a aba Documentos lista o boleto da compra;
  4. o recibo se identifica como não fiscal e não simula NFS-e;
  5. técnico continua sem Financeiro, Compras, Clientes e Orçamentos;
  6. fluxo de caixa alterna entre 7, 30 e 60 dias;
  7. A receber tem filtros de situação, origem e cliente;
  8. a origem do lançamento aparece na linha;
  9. o recibo declara situação fiscal sem simular emissão.

**Não testado:** navegador real, celular e tablet físicos, e o Supabase de
homologação — não tenho acesso a eles neste ambiente.

---

## Correção incidental

`salvarOrcamento` não devolvia o id no modo demonstração, o que impediria a
confirmação pós-criação de funcionar fora do ambiente conectado. Passou a
devolver nos dois modos.

---

## Revisão de integração ChatGPT

Antes da integração foram corrigidos três pontos encontrados na revisão independente:

1. `Não finalizado`: quando fotos e campos textuais eram salvos juntos, o helper persistia apenas as fotos. O fluxo agora persiste fotos e também relato/pendência; materiais continuam sendo lançados somente na conclusão e a interface passou a dizer isso explicitamente.
2. `Precisa retornar`: a seleção agora grava `work_orders.needs_return` antes da finalização no caminho real do Supabase, sem alterar a RPC ou criar migration.
3. Documento financeiro: conta paga gera **RECIBO**; conta em aberto gera **DOCUMENTO DE COBRANÇA**. Ambos continuam `DOCUMENTO NÃO FISCAL`. Quando houver logo PNG/JPG acessível por URL assinada, o PDF tenta incorporá-la.

Os guards estáticos V2 e de runtime foram reexecutados após essas correções e permaneceram verdes.
