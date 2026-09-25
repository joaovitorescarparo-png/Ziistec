export function quoteTotalsLayout({ discount = 0, surcharge = 0 } = {}) {
  const rowHeight = 14;
  const adjustmentDescent = 3;
  const adjustmentGap = 8;
  const bandHeight = 38;
  const afterBandGap = 27;
  const keys = [];
  if (discount > 0 || surcharge > 0) keys.push('subtotal');
  if (discount > 0) keys.push('discount');
  if (surcharge > 0) keys.push('surcharge');
  const rows = keys.map((key, index) => ({ key, baselineOffset: index * rowHeight }));
  // Offsets grow down from the existing totals cursor. Preserve the compact
  // no-adjustment band; otherwise clear the last baseline and its descenders.
  const bandTopOffset = rows.length
    ? rows.at(-1).baselineOffset + adjustmentDescent + adjustmentGap
    : -21;
  const bandBottomOffset = bandTopOffset + bandHeight;
  return {
    rows, adjustmentDescent, adjustmentGap, bandHeight,
    bandTopOffset, bandBottomOffset,
    labelBaselineOffset: bandTopOffset + 23,
    amountBaselineOffset: bandTopOffset + 25,
    height: bandBottomOffset + afterBandGap,
  };
}

export function shouldBreakPdfBlock(y, height, safeBottom = 72, reserve = 0) {
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
    H: simulateQuotePages({ rowHeights:[58], closingHeight:206 }),
    I: simulateQuotePages({ rowHeights:[40], closingHeight:206 }),
    J: simulateQuotePages({ rowHeights:Array(8).fill(58), closingHeight:206 }),
    K: simulateQuotePages({ rowHeights:[40], closingHeight:206 }),
  };
}
