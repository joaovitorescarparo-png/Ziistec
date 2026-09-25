import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createAssistantHandler } from '../../api/assistant.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const sql = read('supabase/0092_assistant_actions.sql');
const companyId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000002';
const requestId = '30000000-0000-4000-8000-000000000003';
const previewHash = 'a'.repeat(64);
const receipt = { requestId, previewHash, previewVersion: 1, confirmationRequired: true };

function apiHarness(rpcResult = { result: { message: 'Ação concluída.' } }) {
  const calls = [];
  const handler = createAssistantHandler({ env: {},
    resolveConfig: () => ({ configurado: true, url: 'https://example.invalid', publishableKey: 'test-placeholder' }),
    fetchImpl: async (url, options) => {
      calls.push({ url, args: options.body && JSON.parse(options.body) });
      return { ok: true, json: async () => url.endsWith('/auth/v1/user') ? { id: userId } :
        url.includes('/company_members?') ? [{ role: 'owner' }] : rpcResult };
    },
  });
  return { calls, async run(body) {
    let status, result;
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-placeholder' }, body },
      { setHeader() {}, status(value) { status = value; return this; }, json(value) { result = value; } });
    return { status, result };
  } };
}

test('API rejects execute without a receipt, malformed hashes and mutable confirmation arguments', async () => {
  const h = apiHarness();
  for (const extra of [{}, { previewHash: true }, { previewHash: 'x'.repeat(64) }, { previewHash, input: {} }, { previewHash, action: 'create_client' }]) {
    assert.equal((await h.run({ operation: 'execute', companyId, requestId, ...extra })).status, 400);
  }
  assert.equal(h.calls.some(c => c.url.includes('/rpc/')), false);
});

test('API forwards the exact preview receipt on execute and repeated requests', async () => {
  const h = apiHarness();
  const payload = { operation: 'execute', companyId, requestId, previewHash };
  assert.equal((await h.run(payload)).status, 200);
  assert.equal((await h.run(payload)).status, 200);
  const calls = h.calls.filter(c => c.url.endsWith('/zt_assistant_execute'));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, { p_company: companyId, p_request_id: requestId, p_preview_hash: previewHash });
  assert.deepEqual(calls[0].args, calls[1].args);
});

test('API preserves access-denied and request-conflict statuses from sanitized SQL results', async () => {
  for (const [code, status] of [['ACCESS_DENIED', 403], ['REQUEST_CONFLICT', 409], ['PLAN_EXPIRED', 422]]) {
    const h = apiHarness({ error: 'Mensagem sanitizada', code });
    assert.equal((await h.run({ operation: 'execute', companyId, requestId, previewHash })).status, status);
  }
});

function transportHarness() {
  let actor = userId, result = receipt, fail = false;
  const calls = [], module = { exports: {} };
  vm.runInNewContext(transformSync(read('src/lib/assistantApi.js'), { format: 'cjs' }).code, {
    module, exports: module.exports,
    require: () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-placeholder', user: { id: actor } } } }) } } }),
    fetch: async (_, options) => {
      calls.push(JSON.parse(options.body));
      if (fail) throw new Error('Network interrupted');
      return { ok: true, json: async () => result };
    },
  });
  return { calls, request: module.exports.requestAssistant,
    setActor(value) { actor = value; }, setResult(value) { result = value; }, setFail(value) { fail = value; } };
}

test('transport never executes while receiving preview, binds receipt to actor/company/request and retains retries', async () => {
  const h = transportHarness();
  const execute = { operation: 'execute', companyId, requestId };
  await assert.rejects(h.request(execute), /revise novamente/);
  assert.equal(h.calls.length, 0);
  await h.request({ operation: 'preview', companyId, requestId, action: 'create_client', input: { name: 'Teste' } });
  assert.deepEqual(h.calls.map(c => c.operation), ['preview']);
  await assert.rejects(h.request({ ...execute, companyId: userId }), /revise novamente/);
  await assert.rejects(h.request({ ...execute, requestId: userId }), /revise novamente/);
  h.setActor(requestId);
  await assert.rejects(h.request(execute), /revise novamente/);
  h.setActor(userId); h.setFail(true);
  await assert.rejects(h.request(execute), /Network interrupted/);
  h.setFail(false); h.setResult({ result: { message: 'Ação concluída.' } });
  await h.request(execute);
  assert.deepEqual(h.calls[1], h.calls[2]);
  assert.equal(h.calls[2].previewHash, previewHash);
});

test('transport rejects mismatched request, unknown preview version and missing hash', async () => {
  for (const result of [{ ...receipt, requestId: userId }, { ...receipt, previewVersion: 2 }, { ...receipt, previewHash: undefined }]) {
    const h = transportHarness(); h.setResult(result);
    await assert.rejects(h.request({ operation: 'preview', companyId, requestId }), /sem confirmação verificável/);
    await assert.rejects(h.request({ operation: 'execute', companyId, requestId }), /revise novamente/);
    assert.equal(h.calls.length, 1);
  }
});

// These are static regression guards, NOT execution/compilation of PostgreSQL.
// Concurrency, RLS, transaction rollback and cron need a disposable database.
const functionBody = name => {
  const start = sql.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return sql.slice(start, sql.indexOf('end $$;', start) + 7);
};
test('SQL static: CASE inside validator IF cannot terminate its condition at the inner THEN', () => {
  // PL/pgSQL reads IF up to the first THEN outside parentheses (read_sql_construct).
  // This guards the exact CI compilation failure; it is not a PostgreSQL parser.
  const validate = functionBody('zt_private.assistant_validate');
  assert.match(validate, /or v_num>\(case when k='quantity' then 10000 when k='amount' then 999999999\.99 else 999999\.99 end\)/);
});
test('SQL static: quantity is checked and normalized before preview/input digest', () => {
  const validate = functionBody('zt_private.assistant_validate');
  assert.match(validate, /security invoker/);
  assert.match(validate, /k='quantity' and v_num<>round\(v_num,3\)/);
  assert.match(validate, /to_jsonb\(v_num::numeric\(12,3\)\)/);
  const plan = functionBody('public.zt_assistant_plan');
  assert.ok(plan.indexOf('v_input:=zt_private.assistant_validate') < plan.indexOf("p_action||':'||v_input::text"));
});
test('SQL static: shared quota locks before counts; assistant delegates to the same authority', () => {
  const quota = functionBody('zt_private.zt_consume_ai_quota');
  assert.ok(quota.indexOf('do update set revision=') < quota.indexOf('select count(*)'));
  assert.match(quota, /v_count>=10\b/);
  assert.match(quota, /v_count>=100\b/);
  assert.match(quota, /interval '1 minute'/);
  assert.match(quota, /interval '24 hours'/);
  assert.match(functionBody('public.zt_assistant_consume_ai_quota'), /return public.zt_consume_ai_quota\(p_company\)/);
});
test('SQL static: canonical creation keys are private; preview receipt precedes every mutation/replay', () => {
  const execute = functionBody('public.zt_assistant_execute');
  assert.match(sql, /operation_id uuid not null default gen_random_uuid\(\) unique/);
  assert.doesNotMatch(execute, /zt_save_\w+\(p_company,null,p_request_id/);
  for (const name of ['quote_idempotent', 'work_order_idempotent', 'manual_financial_entry']) {
    assert.match(execute, new RegExp(`zt_save_${name}\\(p_company,null,p.operation_id`));
  }
  assert.ok(execute.indexOf('p_preview_hash<>p.preview_hash') < execute.indexOf("p.state in ('succeeded','failed')"));
  assert.ok(execute.indexOf('confirmed_at=clock_timestamp()') < execute.indexOf('case p.action'));
  assert.match(sql, /grant execute on function public.zt_assistant_execute\(uuid,uuid,text\)/);
});
test('SQL static: scheduler is optional, absent cron has no executable reference or extension installation', () => {
  const scheduler = sql.match(/do \$assistant_scheduler\$([\s\S]*?)\$assistant_scheduler\$;/)?.[1];
  assert.ok(scheduler);
  assert.match(scheduler, /if to_regprocedure\('cron.schedule\(text,text,text\)'\) is not null then/);
  assert.match(scheduler, /execute 'select cron.schedule\(\$1,\$2,\$3\)'/);
  assert.match(scheduler, /using 'ziistec-assistant-plan-retention','\* \* \* \* \*','select zt_private.assistant_purge_plans\(\)'/);
  assert.match(scheduler, /exception when insufficient_privilege then\s+raise notice/);
  const absent = scheduler.slice(scheduler.lastIndexOf('else'));
  assert.match(absent, /raise notice 'Assistant automatic cleanup not configured: pg_cron unavailable/);
  assert.doesNotMatch(absent, /execute|perform|raise exception/i);
  assert.doesNotMatch(sql, /0092 requires pg_cron|create extension|^select cron.schedule/im);
});
test('SQL static: cleanup retains restricted ACL and expiry rejects pending execution before business writes', () => {
  assert.match(sql, /create function zt_private.assistant_purge_plans\(\)\s+returns void language sql security definer set search_path=''/);
  assert.match(sql, /revoke all on function zt_private.assistant_purge_plans\(\) from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql, /grant[^;]*assistant_purge_plans/i);
  assert.match(sql, /retain_until timestamptz not null default now\(\)\+interval '30 minutes'/);
  assert.match(sql, /update zt_private.assistant_plans set input=null,preview=null,\s+state=case when state='pending' then 'expired' else state end/);
  const execute = functionBody('public.zt_assistant_execute');
  const expiry = execute.indexOf("if p.state='expired' or p.expires_at<=clock_timestamp()");
  assert.ok(expiry >= 0 && expiry < execute.indexOf('case p.action'));
  assert.match(execute.slice(expiry, execute.indexOf('case p.action')), /return jsonb_build_object\('error',[^;]*'PLAN_EXPIRED'\);/);
});
test('SQL static: expiry checks, sanitized audit and denied fallback remain present', () => {
  assert.match(sql, /retain_until<=clock_timestamp\(\)/);
  assert.match(sql, /p.expires_at<=clock_timestamp\(\)/);
  assert.match(sql, /assistant_audit\(p_company,p_request_id,'denied',zt_private.assistant_error_code\(sqlstate\),p_action,v_hash\)/);
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /sqlerrm/i);
  for (const field of ['input_hash', 'preview_hash', 'preview_version', 'confirmed_at', 'confirmed_by', 'error_code', 'status']) {
    assert.match(sql.slice(0, sql.indexOf('alter table public.assistant_action_audit')), new RegExp(`\\b${field}\\b`));
  }
});
