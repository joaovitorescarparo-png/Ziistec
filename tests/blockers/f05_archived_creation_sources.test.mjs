import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const quoteV2 = await readFile(new URL('../../src/lib/quoteV2Api.js', import.meta.url), 'utf8');
const v2Api = await readFile(new URL('../../src/lib/v2Api.js', import.meta.url), 'utf8');
const purchaseV2 = await readFile(new URL('../../src/lib/purchaseV2Api.js', import.meta.url), 'utf8');

const expectDeletedFilter = (source, fragment, label) => {
  const index = source.indexOf(fragment);
  assert.notEqual(index, -1, `${label}: consulta não encontrada`);
  const slice = source.slice(index, index + 280);
  assert.match(slice, /\.is\(\s*['"]deleted_at['"]\s*,\s*null\s*\)/, `${label}: faltou filtro deleted_at`);
};

test('F05: Quote AI V2 usa somente cadastros não arquivados', () => {
  expectDeletedFilter(quoteV2, "supabase.from('clients')", 'Quote AI clientes');
  expectDeletedFilter(quoteV2, "supabase.from('services')", 'Quote AI serviços');
  expectDeletedFilter(quoteV2, "supabase.from('products')", 'Quote AI produtos');
});

test('F05: Garantia Manual/novo contrato usa somente opções não arquivadas', () => {
  const start = v2Api.indexOf('export async function carregarOpcoesGarantiaManualDB');
  assert.notEqual(start, -1, 'carregarOpcoesGarantiaManualDB precisa existir');
  const source = v2Api.slice(start, start + 1600);
  expectDeletedFilter(source, "supabase.from('clients')", 'Garantia Manual clientes');
  expectDeletedFilter(source, "supabase.from('services')", 'Garantia Manual serviços');
  expectDeletedFilter(source, "supabase.from('products')", 'Garantia Manual produtos');
});

test('F05: Compras V2 não oferece produto arquivado em nova compra', () => {
  const start = purchaseV2.indexOf('export async function carregarComprasV2DB');
  assert.notEqual(start, -1, 'carregarComprasV2DB precisa existir');
  const source = purchaseV2.slice(start, start + 1400);
  expectDeletedFilter(source, ".from('products')", 'Compras V2 produtos');
});
