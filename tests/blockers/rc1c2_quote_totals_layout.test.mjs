import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  quoteTotalsLayout, shouldBreakPdfBlock, canKeepClosingTogether,
} from '../../api/quotePdfLayout.js';

const pdfSource = fs.readFileSync(new URL('../../api/quote-pdf.js', import.meta.url), 'utf8');
const closingStart = pdfSource.indexOf('    // Calcula o bloco inferior antes de desenhar:');
const closingEnd = pdfSource.indexOf('    if(warrantyLines.length){', closingStart);
assert.ok(closingStart >= 0 && closingEnd > closingStart, 'Locate the real totals renderer');

// Execute the production closing-block calculation and drawing, with no HTTP,
// Supabase or file writes. Record actual text baselines and rectangle bounds.
const renderTotals = new Function('quoteTotalsLayout', 'shouldBreakPdfBlock', 'canKeepClosingTogether', 'quote', 'initialY', 'warrantyLines', `
  const A4 = [595.28, 841.89], margin = 38, contentW = A4[0] - 2 * margin, SAFE_BOTTOM = 72;
  const normal = 'normal', bold = 'bold', muted = 'muted', ink = 'ink', navy = 'navy', white = 'white';
  const subtotal = 100, texts = [], rectangles = [];
  let y = initialY, pages = 1;
  const wrapText = text => String(text).split('\\n');
  const money = value => Number(value).toFixed(2);
  const txt = (text, x, baseline, size) => texts.push({ text, x, baseline, size });
  const txtRight = txt;
  const page = { drawRectangle: rectangle => rectangles.push(rectangle) };
  const newPage = () => { pages += 1; y = A4[1] - 88; };
  ${pdfSource.slice(closingStart, closingEnd)}
  return { y, pages, texts, rectangles, totalBlockH, lowerBlockH, warrantyH, infoCardH, closingGapH, signatureH };
`);
const render = (quote, initialY = 500, warrantyLines = []) => renderTotals(
  quoteTotalsLayout, shouldBreakPdfBlock, canKeepClosingTogether, quote, initialY, warrantyLines,
);

const cases = [
  { name: 'A: no adjustments', discount: 0, surcharge: 0, labels: [], height: 44, grand: '100.00' },
  { name: 'B: discount only', discount: 10, surcharge: 0, labels: ['Subtotal', 'Desconto'], height: 90, grand: '90.00' },
  { name: 'C: surcharge only', discount: 0, surcharge: 5, labels: ['Subtotal', 'Acréscimo'], height: 90, grand: '105.00' },
  { name: 'D: discount and surcharge', discount: 10, surcharge: 5, labels: ['Subtotal', 'Desconto', 'Acréscimo'], height: 104, grand: '95.00' },
];

for (const fixture of cases) {
  test(`${fixture.name}: real renderer clears adjustment text and reserves its complete height`, () => {
    const geometry = quoteTotalsLayout(fixture);
    const result = render(fixture);
    assert.equal(geometry.height, fixture.height);
    assert.equal(result.totalBlockH, fixture.height);
    assert.equal(result.pages, 1);
    const band = result.rectangles[0];
    assert.equal(band.height, 38);
    const labels = result.texts.filter(text => ['Subtotal', 'Desconto', 'Acréscimo'].includes(text.text));
    assert.deepEqual(labels.map(text => text.text), fixture.labels);
    for (let index = 1; index < labels.length; index += 1) {
      assert.equal(labels[index - 1].baseline - labels[index].baseline, 14);
    }
    if (labels.length) {
      const last = labels.at(-1);
      const bandTop = band.y + band.height;
      // PDF coordinates grow upward: the glyph bottom must stay above the band.
      assert.equal(last.baseline - geometry.adjustmentDescent - bandTop, geometry.adjustmentGap);
      assert.ok(last.baseline - bandTop >= 11, 'Descender clearance plus visual gap');
    } else {
      assert.equal(band.y, 500 - 4 - 17, 'Keep original compact band position');
    }
    const totalLabel = result.texts.find(text => text.text === 'TOTAL');
    const amount = result.texts.at(-1);
    assert.equal(amount.text, fixture.grand);
    for (const text of [totalLabel, amount]) {
      assert.ok(text.baseline > band.y && text.baseline + text.size < band.y + band.height);
    }
    assert.equal(band.y - result.y, 27, 'Keep original spacing below the band');
    assert.equal(500 - 4 - result.y, fixture.height, 'Renderer consumes exactly its reservation');
    assert.equal(result.lowerBlockH, result.totalBlockH + result.warrantyH + result.infoCardH + result.closingGapH + result.signatureH);
  });

  test(`${fixture.name}: lower block keeps one page at the boundary and moves when it cannot fit`, () => {
    const quote = { ...fixture, payment_terms: 'Entrada\nSaldo', notes: 'Observação preservada' };
    const warranties = ['Produto: 12 meses de garantia'];
    const measure = render(quote, 700, warranties);
    const exactY = 72 + measure.lowerBlockH + 4;
    assert.equal(render(quote, exactY, warranties).pages, 1);
    assert.equal(render(quote, exactY - 1, warranties).pages, 2);
    const base = render({ ...quote, discount: 0, surcharge: 0 }, 700, warranties);
    assert.equal(measure.lowerBlockH - base.lowerBlockH, fixture.height - 44);
  });
}
