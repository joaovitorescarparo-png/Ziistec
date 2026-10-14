import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contrato local da 0098 e do runbook do beta; o comportamento real roda no CI SQL/RLS
// (supabase/tests/v2_platform_subscription_renewal_rollback.sql).
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/0098_platform_subscription_renewal.sql');
const body = migration.slice(migration.indexOf('as $$'), migration.lastIndexOf('$$;'));
const runner = read('scripts/run-sql-rls-ci.sh');
const rc1b = read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql');
const doc = read('docs/engineering/BETA_OWNER_ONBOARDING.md');
const SIGNATURE = 'public.zt_platform_renew_subscription(uuid,date,public.zt_sub_status,text)';

test('0098: renovação é SECURITY DEFINER sem search_path e checa admin com MFA antes de gravar', () => {
  assert.match(migration, /create or replace function public\.zt_platform_renew_subscription\(/);
  assert.match(migration, /security definer\s+set search_path=''/);
  const guard = body.indexOf('public.zt_is_platform_admin()');
  assert.ok(guard > 0, 'guard de admin da plataforma');
  assert.ok(guard < body.indexOf('update public.subscriptions') && guard < body.indexOf('insert into public.platform_audit_logs'), 'guard antes de qualquer escrita');
  assert.doesNotMatch(body.toLowerCase(), /\bexecute\b/, 'sem SQL dinâmico');
});

test('0098: só status, período e canceled_at mudam; auditoria com motivo; retry não grava de novo', () => {
  const update = body.slice(body.indexOf('update public.subscriptions'), body.indexOf('returning * into v_after'));
  const set = update.slice(update.indexOf(' set '), update.indexOf(' where '));
  assert.match(set, /status=p_status, current_period_start=v_start, current_period_end=p_period_end, canceled_at=null/);
  assert.doesNotMatch(set, /plan|amount|provider|company_id/, 'empresa, plano, valor e provedor intactos');
  assert.match(body, /'subscription_renewed'/);
  assert.match(body, /'reason',v_reason/);
  assert.ok(body.indexOf("'changed',false") > 0 && body.indexOf("'changed',false") < body.indexOf('update public.subscriptions'), 'mesma renovação devolve sem gravar');
});

test('0098: ACL sem PUBLIC/anon; regressão SQL no CI; inventário RC1B atualizado', () => {
  assert.ok(migration.includes(`revoke all on function ${SIGNATURE} from public, anon;`));
  assert.ok(migration.includes(`grant execute on function ${SIGNATURE} to authenticated;`));
  assert.doesNotMatch(migration, /\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i, 'nenhum grant para anon ou PUBLIC');
  assert.match(runner, /supabase\/tests\/v2_platform_subscription_renewal_rollback\.sql/);
  assert.match(rc1b, /expected=130/);
});

test('runbook do beta: domínio, Auth com redirect exato, SMTP, renovação e onboarding somente do proprietário', () => {
  for (const text of ['beta.ziistec.com', 'claude/assistant-universal-owner-v1', 'Site URL', '`https://beta.ziistec.com/`',
    'SMTP', 'zt_platform_renew_subscription', 'Confirm email', 'não convide técnicos']) {
    assert.ok(doc.includes(text), text);
  }
});
