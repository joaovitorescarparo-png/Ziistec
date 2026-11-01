import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

test('código morto removido não volta: wrappers sem nenhuma chamada em src, api, tests ou scripts', () => {
  const removidos = [
    ['src/lib/v2Api.js', ['venderProdutoNaOSDB', 'excluirContratoDB', 'v2Seguro']],
    ['src/lib/checklistReturnV2Api.js', ['marcarChecklistItemV2DB', 'carregarRetornosOSV2DB']],
    ['src/lib/settingsV2Api.js', ['cancelarAssinaturaSettingsV2DB', 'reativarAssinaturaSettingsV2DB']],
    ['src/lib/dataApiExtras.js', ['atualizarFuncaoColaboradorDB']],
  ];
  for (const [arquivo, nomes] of removidos) {
    const text = read(arquivo);
    for (const nome of nomes) assert.ok(!new RegExp(`\\b${nome}\\b`).test(text), `${arquivo} ainda define ${nome}`);
  }
  // A venda em campo tem um único cliente do RPC (fieldSalesApi); o wrapper antigo de v2Api duplicava a chamada.
  assert.equal(read('src/lib/v2Api.js').includes("rpc('zt_sell_product_on_work_order'"), false);
  assert.equal(read('src/lib/fieldSalesApi.js').includes("rpc('zt_sell_product_on_work_order'"), true);
});

test('Venda na OS recebe o papel do App principal e só consulta o banco quando aberta sem ele', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<WorkOrderSaleV2 \{\.\.\.workspaceProps\} owner=\{owner\}\/>/);
  const tela = read('src/screens/v2/WorkOrderSaleV2.jsx');
  assert.match(tela, /typeof props\.owner==='boolean'/);
  assert.match(tela, /if\(donoInformado\)\{setOwner\(props\.owner\);return undefined;\}/);
  // sem o papel informado o comportamento antigo continua (consulta a própria membresia ativa)
  assert.match(tela, /from\('company_members'\)\.select\('role,status'\)/);
});

// Contrato frontend ↔ banco: toda RPC chamada pelo app existe em alguma migration versionada.
test('toda RPC chamada em src/ e api/ está definida nas migrations', () => {
  const sqlFiles = fs.readdirSync(path.join(ROOT, 'supabase')).filter((f) => /\.sql$/.test(f));
  const defined = new Set();
  for (const f of sqlFiles) {
    for (const m of read(`supabase/${f}`).matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(/gi)) defined.add(m[1]);
  }
  assert.ok(defined.size > 80, 'migrations lidas');
  const faltando = [];
  const alvos = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'api'))];
  for (const file of alvos) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\.rpc\(\s*[`'"]([a-z_0-9]+)[`'"]/g)) if (!defined.has(m[1])) faltando.push(`${rel(file)}: ${m[1]}`);
    for (const m of text.matchAll(/\brpc\(\s*[A-Za-z_.]+,\s*[`'"]([a-z_0-9]+)[`'"]/g)) if (!defined.has(m[1])) faltando.push(`${rel(file)}: ${m[1]}`);
  }
  assert.deepEqual(faltando, []);
});

test('um único cliente de IA no servidor: nenhum endpoint chama o provedor fora do gateway', () => {
  const dentro = new Set(['api/_aiGateway.js']);
  for (const file of walk(path.join(ROOT, 'api'))) {
    const nome = rel(file);
    if (dentro.has(nome)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.openai\.com/.test(text), `${nome} fala direto com um provedor de IA`);
  }
});

test('uma única implementação de reconhecimento de voz no app (o hook), além do patch estático documentado', () => {
  const usam = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    if (/SpeechRecognition/.test(fs.readFileSync(file, 'utf8'))) usam.push(rel(file));
  }
  assert.deepEqual(usam, ['src/hooks/useSpeechInput.js']);
});

test('uma única chamada de conclusão de OS no frontend', () => {
  const chamadas = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/zt_finalize_[a-z_]+/g)) chamadas.push(`${rel(file)}:${m[0]}`);
  }
  assert.deepEqual(chamadas, ['src/lib/dataApi.js:zt_finalize_work_order_with_warranty_overrides']);
});
