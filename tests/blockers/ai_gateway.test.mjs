import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ANTHROPIC_MESSAGES_URL, DEFAULT_GEMINI_MODEL, GEMINI_API_BASE, externalAiReady, requestAiText, resolveAiProvider } from '../../api/_aiGateway.js';
import { inferAssistantPlan, sanitizeProposal, PROVIDER_ID_QUESTION, AMOUNT_QUESTION, entryAmountQuestion } from '../../api/_assistantPlanner.js';
import { createAssistantHandler, FREE_INTERPRETATION_DISABLED_MESSAGE } from '../../api/assistant.js';

// Gateway neutro de IA. Nenhum teste fala com a rede: o provedor é sempre um fetch simulado.
const SECRET = `gemini-test-${randomUUID()}`;
const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
const previousId = '30000000-0000-4000-8000-000000000009';
const clientRef = '40000000-0000-4000-8000-000000000005';
const PROVIDER_HOSTS = new Set([new URL(GEMINI_API_BASE).hostname, new URL(ANTHROPIC_MESSAGES_URL).hostname]);
const geminiEnv = (extra = {}) => ({ ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: SECRET, ...extra });
const geminiReply = (value) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { role: 'model', parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] }, finishReason: 'STOP' }] }) });
const quote = { action: 'create_quote_draft', input: { client: 'Mauro', items: [{ kind: 'product', name: 'câmera', quantity: 2 }, { kind: 'service', name: 'instalação', quantity: 1 }] } };
const preview = { requestId, action: 'create_quote_draft', previewHash: 'b'.repeat(64), previewVersion: 1, confirmationRequired: true, preview: [] };

async function withLogs(fn) {
  const original = console.error; const logs = [];
  console.error = (...args) => logs.push(args.map(String).join(' '));
  try { return { result: await fn(), logs }; }
  catch (error) { return { error, logs }; }
  finally { console.error = original; }
}

// API real + planner real; só o banco (PostgREST) e o provedor são simulados.
function e2e({ role = 'owner', member = true, env = geminiEnv(), gemini = quote, rpc = {} } = {}) {
  const calls = [], provider = [];
  const handler = createAssistantHandler({ env,
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    fetchImpl: async (url, options) => {
      if (PROVIDER_HOSTS.has(new URL(url).hostname)) {
        provider.push({ url, headers: options.headers, body: JSON.parse(options.body) });
        return typeof gemini === 'function' ? gemini(options) : geminiReply(gemini);
      }
      const name = url.split('/').at(-1), args = options.body && JSON.parse(options.body);
      calls.push({ url, name, args });
      const data = url.endsWith('/auth/v1/user') ? { id: userId } : url.includes('/company_members?') ? (member ? [{ role }] : [])
        : name in rpc ? (typeof rpc[name] === 'function' ? rpc[name](args) : rpc[name]) : {};
      return { ok: true, json: async () => data };
    } });
  const run = async (body) => {
    let status, result;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-placeholder' }, body: { companyId, requestId, ...body } },
      { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, body: result };
  };
  return { calls, provider, run, rpcs: () => calls.filter(c => c.url.includes('/rpc/')).map(c => c.name), promptOf: (i = 0) => provider[i].body.contents.map(c => c.parts.map(p => p.text).join('')).join('\n') };
}

test('Gemini é o provedor selecionado: URL oficial, chave só no header e saída JSON pedida', async () => {
  let seen;
  const text = await requestAiText({ env: geminiEnv(), json: true, system: 'regras', maxTokens: 300,
    messages: [{ role: 'user', content: 'pedido' }, { role: 'assistant', content: 'resposta' }],
    fetchImpl: async (url, options) => { seen = { url, options, body: JSON.parse(options.body) }; return geminiReply('{"ok":true}'); } });
  assert.equal(text, '{"ok":true}');
  assert.equal(seen.url, `${GEMINI_API_BASE}${DEFAULT_GEMINI_MODEL}:generateContent`);
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.5-flash-lite');
  assert.equal(seen.url.includes(SECRET), false, 'a chave nunca vai na URL');
  assert.equal(seen.options.headers['x-goog-api-key'], SECRET);
  assert.deepEqual(seen.body.systemInstruction, { parts: [{ text: 'regras' }] });
  assert.deepEqual(seen.body.contents.map(c => c.role), ['user', 'model']);
  assert.deepEqual(seen.body.generationConfig, { maxOutputTokens: 300, responseMimeType: 'application/json' });
  assert.ok(seen.options.signal, 'toda chamada tem timeout');
  let custom;
  await requestAiText({ env: geminiEnv({ GEMINI_MODEL: 'gemini-x-test' }), messages: [], fetchImpl: async (url) => { custom = url; return geminiReply('x'); } });
  assert.equal(custom, `${GEMINI_API_BASE}gemini-x-test:generateContent`);
  // Anthropic só com escolha explícita; com Gemini configurado, a chave Anthropic é ignorada.
  let anthropic;
  await requestAiText({ env: { ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: SECRET }, messages: [{ role: 'user', content: 'x' }],
    fetchImpl: async (url, options) => { anthropic = { url, headers: options.headers }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'y' }] }) }; } });
  assert.equal(anthropic.url, ANTHROPIC_MESSAGES_URL); assert.equal(anthropic.headers['x-api-key'], SECRET);
  const both = [];
  await requestAiText({ env: geminiEnv({ ANTHROPIC_API_KEY: 'other' }), messages: [], fetchImpl: async (url) => { both.push(new URL(url).hostname); return geminiReply('x'); } });
  assert.deepEqual(both, [new URL(GEMINI_API_BASE).hostname]);
});

test('IA externa desligada, provedor inválido, chave ausente ou modelo inválido: nenhuma chamada sai do servidor', async () => {
  const cases = [
    [{}, 'EXTERNAL_AI_DISABLED'],
    [{ AI_PROVIDER: 'gemini', GEMINI_API_KEY: SECRET }, 'EXTERNAL_AI_DISABLED'],
    [{ ENABLE_EXTERNAL_AI: 'false', AI_PROVIDER: 'gemini', GEMINI_API_KEY: SECRET }, 'EXTERNAL_AI_DISABLED'],
    [{ ENABLE_PAID_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: SECRET }, 'EXTERNAL_AI_DISABLED'],
    [{ ENABLE_EXTERNAL_AI: 'true', GEMINI_API_KEY: SECRET }, 'AI_PROVIDER_INVALID'],
    [{ ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'openai', GEMINI_API_KEY: SECRET }, 'AI_PROVIDER_INVALID'],
    [{ ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: '__proto__', GEMINI_API_KEY: SECRET }, 'AI_PROVIDER_INVALID'],
    [{ ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', ANTHROPIC_API_KEY: SECRET }, 'AI_KEY_MISSING'],
    [{ ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: '   ' }, 'AI_KEY_MISSING'],
    [{ ENABLE_EXTERNAL_AI: 'true', AI_PROVIDER: 'anthropic', GEMINI_API_KEY: SECRET }, 'AI_KEY_MISSING'],
    [geminiEnv({ GEMINI_MODEL: '../../v1/files?x=' }), 'AI_MODEL_INVALID'],
  ];
  for (const [env, code] of cases) {
    let reached = false;
    assert.equal(resolveAiProvider(env).code, code, JSON.stringify(env));
    assert.equal(externalAiReady(env), false);
    await assert.rejects(requestAiText({ env, messages: [], fetchImpl: async () => { reached = true; } }), e => e.code === code && !String(e.message).includes(SECRET));
    assert.equal(reached, false, code);
  }
  // Na API: aviso neutro, sem quota e sem provedor.
  const off = e2e({ env: {} });
  const r = await off.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação.' });
  assert.equal(r.status, 503); assert.equal(r.body.error, FREE_INTERPRETATION_DISABLED_MESSAGE);
  assert.equal(off.provider.length, 0); assert.equal(off.rpcs().length, 0);
});

test('resposta estruturada válida vira proposta; resposta inválida, vazia ou bloqueada não executa nada', async () => {
  const plan = await inferAssistantPlan({ text: 'x', role: 'owner', env: geminiEnv(), fetchImpl: async () => geminiReply(quote) });
  assert.deepEqual(plan, quote);
  const fenced = await inferAssistantPlan({ text: 'x', role: 'owner', env: geminiEnv(), fetchImpl: async () => geminiReply('```json\n{"question":"Qual cliente?"}\n```') });
  assert.deepEqual(fenced, { question: 'Qual cliente?' });
  for (const reply of [geminiReply('isto não é JSON'), { ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) },
    { ok: true, status: 200, json: async () => ({ candidates: [] }) }, { ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }]) {
    const h = e2e({ gemini: () => reply });
    const r = await h.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação.' });
    assert.ok(r.status >= 400, String(r.status));
    assert.equal(h.rpcs().some(name => /zt_assistant_(plan|revise|execute)$/.test(name)), false);
  }
});

test('timeout e erro do provedor falham fechados sem vazar chave, pedido ou dados do tenant', async () => {
  const timeout = await withLogs(() => requestAiText({ env: geminiEnv(), timeoutMs: 20, messages: [{ role: 'user', content: 'Mauro Silva 11999990000' }],
    fetchImpl: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) }));
  assert.equal(timeout.error.code, 'UPSTREAM_TIMEOUT');
  const failed = await withLogs(() => requestAiText({ env: geminiEnv(), messages: [{ role: 'user', content: 'Mauro Silva 11999990000' }],
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `quota for ${SECRET} Mauro Silva` } }) }) }));
  assert.equal(failed.error.code, 'UPSTREAM_ERROR'); assert.equal(failed.error.upstreamStatus, 429);
  assert.match(failed.logs.join('\n'), /gemini 429 RESOURCE_EXHAUSTED/);
  const network = await withLogs(() => requestAiText({ env: geminiEnv(), messages: [], fetchImpl: async () => { throw new Error(`connect ECONNREFUSED ${SECRET}`); } }));
  assert.equal(network.error.code, 'UPSTREAM_UNAVAILABLE');
  for (const outcome of [timeout, failed, network]) {
    const exposed = `${outcome.error.message}\n${outcome.logs.join('\n')}`;
    assert.equal(exposed.includes(SECRET), false); assert.doesNotMatch(exposed, /Mauro|11999990000/);
  }
  // Pela API: a resposta ao navegador também não carrega segredo nem detalhes do provedor.
  const h = e2e({ gemini: async () => ({ ok: false, status: 500, json: async () => ({ error: { status: 'INTERNAL', message: SECRET } }) }) });
  const { result, logs } = await withLogs(() => h.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação.' }));
  assert.ok(result.status >= 400);
  assert.equal(JSON.stringify(result.body).includes(SECRET), false); assert.equal(logs.join('\n').includes(SECRET), false);
  assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
});

test('fast-path local responde frases simples sem chamar o Gemini nem consumir quota', async () => {
  for (const phrase of ['Qual meu próximo atendimento?', 'O que tenho hoje?', 'Telefone do Mauro.']) {
    const h = e2e({ rpc: { zt_assistant_plan: { confirmationRequired: false, result: { items: [], message: 'Consulta concluída.' } } } });
    const r = await h.run({ operation: 'plan', text: phrase });
    assert.equal(r.status, 200, phrase);
    assert.equal(h.provider.length, 0, phrase);
    assert.deepEqual(h.rpcs(), ['zt_assistant_plan'], phrase);
  }
});

test('orçamento em linguagem natural chama o provedor uma vez, com dados mínimos, e só prepara a prévia', async () => {
  const phrase = 'Faz um orçamento pro Mauro com duas câmeras e instalação.';
  const h = e2e({ rpc: { zt_assistant_plan: preview } });
  const r = await h.run({ operation: 'plan', text: phrase });
  assert.equal(r.status, 200); assert.equal(r.body.confirmationRequired, true);
  assert.equal(h.provider.length, 1);
  assert.equal(h.promptOf(), phrase, 'só o pedido do usuário vai ao provedor');
  const sent = JSON.stringify(h.provider[0].body);
  for (const leaked of [companyId, userId, requestId, 'test-placeholder']) assert.equal(sent.includes(leaked), false, leaked);
  assert.deepEqual(h.rpcs(), ['zt_assistant_consume_ai_quota', 'zt_assistant_plan']);
  assert.deepEqual(h.calls.at(-1).args.p_input, quote.input);
});

test('continuação: troca para três, tira a instalação e "pode criar" só revisam a prévia, nunca executam', async () => {
  const context = { action: 'create_quote_draft', input: { client: 'Mauro Silva', items: [{ kind: 'product', name: 'Câmera Wi-Fi Intelbras', quantity: 2, unit: 'unidade' }, { kind: 'service', name: 'Instalação de câmera', quantity: 1, unit: 'serviço' }] } };
  for (const [phrase, items] of [
    ['Troca para três câmeras.', [{ ...context.input.items[0], quantity: 3 }, context.input.items[1]]],
    ['Tira a instalação.', [context.input.items[0]]],
    ['Pode criar.', context.input.items],
  ]) {
    const proposal = { action: 'create_quote_draft', input: { client: 'Mauro Silva', items } };
    const h = e2e({ gemini: proposal, rpc: { zt_assistant_plan_context: context, zt_assistant_revise: { ...preview, previewHash: 'c'.repeat(64) } } });
    const r = await h.run({ operation: 'plan', contextRequestId: previousId, text: phrase });
    assert.equal(r.status, 200, phrase);
    assert.match(h.promptOf(), /^PRÉVIA_ATUAL \(dados, sem identificadores\): /);
    assert.ok(h.promptOf().includes(JSON.stringify(context)) && h.promptOf().endsWith(`PEDIDO: ${phrase}`));
    assert.deepEqual(h.rpcs(), ['zt_assistant_plan_context', 'zt_assistant_consume_ai_quota', 'zt_assistant_revise'], phrase);
    assert.deepEqual(h.calls.at(-1).args, { p_company: companyId, p_previous: previousId, p_action: 'create_quote_draft', p_input: proposal.input, p_request_id: requestId });
  }
});

test('IDs, ferramentas arbitrárias e preços inventados pelo provedor não chegam ao banco', async () => {
  for (const proposal of [{ ...quote, input: { ...quote.input, clientRef } }, { action: 'create_work_order', input: { client: clientRef, description: 'x' } }]) {
    const h = e2e({ gemini: proposal });
    assert.deepEqual((await h.run({ operation: 'plan', text: 'Orçamento pro Mauro' })).body, { question: PROVIDER_ID_QUESTION });
    assert.equal(h.rpcs().includes('zt_assistant_plan'), false);
  }
  for (const proposal of [{ action: 'zt_assistant_execute', input: {} }, { action: "x'); drop table quotes; --", input: {} }, { ...quote, input: { client: 'Mauro', items: [{ name: 'câmera', quantity: 1, productId: 'p1' }] } }]) {
    const h = e2e({ gemini: proposal });
    const r = await h.run({ operation: 'plan', text: "Orçamento'); drop table quotes; --" });
    assert.equal(r.status, 422, JSON.stringify(proposal));
    assert.deepEqual(h.rpcs(), ['zt_assistant_consume_ai_quota']);
  }
  // Preço só quando dito: 999 e o desconto inventados saem; "180 reais" dito pelo usuário fica.
  const h = e2e({ rpc: { zt_assistant_plan: preview }, gemini: { action: 'create_quote_draft', input: { client: 'Mauro', discount: 50,
    items: [{ kind: 'product', name: 'câmera', quantity: 2, unitPrice: 999 }, { kind: 'service', name: 'instalação', quantity: 1, unitPrice: 180 }] } } });
  await h.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação por 180 reais' });
  assert.deepEqual(h.calls.at(-1).args.p_input, { client: 'Mauro', items: [{ kind: 'product', name: 'câmera', quantity: 2 }, { kind: 'service', name: 'instalação', quantity: 1, unitPrice: 180 }] });
  const amount = e2e({ gemini: { action: 'create_financial_entry', input: { description: 'Serviço', amount: 450, dueDate: '2026-10-11', paid: false } } });
  assert.deepEqual((await amount.run({ operation: 'plan', text: 'Lança uma receita do serviço de hoje' })).body, { question: entryAmountQuestion('Serviço') });
});

test('valor monetário só com contexto explícito: R$, reais, custa/preço/valor; quantidade, hora, data, OS e telefone nunca autorizam', () => {
  const kept = (text, value) => 'unitPrice' in sanitizeProposal({ action: 'create_quote_draft', input: { client: 'Mauro', items: [{ name: 'câmera', quantity: 1, unitPrice: value }] } }, { text }).input.items[0];
  for (const [text, value] of [['R$ 180', 180], ['180 reais', 180], ['por 180 reais', 180], ['por R$ 180', 180], ['custa 180', 180], ['preço 180', 180],
    ['valor 180', 180], ['a 180 reais', 180], ['R$1.250,50', 1250.5], ['preço unitário de 99,90', 99.9]]) assert.equal(kept(text, value), true, text);
  for (const [text, value] of [['3 câmeras', 3], ['2 instalações', 2], ['amanhã às 14', 14], ['às 14h', 14], ['dia 12', 12], ['OS 123', 123],
    ['cliente 25', 25], ['telefone 11 99999-0000', 11], ['telefone 11 99999-0000', 99999], ['por 180', 180], ['desconto de 50', 50]]) assert.equal(kept(text, value), false, text);
});

test('regressões do sanitizador monetário: só valor dito com contexto de dinheiro chega ao banco', async () => {
  const camera = (quantity, unitPrice) => ({ kind: 'product', name: 'câmera', quantity, ...(unitPrice === undefined ? {} : { unitPrice }) });
  const install = { kind: 'service', name: 'instalação', quantity: 1 };
  const plan = async (text, input, action = 'create_quote_draft') => {
    const h = e2e({ gemini: { action, input }, rpc: { zt_assistant_plan: preview } });
    const r = await h.run({ operation: 'plan', text });
    return { r, h, sent: h.rpcs().includes('zt_assistant_plan') ? h.calls.at(-1).args.p_input : undefined };
  };
  // 1. "3 câmeras": quantidade fica, preço 3 inventado sai (catálogo ou pergunta do banco).
  let out = await plan('Faz um orçamento com 3 câmeras e instalação.', { client: 'Mauro', items: [camera(3, 3), install] });
  assert.deepEqual(out.sent.items, [camera(3), install]);
  // 2. "por 180 reais": quantidade 3 e preço 180 ficam.
  out = await plan('Faz um orçamento com 3 câmeras por 180 reais.', { client: 'Mauro', items: [camera(3, 180)] });
  assert.deepEqual(out.sent.items, [camera(3, 180)]);
  // 3. "às 14h": horário não vira preço.
  out = await plan('Faz um orçamento com 2 câmeras às 14h.', { client: 'Mauro', items: [camera(2, 14)] });
  assert.deepEqual(out.sent.items, [camera(2)]);
  // 6 e 7. Receita: "450 reais" vale; "dia 12" não vira valor e o Assistente pergunta.
  out = await plan('Lança uma receita de 450 reais', { description: 'Receita', amount: 450, dueDate: '2026-10-11', paid: false }, 'create_financial_entry');
  assert.equal(out.sent.amount, 450);
  out = await plan('Lança uma receita do dia 12', { description: 'Receita', amount: 12, dueDate: '2026-10-12', paid: false }, 'create_financial_entry');
  assert.deepEqual(out.r.body, { question: entryAmountQuestion('Receita') });
  assert.equal(out.sent, undefined);

  // 4 e 5. Revisão da prévia: valor já informado continua valendo; o número da troca não vira preço.
  const context = { action: 'create_quote_draft', input: { client: 'Mauro Silva', items: [{ kind: 'product', name: 'Câmera Wi-Fi Intelbras', quantity: 2, unit: 'unidade', unitPrice: 180 }] } };
  const revise = async (text, input) => {
    const h = e2e({ gemini: { action: 'create_quote_draft', input }, rpc: { zt_assistant_plan_context: context, zt_assistant_revise: preview } });
    await h.run({ operation: 'plan', contextRequestId: previousId, text });
    assert.equal(h.calls.at(-1).name, 'zt_assistant_revise');
    return h.calls.at(-1).args.p_input;
  };
  const item = (quantity, unitPrice) => ({ ...context.input.items[0], quantity, ...(unitPrice === undefined ? {} : { unitPrice }) });
  const withoutPrice = ({ unitPrice, ...rest }) => rest;
  assert.equal((await revise('Desconto de 50 reais.', { client: 'Mauro Silva', items: [item(2, 180)], discount: 50 })).discount, 50);
  assert.deepEqual((await revise('troca para três câmeras', { client: 'Mauro Silva', items: [item(3, 180)] })).items, [item(3, 180)]);
  assert.deepEqual((await revise('troca para 3 câmeras', { client: 'Mauro Silva', items: [item(3, 3)] })).items, [withoutPrice(item(3))]);
});

test('isolamento entre empresas continua antes de qualquer custo: sem vínculo ou negado pelo banco, nada é preparado', async () => {
  const outsider = e2e({ member: false });
  const r = await outsider.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação.' });
  assert.equal(r.status, 403); assert.equal(outsider.provider.length, 0); assert.equal(outsider.rpcs().length, 0);
  const denied = e2e({ rpc: { zt_assistant_plan: { error: 'Não foi possível preparar a ação. Verifique os dados e o acesso.', code: 'ACCESS_DENIED' } } });
  const d = await denied.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação.' });
  assert.equal(d.status, 403); assert.equal(denied.rpcs().includes('zt_assistant_execute'), false);
  const tech = e2e({ role: 'technician' });
  assert.equal((await tech.run({ operation: 'plan', text: 'Faz um orçamento pro Mauro com duas câmeras e instalação.' })).status, 403);
  assert.equal(tech.rpcs().includes('zt_assistant_plan'), false);
});
