// Segurança V1.1 (SEC-04): o ajuste manual de estoque é idempotente por pedido. O banco reconhece o pedido pelo UUID;
// aqui o UUID nasce uma vez por operação lógica (produto + quantidade) e é reaproveitado em cada nova tentativa:
// retry depois de timeout, duplo clique e reenvio do formulário chegam ao banco com o MESMO id e alteram o estoque
// uma única vez. Mudou o produto ou a quantidade, é outra operação e ganha outro id. Só um ajuste concluído
// (done) libera o id; depois de erro ele continua valendo para a próxima tentativa.
export function createAdjustmentRequestKeeper(newId = () => globalThis.crypto.randomUUID()) {
  let current = null;
  return {
    idFor(productId, delta) {
      const key = `${productId}|${Number(delta)}`;
      if (!current || current.key !== key) current = { key, id: newId() };
      return current.id;
    },
    done() { current = null; },
  };
}
