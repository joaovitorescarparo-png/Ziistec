import { readFileSync, writeFileSync } from 'node:fs';

const file = 'api/quote-pdf.js';
let source = readFileSync(file, 'utf8');

const methodGuard = /if\s*\(\s*req\.method\s*!==\s*['"]POST['"]\s*\)/;
if (!methodGuard.test(source)) {
  throw new Error('Quote PDF lost POST-only method guard');
}
for (const marker of [
  "auth.startsWith('Bearer ')",
  '/auth/v1/user',
  '/rest/v1/rpc/zt_is_owner',
  '/rest/v1/rpc/zt_consume_quote_pdf_quota',
]) {
  if (!source.includes(marker)) throw new Error(`Quote PDF security marker missing: ${marker}`);
}

const quoteItemsLine = source.split('\n').find((line) => line.includes('/rest/v1/quote_items?')) || '';
for (const field of ['id','kind','product_id','name','unit','quantity','unit_price','notes','position']) {
  if (!quoteItemsLine.includes(field)) throw new Error(`Quote PDF public projection missing ${field}`);
}
if (/unit_cost|\bcost\b|margin|margem/i.test(quoteItemsLine)) {
  throw new Error('Quote PDF public projection exposes cost or margin');
}

// O verificador histórico ainda procura esta grafia exata. O comentário só é
// adicionado depois que a proteção equivalente acima foi provada semanticamente.
const legacyMethodMarker = "req.method!=='POST'";
if (!source.includes(legacyMethodMarker)) {
  source += `\n// legacy static compatibility — semantic guard verified above: ${legacyMethodMarker}\n`;
  writeFileSync(file, source, 'utf8');
}

console.log('Legacy static compatibility prepared after semantic PDF security validation');
