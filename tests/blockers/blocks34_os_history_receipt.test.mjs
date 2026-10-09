import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Blocos 3/4: Comprovante de Serviço, relatório sem financeiro para técnico, relato idempotente,
// local cadastrado na OS direta e histórico técnico por local.

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sql = {
  projection: read('supabase/0093_service_report_financial_projection.sql'),
  actors: read('supabase/0094_work_order_lifecycle_actors.sql'),
  report: read('supabase/0095_work_order_report_idempotency.sql'),
  location: read('supabase/0096_direct_work_order_client_location.sql'),
  receipts: read('supabase/0097_service_receipts.sql'),
  history: read('supabase/0098_location_technical_history.sql'),
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
    receipts: await vite.ssrLoadModule('/src/lib/serviceReceiptApi.js'),
    history: await vite.ssrLoadModule('/src/lib/locationHistoryApi.js'),
    data: await vite.ssrLoadModule('/src/lib/dataApi.js'),
    reportPdf: await vite.ssrLoadModule('/src/lib/serviceReportPdf.js'),
    receiptPdf: await vite.ssrLoadModule('/src/lib/serviceReceiptPdf.js'),
  };
});
after(async () => { await vite?.close(); });

// Texto real desenhado no PDF: pdf-lib comprime o conteúdo e escreve cada linha como <hex> Tj.
function pdfTexts(bytes) {
  const buf = Buffer.from(bytes);
  const raw = buf.toString('latin1');
  const texts = [];
  const marker = /stream\r?\n/g;
  let match;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    let chunk = buf.subarray(start, end);
    while (chunk.length && (chunk[chunk.length - 1] === 0x0a || chunk[chunk.length - 1] === 0x0d)) chunk = chunk.subarray(0, chunk.length - 1);
    try {
      const content = zlib.inflateSync(chunk).toString('latin1');
      for (const hit of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) texts.push(Buffer.from(hit[1], 'hex').toString('latin1'));
    } catch { /* stream não comprimido ou de imagem */ }
    marker.lastIndex = end;
  }
  return texts;
}

const receiptFixture = () => ({
  id: 'r2', number: 'CS-0001', version: 2, is_active: true, issued_at: '2026-10-09T13:00:00Z',
  notes: 'Garantia de 90 dias no serviço', reissue_reason: 'Pagamento recebido',
  snapshot: {
    receipt_schema_version: 1,
    document: { kind: 'service_receipt', title: 'Comprovante de Serviço', notice: 'Documento não fiscal', number: 'CS-0001', version: 2,
      issued_at: '2026-10-09T13:00:00Z', issued_by: { id: 'u1', name: 'Ana Proprietária' }, reissue_reason: 'Pagamento recebido' },
    company: { name: 'Empresa Teste', tax_id: '12.345.678/0001-90', phone: '11 4000-0000' },
    client: { name: 'Condomínio Aurora', tax_id: '11.222.333/0001-44', phone: '11 90000-0000' },
    location: { service_place: 'Bloco A · Apto 12', address: 'Rua das Flores, 10' },
    work_order: { id: 'wo1', number: 'OS-0042', completed_at: '2026-10-08T18:00:00Z', request: 'Troca de fechadura' },
    technician: { name: 'Carlos Técnico' },
    technical_report: { body: 'Fechadura trocada e testada com o síndico.' },
    items: [{ name: 'Fechadura digital', quantity: 1, unit: 'unidade', unit_price: 250 }, { name: 'Mão de obra', quantity: 2, unit: 'hora', unit_price: 25 }],
    warranties: [{ kind: 'service', description: 'Garantia da instalação', starts_on: '2026-10-08', ends_on: '2027-01-06' }],
    financial: { quote_based: true, subtotal: 300, discount: 20, surcharge: 0, total: 280, status: 'paid', status_label: 'Recebido', payment_method: 'pix', paid_at: '2026-10-09' },
    notes: 'Garantia de 90 dias no serviço',
  },
});

const reportSnapshot = () => ({
  schema_version: 1,
  company: { name: 'Empresa Teste' },
  client: { name: 'Condomínio Aurora' },
  location: { service_place: 'Bloco A' },
  work_order: { id: 'wo1', number: 'OS-0042', completed_at: '2026-10-08T18:00:00Z', request: 'Troca de fechadura' },
  technician: { name: 'Carlos Técnico' },
  technical_report: { body: 'Fechadura trocada.' },
  items: [{ name: 'Fechadura digital', quantity: 1, unit: 'unidade', unit_price: 250, price_pending: false }],
  materials: [], warranties: [], evidence: [],
  payment: { show_values: true, billable_total: 250, status: 'receivable', status_label: 'A receber', payment_method: null },
});

// ------------------------------------------------------------------ PDFs
test('Comprovante de Serviço em PDF: título, número/versão, aviso não fiscal, totais e pagamento', async () => {
  const texts = pdfTexts(await apis.receiptPdf.montarComprovanteServicoPDF(receiptFixture()));
  const all = texts.join('\n');
  assert.ok(texts.includes('COMPROVANTE DE SERVIÇO'), all);
  assert.ok(texts.includes('DOCUMENTO NÃO FISCAL'), all);
  assert.ok(texts.includes('Nº CS-0001 v2'), all);
  assert.ok(texts.some((t) => t.startsWith('Documento não fiscal · Comprovante CS-0001 v2')), all);
  assert.ok(texts.includes('R$ 280,00'), 'total do comprovante');
  assert.ok(texts.includes('- R$ 20,00'), 'desconto aprovado');
  assert.ok(texts.includes('Recebido') && texts.includes('Pix'), 'situação e forma de pagamento');
  assert.ok(texts.some((t) => t.includes('Pagamento recebido')), 'motivo da reemissão');
  assert.ok(texts.includes('Condomínio Aurora') && texts.includes('Bloco A · Apto 12'), 'cliente e local do snapshot');
  assert.ok(!/nota fiscal|NFS-e/i.test(all), 'comprovante não se apresenta como nota fiscal');
  await assert.rejects(() => apis.receiptPdf.montarComprovanteServicoPDF({ snapshot: reportSnapshot() }), /Comprovante de Serviço inválido/);
});

test('mensagem de WhatsApp do comprovante usa número do cliente e aviso não fiscal', () => {
  const link = apis.receiptPdf.linkWhatsAppComprovante(receiptFixture(), '(11) 99999-0000');
  assert.match(link, /^https:\/\/wa\.me\/5511999990000\?text=/);
  const text = decodeURIComponent(link.split('?text=')[1]);
  assert.match(text, /Comprovante de Serviço CS-0001 v2 referente à OS OS-0042/);
  assert.match(text, /Total: R\$ 280,00 · Recebido/);
  assert.match(text, /Documento não fiscal/);
  assert.match(apis.receiptPdf.linkWhatsAppComprovante(receiptFixture(), ''), /^https:\/\/wa\.me\/\?text=/);
});

test('Relatório de Atendimento: proprietário vê pagamento; projeção do técnico não desenha valor nem pagamento', async () => {
  const owner = pdfTexts(await apis.reportPdf.montarRelatorioAtendimentoPDF({ snapshot: reportSnapshot() }));
  assert.ok(owner.includes('A receber'), owner.join('\n'));
  assert.ok(owner.includes('R$ 250,00'), owner.join('\n'));

  const { payment, ...semPagamento } = reportSnapshot();
  const projection = { ...semPagamento, financial_redacted: true, items: semPagamento.items.map(({ unit_price, price_pending, ...i }) => i) };
  const tech = pdfTexts(await apis.reportPdf.montarRelatorioAtendimentoPDF({ snapshot: projection }));
  const all = tech.join('\n');
  assert.ok(!all.includes('R$'), all);
  assert.ok(!/PAGAMENTO|A receber|Valor exibível|Não informado/.test(all), all);
  assert.ok(tech.includes('Atendimento concluído'), all);
  assert.ok(tech.includes('Fechadura digital') && tech.includes('Fechadura trocada.'), 'conteúdo operacional preservado');
});

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

test('memória da OS usa a projeção do banco para o relatório; linha bruta só antes da migration', async () => {
  const setTables = () => {
    fake.tableResults.set('work_orders', { data: { id: 'wo1', company_id: 'c1', client_id: 'cl1', status: 'done' }, error: null });
    fake.tableResults.set('clients', { data: { id: 'cl1', name: 'Cliente' }, error: null });
    fake.tableResults.set('work_order_reports', { data: [{ id: 'raw', entry_type: 'service_report', is_active: true, snapshot: { payment: { status_label: 'A receber' } } }], error: null });
  };
  fake.reset(); setTables();
  fake.rpcResults.set('zt_get_service_report', { data: { id: 'raw', viewer_role: 'technician', snapshot: { financial_redacted: true } }, error: null });
  let detail = await apis.memory.carregarDetalheMemoriaOSV2DB('c1', 'wo1');
  assert.equal(detail.serviceReport.viewer_role, 'technician');
  assert.equal(detail.serviceReport.snapshot.payment, undefined);
  assert.deepEqual(fake.calls.find((c) => c.kind === 'rpc' && c.name === 'zt_get_service_report').args, { p_wo: 'wo1' });

  fake.reset(); setTables();
  fake.rpcResults.set('zt_get_service_report', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_get_service_report(p_wo)' } });
  detail = await apis.memory.carregarDetalheMemoriaOSV2DB('c1', 'wo1');
  assert.equal(detail.serviceReport.id, 'raw');

  fake.reset(); setTables();
  fake.rpcResults.set('zt_get_service_report', { data: null, error: { code: '42501', message: 'Sem permissão para esta OS' } });
  await assert.rejects(() => apis.memory.carregarDetalheMemoriaOSV2DB('c1', 'wo1'), (e) => /Sem permissão/.test(e.message));
});

test('emissão do comprovante envia requestId estável, observação aparada e motivo nulo na primeira emissão', async () => {
  fake.reset();
  fake.rpcResults.set('zt_issue_service_receipt', (args) => ({ data: { id: 'r1', number: 'CS-0001', version: 1, request_id: args.p_request }, error: null }));
  const r = await apis.receipts.emitirComprovanteServicoDB({ workOrderId: 'wo1', requestId: 'req-1', notes: '  Garantia 90 dias  ', reissueReason: '   ' });
  assert.equal(r.number, 'CS-0001');
  assert.deepEqual(fake.calls.find((c) => c.kind === 'rpc').args, { p_wo: 'wo1', p_request: 'req-1', p_notes: 'Garantia 90 dias', p_reissue_reason: null });
  await assert.rejects(() => apis.receipts.emitirComprovanteServicoDB({ workOrderId: 'wo1' }), /Identificador da emissão/);

  fake.reset();
  fake.rpcResults.set('zt_issue_service_receipt', { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.zt_issue_service_receipt' } });
  await assert.rejects(() => apis.receipts.emitirComprovanteServicoDB({ workOrderId: 'wo1', requestId: 'req-2' }), (e) => e.code === 'V2_MIGRATION_PENDING');

  fake.reset();
  fake.rpcResults.set('zt_issue_service_receipt', { data: null, error: { code: '42501', message: 'Somente o proprietário emite o Comprovante de Serviço' } });
  await assert.rejects(() => apis.receipts.emitirComprovanteServicoDB({ workOrderId: 'wo1', requestId: 'req-3' }), (e) => /Somente o proprietário/.test(e.message));
});

test('comprovantes da OS: versão ativa separada das anteriores; ambiente sem tabela não quebra a tela', async () => {
  fake.reset();
  fake.tableResults.set('service_receipts', { data: [{ id: 'r2', version: 2, is_active: true }, { id: 'r1', version: 1, is_active: false }], error: null });
  const state = await apis.receipts.carregarComprovantesOSDB('wo1');
  assert.equal(state.ativo.id, 'r2');
  assert.equal(state.versoes.length, 2);
  assert.ok(fake.calls.some((c) => c.table === 'service_receipts' && c.op === 'eq' && c.args[0] === 'work_order_id' && c.args[1] === 'wo1'));

  fake.reset();
  fake.tableResults.set('service_receipts', { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.service_receipts' in the schema cache" } });
  assert.deepEqual(await apis.receipts.carregarComprovantesOSDB('wo1'), { ativo: null, versoes: [], disponivel: false });
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
test('OSDetalhe: comprovante só para proprietário com OS concluída em banco real; histórico do local por papel', async () => {
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

    assert.match(render(baseOS, owner, true, 'proprietario'), /Comprovante de Serviço/);
    assert.doesNotMatch(render(baseOS, tech, true, 'tecnico'), /Comprovante de Serviço/);
    assert.doesNotMatch(render(baseOS, owner, false, 'proprietario'), /Comprovante de Serviço/, 'modo demonstração não emite');
    assert.doesNotMatch(render({ ...baseOS, status: 'andamento' }, owner, true, 'proprietario'), /Comprovante de Serviço/);

    assert.match(render(baseOS, owner, true, 'proprietario'), /Atendimentos anteriores neste local/);
    assert.match(render({ ...baseOS, status: 'andamento' }, tech, true, 'tecnico'), /Atendimentos anteriores neste local/);
    assert.doesNotMatch(render(baseOS, tech, true, 'tecnico'), /Atendimentos anteriores neste local/, 'técnico sem OS aberta não consulta o local');
    assert.doesNotMatch(render({ ...baseOS, localId: null }, owner, true, 'proprietario'), /Atendimentos anteriores neste local/);
  } finally { await ssr.close(); }
});

test('telas: relato com requestId estável, valores ocultos ao técnico e NovaOS com local cadastrado', () => {
  const memory = read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(memory, /reportRequestRef\.current\?\.text!==text/);
  assert.match(memory, /salvarRelatoTecnicoV2DB\(\{workOrder:detail\.workOrder,body:text,userId,requestId:reportRequestRef\.current\.id\}\)/);
  assert.match(memory, /owner\?money\(Number\(i\.quantity\|\|0\)\*Number\(i\.unit_price\|\|0\)\):null/);
  assert.match(memory, /snapshot\?\.financial_redacted\?'Valores e pagamento ficam com o proprietário\.'/);

  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /localId: id === s\.clienteId \? s\.localId : ""/, 'troca de cliente limpa o local');
  assert.match(legacy, /\{real && f\.clienteId && \(\s*<QuoteClientLocationField/);
  assert.match(legacy, /verValores && real && os\.status === "concluida"/);
  assert.match(legacy, /localCliente\.startsWith\("loc:"\)/, 'histórico do cliente filtra pelo vínculo relacional');
});

// ------------------------------------------------------------------ contrato SQL
test('0093: técnico não lê a linha bruta do relatório e recebe projeção sem pagamento/preço', () => {
  const s = compact(sql.projection);
  assert.match(s, /alter policy p_wo_rep_select on public\.work_order_reports using \( public\.zt_wo_is_owned\(work_order_id\) or \(public\.zt_wo_is_mine\(work_order_id\) and entry_type <> 'service_report'\) \)/);
  assert.match(s, /v_snapshot:=\(v_snapshot - 'payment'\)/);
  assert.match(s, /e\.item - 'unit_price' - 'price_pending'/);
  assert.match(s, /'financial_redacted',true/);
  assert.match(s, /if not v_owner and not public\.zt_wo_is_mine\(v_wo\.id\) then raise exception 'Sem permissão para esta OS' using errcode='42501'/);
  assert.match(s, /revoke all on function public\.zt_get_service_report\(uuid\) from public, anon; grant execute on function public\.zt_get_service_report\(uuid\) to authenticated;/);
});

test('0094/0095: atores definidos pelo banco e relato deduplicado por requestId e por texto', () => {
  const actors = compact(sql.actors);
  assert.match(actors, /if current_user in \('authenticated','anon'\) then/);
  assert.match(actors, /new\.started_by:=auth\.uid\(\)/);
  assert.match(actors, /new\.completed_by:=auth\.uid\(\)/);
  const report = compact(sql.report);
  assert.match(report, /create unique index if not exists uq_work_order_reports_request on public\.work_order_reports\(work_order_id, request_id\) where request_id is not null/);
  assert.match(report, /btrim\(v_last\)=btrim\(new\.body\) then return null;/);
  assert.match(report, /public\.zt_wo_is_owned\(v_wo\.id\) or \(public\.zt_wo_is_mine\(v_wo\.id\) and public\.zt_wo_open\(v_wo\.id\)\)/);
});

test('0096: OS direta valida local do mesmo cliente/empresa e preserva assinatura com default', () => {
  const s = compact(sql.location);
  assert.match(s, /create or replace function zt_private\.zt_save_work_order\(p_company uuid, p_wo uuid, p_row jsonb, p_items jsonb default '\[\]'::jsonb\)/);
  assert.match(s, /set search_path=public/);
  assert.match(s, /where l\.id=v_location and l\.company_id=p_company and l\.client_id=v_client/);
  assert.match(s, /when p_row \? 'client_location_id' then v_location when v_client is distinct from client_id then null else client_location_id end/);
});

test('0097: comprovante owner-only, não fiscal, idempotente, versionado e sem escrita direta', () => {
  const s = compact(sql.receipts);
  assert.match(s, /create policy service_receipts_owner_select on public\.service_receipts for select to authenticated using \(public\.zt_is_owner\(company_id\)\)/);
  assert.match(s, /revoke all on public\.service_receipts from public, anon, authenticated; grant select on public\.service_receipts to authenticated;/);
  assert.doesNotMatch(s, /grant (insert|update|delete|all)[^;]*service_receipts/i);
  assert.match(s, /'notice','Documento não fiscal'/);
  assert.match(s, /'CS-'\|\|lpad\(v_counter::text,4,'0'\)/);
  assert.match(s, /if not public\.zt_is_owner\(v_wo\.company_id\) then raise exception 'Somente o proprietário emite o Comprovante de Serviço' using errcode='42501'/);
  assert.match(s, /if v_wo\.status<>'done' then/);
  assert.match(s, /if v_wo\.pending_pricing then/);
  assert.match(s, /create unique index if not exists uq_service_receipts_request on public\.service_receipts\(company_id, request_id\)/);
  assert.match(s, /create unique index if not exists uq_service_receipts_active on public\.service_receipts\(work_order_id\) where is_active/);
  assert.match(s, /\(version > 1 and reissue_reason is not null/);
  assert.match(s, /trg_subscription_write_guard before insert or update or delete on public\.service_receipts/);
});

test('0098: técnico só no local com OS aberta atribuída, sem valores; arquivos só para dono/responsável', () => {
  const s = compact(sql.history);
  assert.match(s, /Histórico completo do cliente é exclusivo do proprietário/);
  assert.match(s, /w\.status not in \('done','canceled'\) and public\.zt_wo_is_mine\(w\.id\)/);
  assert.match(s, /'billed_amount',case when v_owner then/);
  assert.match(s, /'unit_price',case when v_owner then i\.unit_price end/);
  assert.match(s, /if v_owner or v_assigned then v_result:=v_result \|\| jsonb_build_object\('evidence'/);
  assert.match(s, /if v_owner then .* v_result:=v_result \|\| jsonb_build_object\('financial'/);
  assert.match(s, /alter policy client_locations_visible on public\.client_locations/);
});

test('novas funções SECURITY DEFINER têm search_path explícito e nenhum SQL dinâmico', () => {
  let definers = 0;
  for (const [name, source] of Object.entries(sql)) {
    const functions = [...source.matchAll(/create or replace function[\s\S]*?\$\$([\s\S]*?)\$\$;/gi)];
    for (const [whole, body] of functions) {
      if (!/security definer/i.test(whole)) continue;
      definers += 1;
      assert.match(whole, /set search_path=/i, `${name}: definer sem search_path`);
      assert.doesNotMatch(body, /\bexecute\b/i, `${name}: definer com execute no corpo`);
    }
  }
  // 0093, 0095, 0096 (substituição), 0097 e duas na 0098.
  assert.equal(definers, 6);
});

test('regressões SQL dos Blocos 3/4 fazem parte do gate SQL/RLS e o inventário de definers foi atualizado', () => {
  const runner = read('scripts/run-sql-rls-ci.sh');
  for (const file of ['v2_blocks34_work_order_lifecycle_rollback.sql', 'v2_blocks34_service_receipts_rollback.sql', 'v2_blocks34_location_history_rollback.sql']) {
    assert.match(runner, new RegExp(file.replace(/\./g, '\\.')));
    assert.match(read(`supabase/tests/${file}`), /\nrollback;\s*$/);
  }
  assert.match(read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql'), /if v_total<>130 then/);
  assert.match(read('supabase/tests/v2_field_workflow_wave2_service_report_rollback.sql'), /Técnico atribuído leu a linha bruta do relatório/);
});
