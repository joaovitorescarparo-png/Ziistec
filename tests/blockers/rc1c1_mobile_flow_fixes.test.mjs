import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacy=fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../../src/lib/dataApi.js',import.meta.url),'utf8');
const extras=fs.readFileSync(new URL('../../src/lib/dataApiExtras.js',import.meta.url),'utf8');
const session=fs.readFileSync(new URL('../../src/lib/useSessao.js',import.meta.url),'utf8');

test('manual NovaOS keeps modal/data on failed save and reuses one request id across retry',()=>{
  const start=legacy.indexOf('function NovaOS(');
  const end=legacy.indexOf('\nfunction ',start+20);
  const block=legacy.slice(start,end);
  assert.match(block,/const requestIdRef = useRef\(null\)/);
  assert.match(block,/requestId: requestIdRef\.current/);
  assert.match(block,/const salvoId = await salvarOS/);
  assert.match(block,/if \(!salvoId\)[\s\S]*setErroCriacao/);
  assert.match(block,/if \(!salvoId\)[\s\S]*return;[\s\S]*onClose\(\)/);
  assert.match(block,/role="alert"/);
});

test('manual NovaOS can link client quotes and opens an existing linked OS instead of duplicating',()=>{
  assert.match(legacy,/Orçamento vinculado \(opcional\)/);
  assert.match(legacy,/orcamentos\.filter\(\(o\) => o\.clienteId === f\.clienteId\)/);
  assert.match(legacy,/carregarOSPorOrcamentoDB\(orcamentoId, empresaId\)/);
  assert.match(legacy,/return abrirOSVinculada\(existente, orcamentoId\)/);
  assert.match(data,/quote_id:x\.orcamentoId\|\|null/);
  assert.match(data,/export async function carregarOSPorOrcamentoDB/);
  assert.match(data,/const \{ itemCosts, materialCosts, workOrderCosts \} = await carregarCustosPrivados\(companyId,response\.data\.id\)/);
  assert.match(legacy,/const pronto = f\.clienteId && \(orcamentoSelecionado\?\.osId \|\| f\.descricaoLivre\.trim\(\) \|\| f\.itens\.length > 0\)/);
});

test('quote to OS reloads only the newly created work order',()=>{
  assert.doesNotMatch(extras,/carregarDadosEmpresa/);
  assert.match(extras,/const nova=await carregarOSPorIdDB\(id\)/);
  assert.match(data,/export async function carregarOSPorIdDB/);
});

test('local OS save does not invoke tenant-wide reload and access revalidation remains enabled',()=>{
  const start=legacy.indexOf('const salvarOS = async (os) =>');
  const end=legacy.indexOf('const agendarOS = async',start);
  const block=legacy.slice(start,end);
  assert.doesNotMatch(block,/recarregarDados|recarregarSeguro/);
  assert.match(session,/window\.addEventListener\("focus", aoFocar\)/);
  assert.match(session,/document\.addEventListener\("visibilitychange", aoVisibilizar\)/);
});
