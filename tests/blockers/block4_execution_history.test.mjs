import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Bloco 4 (0101–0104): execução e histórico técnico — atores da OS, relato idempotente, local cadastrado
// na OS direta e histórico por cliente/local (somente proprietário nesta linha beta).
// Harness portado de tests/blockers/blocks34_os_history_receipt.test.mjs (branch blocks-3-4-os-history-receipt).

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sql = {
  actors: read('supabase/0101_work_order_lifecycle_actors.sql'),
  report: read('supabase/0102_work_order_report_idempotency.sql'),
  location: read('supabase/0103_direct_work_order_client_location.sql'),
  history: read('supabase/0104_client_service_history.sql'),
};
const compact = (s) => s.replace(/\s+/g, ' ');

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
// idempotentWrite recusa salvar quando navigator.onLine é falso; o Node não define onLine.
if (globalThis.navigator) Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

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
    memory: await vite.ssrLoadModule('/src/lib/workOrderMemoryV2Api.js'),
    history: await vite.ssrLoadModule('/src/lib/locationHistoryApi.js'),
    data: await vite.ssrLoadModule('/src/lib/dataApi.js'),
  };
});
after(async () => { await vite?.close(); });


// ------------------------------------------------------------------ APIs
test('relato técnico vai pela RPC idempotente com requestId; sem RPC no ambiente volta ao insert anterior', async () => {
  fake.reset();
  fake.rpcResults.set('zt_save_work_order_report', (args) => ({ data: { id: 'rep-1', body: args.p_body, request_id: args.p_request }, error: null }));
  const saved = await apis.memory.salvarRelatoTecnicoV2DB({ workOrder: { id: 'wo1', company_id: 'c1' }, body: '  Troca do sensor  ', userId: 'u1', requestId: 'req-1' });
  assert.equal(saved.id, 'rep-1');
  assert.deepEqual(fake.calls.find((c) => c.kind === 'rpc').args, { p_wo: 'wo1', p_body: 'Troca do sensor', p_request: 'req-1' });
  assert.ok(!fake.calls.some((c) => c.kind === 'from' && c.op === 'insert'), 'sem insert direto quando a RPC existe');

  await assert.rejects(() => apis.memory.salvarRelatoTecnicoV2DB({ workOrder: { id: 'wo1', company_id: 'c1' }, body: 'x', userId: 'u1' }), /Identificador do envio/);

  fake.reset();
  fake.rpcResults.set('zt_save_work_order_report', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_save_work_order_report in the schema cache' } });
  fake.tableResults.set('work_order_reports', { data: { id: 'legacy-insert' }, error: null });
  const legacy = await apis.memory.salvarRelatoTecnicoV2DB({ workOrder: { id: 'wo1', company_id: 'c1' }, body: 'Relato', userId: 'u1', requestId: 'req-2' });
  assert.equal(legacy.id, 'legacy-insert');
  assert.ok(fake.calls.some((c) => c.kind === 'from' && c.table === 'work_order_reports' && c.op === 'insert'));

  fake.reset();
  fake.rpcResults.set('zt_save_work_order_report', { data: null, error: { code: '42501', message: 'Sem permissão para registrar relato nesta OS' } });
  await assert.rejects(() => apis.memory.salvarRelatoTecnicoV2DB({ workOrder: { id: 'wo1', company_id: 'c1' }, body: 'Relato', userId: 'u1', requestId: 'req-3' }), (e) => /Sem permissão/.test(e.message));
  assert.ok(!fake.calls.some((c) => c.kind === 'from' && c.op === 'insert'), 'erro de permissão não cai no insert direto');
});


test('histórico por local chama a RPC com cliente/local e degrada sem migration', async () => {
  fake.reset();
  fake.rpcResults.set('zt_client_service_history', { data: [{ work_order_id: 'wo9', number: 'OS-0009' }], error: null });
  const r = await apis.history.carregarHistoricoAtendimentosDB({ clientId: 'cl1', locationId: 'loc1' });
  assert.deepEqual(r, { disponivel: true, itens: [{ work_order_id: 'wo9', number: 'OS-0009' }] });
  assert.deepEqual(fake.calls[0].args, { p_client: 'cl1', p_location: 'loc1', p_limit: 50 });

  fake.reset();
  fake.rpcResults.set('zt_client_service_history', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_client_service_history' } });
  assert.deepEqual(await apis.history.carregarHistoricoAtendimentosDB({ clientId: 'cl1' }), { disponivel: false, itens: [] });

  fake.reset();
  fake.rpcResults.set('zt_work_order_history_detail', { data: null, error: { code: '42501', message: 'Sem permissão para esta OS' } });
  await assert.rejects(() => apis.history.carregarDetalheHistoricoOSDB('wo9'), (e) => /Sem permissão/.test(e.message));
});

test('OS direta grava client_location_id escolhido; fluxo que não conhece o local não sobrescreve o vínculo', async () => {
  const rows = [];
  fake.reset();
  fake.rpcResults.set('zt_save_work_order_idempotent', (args) => { rows.push(args.p_row); return { data: 'wo-new', error: null }; });
  fake.tableResults.set('work_orders', { data: { id: 'wo-new', company_id: 'c1', client_id: 'cl1', status: 'unscheduled', client_location_id: 'loc1', work_order_items: [], work_order_materials: [] }, error: null });

  const saved = await apis.data.salvarOSDB({ clienteId: 'cl1', localId: 'loc1', status: 'aguardando', itens: [], requestId: 'req-1' }, 'c1', 'u1');
  assert.equal(rows[0].client_location_id, 'loc1');
  assert.equal(saved.localId, 'loc1', 'fromWorkOrder expõe o vínculo para reenvio nas edições');

  await apis.data.salvarOSDB({ clienteId: 'cl1', localId: '', status: 'aguardando', itens: [], requestId: 'req-2' }, 'c1', 'u1');
  assert.ok(Object.prototype.hasOwnProperty.call(rows[1], 'client_location_id') && rows[1].client_location_id === null);

  await apis.data.salvarOSDB({ clienteId: 'cl1', status: 'aguardando', itens: [], requestId: 'req-3' }, 'c1', 'u1');
  assert.ok(!Object.prototype.hasOwnProperty.call(rows[2], 'client_location_id'), 'sem localId a chave não vai e o banco preserva o local');
});

// ------------------------------------------------------------------ UI por papel (SSR real)

// ------------------------------------------------------------------ UI por papel (SSR real)
test('OSDetalhe: histórico do local só para o proprietário, em banco real e com local cadastrado', async () => {
  const ssr = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom', logLevel: 'error' });
  try {
    const { OSDetalhe } = await ssr.ssrLoadModule('/src/legacy/ZiisTecApp.jsx');
    const baseOS = { id: 'wo1', numero: 'OS-0042', clienteId: 'cl1', status: 'concluida', data: '2026-10-08', hora: '09:00', local: 'Rua das Flores, 10',
      localServico: 'Bloco A', localId: 'loc1', itens: [{ id: 'i1', nome: 'Fechadura', qtd: 1, unidade: 'un', preco: 250, custo: 0 }],
      adicionais: [], checklist: [], historico: [], fotos: [], custosExtras: 0 };
    const owner = () => true;
    const tech = (k) => !['verValores', 'todasOS', 'catalogo', 'garantias', 'orcamentos', 'clientes'].includes(k);
    const render = (os, permitido, real, papel) => renderToStaticMarkup(React.createElement(OSDetalhe, {
      os, cliente: () => ({ nome: 'Condomínio Aurora', whatsapp: '11999990000' }), nomeCliente: () => 'Condomínio Aurora', permitido,
      orcamentos: [], lancamentos: [], garantias: [], ordens: [os], empresa: {}, equipe: [], papel, real, aviso: () => {}, abrirOS: () => {},
    }));
    assert.match(render(baseOS, owner, true, 'proprietario'), /Atendimentos anteriores neste local/);
    assert.match(render({ ...baseOS, status: 'andamento' }, owner, true, 'proprietario'), /Atendimentos anteriores neste local/);
    assert.doesNotMatch(render({ ...baseOS, status: 'andamento' }, tech, true, 'tecnico'), /Atendimentos anteriores neste local/, 'técnico não recebe histórico nesta linha beta');
    assert.doesNotMatch(render(baseOS, tech, true, 'tecnico'), /Atendimentos anteriores neste local/);
    assert.doesNotMatch(render({ ...baseOS, localId: null }, owner, true, 'proprietario'), /Atendimentos anteriores neste local/);
    assert.doesNotMatch(render(baseOS, owner, false, 'proprietario'), /Atendimentos anteriores neste local/, 'modo demonstração não consulta o banco');
  } finally { await ssr.close(); }
});

test('telas: relato com requestId estável, NovaOS com local cadastrado e cliente agrupado por local', () => {
  const memory = read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(memory, /reportRequestRef\.current\?\.text!==text/);
  assert.match(memory, /salvarRelatoTecnicoV2DB\(\{workOrder:detail\.workOrder,body:text,userId,requestId:reportRequestRef\.current\.id\}\)/);
  assert.match(memory, /if\(savingReport\|\|!detail\?\.workOrder\|\|!report\.trim\(\)\) return;/, 'duplo toque não envia de novo');
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /localId: id === s\.clienteId \? s\.localId : ""/, 'troca de cliente limpa o local');
  assert.match(legacy, /\{real && f\.clienteId && \(\s*<QuoteClientLocationField/);
  assert.match(legacy, /localCliente\.startsWith\("loc:"\)/, 'histórico do cliente filtra pelo vínculo relacional');
  assert.match(legacy, /if \(!real \|\| !clienteAberto \|\| papel !== "proprietario"\) return;/, 'locais cadastrados só para o proprietário');
  assert.match(legacy, /const historicoLocalVisivel = Boolean\(real && os\.localId && verValores\);/);
  const panel = read('src/components/LocationHistoryPanel.jsx');
  assert.doesNotMatch(panel, /context==='location'/, 'sem contexto de local para técnico');
  assert.match(panel, /owner&&i\.billed_amount!=null/);
  assert.match(panel, /owner&&i\.unit_price!=null/);
});

// ------------------------------------------------------------------ contrato SQL
test('0101/0102: atores definidos pelo banco e relato deduplicado por requestId e por texto', () => {
  const actors = compact(sql.actors);
  assert.match(actors, /if current_user in \('authenticated','anon'\) then/);
  assert.match(actors, /new\.started_by:=auth\.uid\(\)/);
  assert.match(actors, /new\.completed_by:=auth\.uid\(\)/);
  assert.match(actors, /security invoker/);
  const report = compact(sql.report);
  assert.match(report, /create unique index if not exists uq_work_order_reports_request on public\.work_order_reports\(work_order_id, request_id\) where request_id is not null/);
  // Lote mais recente (mesmo created_at = mesma transação) inteiro, sem desempate aleatório por uuid.
  assert.match(report, /and btrim\(r\.body\)=btrim\(new\.body\) and r\.created_at=\(select max\(x\.created_at\) from public\.work_order_reports x/);
  assert.doesNotMatch(report, /order by r\.created_at desc, r\.id desc/, 'sem "último relato" escolhido por uuid');
  assert.match(report, /public\.zt_wo_is_owned\(v_wo\.id\) or \(public\.zt_wo_is_mine\(v_wo\.id\) and public\.zt_wo_open\(v_wo\.id\)\)/);
});

test('0103: OS direta valida local do mesmo cliente/empresa, preserva assinatura com default e usa search_path vazio', () => {
  const s = compact(sql.location);
  assert.match(s, /create or replace function zt_private\.zt_save_work_order\(p_company uuid, p_wo uuid, p_row jsonb, p_items jsonb default '\[\]'::jsonb\)/);
  assert.match(s, /security definer set search_path='' as \$\$/);
  assert.doesNotMatch(sql.location.replace(/--[^\n]*/g, ''), /search_path=public/);
  assert.match(s, /where l\.id=v_location and l\.company_id=p_company and l\.client_id=v_client/);
  assert.match(s, /when p_row \? 'client_location_id' then v_location when v_client is distinct from client_id then null else client_location_id end/);
  assert.match(s, /if not public\.zt_is_owner\(p_company\) then raise exception 'Somente o proprietário salva ordens de serviço por este fluxo'/);
});

test('0104: histórico só do proprietário; detalhe só da própria OS para o técnico; policy de local inalterada', () => {
  const code = sql.history.replace(/--[^\n]*/g, '');
  const s = compact(code);
  assert.doesNotMatch(code, /alter policy|create policy|client_locations_visible/i, 'não amplia a leitura de client_locations');
  assert.doesNotMatch(code, /zt_is_member|v_location_context/, 'sem contexto de local para técnico');
  assert.match(s, /v_owner:=public\.zt_is_owner\(v_company\); if not v_owner then raise exception 'Histórico do cliente é exclusivo do proprietário' using errcode='42501'/);
  assert.match(s, /if not v_owner and not v_assigned then raise exception 'Sem permissão para esta OS' using errcode='42501'/);
  assert.match(s, /'unit_price',case when v_owner then i\.unit_price end/);
  assert.match(s, /if v_owner or v_assigned then v_result:=v_result \|\| jsonb_build_object\('evidence'/);
  assert.match(s, /if v_owner then .* v_result:=v_result \|\| jsonb_build_object\('financial'/);
  assert.match(s, /where l\.id=p_location and l\.company_id=v_company and l\.client_id=p_client/);
});

test('Bloco 4: definers com search_path explícito, sem SQL dinâmico; regressões no gate SQL/RLS; inventário 138', () => {
  let definers = 0;
  for (const [name, source] of Object.entries(sql)) {
    for (const [whole, body] of source.matchAll(/create or replace function[\s\S]*?\$\$([\s\S]*?)\$\$;/gi)) {
      if (!/security definer/i.test(whole)) continue;
      definers += 1;
      assert.match(whole, /set search_path=/i, `${name}: definer sem search_path`);
      assert.doesNotMatch(body, /\bexecute\b/i, `${name}: definer com execute no corpo`);
    }
  }
  // 0102 (relato), 0103 (substitui zt_save_work_order, não soma) e duas na 0104.
  assert.equal(definers, 4);
  const runner = read('scripts/run-sql-rls-ci.sh');
  for (const file of ['v2_block4_work_order_lifecycle_rollback.sql', 'v2_block4_client_service_history_rollback.sql']) {
    assert.ok(runner.includes(`supabase/tests/${file}`), `${file} registrado no gate SQL/RLS`);
    assert.match(read(`supabase/tests/${file}`), /\nrollback;\s*$/);
  }
  assert.match(read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql'), /-- 0101–0104 add three public definers[\s\S]*if v_total<>138 then/);
});
