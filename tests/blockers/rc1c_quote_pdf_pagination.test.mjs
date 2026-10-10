import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quoteScenarioPageCounts, shouldBreakPdfBlock } from '../../api/quotePdfLayout.js';

const pdf = fs.readFileSync(new URL('../../api/quote-pdf.js', import.meta.url), 'utf8');

test('A-G one-page-first scenarios have deterministic page counts', () => {
  const pages = quoteScenarioPageCounts();
  assert.deepEqual(pages, { A:1, B:1, C:2, D:2, E:1, F:2, G:2, H:1, I:1, J:2, K:1 });
  console.log(`RC1C_PDF_PAGES A=${pages.A} B=${pages.B} C=${pages.C} D=${pages.D} E=${pages.E} F=${pages.F} G=${pages.G} H=${pages.H} I=${pages.I} J=${pages.J} K=${pages.K}`);
});

test('E without photos retains compact item rows', () => {
  assert.equal(shouldBreakPdfBlock(300, 40, 72, 12), false);
});

test('F long commercial message is not silently truncated', () => {
  assert.doesNotMatch(pdf, /customer_message[^\n]*slice\(0,18\)/);
  assert.match(pdf, /while\(remaining\.length\)/);
  assert.match(pdf, /SOBRE ESTA PROPOSTA · CONTINUAÇÃO/);
});

test('G warranties are not capped and are paginated with ensure guards', () => {
  assert.doesNotMatch(pdf, /warrantyLines[\s\S]{0,200}slice\(0,8\)/);
  assert.match(pdf, /for\(const lineText of warrantyLines\)/);
  assert.match(pdf, /ensure\(15\)/);
});

test('item rows use measured break logic without fixed 205px reserve or filler rows', () => {
  assert.doesNotMatch(pdf, /SAFE_BOTTOM \+ 205/);
  assert.doesNotMatch(pdf, /minVisibleRows/);
  assert.match(pdf, /shouldBreakPdfBlock\(y,rowH,SAFE_BOTTOM,12\)/);
});


test('H-K product-image PDF flow is explicit for ON, OFF, JPG/PNG and WEBP', () => {
  assert.match(pdf, /quote\.show_product_images&&productMeta\?\.image_path/);
  assert.match(pdf, /pdf\.embedPng\(bytes\)/);
  assert.match(pdf, /pdf\.embedJpg\(bytes\)/);
  assert.match(pdf, /WEBP não pode ser incorporada diretamente/);
  assert.match(pdf, /productImageResult\.note/);
});
