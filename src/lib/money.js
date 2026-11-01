/* Formatação de dinheiro para a tela. Só exibição: o valor autoritativo vem sempre do banco.
 * Entrada que não é número (texto, null, undefined, NaN) aparece como R$ 0,00, nunca como "R$ NaN". */
export const brl = (valor) => (Number(valor) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
