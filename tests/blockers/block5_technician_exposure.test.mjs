import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createServer } from 'vite';

// Bloco 5 (0105): o técnico executa a OS sem receber valores comerciais. O frontend lista as colunas de
// work_orders (approved_* sem SELECT), carrega os itens do técnico pela projeção sem preço e o Relatório
// de Atendimento pela RPC que aplica o papel no banco.

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/0105_technician_financial_projection.sql');
const compact = (s) => s.replace(/\s+/g, ' ');
const code = (s) => s.replace(/--[^\n]*/g, '');

// ------------------------------------------------------------------ Supabase falso (somente APIs)
function createFakeSupabase() {
  const calls = [];
  const rpcResults = new Map();
  const tableResults = new Map();
  const query = (table) => {
    const ops = [];
    const settle = () => {
      const configured = tableResults.get(table);
      const value = typeof configured === 'function' ? configured(ops) : configured;
      return value ?? { data: [], error: null };
    };
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve(settle()).then(resolve, reject);
        return (...args) => { ops.push([prop, ...args]); calls.push({ kind: 'from', table, op: prop, args }); return proxy; };
      },
    });
    return proxy;
  };
  const client = {
    from: (table) => query(table),
    rpc: async (name, args) => {
      calls.push({ kind: 'rpc', name, args });
      const configured = rpcResults.get(name);
      return (typeof configured === 'function' ? configured(args) : configured) ?? { data: null, error: null };
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'sem storage no teste' } }) }) },
  };
  const reset = () => { calls.length = 0; rpcResults.clear(); tableResults.clear(); };
  return { client, calls, rpcResults, tableResults, reset };
}

const fake = createFakeSupabase();
globalThis.__ztFakeSupabase = fake.client;

const fakeSupabasePlugin = {
  name: 'zt-fake-supabase',
  enforce: 'pre',
  resolveId(source, importer) {
    if (importer && /[\\/]src[\\/]lib[\\/]/.test(importer) && /^\.\/supabase(\.js)?$/.test(source)) return '\0zt-fake-supabase';
    return null;
  },
  load(id) {
    if (id !== '\0zt-fake-supabase') return null;
    return 'export const supabase = globalThis.__ztFakeSupabase; export const configurado = true; export const ambienteSupabase = "test"; export function mensagemErro(e){ return e?.message || String(e || ""); } export function sessaoExpirou(){ return false; }';
  },
};

let vite;
let apis;
before(async () => {
  vite = await createServer({ plugins: [fakeSupabasePlugin], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  apis = {
    data: await vite.ssrLoadModule('/src/lib/dataApi.js'),
    memory: await vite.ssrLoadModule('/src/lib/workOrderMemoryV2Api.js'),
    reportPdf: await vite.ssrLoadModule('/src/lib/serviceReportPdf.js'),
  };
});
after(async () => { await vite?.close(); });

// Texto real desenhado no PDF (mesmo extrator do teste do Bloco 3).
function pdfTexts(bytes) {
  const buf = Buffer.from(bytes);
  const raw = buf.toString('latin1');
  const texts = [];
  const marker = /(?<!end)stream\r?\n/g;
  let match;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let chunk = buf.subarray(start, end);
    if (chunk.length && chunk[chunk.length - 1] === 0x0a) chunk = chunk.subarray(0, chunk.length - 1);
    if (chunk.length && chunk[chunk.length - 1] === 0x0d) chunk = chunk.subarray(0, chunk.length - 1);
    try {
      const content = zlib.inflateSync(chunk).toString('latin1');
      for (const hit of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) texts.push(Buffer.from(hit[1], 'hex').toString('latin1'));
    } catch { /* stream não comprimido ou de imagem */ }
    marker.lastIndex = end;
  }
  return texts;
}

const woRow = (items = []) => ({ id: 'wo1', company_id: 'c1', number: 'OS-0001', client_id: 'cl1', status: 'scheduled', work_order_items: items, work_order_materials: [] });
const fieldItems = [
  { id: 'i1', work_order_id: 'wo1', company_id: 'c1', kind: 'free', name: 'Instalação split', unit: 'unidade', quantity: 1, is_extra: false, price_pending: false },
  { id: 'i2', work_order_id: 'wo1', company_id: 'c1', kind: 'free', name: 'Adicional de campo', unit: 'unidade', quantity: 1, is_extra: true, price_pending: true },
];

// ------------------------------------------------------------------ carregamento da OS
test('técnico: OS carrega itens pela projeção sem preço; select de work_orders lista colunas sem approved_*', async () => {
  fake.reset();
  fake.tableResults.set('work_orders', { data: woRow([]), error: null });
  fake.rpcResults.set('zt_field_work_order_items', { data: fieldItems, error: null });
  const os = await apis.data.carregarOSPorIdDB('wo1');
  assert.deepEqual(os.itens.map((i) => [i.nome, i.preco, i.aguardandoValor, i.adicional]),
    [['Instalação split', 0, false, false], ['Adicional de campo', 0, true, true]]);
  assert.deepEqual(fake.calls.find((c) => c.kind === 'rpc' && c.name === 'zt_field_work_order_items').args, { p_company: 'c1', p_wo: 'wo1' });
  const select = fake.calls.find((c) => c.kind === 'from' && c.table === 'work_orders' && c.op === 'select').args[0];
  assert.doesNotMatch(select, /^\s*\*/, 'sem select * em work_orders');
  assert.doesNotMatch(select, /approved_/);
  assert.match(select, /^id,company_id,number,/);
  assert.match(select, /work_order_items:work_order_items!wo_items_work_order_company_fkey\(\*\)/);
});

test('proprietário: itens do embed (com preço) prevalecem; banco sem 0105 mantém o embed; erro real não é engolido', async () => {
  fake.reset();
  fake.tableResults.set('work_orders', { data: woRow([{ id: 'i1', work_order_id: 'wo1', kind: 'free', name: 'Instalação split', quantity: 1, unit_price: 900 }]), error: null });
  fake.rpcResults.set('zt_field_work_order_items', { data: [], error: null });
  const owner = await apis.data.carregarOSPorIdDB('wo1');
  assert.deepEqual(owner.itens.map((i) => [i.nome, i.preco]), [['Instalação split', 900]]);

  fake.rpcResults.set('zt_field_work_order_items', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_field_work_order_items in the schema cache' } });
  assert.equal((await apis.data.carregarOSPorIdDB('wo1')).itens[0].preco, 900);

  fake.rpcResults.set('zt_field_work_order_items', { data: null, error: { code: '42501', message: 'Sem acesso ativo à empresa' } });
  await assert.rejects(() => apis.data.carregarOSPorIdDB('wo1'), (e) => /Sem acesso ativo/.test(e.message));
});

test('carga completa da empresa distribui os itens da projeção por OS do técnico', async () => {
  fake.reset();
  fake.tableResults.set('work_orders', { data: [woRow([]), { ...woRow([]), id: 'wo2', number: 'OS-0002' }], error: null });
  fake.rpcResults.set('zt_field_work_order_items', { data: [...fieldItems, { ...fieldItems[0], id: 'i3', work_order_id: 'wo2', name: 'Revisão' }], error: null });
  const dados = await apis.data.carregarDadosEmpresa('c1');
  assert.deepEqual(dados.ordens.map((o) => [o.id, o.itens.map((i) => i.nome)]),
    [['wo1', ['Instalação split', 'Adicional de campo']], ['wo2', ['Revisão']]]);
  assert.deepEqual(fake.calls.find((c) => c.kind === 'rpc' && c.name === 'zt_field_work_order_items').args, { p_company: 'c1', p_wo: null });
});

// ------------------------------------------------------------------ memória da OS
test('memória da OS: relatório e itens vêm das RPCs por papel; sem migration volta às leituras anteriores', async () => {
  fake.reset();
  fake.tableResults.set('work_orders', { data: { id: 'wo1', company_id: 'c1', number: 'OS-0001', client_id: 'cl1', status: 'done' }, error: null });
  fake.tableResults.set('work_order_items', { data: [], error: null });
  fake.tableResults.set('work_order_reports', { data: [{ id: 'rep1', entry_type: 'report', body: 'Relato' }], error: null });
  fake.rpcResults.set('zt_get_service_report', { data: { id: 'sr1', entry_type: 'service_report', is_active: true, viewer_role: 'technician', snapshot: { financial_redacted: true, items: [{ name: 'Instalação split' }] } }, error: null });
  fake.rpcResults.set('zt_field_work_order_items', { data: [fieldItems[0]], error: null });
  const tech = await apis.memory.carregarDetalheMemoriaOSV2DB('c1', 'wo1');
  assert.equal(tech.serviceReport.id, 'sr1');
  assert.equal(tech.serviceReport.snapshot.financial_redacted, true);
  assert.deepEqual(tech.items.map((i) => i.name), ['Instalação split']);
  assert.ok(!('unit_price' in tech.items[0]));
  assert.deepEqual(fake.calls.find((c) => c.kind === 'rpc' && c.name === 'zt_get_service_report').args, { p_wo: 'wo1' });

  fake.reset();
  fake.tableResults.set('work_orders', { data: { id: 'wo1', company_id: 'c1', number: 'OS-0001', client_id: 'cl1', status: 'done' }, error: null });
  fake.tableResults.set('work_order_items', { data: [{ id: 'i9', name: 'Fechadura', quantity: 1, unit_price: 250 }], error: null });
  fake.tableResults.set('work_order_reports', { data: [{ id: 'raw', entry_type: 'service_report', is_active: true, snapshot: {} }], error: null });
  fake.rpcResults.set('zt_get_service_report', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_get_service_report' } });
  fake.rpcResults.set('zt_field_work_order_items', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_field_work_order_items' } });
  const legacy = await apis.memory.carregarDetalheMemoriaOSV2DB('c1', 'wo1');
  assert.equal(legacy.serviceReport.id, 'raw');
  assert.deepEqual(legacy.items.map((i) => i.unit_price), [250]);
});

test('PDF do relatório: projeção do técnico sem pagamento nem valores; proprietário mantém a situação financeira', async () => {
  const base = { work_order: { id: 'wo1', number: 'OS-0042' }, company: { name: 'Empresa Teste' }, client: { name: 'Condomínio Aurora' },
    technical_report: { body: 'Split instalado e testado.' } };
  const tech = pdfTexts(await apis.reportPdf.montarRelatorioAtendimentoPDF({ snapshot: { ...base, financial_redacted: true,
    items: [{ name: 'Instalação split', quantity: 1, unit: 'un', is_extra: false }] } }));
  const techAll = tech.join('\n');
  assert.ok(tech.includes('Instalação split'), techAll);
  assert.match(techAll, /Atendimento conclu/);
  assert.doesNotMatch(techAll, /\bpagamento\b|R\$|valor exib|\bforma\b/i);

  const owner = pdfTexts(await apis.reportPdf.montarRelatorioAtendimentoPDF({ snapshot: { ...base,
    items: [{ name: 'Instalação split', quantity: 1, unit: 'un', unit_price: 900, price_pending: false }],
    payment: { show_values: true, billable_total: 950, status: 'paid', status_label: 'Recebido', payment_method: 'pix' } } }));
  const ownerAll = owner.join('\n');
  assert.match(ownerAll, /\bpagamento\b/i);
  assert.match(ownerAll, /Recebido/);
  assert.match(ownerAll, /950,00/);
});

test('telas: valor do item e situação de pagamento da memória da OS só para o proprietário', () => {
  const memory = read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(memory, /\{i\.price_pending\?'Valor pendente':owner\?money\(Number\(i\.quantity\|\|0\)\*Number\(i\.unit_price\|\|0\)\):null\}/);
  assert.doesNotMatch(memory, /\{i\.price_pending\?'Valor pendente':money\(/, 'sem valor de item para o técnico');
  assert.match(memory, /snapshot\?\.financial_redacted\?'Valores e pagamento ficam com o proprietário\.'/);
  // Nenhuma leitura "select *" de work_orders nem coluna approved_* no app.
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  } };
  walk('src');
  walk('api');
  for (const f of files) {
    const s = read(f);
    assert.doesNotMatch(s, /from\(['"]work_orders['"]\)\s*\.select\(\s*['"`]\s*\*/, `${f}: select * em work_orders`);
    assert.doesNotMatch(s, /approved_(subtotal|discount|surcharge|total)/, `${f}: leitura direta de approved_*`);
  }
});

// ------------------------------------------------------------------ contrato SQL
test('0105: relatório projetado por papel (porta da antiga 0093) e linha bruta só do proprietário', () => {
  const s = compact(code(migration));
  assert.match(s, /alter policy p_wo_rep_select on public\.work_order_reports using \( public\.zt_wo_is_owned\(work_order_id\) or \(public\.zt_wo_is_mine\(work_order_id\) and entry_type <> 'service_report'\) \);/);
  assert.match(s, /create or replace function public\.zt_get_service_report\(p_wo uuid\) returns jsonb language plpgsql stable security definer set search_path='' as \$\$/);
  assert.match(s, /if not v_owner and not public\.zt_wo_is_mine\(v_wo\.id\) then raise exception 'Sem permissão para esta OS' using errcode='42501'/);
  assert.match(s, /v_snapshot:=\(v_snapshot - 'payment'\) \|\| jsonb_build_object\( 'items',coalesce\(\( select jsonb_agg\(e\.item - 'unit_price' - 'price_pending' order by e\.ord\)/);
  assert.match(s, /'financial_redacted',true/);
  assert.match(s, /revoke all on function public\.zt_get_service_report\(uuid\) from public, anon; grant execute on function public\.zt_get_service_report\(uuid\) to authenticated;/);
});

test('0105: itens só do proprietário pela tabela; técnico pela projeção sem preço; insert do técnico intacto', () => {
  const s = compact(code(migration));
  assert.match(s, /alter policy p_wo_items_select on public\.work_order_items using \(public\.zt_wo_is_owned\(work_order_id\)\);/);
  assert.doesNotMatch(s, /p_wo_items_insert/, 'policy de insert do técnico não muda');
  const fn = s.match(/create or replace function public\.zt_field_work_order_items[\s\S]*?\$\$;/)[0];
  assert.match(fn, /returns table\( id uuid, work_order_id uuid, company_id uuid, kind public\.zt_item_kind,/);
  assert.doesNotMatch(fn, /unit_price|unit_cost/, 'projeção sem preço/custo');
  assert.match(fn, /security definer set search_path=''/);
  assert.match(fn, /if p_company is null or not zt_private\.is_member\(p_company\) then raise exception 'Sem acesso ativo à empresa' using errcode='42501'/);
  assert.match(fn, /if zt_private\.is_owner\(p_company\) then return; end if;/);
  assert.match(fn, /where i\.company_id=p_company and w\.assigned_to=auth\.uid\(\) and \(p_wo is null or w\.id=p_wo\)/);
  assert.match(s, /revoke all on function public\.zt_field_work_order_items\(uuid,uuid\) from public, anon; grant execute on function public\.zt_field_work_order_items\(uuid,uuid\) to authenticated;/);
});

test('0105: approved_* sem SELECT para authenticated; demais colunas por grant explícito; nada de escrita muda', () => {
  const s = compact(code(migration));
  assert.match(s, /revoke select on table public\.work_orders from authenticated;/);
  assert.match(s, /a\.attname not in \('approved_subtotal','approved_discount','approved_surcharge','approved_total'\)/);
  assert.match(s, /grant select \(%s\) on table public\.work_orders to authenticated/);
  assert.doesNotMatch(s, /revoke (insert|update|delete|all)[^;]*on table public\.work_orders/i);
  assert.doesNotMatch(s, /create policy|drop policy/i);
});

test('Bloco 5: dois definers com search_path vazio e sem SQL dinâmico; teste no gate SQL/RLS; inventário 140', () => {
  let definers = 0;
  for (const [whole, body] of migration.matchAll(/create or replace function[\s\S]*?\$\$([\s\S]*?)\$\$;/gi)) {
    if (!/security definer/i.test(whole)) continue;
    definers += 1;
    assert.match(whole, /set search_path=''/);
    assert.doesNotMatch(body, /\bexecute\b/i, 'definer com execute no corpo');
  }
  assert.equal(definers, 2);
  const runner = read('scripts/run-sql-rls-ci.sh');
  assert.ok(runner.includes('supabase/tests/v2_block5_technician_exposure_rollback.sql'), 'teste do Bloco 5 registrado no gate SQL/RLS');
  const sqlTest = read('supabase/tests/v2_block5_technician_exposure_rollback.sql');
  assert.match(sqlTest, /\nrollback;\s*$/);
  assert.match(sqlTest, /if n<>42 then raise exception 'BLOCK5_TECHNICIAN_EXPOSURE_INCOMPLETE/);
  for (const check of ['tecnico_sem_approved', 'tecnico_uuid_conhecido_negado', 'outra_empresa_nao_le_dados_de_a', 'anon_bloqueado',
    'tecnico_desativado_perde_acesso', 'convite_equipe_sem_convite_beta', 'convite_beta_nao_e_convite_de_tecnico']) {
    assert.ok(sqlTest.includes(`'${check}'`), `check ${check} presente`);
  }
  assert.match(read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql'), /-- 0105 adds two public definers[\s\S]*if v_total<>142 then/);
  const audit = read('docs/engineering/SECURITY_DEFINER_AUDIT.md');
  assert.match(audit, /`zt_get_service_report\(p_wo uuid\)` \| 0105/);
  assert.match(audit, /`zt_field_work_order_items\(p_company uuid, p_wo uuid\)` \| 0105/);
});
