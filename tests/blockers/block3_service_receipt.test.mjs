import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Bloco 3 (0100): Comprovante de Serviço — documento não fiscal, owner-only, idempotente e versionado.
// Harness portado de tests/blockers/blocks34_os_history_receipt.test.mjs (branch blocks-3-4-os-history-receipt).

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sql = { receipts: read('supabase/0100_service_receipts.sql') };
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
    receipts: await vite.ssrLoadModule('/src/lib/serviceReceiptApi.js'),
    receiptPdf: await vite.ssrLoadModule('/src/lib/serviceReceiptPdf.js'),
  };
});
after(async () => { await vite?.close(); });

// Texto real desenhado no PDF: pdf-lib comprime o conteúdo e escreve cada linha como <hex> Tj.
function pdfTexts(bytes) {
  const buf = Buffer.from(bytes);
  const raw = buf.toString('latin1');
  const texts = [];
  // "endstream\n" também contém "stream\n": o lookbehind evita casar o fim de um stream como início.
  const marker = /(?<!end)stream\r?\n/g;
  let match;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) break;
    // O PDF põe UMA quebra de linha antes de "endstream". Remover todas cortava o último byte
    // comprimido quando ele era 0x0a/0x0d (dependia da data no fuso da máquina) e o texto sumia.
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

const reportSnapshot = () => ({ schema_version: 1, work_order: { id: 'wo1', number: 'OS-0042' }, payment: { status: 'receivable' } });

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


test('OSDetalhe: comprovante só para proprietário com OS concluída em banco real', async () => {
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

  } finally { await ssr.close(); }
});


test('PDF de versão anterior sai do próprio snapshot e mostra o local cadastrado', async () => {
  const v1 = receiptFixture();
  v1.id = 'r1'; v1.version = 1; v1.is_active = false; v1.reissue_reason = null;
  v1.snapshot.document = { ...v1.snapshot.document, version: 1, reissue_reason: null };
  v1.snapshot.financial = { ...v1.snapshot.financial, status: 'receivable', status_label: 'A receber', paid_at: null, due_date: '2026-10-15' };
  v1.snapshot.client_location = { id: 'loc1', name: 'Portaria Norte', address: 'Rua das Flores, 10 - Portaria' };
  const texts = pdfTexts(await apis.receiptPdf.montarComprovanteServicoPDF(v1));
  const all = texts.join('\n');
  assert.ok(texts.includes('Nº CS-0001'), all);
  assert.ok(texts.includes('A receber'), 'situação congelada da versão 1');
  assert.ok(!texts.includes('Recebido'), 'versão 1 não herda o pagamento da versão 2');
  assert.ok(texts.includes('Portaria Norte'), 'nome do local cadastrado');
  assert.ok(texts.includes('Bloco A · Apto 12'), 'ponto do serviço quando difere do local cadastrado');
  assert.ok(texts.some((t) => t.includes('Rua das Flores, 10 - Portaria')), 'endereço do local cadastrado');
});

test('painel do comprovante: emissão com requestId estável, reemissão com motivo e PDF por versão anterior', () => {
  const panel = read('src/components/ServiceReceiptPanel.jsx');
  assert.match(panel, /if\(pedido\.current\?\.chave!==chave\) pedido\.current=\{chave,id:novoRequestIdComprovante\(\)\};/);
  assert.match(panel, /if\(ativo&&!motivoLimpo\)\{setErro\('Informe o motivo da reemissão\.'\);return;\}/);
  assert.match(panel, /onClick=\{\(\)=>baixar\(v\)\}[^>]*aria-label=\{`Baixar PDF da versão \$\{v\.version\}`\}/);
  assert.match(panel, /\{AVISO_NAO_FISCAL\}\./);
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /if \(verValores && real && os\.status === "concluida"\) acoes\.push\(\{ label: "Comprovante de Serviço"/);
  assert.match(legacy, /<ServiceReceiptPanel workOrderId=\{os\.id\} telefoneCliente=\{c\?\.whatsapp \|\| c\?\.telefone \|\| ""\} onAviso=\{aviso\} \/>/);
});

test('0100: comprovante owner-only, não fiscal, idempotente, versionado, com local cadastrado e sem escrita direta', () => {
  const s = compact(sql.receipts.replace(/--[^\n]*/g, ''));
  assert.match(s, /create policy service_receipts_owner_select on public\.service_receipts for select to authenticated using \(public\.zt_is_owner\(company_id\)\)/);
  assert.match(s, /revoke all on public\.service_receipts from public, anon, authenticated; grant select on public\.service_receipts to authenticated;/);
  assert.doesNotMatch(s, /grant (insert|update|delete|all)[^;]*service_receipts/i);
  assert.doesNotMatch(s, /grant [^;]* to (anon|public)\b/i);
  assert.match(s, /'notice','Documento não fiscal'/);
  assert.match(s, /'CS-'\|\|lpad\(v_counter::text,4,'0'\)/);
  assert.match(s, /if not public\.zt_is_owner\(v_wo\.company_id\) then raise exception 'Somente o proprietário emite o Comprovante de Serviço' using errcode='42501'/);
  assert.match(s, /perform zt_private\.assert_operational_write_allowed\(v_wo\.company_id\);/);
  assert.match(s, /if v_wo\.status<>'done' then/);
  assert.match(s, /if v_wo\.pending_pricing then/);
  assert.match(s, /create unique index if not exists uq_service_receipts_request on public\.service_receipts\(company_id, request_id\)/);
  assert.match(s, /create unique index if not exists uq_service_receipts_active on public\.service_receipts\(work_order_id\) where is_active/);
  assert.match(s, /\(version > 1 and reissue_reason is not null/);
  assert.match(s, /trg_subscription_write_guard before insert or update or delete on public\.service_receipts/);
  assert.match(s, /where l\.id=v_wo\.client_location_id and l\.company_id=v_wo\.company_id and l\.client_id=v_wo\.client_id/);
  assert.match(s, /\(v_report\.snapshot - 'payment' - 'schema_version'\)/, 'parte do snapshot do relatório, que já exclui custo');
  assert.doesNotMatch(s, /financial_entries\s*\(|insert into public\.financial_entries/i, 'emissão não cria lançamento');
});

test('0100: definer com search_path vazio e sem SQL dinâmico; regressões no gate SQL/RLS; inventário 135', () => {
  const functions = [...sql.receipts.matchAll(/create or replace function[\s\S]*?\$\$([\s\S]*?)\$\$;/gi)];
  assert.equal(functions.length, 1);
  const [whole, body] = functions[0];
  assert.match(whole, /security definer\nset search_path=''/);
  assert.doesNotMatch(body, /\bexecute\b/i);
  const runner = read('scripts/run-sql-rls-ci.sh');
  assert.match(runner, /supabase\/tests\/v2_block3_service_receipts_rollback\.sql/);
  assert.match(runner, /bash scripts\/test-service-receipt-concurrency\.sh/);
  const smoke = read('supabase/tests/v2_block3_service_receipts_rollback.sql');
  assert.match(smoke, /^begin;$/m);
  assert.match(smoke, /\nrollback;\s*$/);
  assert.match(smoke, /if \(select count\(\*\) from zt_sr_results\)<>46 then/);
  assert.match(smoke, /snapshot_local_cadastrado/);
  const race = read('scripts/test-service-receipt-concurrency.sh');
  assert.match(race, /issue "\$OUT1" & p1=\$!\nissue "\$OUT2" & p2=\$!/);
  assert.match(read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql'), /-- 0100 adds one public definer[\s\S]*if v_total<>135 then/);
});
