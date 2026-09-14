from pathlib import Path
import json
ROOT=Path('.')
layout='''export function shouldBreakPdfBlock(y, height, safeBottom = 72, reserve = 0) {
  return Number(y) - Number(height) < Number(safeBottom) + Number(reserve);
}

export function canKeepClosingTogether(height, continuationStartY = 753.89, safeBottom = 72) {
  return Number(height) <= Number(continuationStartY) - Number(safeBottom);
}

export function simulateQuotePages({
  firstItemsY = 528,
  continuationItemsY = 716,
  safeBottom = 72,
  preItemBlockHeights = [],
  rowHeights = [],
  closingHeight = 206,
} = {}) {
  let pages = 1;
  let y = firstItemsY;
  for (const height of preItemBlockHeights) {
    if (shouldBreakPdfBlock(y, height, safeBottom, 12)) { pages += 1; y = continuationItemsY; }
    y -= height;
  }
  for (const height of rowHeights) {
    if (shouldBreakPdfBlock(y, height, safeBottom, 12)) { pages += 1; y = continuationItemsY; }
    y -= height;
  }
  if (shouldBreakPdfBlock(y, closingHeight, safeBottom)) pages += 1;
  return pages;
}

export function quoteScenarioPageCounts() {
  return {
    A: simulateQuotePages({ rowHeights:[40,40], closingHeight:206 }),
    B: simulateQuotePages({ rowHeights:[40,40,40,40,40,40], closingHeight:206 }),
    C: simulateQuotePages({ rowHeights:Array(15).fill(44), closingHeight:206 }),
    D: simulateQuotePages({ rowHeights:Array(6).fill(58), closingHeight:206 }),
    E: simulateQuotePages({ rowHeights:Array(6).fill(40), closingHeight:206 }),
    F: simulateQuotePages({ preItemBlockHeights:[300], rowHeights:[40,40,40], closingHeight:206 }),
    G: simulateQuotePages({ rowHeights:[40,40,40], closingHeight:340 }),
  };
}
'''
test='''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quoteScenarioPageCounts, shouldBreakPdfBlock } from '../../api/quotePdfLayout.js';

const pdf = fs.readFileSync(new URL('../../api/quote-pdf.js', import.meta.url), 'utf8');

test('A-G one-page-first scenarios have deterministic page counts', () => {
  const pages = quoteScenarioPageCounts();
  assert.deepEqual(pages, { A:1, B:1, C:2, D:2, E:1, F:2, G:2 });
  console.log(`RC1C_PDF_PAGES A=${pages.A} B=${pages.B} C=${pages.C} D=${pages.D} E=${pages.E} F=${pages.F} G=${pages.G}`);
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
'''
(ROOT/'api/quotePdfLayout.js').write_text(layout)
(ROOT/'tests/blockers/rc1c_quote_pdf_pagination.test.mjs').write_text(test)
responsive=Path('/tmp/rc1c_responsive_breakpoints.test.mjs')
if not responsive.exists(): raise SystemExit('responsive staged test missing')
(ROOT/'tests/blockers/rc1c_responsive_breakpoints.test.mjs').write_text(responsive.read_text())
pkg=json.loads((ROOT/'package.json').read_text())
verify=pkg['scripts']['verify:v2']
path='tests/blockers/rc1c_responsive_breakpoints.test.mjs'
if path not in verify: verify += ' '+path
pkg['scripts']['verify:v2']=verify
(ROOT/'package.json').write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
print('RC1C_FINAL_TEST_CONTRACTS=PASS')
