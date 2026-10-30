/* Regra única de estoque baixo: produto com controle de estoque cujo saldo está no mínimo ou abaixo dele.
 * Usada pela tela Produtos e estoque e pelo alerta do Início; não duplique a comparação em outro lugar. */
export const estoqueBaixo = (produto) => Boolean(produto?.controlaEstoque) && Number(produto.estoque) <= Number(produto.estoqueMinimo);
