# ZiisTec — Changelog da Rodada 3

## Resumo

Rodada de polimento comercial. O foco foi o documento que chega ao cliente e o
acabamento dos fluxos existentes. Nenhuma tela foi redesenhada, nenhuma
navegação foi trocada e nenhuma funcionalidade foi removida. Não houve alteração
de migration, RPC, RLS ou schema do Supabase, e nada foi mexido na Vercel.

Fiz auditoria antes de escrever código: li o gerador de PDF, os fluxos de
orçamento, OS, financeiro, compras e garantia, e o tratamento de erro atual.
As alterações foram incrementais e verificadas uma a uma.

---

## Arquivos alterados

| Arquivo | Motivo |
|---|---|
| `api/quote-pdf.js` | Proposta comercial: marca d'água com a logo, cliente em destaque, tipo do item, TOTAL destacado, local/validade, rodapé e nome do arquivo com o cliente |
| `src/legacy/ZiisTecApp.jsx` | Nome do cliente na identificação do orçamento, mensagem de WhatsApp humana, campo de dinheiro brasileiro, travas contra duplo clique, cobrança × recibo |
| `src/lib/supabase.js` | Tradução de erros técnicos do PostgREST/Postgres para português, com detalhe apenas no console |
| `src/lib/reciboPdf.js` | Título conforme o documento (recibo ou cobrança) e aviso "não substitui NF-e ou NFS-e" |
| `scripts/verify-consolidated-source.mjs` | Apenas o pin de hash. O guard continua ativo |
| `CLAUDE_ROUND3_CHANGELOG.md` | Este arquivo |

---

## O que foi implementado

**1. PDF do orçamento (item 1).** A logo da empresa passou a ser desenhada
também como marca d'água centralizada, com opacidade 0,06 — dentro da faixa de
4% a 8% pedida — aplicada em todas as páginas no fechamento do documento, para
não interferir na leitura. O bloco do cliente virou **"ORÇAMENTO PARA [NOME]"**
com o nome em corpo grande. A tabela ganhou uma coluna discreta de tipo
(Serviço/Produto). O TOTAL ganhou faixa de fundo e corpo 17. Foram acrescentadas
as seções de local do serviço e validade, e o rodapé passou a trazer empresa,
CNPJ/CPF, telefone, WhatsApp, e-mail, endereço, responsável e a linha
"Documento gerado pela ZiisTec". Condições de pagamento, observações e a
proteção que impede custo/margem de irem para o PDF continuam como estavam.

**2. Nome do cliente no orçamento (item 2).** A listagem já liderava pelo
cliente. O detalhe passou a exibir `ORC-0003 — Fabio`, o PDF diz
"Orçamento para Fabio" e o arquivo sai como `ORC-0003 - Fabio.pdf`, com acentos
e símbolos saneados tanto no frontend quanto no `Content-Disposition` da API.

**4. WhatsApp (item 4).** A mensagem deixou de ser uma lista técnica de itens e
passou a ser: saudação com o primeiro nome do cliente, número do orçamento, nome
da empresa, valor total em destaque, validade e condição de pagamento quando
existirem, e fechamento cordial. Tudo montado com dados reais do orçamento.

**5. Documentos para o cliente (item 5).** A seção agora se chama "Documentos e
comprovantes para o cliente" e o documento se adapta ao estado: receita não paga
gera **Cobrança**, receita paga gera **Recibo**. O PDF muda o título conforme o
caso e traz "Este documento não substitui NF-e ou NFS-e". Nenhuma emissão fiscal
foi implementada.

**6. Campos de dinheiro (item 6).** Novo componente `InputMoeda`: prefixo `R$`
fixo, digitação de centavos da direita para a esquerda e formatação brasileira
ao vivo. Digitar `20000` mostra `200,00`; `2000000` mostra `20.000,00`. Acabou o
comportamento de `0200`. O valor entregue ao banco continua sendo número limpo.
Aplicado em preço unitário do orçamento, desconto, acréscimo, preço e custo do
cadastro rápido, item livre, outros custos da OS e valor de lançamento
financeiro.

**7. Duplicidade (item 7).** Criar orçamento, abrir OS, salvar cliente,
registrar compra e concluir atendimento agora desabilitam o botão e mostram
"Salvando…", "Criando…", "Registrando…" ou "Concluindo…" enquanto a operação
corre. A idempotência do backend não foi tocada — isto é camada de UX somada a
ela, não substituta.

**8. Mensagens de erro (item 8).** `mensagemErro` passou a cobrir os erros
estruturais que vazavam texto técnico: `PGRST200/201` e "could not embed"
viram "Não foi possível carregar os dados agora. Tente novamente."; `23502` vira
"Preencha os campos obrigatórios"; `42P01`/`42703` viram "Esta função ainda não
está disponível neste ambiente"; timeouts e conflitos têm mensagem própria.
Qualquer código desconhecido cai em mensagem genérica em português. O detalhe
original vai só para `console.warn`, para diagnóstico.

**9. Feedback visual (item 9).** Estados textuais nos botões críticos, incluindo
"Gerando…" no PDF e no compartilhamento, que já existiam e foram preservados.

**12. Garantia (item 12).** Preservada integralmente, sem regressão.

---

## O que não foi alterado

Identidade visual, paleta, sidebar, navegação e layout das telas. Migrations,
RPCs, RLS, policies e schema do Supabase. Configuração da Vercel. Separação
owner/technician: o técnico continua sem financeiro, custos, margem, compras,
carteira de clientes e orçamentos, verificado por teste.

Itens 3 (preview do PDF antes do download), 10 (varredura completa de
responsividade), 11 (auditoria ponta a ponta do fluxo orçamento → OS), 13
(refino das demais listagens), 14 (acessibilidade), 15 (performance) e 16
(bateria completa) **não foram cobertos por inteiro** — ver Pendências.

---

## Testes executados

| Comando | Resultado |
|---|---|
| `npm ci` | ok |
| `npm run verify:v2` | exit 0 |
| `npm audit --audit-level=high` | exit 0 — 0 vulnerabilidades |
| `npm run build` | exit 0 |

Dez testes de comportamento (Vitest + Testing Library), todos passando:

1. campo de dinheiro formata em padrão brasileiro (`20000` → `200,00`;
   `2000000` → `20.000,00`);
2. orçamento identificado pelo cliente na lista e no detalhe;
3. três cliques em "Criar orçamento" geram um único ORC;
4. documento sai como cobrança quando não pago e recibo quando pago, com o
   aviso de não substituir NF-e/NFS-e;
5. erros técnicos viram português sem vazar detalhe;
6. técnico segue sem financeiro, compras, clientes e orçamentos;
7. a 10 · regressão das rodadas 1 e 2: orçamento manual-first com IA opcional,
   cadastro rápido com garantia, financeiro com 4 abas / filtros / fluxo 7-30-60,
   agenda, garantias e OS acessíveis.

Além disso, validei o PDF executando `pdf-lib` de verdade: confirmei que a
imagem entra como XObject e que o operador de estado gráfico de opacidade é
aplicado — a marca d'água não é só código que compila.

**Não testei:** celular, tablet ou navegador reais, e o Supabase de homologação.
Não tenho acesso físico a dispositivos nem à rede do projeto neste ambiente.
Portanto, o PDF novo **não foi visualizado renderizado**; validei estrutura,
sintaxe e a mecânica da opacidade, não o resultado estético.

---

## Riscos encontrados

- **Marca d'água com logos claras:** a opacidade fixa de 0,06 funciona bem na
  maioria dos casos, mas uma logo quase branca pode ficar invisível e uma muito
  escura pode pesar. Só a homologação visual resolve; se incomodar, o ajuste é
  de uma constante.
- **PDF sem verificação visual:** vale abrir um orçamento real antes de enviar
  ao primeiro cliente.
- **`InputMoeda` em campos de custo:** a digitação por centavos muda o hábito de
  quem digitava "450" esperando R$ 450,00. Agora é preciso digitar "45000".
  É o padrão de bancos e maquininhas, mas merece um olhar seu.

---

## Pendências

- Item 3: preview do PDF antes do download.
- Item 10: varredura de responsividade em Android tablet, iPad e celulares.
- Item 11: auditoria ponta a ponta de orçamento → enviado → aprovado → OS,
  conferindo preservação de cliente, itens, valores, local e garantia.
- Itens 13, 14 e 15: refino das demais listagens, acessibilidade e performance.
- Etapas C, D e E do documento de fusão continuam abertas.

---

## Necessidade de migration / RPC / backend

**Nenhuma nesta rodada.** Tudo foi feito com o schema e as APIs existentes.

Continua valendo o registrado em `docs/ROUND2_BACKEND_NEEDS.md`: o override de
garantia por OS depende de um parâmetro novo em
`zt_finalize_work_order_atomic`, e a emissão fiscal oficial depende de provedor,
certificado e credenciais — nada disso foi simulado.

---

## Passos para homologação humana

1. Abrir um orçamento real com logo cadastrada e gerar o PDF. Conferir marca
   d'água, legibilidade, TOTAL, rodapé e o nome do arquivo.
2. Enviar esse orçamento pelo WhatsApp e ler a mensagem como se fosse o cliente.
3. Criar um orçamento digitando valores no campo novo de dinheiro e conferir o
   valor salvo depois de recarregar a página.
4. Clicar várias vezes em "Criar orçamento" e confirmar que nasce um só.
5. No Financeiro, gerar uma cobrança de conta em aberto e um recibo de conta
   paga; conferir os dois PDFs.
6. Entrar como técnico e confirmar que financeiro, custos e compras seguem fora
   do alcance.
7. Repetir os passos 1 a 5 em tablet e celular reais.
