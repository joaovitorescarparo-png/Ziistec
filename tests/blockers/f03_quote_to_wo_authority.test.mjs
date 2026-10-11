import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/lib/dataApiExtras.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function criarOSDeOrcamentoDB');
const end = source.indexOf('export async function abrirAtendimentoGarantiaDB', start);

assert.notEqual(start, -1, 'criarOSDeOrcamentoDB precisa existir');
assert.notEqual(end, -1, 'não foi possível delimitar criarOSDeOrcamentoDB');

const functionSource = source.slice(start, end);

test('F03: Orçamento → OS usa zt_create_work_order_from_quote como autoridade', () => {
  assert.match(
    functionSource,
    /supabase\.rpc\(\s*['"]zt_create_work_order_from_quote['"]/,
    'criarOSDeOrcamentoDB ainda não chama a RPC canônica zt_create_work_order_from_quote',
  );
  assert.doesNotMatch(
    functionSource,
    /\bsalvarOSDB\s*\(/,
    'criarOSDeOrcamentoDB ainda monta/salva a OS manualmente via salvarOSDB',
  );
});
