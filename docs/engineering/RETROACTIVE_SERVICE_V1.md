# Registrar serviço realizado — V1 (0117)

## O problema

O produto só sabia abrir uma OS para o que ainda vai acontecer. Quem atendeu
ontem e lança hoje tinha duas saídas ruins: abrir uma OS "de hoje" e perder a
data real do atendimento, ou editar o banco por fora. As duas estragam
histórico, garantia e financeiro.

## A forma da solução

Um segundo botão na tela de Ordens de serviço, ao lado de "+ Nova OS":
**Registrar serviço realizado**. Só isso muda na navegação. Não há aba nova,
menu novo, módulo novo, tabela de serviços realizados, financeiro paralelo nem
estoque paralelo. O que sai do formulário é uma `work_order` concluída normal,
que aparece em Concluídas, no histórico do cliente, nos relatórios, no
financeiro e no estoque como qualquer outra.

Owner-only: registrar um atendimento passado é ato administrativo. O botão
depende de `papel === "proprietario"` e de sessão real, e a RPC exige
`zt_is_owner` — esconder o botão nunca é o controle.

## As duas datas

Este é o ponto que o modelo não tinha e que o fluxo resolve:

| campo | significado |
| --- | --- |
| `scheduled_date` / `scheduled_time` | quando o serviço foi feito |
| `completed_at` | o momento histórico real da conclusão |
| `created_at` | quando o registro foi lançado no sistema |

`created_at` **nunca** é escrito pela RPC. É ele que torna "Registrado
posteriormente" derivável: a tela compara o dia local do `created_at`
(`registradoEm`, em `fromWorkOrder`) com a data do serviço. Nenhuma coluna
existe para marcar isso, e o histórico da OS ganha uma linha dizendo as duas
datas em palavras.

## Reúso, não fluxo novo

`public.zt_register_completed_work_order(p_company, p_request, p_row, p_items,
p_materials, p_payment)` é a única função que a 0117 cria. Ela encadeia o que já
existia:

1. `zt_private.zt_save_work_order_idempotent` — número, local do cliente, itens;
2. `work_order_materials` antes da conclusão (a trava de documento concluído
   impede inserir material depois);
3. `zt_private.zt_complete_work_order` — relato no histórico, garantias e o
   lançamento em `financial_entries`;
4. `public.zt_adjust_product_stock` — a baixa oficial.

Só depois disso, na mesma transação e só neste fluxo, ela corrige o que a
conclusão normal fixa em "agora": `completed_at`, `warranties.starts_on`/`ends_on`
(preservando a duração) e o `due_date` do recebível. A OS normal e a finalização
normal não mudam: nenhuma função existente é redefinida.

## Estoque

Usa `zt_adjust_product_stock` com delta negativo, e **não**
`zt_sell_product_on_work_order`: a venda em campo criaria um segundo recebível
ao lado do faturamento da própria OS, cobrando o cliente duas vezes.

- O pedido de cada baixa é derivado do registro: `md5(request || ':' || product)`.
  Retry do mesmo registro não baixa de novo.
- Produto sem `track_stock` não gera movimento. Chamar o ajuste ligaria
  `track_stock` sem o usuário ter pedido.
- O movimento cita a OS, a data real do serviço e a data do registro.
- Estoque insuficiente **aborta o registro inteiro** (`23514`). É a leitura
  segura de "não deixar metade do registro aplicada": melhor recusar e pedir que
  a compra seja lançada do que gravar saldo negativo ou uma OS sem a baixa.

## Financeiro

Reusa o lançamento que a conclusão oficial criou; a RPC nunca insere um segundo.
Pendente vence em `data do serviço + dias` (os mesmos 7 da finalização normal) ou
na data informada. Pago marca o mesmo lançamento, com forma obrigatória e data
de pagamento que não pode ser futura — e por isso não sobra cobrança pendente
residual. O técnico continua sem acesso ao financeiro.

## Garantias

Para o registro retroativo, `starts_on` é a data real do serviço e `ends_on`
preserva a duração que a política do catálogo deu. A finalização normal continua
começando a garantia hoje.

## Idempotência e transação

`client_request_id` identifica o registro. O mesmo pedido devolve o mesmo
registro com `replayed: true`, antes de qualquer escrita, e não repete OS,
materiais, estoque nem financeiro. A função é uma unidade: qualquer falha desfaz
tudo.

## Provas

- `supabase/tests/v2_retroactive_service_rollback.sql` (58 checks, no gate
  oficial): hoje e cinco dias atrás; data futura recusada sem deixar OS;
  Concluídas; cliente, responsável, serviços e materiais; estoque baixando
  exatamente uma vez e produto sem controle sem movimento; pendente e pago;
  retry não duplicando OS, estoque, financeiro nem materiais; `created_at` real e
  não falsificado; data do serviço histórica; garantia na data do serviço;
  estoque insuficiente não deixando nada pela metade; técnico e proprietário de
  outra empresa recusados; `company_id` do corpo ignorado; Nova OS e finalização
  normais intactas.
- `tests/blockers/retroactive_service_contract.test.mjs` (8 testes, no
  `verify:v2`): o contrato da tela, da camada de dados e da migration.
