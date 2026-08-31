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

test('F05: novos vínculos de cliente filtram registros arquivados', () => {
  assert.match(
    app,
    /clientes\.filter\(\s*\(c\)\s*=>\s*!c\.excluidoEm\s*\)\.map\(\(c\)\s*=>\s*\(\{\s*id:\s*c\.id,\s*nome:/,
    'o catálogo de clientes enviado à IA ainda inclui arquivados',
  );

  const archivedSafePickerCount = (
    app.match(/clientes\.filter\(\s*\(c\)\s*=>\s*!c\.excluidoEm\s*\)\.map\(\(c\)\s*=>\s*<option/g) || []
  ).length + (
    app.match(/clientes\.filter\(\s*\(x\)\s*=>\s*!x\.excluidoEm\s*\)\.map\(\(x\)\s*=>\s*<option/g) || []
  ).length;

  assert.ok(
    archivedSafePickerCount >= 3,
    `esperava pelo menos 3 pickers de novo documento filtrando arquivados; encontrei ${archivedSafePickerCount}`,
  );
});
