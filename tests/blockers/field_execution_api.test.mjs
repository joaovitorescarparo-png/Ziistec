import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Clientes falsos: nenhum teste aqui fala com Supabase, com o provedor de IA ou com qualquer rede.
const WO = 'd5000000-0000-4000-8000-0000000000a1';
const REQ = 'd5000000-0000-4000-8000-0000000000b1';
const PRODUCT = 'd5000000-0000-4000-8000-0000000000c1';

function fakeClient({ tables = {}, rpcs = {}, session = { access_token: 'token-teste' } } = {}) {
  const calls = { from: [], rpc: [] };
  const table = (name) => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => tables[name] ?? { data: null, error: null, status: 200 } };
    return query;
  };
  return {
    calls,
    from(name) { calls.from.push(name); return table(name); },
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      const handler = rpcs[name];
      return typeof handler === 'function' ? handler(args) : handler ?? { data: null, error: null, status: 200 };
    },
    auth: { getSession: async () => ({ data: { session } }) },
  };
}
const missingFunction = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 };
const missingTable = { data: null, error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 };
const networkFailure = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 };

const loadModules = async () => {
  const vite = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
  const base = await vite.ssrLoadModule('/src/lib/technicalBaseApi.js');
  const report = await vite.ssrLoadModule('/src/lib/workOrderReportApi.js');
  return { vite, base, report };
};

test('API da Base Técnica e do relatório com IA (clientes falsos)', async (t) => {
  const { vite, base, report } = await loadModules();
  try {
    await t.test('salvar Base Técnica envia só campos conhecidos e o identificador do pedido; vazio vira nulo', async () => {
      const client = fakeClient({ rpcs: { zt_save_work_order_technical_base: { data: { revision: 1 }, error: null, status: 200 } } });
      const out = await base.salvarBaseTecnicaDB({
        workOrderId: WO, requestId: REQ,
        base: { cause: '  fonte queimada ', solution: '', difficulty: 'hard', learning: 'x', needsReturn: true, unit_cost: 99 },
      }, client);
      assert.equal(out.saved, true);
      assert.deepEqual(client.calls.rpc[0], {
        name: 'zt_save_work_order_technical_base',
        args: { p_wo: WO, p_cause: 'fonte queimada', p_solution: null, p_difficulty: 'hard', p_learning: 'x', p_request: REQ },
      });
    });

    await t.test('retry com o mesmo conteúdo reenvia o mesmo identificador (o banco devolve a mesma linha, sem duplicar)', async () => {
      const client = fakeClient({ rpcs: { zt_save_work_order_technical_base: networkFailure } });
      const entrada = { workOrderId: WO, requestId: REQ, base: { cause: 'a', solution: 'b', difficulty: 'easy', learning: '' } };
      await assert.rejects(() => base.salvarBaseTecnicaDB(entrada, client), (error) => error instanceof Error && /Failed to fetch/.test(error.message));
      client.calls.rpc.length = 0;
      client.rpc = async (name, args) => { client.calls.rpc.push({ name, args }); return { data: { revision: 1 }, error: null, status: 200 }; };
      const out = await base.salvarBaseTecnicaDB(entrada, client);
      assert.equal(out.saved, true);
      assert.equal(client.calls.rpc.length, 1);
      assert.equal(client.calls.rpc[0].args.p_request, REQ);
    });

    await t.test('banco sem a 0111: salvar vira "indisponível" e nunca derruba o fechamento', async () => {
      const client = fakeClient({ rpcs: { zt_save_work_order_technical_base: missingFunction, zt_save_attendance_confirmation: missingFunction } });
      assert.deepEqual(await base.salvarBaseTecnicaDB({ workOrderId: WO, requestId: REQ, base: { cause: 'x' } }, client), { saved: false, unavailable: true });
      assert.deepEqual(await base.salvarConfirmacaoDB({ workOrderId: WO, requestId: REQ, name: 'Maria', absent: false }, client), { saved: false, unavailable: true });
    });

    await t.test('permissão negada sobe como erro (técnico de outra OS, empresa errada): nada é engolido', async () => {
      const client = fakeClient({ rpcs: { zt_save_work_order_technical_base: { data: null, error: { code: '42501', message: 'Sem permissão para registrar a Base Técnica desta OS' }, status: 403 } } });
      await assert.rejects(() => base.salvarBaseTecnicaDB({ workOrderId: WO, requestId: REQ, base: { cause: 'x' } }, client), (error) => error.code === '42501');
    });

    await t.test('confirmação exige nome ou responsável ausente antes de qualquer chamada', async () => {
      const client = fakeClient();
      await assert.rejects(() => base.salvarConfirmacaoDB({ workOrderId: WO, requestId: REQ, name: '', absent: false }, client), /Responsável ausente/);
      assert.equal(client.calls.rpc.length, 0);
      await base.salvarConfirmacaoDB({ workOrderId: WO, requestId: REQ, name: '  Maria   Souza ', absent: false }, client);
      assert.deepEqual(client.calls.rpc[0].args, { p_wo: WO, p_name: 'Maria Souza', p_absent: false, p_request: REQ });
      await base.salvarConfirmacaoDB({ workOrderId: WO, requestId: REQ, name: 'ignorado', absent: true }, client);
      assert.deepEqual(client.calls.rpc[1].args, { p_wo: WO, p_name: null, p_absent: true, p_request: REQ });
    });

    await t.test('carregar fechamento: tabelas ausentes = recurso indisponível; erro real sobe', async () => {
      const ausente = await base.carregarFechamentoTecnico(WO, fakeClient({ tables: { work_order_technical_base: missingTable, work_order_attendance_confirmations: missingTable } }));
      assert.equal(ausente.available, false);
      const presente = await base.carregarFechamentoTecnico(WO, fakeClient({
        tables: {
          work_order_technical_base: { data: { cause: 'c', solution: 's', difficulty: 'medium', learning: 'l', revision: 2, updated_at: '2026-10-28T10:00:00Z' }, error: null, status: 200 },
          work_order_attendance_confirmations: { data: { received_by_name: 'João', receiver_absent: false }, error: null, status: 200 },
        },
      }));
      assert.equal(presente.available, true);
      assert.deepEqual(presente.base, { cause: 'c', solution: 's', difficulty: 'medium', learning: 'l' });
      assert.deepEqual(presente.confirmation, { name: 'João', absent: false });
      assert.equal(presente.baseSaved && presente.confirmationSaved, true);
      const vazio = await base.carregarFechamentoTecnico(WO, fakeClient());
      assert.equal(vazio.available, true);
      assert.equal(vazio.baseSaved, false);
      await assert.rejects(() => base.carregarFechamentoTecnico(WO, fakeClient({ tables: { work_order_technical_base: { data: null, error: { code: '42501', message: 'negado' }, status: 403 } } })), /negado/);
    });

    await t.test('auditoria de uso da IA: nunca bloqueia (erro de rede vira false)', async () => {
      const ok = fakeClient({ rpcs: { zt_mark_work_order_ai_report_used: { data: true, error: null, status: 200 } } });
      assert.equal(await base.marcarRelatorioIAUsadoDB({ workOrderId: WO, requestId: REQ, finalText: 'texto' }, ok), true);
      assert.deepEqual(ok.calls.rpc[0].args, { p_wo: WO, p_request: REQ, p_final_text: 'texto' });
      assert.equal(await base.marcarRelatorioIAUsadoDB({ workOrderId: WO, requestId: REQ, finalText: 'x' }, fakeClient({ rpcs: { zt_mark_work_order_ai_report_used: networkFailure } })), false);
      const quebrado = { rpc: async () => { throw new Error('boom'); } };
      assert.equal(await base.marcarRelatorioIAUsadoDB({ workOrderId: WO, requestId: REQ, finalText: 'x' }, quebrado), false);
    });

    await t.test('uso do limite vem do banco; recurso ausente devolve null', async () => {
      assert.deepEqual(await base.carregarUsoRelatorioIADB(WO, fakeClient({ rpcs: { zt_work_order_ai_report_usage: { data: { used: 2, limit: 3, remaining: 1 }, error: null, status: 200 } } })), { used: 2, limit: 3, remaining: 1 });
      assert.equal(await base.carregarUsoRelatorioIADB(WO, fakeClient({ rpcs: { zt_work_order_ai_report_usage: missingFunction } })), null);
    });

    await t.test('pedido do relatório leva só ids e produtos escolhidos: nenhum custo, preço ou texto interno', async () => {
      const capturado = [];
      const fetchImpl = async (url, options) => { capturado.push({ url, options }); return { ok: true, status: 200, json: async () => ({ source: 'ai', text: 'Relatório.', usage: { used: 1, limit: 3, remaining: 2 } }) }; };
      const out = await report.gerarRelatorioIA({
        workOrderId: WO, requestId: REQ, fetchImpl, client: fakeClient(),
        materiais: [
          { catalogoId: PRODUCT, qtd: 2, nome: 'Fechadura', preco: 450, custo: 210 },
          { catalogoId: 'nao-e-uuid', qtd: 1 },
          { catalogoId: PRODUCT, qtd: 0 },
          { catalogoId: null, qtd: 3 },
        ],
      });
      assert.equal(out.source, 'ai');
      assert.equal(capturado.length, 1);
      assert.equal(capturado[0].url, '/api/work-order-report');
      assert.equal(capturado[0].options.headers.Authorization, 'Bearer token-teste');
      const corpo = JSON.parse(capturado[0].options.body);
      assert.deepEqual(Object.keys(corpo).sort(), ['materials', 'requestId', 'workOrderId']);
      assert.deepEqual(corpo.materials, [{ productId: PRODUCT, quantity: 2 }]);
      assert.doesNotMatch(capturado[0].options.body, /450|210|custo|preco|Fechadura|causa|dificuldade/i);
    });

    await t.test('falhas do endpoint viram tipos claros: rede, indisponível, em andamento, sessão', async () => {
      const rodar = (fetchImpl, client = fakeClient()) => report.gerarRelatorioIA({ workOrderId: WO, requestId: REQ, fetchImpl, client });
      await assert.rejects(() => rodar(async () => { throw new TypeError('Failed to fetch'); }), (error) => error.kind === 'network');
      await assert.rejects(() => rodar(async () => ({ ok: false, status: 503, json: async () => ({ code: 'REPORT_AI_UNAVAILABLE', error: 'x' }) })), (error) => error.kind === 'unavailable');
      await assert.rejects(() => rodar(async () => ({ ok: false, status: 404, json: async () => { throw new Error('html'); } })), (error) => error.kind === 'unavailable');
      await assert.rejects(() => rodar(async () => ({ ok: false, status: 409, json: async () => ({ code: 'IN_PROGRESS', error: 'x' }) })), (error) => error.kind === 'busy');
      await assert.rejects(() => rodar(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Acesso não permitido.' }) })), (error) => error.kind === 'server' && /Acesso não permitido/.test(error.message));
      await assert.rejects(() => rodar(async () => ({ ok: true, status: 200, json: async () => ({ text: 'sem source' }) })), (error) => error.kind === 'server');
      await assert.rejects(() => rodar(async () => { throw new Error('não deve chamar'); }, fakeClient({ session: null })), (error) => error.kind === 'session');
    });

    await t.test('resposta de fallback do servidor chega como texto utilizável, não como erro', async () => {
      const out = await report.gerarRelatorioIA({
        workOrderId: WO, requestId: REQ, client: fakeClient(),
        fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ source: 'fallback', reason: 'quota', text: 'Foi realizado atendimento técnico.' }) }),
      });
      assert.equal(out.source, 'fallback');
      assert.equal(out.reason, 'quota');
      assert.equal(out.text, 'Foi realizado atendimento técnico.');
    });
  } finally {
    await vite.close();
  }
});
