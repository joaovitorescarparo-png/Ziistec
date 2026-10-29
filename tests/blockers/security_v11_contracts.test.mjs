import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdjustmentRequestKeeper } from '../../src/lib/stockAdjustment.js';

// Segurança V1.1 — SEC-03 (fornecedor por empresa), SEC-04 (estoque idempotente no frontend e nos contratos SQL)
// e a fiação dos testes novos. O comportamento do banco é provado pelos testes SQL (gate sql-rls); aqui ficam os
// contratos que não dependem do banco: frontend, texto das migrations e registro no gate.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const stripSqlComments = (sql) => sql.replace(/--.*$/gm, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// ───────────────────────── SEC-04 · frontend ─────────────────────────

test('o id do ajuste nasce uma vez por operação e sobrevive a retry, duplo clique e timeout', () => {
  const keeper = createAdjustmentRequestKeeper();
  const first = keeper.idFor('produto-1', 10);
  assert.match(first, UUID);
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(keeper.idFor('produto-1', 10), first, 'nova tentativa da mesma operação');
  assert.equal(keeper.idFor('produto-1', '10'), first, 'a quantidade chega como texto ou número');
});

test('outro produto ou outra quantidade é outra operação e ganha outro id; concluído libera o id', () => {
  let counter = 0;
  const keeper = createAdjustmentRequestKeeper(() => `id-${++counter}`);
  const a = keeper.idFor('p1', 10);
  assert.notEqual(keeper.idFor('p1', -3), a);
  assert.notEqual(keeper.idFor('p2', -3), keeper.idFor('p1', -3));
  const b = keeper.idFor('p2', 5);
  assert.equal(keeper.idFor('p2', 5), b);
  keeper.done();
  assert.notEqual(keeper.idFor('p2', 5), b, 'depois de concluir, o mesmo ajuste é um pedido novo');
});

// v2Api.js importa './supabase' (resolvido só pelo Vite): carregado de verdade, com o cliente trocado por um simulado.
async function loadV2Api(rpc) {
  const source = read('src/lib/v2Api.js').split("import { supabase } from './supabase';").join('const supabase = globalThis.__ztSupabase;');
  assert.ok(source.includes('globalThis.__ztSupabase'));
  globalThis.__ztSupabase = { rpc };
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Math.random()}`);
}

test('ajustarEstoqueDB sempre envia p_request e recusa chamada sem id', async () => {
  const calls = [];
  const { ajustarEstoqueDB } = await loadV2Api(async (name, args) => { calls.push({ name, args }); return { data: '10.000', error: null }; });
  const id = '30000000-0000-4000-8000-000000000003';
  assert.equal(await ajustarEstoqueDB('c1', 'p1', '10', 'Entrada', id), 10);
  assert.deepEqual(calls, [{ name: 'zt_adjust_product_stock', args: { p_company: 'c1', p_product: 'p1', p_delta: 10, p_notes: 'Entrada', p_request: id } }]);
  calls.length = 0;
  await assert.rejects(ajustarEstoqueDB('c1', 'p1', 10, 'x'), /Identificador do ajuste/);
  await assert.rejects(ajustarEstoqueDB('c1', 'p1', 10, 'x', ''), /Identificador do ajuste/);
  assert.deepEqual(calls, [], 'sem id nada vai ao banco');
});

test('retry repete o MESMO p_request: o banco devolve o saldo do primeiro ajuste', async () => {
  const seen = [];
  const { ajustarEstoqueDB } = await loadV2Api(async (name, args) => {
    seen.push(args.p_request);
    return seen.length === 1 ? { data: null, error: { code: '57014', message: 'timeout' } } : { data: '7.000', error: null };
  });
  const keeper = createAdjustmentRequestKeeper();
  await assert.rejects(ajustarEstoqueDB('c1', 'p1', -3, 'Saída', keeper.idFor('p1', -3)), (e) => e.code === '57014');
  assert.equal(await ajustarEstoqueDB('c1', 'p1', -3, 'Saída', keeper.idFor('p1', -3)), 7);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});

test('banco sem a 0109: cai para o ajuste antigo só quando a função não existe; qualquer outro erro é repassado', async () => {
  for (const code of ['PGRST202', '42883']) {
    const calls = [];
    const { ajustarEstoqueDB } = await loadV2Api(async (name, args) => {
      calls.push(args);
      return 'p_request' in args ? { data: null, error: { code, message: 'Could not find the function' } } : { data: '12', error: null };
    });
    assert.equal(await ajustarEstoqueDB('c1', 'p1', 2, null, '30000000-0000-4000-8000-000000000003'), 12, code);
    assert.deepEqual(calls.map((args) => 'p_request' in args), [true, false]);
  }
  for (const code of ['23505', '23514', '42501', 'P0002', '22023']) {
    const calls = [];
    const { ajustarEstoqueDB } = await loadV2Api(async (name, args) => { calls.push(args); return { data: null, error: { code, message: 'recusado' } }; });
    await assert.rejects(ajustarEstoqueDB('c1', 'p1', 2, null, '30000000-0000-4000-8000-000000000003'), (e) => e.code === code, code);
    assert.equal(calls.length, 1, `${code} não pode cair no ajuste antigo`);
  }
});

test('a tela de estoque usa o id estável nos dois ajustes e só libera o id depois de concluir', () => {
  const screen = read('src/screens/v2/ProductStockV2.jsx');
  assert.match(screen, /import \{ createAdjustmentRequestKeeper \} from '\.\.\/\.\.\/lib\/stockAdjustment';/);
  assert.match(screen, /const adjustKeeper = useRef\(createAdjustmentRequestKeeper\(\)\);/);
  const calls = [...screen.matchAll(/await ajustarEstoqueDB\(([^\n]*)\n\s*adjustKeeper\.current\.done\(\);/g)];
  assert.equal(calls.length, 2, 'estoque inicial e entrada/saída manual');
  for (const [, args] of calls) assert.match(args, /adjustKeeper\.current\.idFor\(/);
  assert.equal([...screen.matchAll(/ajustarEstoqueDB\(/g)].length, 2, 'só as duas chamadas, nenhuma sem id');
  assert.equal(/randomUUID/.test(screen), false, 'o id não é gerado a cada clique');
});

// ───────────────────────── SEC-03 / SEC-04 / SEC-05 · migrations ─────────────────────────

const migration = (name) => read(`supabase/${name}`);

test('as migrations 0108–0110 existem, são sequenciais e não reutilizam número', () => {
  const files = readdirSync(path.join(root, 'supabase')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const numbers = files.map((f) => f.slice(0, 4));
  for (const n of ['0108', '0109', '0110']) assert.equal(numbers.filter((x) => x === n).length, 1, `número ${n} único`);
  assert.deepEqual(files.filter((f) => /^01(0[8-9]|1\d)/.test(f)), ['0108_supplier_tenant_foreign_keys.sql', '0109_stock_adjustment_idempotency.sql', '0110_team_invite_email_throttle.sql', '0111_field_execution_intelligence.sql', '0112_company_member_identity_guard.sql']);
});

test('0108: FK composta por empresa, falha fechada e nenhuma mudança de dados', () => {
  const raw = migration('0108_supplier_tenant_foreign_keys.sql');
  const sql = stripSqlComments(raw);
  assert.match(sql, /foreign key \(supplier_id, company_id\)\s+references public\.suppliers \(id, company_id\)\s+on delete set null \(supplier_id\)/i);
  assert.equal([...sql.matchAll(/add constraint \w+\s+foreign key \(supplier_id, company_id\)/gi)].length, 2, 'produtos e compras');
  assert.match(sql, /unique \(id, company_id\)/i);
  assert.match(sql, /SEC03_CROSS_TENANT_SUPPLIER_REFERENCES/);
  assert.match(sql, /errcode = '23503'/);
  assert.match(sql, /drop constraint if exists products_supplier_id_fkey/);
  assert.match(sql, /drop constraint if exists purchases_supplier_id_fkey/);
  // Nunca corrige nem apaga dados: nada de UPDATE/DELETE/INSERT/TRUNCATE e nenhum NOT VALID (a tabela inteira é validada).
  assert.equal(/\b(update|delete\s+from|insert\s+into|truncate)\b/i.test(sql), false);
  assert.equal(/not valid/i.test(sql), false);
  // O teste SQL (gate sql-rls) executa uma cópia literal do guarda contra um vínculo cruzado semeado: as duas precisam ser iguais.
  const start = raw.indexOf('do $$\ndeclare\n  v_products integer;');
  const guard = raw.slice(start, raw.indexOf('end $$;', start) + 'end $$;'.length).split('$$').join('$g$');
  assert.ok(start >= 0 && guard.includes('SEC03_CROSS_TENANT_SUPPLIER_REFERENCES'));
  assert.ok(read('supabase/tests/v2_security_v11_supplier_tenant_fk_rollback.sql').includes(`$run$${guard}$run$`), 'o guarda testado no SQL é o da migration');
  // A orientação de tratamento do ambiente que falhar está na própria migration.
  assert.match(raw, /select 'products' t, p\.id, p\.company_id, p\.supplier_id, s\.company_id as supplier_company/);
  assert.match(raw, /NUNCA corrige ou apaga dados/);
});

test('0109: overload idempotente com trava de linha; o antigo perde o EXECUTE do navegador', () => {
  const sql = stripSqlComments(migration('0109_stock_adjustment_idempotency.sql'));
  assert.match(sql, /add column if not exists client_request_id uuid/i);
  assert.match(sql, /create unique index if not exists uq_inventory_movements_client_request\s+on public\.inventory_movements\(company_id, client_request_id\)\s+where client_request_id is not null/i);
  const body = sql.slice(sql.indexOf('$$'), sql.lastIndexOf('$$'));
  assert.match(sql, /security definer\s+set search_path = ''/i);
  assert.equal(/\bexecute\b/i.test(body), false, 'sem SQL dinâmico no corpo (invariante de inventário dos definers)');
  assert.match(body, /for update/i);
  assert.ok(body.indexOf('for update') < body.lastIndexOf('client_request_id = p_request'), 'o pedido é conferido de novo depois da trava da linha');
  assert.match(body, /errcode = '23505'/);
  assert.match(sql, /revoke all on function public\.zt_adjust_product_stock\(uuid, uuid, numeric, text\) from public, anon, authenticated, service_role/i);
  assert.match(sql, /grant execute on function public\.zt_adjust_product_stock\(uuid, uuid, numeric, text, uuid\) to authenticated, service_role/i);
  assert.equal(/default/i.test(sql.slice(sql.indexOf('create or replace function'), sql.indexOf('returns numeric'))), false, 'sem default: o PostgREST não pode confundir os overloads');
});

test('0110: registro fechado ao navegador, lock por empresa, hash do e-mail e função só para authenticated', () => {
  const sql = stripSqlComments(migration('0110_team_invite_email_throttle.sql'));
  assert.match(sql, /alter table public\.team_invite_email_sends enable row level security/i);
  assert.match(sql, /revoke all on table public\.team_invite_email_sends from public, anon, authenticated/i);
  assert.equal(/create policy/i.test(sql), false, 'sem policy: só a função definer lê e grava');
  assert.equal(/references public\.company_invites/i.test(sql), false, 'apagar o convite não pode apagar o histórico de envios');
  assert.match(sql, /sha256\(convert_to\(lower\(btrim\(v_email\)\), 'utf8'\)\)/);
  assert.equal(/\bemail\s+text\b/i.test(sql), false, 'o registro não guarda o e-mail em texto');
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('zt_invite_email:' \|\| v_company::text, 0\)\)/);
  assert.match(sql, /security definer\s+set search_path = ''/i);
  const body = sql.slice(sql.indexOf('as $$'), sql.lastIndexOf('$$;'));
  assert.equal(/\bexecute\b/i.test(body), false);
  assert.match(sql, /revoke all on function public\.zt_claim_team_invite_email\(uuid\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.zt_claim_team_invite_email\(uuid\) to authenticated;/i);
  assert.match(sql, /c_cooldown constant interval := interval '60 seconds'/);
  assert.match(sql, /c_per_recipient constant integer := 5/);
  assert.match(sql, /c_per_company constant integer := 30/);
});

test('a função team-invite-email só envia depois da reserva e usa o neutralizador nos dois campos de texto', () => {
  const source = read('supabase/functions/team-invite-email/index.ts');
  const claim = source.indexOf('zt_claim_team_invite_email');
  const admin = source.indexOf('createClient(supabaseUrl, serviceRoleKey');
  const mail = source.indexOf('inviteUserByEmail');
  assert.ok(claim > 0 && claim < admin && admin < mail, 'reserva → cliente administrativo → e-mail');
  assert.match(source, /invitee_name: inertText\(invite\.name, 120\)/);
  assert.match(source, /company_name: companyName/);
  assert.match(source, /const companyName = inertText\(company\.trade_name \|\| company\.name, 160\) \|\| "Sua empresa";/);
  assert.equal(/invitee_name: invite\.name/.test(source), false, 'nenhum campo livre entra sem neutralização');
});

// ───────────────────────── fiação no gate ─────────────────────────

test('os testes SQL e de concorrência novos estão no runner do CI e os scripts existem com LF', () => {
  const runner = read('scripts/run-sql-rls-ci.sh');
  for (const file of ['v2_security_v11_supplier_tenant_fk_rollback.sql', 'v2_security_v11_stock_idempotency_rollback.sql', 'v2_security_v11_invite_email_throttle_rollback.sql']) {
    assert.ok(runner.includes(`supabase/tests/${file}`), file);
    assert.match(read(`supabase/tests/${file}`), /\nrollback;\s*$/, `${file} termina em ROLLBACK`);
  }
  for (const script of ['test-stock-adjustment-concurrency.sh', 'test-invite-email-throttle-concurrency.sh']) {
    assert.ok(runner.includes(`scripts/${script}`), script);
    assert.ok(existsSync(path.join(root, 'scripts', script)));
    assert.equal(readFileSync(path.join(root, 'scripts', script), 'utf8').includes('\r'), false, `${script} com LF`);
  }
  const verify = JSON.parse(read('package.json')).scripts['verify:v2'];
  for (const file of ['security_v11_invite_email.test.mjs', 'security_v11_contracts.test.mjs', 'repo_line_endings.test.mjs']) assert.ok(verify.includes(`tests/blockers/${file}`), file);
});

test('o inventário de SECURITY DEFINER do gate acompanha as duas funções novas', () => {
  const audit = read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql');
  assert.match(audit, /0109 adds one public definer[\s\S]*-- 0110 adds one public definer[\s\S]*if v_total<>149 then/);
  const doc = read('docs/engineering/SECURITY_DEFINER_AUDIT.md');
  assert.match(doc, /`zt_adjust_product_stock\(p_company uuid, p_product uuid, p_delta numeric, p_notes text, p_request uuid\)` \| 0109/);
  assert.match(doc, /`zt_claim_team_invite_email\(p_invite uuid\)` \| 0110/);
});
