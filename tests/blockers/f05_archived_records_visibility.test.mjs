import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dataApi = await readFile(new URL('../../src/lib/dataApi.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');

test('F05: clientes arquivados continuam na carga histórica', () => {
  const start = dataApi.indexOf("supabase.from('clients')");
  assert.notEqual(start, -1, 'consulta de clients precisa existir');
  const slice = dataApi.slice(start, start + 220);
  assert.doesNotMatch(
    slice,
    /\.is\(\s*['"]deleted_at['"]\s*,\s*null\s*\)/,
    'clientes arquivados não podem ser removidos da carga histórica global',
  );
});

test('F05: catálogo de IA e pickers de novos vínculos não oferecem clientes arquivados', () => {
  assert.match(
    app,
    /clientes\.filter\(\s*\(c\)\s*=>\s*!c\.excluidoEm\s*\)\.map\(\(c\)\s*=>\s*\(\{\s*id:\s*c\.id,\s*nome:/,
    'o catálogo de clientes enviado à IA ainda inclui arquivados',
  );

  const quotePicker = /clientes\.filter\(\s*\(x\)\s*=>\s*!x\.excluidoEm\s*\|\|\s*x\.id\s*===\s*d\.clienteId\s*\)\.map/;
  const workOrderPicker = /clientes\.filter\(\s*\(c\)\s*=>\s*!c\.excluidoEm\s*\|\|\s*c\.id\s*===\s*f\.clienteId\s*\)\.map/;
  const manualIncomePicker = /clientes\.filter\(\s*\(c\)\s*=>\s*!c\.excluidoEm\s*\|\|\s*c\.id\s*===\s*form\.clienteId\s*\)\.map/;

  assert.match(app, quotePicker, 'novo orçamento ainda oferece cliente arquivado');
  assert.match(app, workOrderPicker, 'nova OS ainda oferece cliente arquivado');
  assert.match(app, manualIncomePicker, 'novo lançamento manual ainda oferece cliente arquivado');

  assert.match(
    app,
    /filtro\.clienteId[\s\S]{0,260}\{clientes\.map\(\(c\)\s*=>\s*<option/,
    'o filtro histórico do financeiro deve continuar conhecendo clientes arquivados',
  );
});
