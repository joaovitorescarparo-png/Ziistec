import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gerar, item, orcamentoBase, textos, semSobreposicao, A4, MARGEM, DIREITA, SAFE_BOTTOM,
} from './support/quote-pdf-harness.mjs';

// Bloco de fechamento do PDF (resumo, TOTAL, garantia, condições e aceite), medido no desenho REAL da
// rota /api/quote-pdf (o mesmo código da Edge Function). Cálculo inalterado: subtotal − desconto + acréscimo.
const RESUMO_W = 236;
const TOTAL_H = 36;
const faixaTotal = (pagina) => pagina.retangulos.find((r) => r.height === TOTAL_H && Math.round(r.width) === RESUMO_W);

const cases = [
  { name: 'A: sem ajustes', discount: 0, surcharge: 0, labels: [], grand: 'R$ 100,00' },
  { name: 'B: só desconto', discount: 10, surcharge: 0, labels: ['Subtotal', 'Desconto'], grand: 'R$ 90,00' },
  { name: 'C: só acréscimo', discount: 0, surcharge: 5, labels: ['Subtotal', 'Acréscimo'], grand: 'R$ 105,00' },
  { name: 'D: desconto e acréscimo', discount: 10, surcharge: 5, labels: ['Subtotal', 'Desconto', 'Acréscimo'], grand: 'R$ 95,00' },
];

for (const fixture of cases) {
  test(`${fixture.name}: ajustes acima da faixa do TOTAL, sem encostar, valor correto`, async () => {
    const r = await gerar({ orcamento: orcamentoBase({ discount: fixture.discount, surcharge: fixture.surcharge }), itens: [item(1, { quantity: 1, unit_price: 100 })] });
    assert.equal(r.status, 200);
    assert.equal(r.paginas.length, 1);
    const pagina = r.paginas[0];
    const faixa = faixaTotal(pagina);
    assert.ok(faixa, 'faixa do TOTAL');
    assert.ok(Math.abs(faixa.x + faixa.width - DIREITA) < 0.01, 'resumo encostado na margem direita');
    const labels = pagina.textos.filter((t) => ['Subtotal', 'Desconto', 'Acréscimo'].includes(t.text));
    assert.deepEqual(labels.map((t) => t.text), fixture.labels);
    for (let i = 1; i < labels.length; i += 1) assert.equal(Number((labels[i - 1].y - labels[i].y).toFixed(4)), 17);
    const topoFaixa = faixa.y + faixa.height;
    if (labels.length) {
      const ultimo = labels.at(-1);
      assert.ok(ultimo.baixo - topoFaixa >= 6, 'descendentes do último ajuste longe da faixa');
      // Valor de cada ajuste na mesma linha do rótulo.
      for (const l of labels) assert.ok(pagina.textos.some((t) => t !== l && t.y === l.y && t.x2 <= DIREITA - 13.9 && /R\$/.test(t.text)));
    }
    const totalLabel = pagina.textos.find((t) => t.text === 'TOTAL' && t.size === 10);
    const valor = pagina.textos.find((t) => t.text === fixture.grand && t.size === 15);
    assert.ok(valor, `valor ${fixture.grand}`);
    for (const t of [totalLabel, valor]) assert.ok(t.baixo > faixa.y && t.alto < topoFaixa, `"${t.text}" dentro da faixa`);
    assert.deepEqual(semSobreposicao(r), []);
  });
}

// Propriedade (1–40 itens): o TOTAL vem logo após o último item quando cabe ali; garantia, condições,
// observações e aceite ficam juntos numa página só (a última); nada invade o rodapé; e nenhuma
// quebra acontece sem necessidade (sem meia página em branco).
test('Fechamento: TOTAL junto dos itens, demais blocos juntos, sem página desperdiçada (1–40 itens)', async () => {
  const garantia = 'a4444444-4444-4444-8444-444444444441';
  // Resumo com 3 ajustes: 16 + 3×17 + 6 + 36 (faixa) + 24 = 133 pt reservados.
  const RESUMO_H = 133;
  for (let n = 1; n <= 40; n += 1) {
    const itens = Array.from({ length: n }, (_, i) => item(i + 1, i === 0 ? { kind: 'product', product_id: garantia, name: 'Produto com garantia' } : { name: `Serviço ${i + 1}` }));
    const r = await gerar({
      orcamento: orcamentoBase({ discount: 10, surcharge: 5, payment_terms: 'Entrada na aprovação e saldo na conclusão.', notes: 'Observação preservada.' }),
      itens, produtos: { [garantia]: { id: garantia, image_path: null, warranty_months: 12 } },
    });
    assert.equal(r.status, 200, `n=${n}`);
    const ts = textos(r);
    const ultimaPagina = r.paginas.length - 1;
    const paginaDe = (t) => ts.find((x) => x.text === t)?.pagina;
    const paginaTotal = r.paginas.findIndex((p) => faixaTotal(p));
    const faixa = faixaTotal(r.paginas[paginaTotal]);
    assert.equal(paginaDe('Subtotal'), paginaTotal, `n=${n}: ajustes junto do TOTAL`);
    const paginaResto = paginaDe('GARANTIA');
    for (const t of ['CONDIÇÕES DE PAGAMENTO', 'OBSERVAÇÕES', 'Responsável / empresa', 'Cliente / aceite']) {
      assert.equal(paginaDe(t), paginaResto, `n=${n}: "${t}" junto da garantia`);
    }
    assert.equal(paginaResto, ultimaPagina, `n=${n}: aceite na última página`);
    assert.ok(paginaResto >= paginaTotal && paginaResto <= paginaTotal + 1, `n=${n}: resto na página do TOTAL ou na seguinte`);

    const ultimoItem = ts.filter((t) => t.size === 9.5 && /^(Serviço \d+|Produto com garantia)$/.test(t.text)).at(-1);
    const subtotal = ts.find((t) => t.text === 'Subtotal');
    assert.ok(paginaTotal > ultimoItem.pagina || subtotal.y < ultimoItem.y, `n=${n}: TOTAL depois do último item`);
    const linhaFinal = r.paginas[ultimoItem.pagina].linhas.filter((l) => l.x1 === MARGEM && Math.abs(l.x2 - DIREITA) < 0.01 && l.thickness === 0.5).at(-1);
    if (paginaTotal > ultimoItem.pagina) {
      assert.equal(paginaTotal, ultimoItem.pagina + 1, `n=${n}: TOTAL na página seguinte, não depois`);
      assert.ok(linhaFinal.y1 - RESUMO_H < SAFE_BOTTOM, `n=${n}: TOTAL mudou de página sem necessidade`);
    }
    if (paginaResto > paginaTotal) {
      const resto = r.paginas[paginaResto].textos.filter((t) => !(t.y === 32 && t.size === 7));
      const alturaResto = (A4[1] - 74) - Math.min(...resto.map((t) => t.baixo));
      const sobra = faixa.y - 24 - SAFE_BOTTOM;
      assert.ok(sobra < alturaResto + 30, `n=${n}: garantia/aceite mudaram de página sem necessidade (sobra ${sobra.toFixed(0)}, bloco ${alturaResto.toFixed(0)})`);
    }
    assert.deepEqual(semSobreposicao(r), [], `n=${n}`);
  }
});
