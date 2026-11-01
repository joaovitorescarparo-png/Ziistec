import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const dataApi = await readFile(new URL('../../src/lib/dataApi.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');

const selectBlock = (source, marker, label) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${label}: Select não encontrado`);
  const end = source.indexOf('</Select>', start);
  assert.notEqual(end, -1, `${label}: fechamento do Select não encontrado`);
  return source.slice(start, end);
};

test('F05: clientes arquivados continuam na carga histórica', () => {
  const start = dataApi.indexOf("supabase.from('clients')");
  assert.notEqual(start, -1, 'consulta de clients precisa existir');
  const end = dataApi.indexOf("supabase.from('services')", start);
  assert.notEqual(end, -1, 'não foi possível delimitar a consulta histórica de clients');
  const clientQuery = dataApi.slice(start, end);

  assert.doesNotMatch(
    clientQuery,
    /deleted_at/,
    'clientes arquivados não podem ser removidos da carga histórica global',
  );
});

test('F05: catálogo de IA e pickers de novos vínculos não oferecem clientes arquivados', () => {
  assert.match(
    app,
    /CATÁLOGO DE CLIENTES:[\s\S]{0,220}clientes\.filter\([\s\S]{0,100}excluidoEm/,
    'o catálogo de clientes enviado à IA ainda inclui arquivados',
  );

  const quote = selectBlock(app, '<Select value={d.clienteId}', 'novo orçamento');
  assert.match(quote, /clientes\.filter/, 'novo orçamento precisa filtrar clientes');
  assert.match(quote, /excluidoEm/, 'novo orçamento precisa excluir cliente arquivado');
  assert.match(quote, /d\.clienteId/, 'novo orçamento precisa preservar cliente histórico já selecionado');
  assert.doesNotMatch(quote, /\{clientes\.map/, 'novo orçamento ainda usa a lista histórica inteira');

  const workOrder = selectBlock(app, '<Select value={f.clienteId}', 'nova OS');
  assert.match(workOrder, /clientes\.filter/, 'nova OS precisa filtrar clientes');
  assert.match(workOrder, /excluidoEm/, 'nova OS precisa excluir cliente arquivado');
  assert.match(workOrder, /f\.clienteId/, 'nova OS precisa preservar cliente histórico já selecionado');
  assert.doesNotMatch(workOrder, /\{clientes\.map/, 'nova OS ainda usa a lista histórica inteira');

  const manualIncome = selectBlock(app, '<Select value={form.clienteId || ""}', 'lançamento manual');
  assert.match(manualIncome, /clientes\.filter/, 'lançamento manual precisa filtrar clientes');
  assert.match(manualIncome, /excluidoEm/, 'lançamento manual precisa excluir cliente arquivado');
  assert.match(manualIncome, /form\.clienteId/, 'lançamento manual precisa preservar cliente histórico já selecionado');
  assert.doesNotMatch(manualIncome, /\{clientes\.map/, 'lançamento manual ainda usa a lista histórica inteira');
});
