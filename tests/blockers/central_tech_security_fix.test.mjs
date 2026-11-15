import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Central Técnica V1 — security fix antes da primeira aplicação de 0113–0115 no H0.
// Contratos estáticos (rodam no verify:v2, sem banco). A prova de comportamento está nos testes SQL do gate
// SQL/RLS: v2_central_tecnica_rls_rollback.sql e v2_central_tecnica_golden_path_rollback.sql.
//   P1  caso técnico não propaga texto bruto da OS (publicação curada pelo owner);
//   P1  company_id de categoria/fabricante/modelo/documento/ficha é imutável; a busca não confia só no ID da FK;
//   P2  is_official é da plataforma (service_role / platform admin AAL2) e só em documento global.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const m0113 = read('supabase/0113_central_tecnica_foundation.sql');
const m0114 = read('supabase/0114_central_tecnica_search.sql');
const m0115 = read('supabase/0115_central_tecnica_os_and_cases.sql');
const stripComments = (sql) => sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');

// Corpo de uma função `create or replace function <name>(...) ... as $$ <body> $$;`, sem comentários.
const fnBody = (sql, name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, `${name} precisa existir`);
  const open = sql.indexOf('as $$', start);
  const close = sql.indexOf('$$;', open + 5);
  assert.ok(open > start && close > open, `${name}: corpo delimitado por $$`);
  return { header: sql.slice(start, open), body: stripComments(sql.slice(open + 5, close)).toLowerCase() };
};

test('P1 casos: a consulta só seleciona colunas case_* e nunca texto bruto da OS', () => {
  const { header, body } = fnBody(m0115, 'public.zt_equipment_cases');
  const returns = header.slice(header.indexOf('returns table'), header.indexOf('language')).replace(/\s+/g, ' ').trim();
  assert.equal(returns, 'returns table ( case_id uuid, published_on date, completed_on date, symptom text, cause text, solution text, learning text, difficulty text, unit_identified boolean )');
  for (const col of ['b.case_public_id', 'b.case_symptom', 'b.case_cause', 'b.case_solution', 'b.case_learning']) {
    assert.ok(body.includes(col), `a consulta lê ${col}`);
  }
  assert.ok(body.includes('b.case_published_at is not null'), 'só caso publicado');
  assert.ok(body.includes("public.zt_is_member(p_company)"), 'membresia conferida pela sessão');
  const forbidden = [
    'problem_report', '.request', '.notes', 'notes', '.number', 'wo_number', '.address', 'service_place',
    'received_by', 'attendance', 'client_id', 'clients', '.phone', '.email', 'tax_id',
    'b.cause', 'b.solution', 'b.learning', 'left(',
    'price', 'cost', 'amount', 'margin', 'total', 'payment', 'financial', 'receipt',
  ];
  for (const token of forbidden) assert.equal(body.includes(token), false, `zt_equipment_cases não pode referenciar "${token}"`);
  // De work_orders só participam id, company_id, status, deleted_at e completed_at.
  const woColumns = [...body.matchAll(/\bw\.([a-z_]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(woColumns)].sort(), ['company_id', 'completed_at', 'deleted_at', 'id', 'status']);

  const count = fnBody(m0115, 'public.zt_equipment_cases_count').body;
  assert.ok(count.includes('b.case_published_at is not null'), 'a contagem só conta caso publicado');
  for (const token of ['b.cause', 'b.solution', 'b.learning', 'problem_report', 'notes']) assert.equal(count.includes(token), false);
});

test('P1 casos: publicar é ato explícito do owner, por RPC, sem copiar a Base Técnica', () => {
  const { header, body } = fnBody(m0115, 'public.zt_publish_work_order_technical_case');
  assert.match(header, /security definer\s+set search_path=''/);
  assert.match(header, /p_wo uuid,\s*p_symptom text,\s*p_cause text,\s*p_solution text,\s*p_learning text,\s*p_request uuid/);
  assert.equal(/p_company/.test(header), false, 'a empresa não vem do cliente: é derivada da OS');
  assert.ok(body.includes('auth.uid()') && body.includes("errcode='28000'"), 'exige sessão');
  assert.ok(body.includes('public.zt_wo_is_owned(p_wo)') && body.includes('public.zt_is_owner(v_company)'), 'ownership conferido pela sessão');
  assert.ok(body.includes('zt_private.assert_operational_write_allowed(v_company)'), 'assinatura operacional');
  assert.ok(body.includes("v_status <> 'done'"), 'só OS concluída');
  assert.ok(body.includes('v_row.case_last_request_id = p_request') && body.includes("errcode='23505'"), 'idempotência por pedido');
  assert.ok(body.includes('case_revision=b.case_revision+1') && body.includes('case_updated_by=v_uid') && body.includes('case_published_by='), 'auditável');
  for (const token of ['v_row.cause', 'v_row.solution', 'v_row.learning', 'b.cause', 'b.solution', 'b.learning', 'problem_report', 'notes', 'w.*', 'price', 'cost', 'amount', 'financial']) {
    assert.equal(body.includes(token), false, `a publicação não pode ler "${token}"`);
  }
  for (const column of ['case_symptom=v_symptom', 'case_cause=v_cause', 'case_solution=v_solution', 'case_learning=v_learning']) {
    assert.ok(body.includes(column), `o texto publicado vem do parâmetro revisado (${column})`);
  }
  const unpublish = fnBody(m0115, 'public.zt_unpublish_work_order_technical_case');
  assert.match(unpublish.header, /security definer\s+set search_path=''/);
  assert.ok(unpublish.body.includes('public.zt_is_owner(v_company)') && unpublish.body.includes('case_published_at=null'));

  const sql = stripComments(m0115);
  for (const signature of [
    'public.zt_publish_work_order_technical_case(uuid,text,text,text,text,uuid)',
    'public.zt_unpublish_work_order_technical_case(uuid)',
    'public.zt_equipment_cases(uuid,uuid,integer,integer)',
    'public.zt_equipment_cases_count(uuid,uuid)',
  ]) {
    assert.ok(sql.includes(`revoke all on function ${signature} from public,anon;`), `${signature}: revogada de public/anon`);
    assert.ok(sql.includes(`grant execute on function ${signature} to authenticated,service_role;`), `${signature}: só authenticated/service_role`);
  }
  // Nenhuma escrita direta do navegador nas colunas de caso: a 0115 não concede INSERT/UPDATE na Base Técnica.
  assert.equal(/grant[^;]*\b(insert|update|delete|all)\b[^;]*work_order_technical_base/i.test(sql), false);
  // O estado não publicado não guarda texto de caso; o publicado tem identificador próprio.
  assert.match(sql, /constraint wo_technical_base_case_shape check \(/);
  assert.match(sql, /uq_wo_technical_base_case_public_id/);
  // Nenhum UPDATE/INSERT copia a Base Técnica para as colunas de caso.
  assert.equal(/case_(cause|solution|learning|symptom)\s*=\s*(b\.|v_row\.)?(cause|solution|learning)\b/i.test(sql), false);
});

test('P1 tenant: company_id é imutável nas cinco tabelas de conteúdo, para todos os papéis', () => {
  const { header, body } = fnBody(m0113, 'public.zt_eq_guard_company_immutable');
  assert.match(header, /security invoker\s+set search_path=''/);
  assert.ok(body.includes('new.company_id is distinct from old.company_id'));
  assert.ok(body.includes("errcode='42501'"));
  assert.equal(/current_user|service_role|zt_is_platform_admin|auth\./.test(body), false, 'sem exceção por papel: migração de escopo não é UPDATE comum');
  const block = m0113.slice(m0113.indexOf('create trigger trg_%1$s_company_immutable') - 600, m0113.indexOf('create trigger trg_%1$s_company_immutable') + 200);
  for (const table of ['equipment_categories', 'equipment_manufacturers', 'equipment_models', 'equipment_documents', 'equipment_quick_guides']) {
    assert.ok(block.includes(`'${table}'`), `${table} recebe o guard de escopo imutável`);
  }
  assert.match(block, /before update on public\.%1\$s/, 'todo UPDATE, não só "UPDATE OF company_id"');
  const sql = stripComments(m0113);
  assert.ok(sql.includes('revoke all on function public.zt_eq_guard_company_immutable() from public,anon,authenticated;'));
});

test('P1 tenant: a busca SECURITY DEFINER valida o escopo de modelo, fabricante e categoria em todo JOIN', () => {
  const { body } = fnBody(m0114, 'public.zt_equipment_search');
  const flat = body.replace(/\s+/g, ' ');
  assert.ok(flat.includes('public.zt_is_member(p_company)'));
  const manufacturerJoins = flat.split('join public.equipment_manufacturers f').slice(1);
  assert.equal(manufacturerJoins.length, 2, 'dois JOINs de fabricante (hit e projeção final)');
  for (const join of manufacturerJoins) {
    assert.ok(join.trimStart().startsWith('on f.id=m.manufacturer_id and (f.company_id is null or f.company_id=m.company_id)'), 'fabricante: global ou do mesmo escopo do modelo');
  }
  const categoryJoins = flat.split('join public.equipment_categories c').slice(1);
  assert.equal(categoryJoins.length, 1);
  assert.ok(categoryJoins[0].trimStart().startsWith('on c.id=m.category_id and (c.company_id is null or c.company_id=m.company_id)'), 'categoria: global ou do mesmo escopo do modelo');
  assert.ok(flat.includes('join public.equipment_models m on m.id=r.mid and (m.company_id is null or m.company_id=p_company)'), 'modelo: global ou da empresa da sessão, também na projeção final');
  assert.equal(/join public\.equipment_(manufacturers|categories) [fc] on [fc]\.id=m\.(manufacturer|category)_id (where|join|order)/.test(flat), false, 'nenhum JOIN só por ID');
});

test('P2 is_official: selo da plataforma, só em documento global, nunca por user_metadata', () => {
  const sql = stripComments(m0113);
  assert.ok(sql.includes('constraint equipment_documents_official_global_only check (not is_official or company_id is null)'));
  const { header, body } = fnBody(m0113, 'public.zt_eq_guard_document_official');
  assert.match(header, /security invoker\s+set search_path=''/);
  assert.ok(body.includes("current_user in ('authenticated','anon')") && body.includes('public.zt_is_platform_admin()'));
  assert.ok(body.includes('new.is_official is not distinct from old.is_official'), 'só age quando o selo é ligado/alterado');
  assert.ok(body.includes('new.is_official and new.company_id is not null'));
  assert.match(sql, /create trigger trg_equipment_documents_official\s+before insert or update on public\.equipment_documents/);
  for (const migration of [m0113, m0114, m0115]) {
    assert.equal(/user_metadata|raw_user_meta_data|app_metadata/.test(stripComments(migration)), false, 'autorização nunca por metadado do usuário');
  }
  // O navegador nunca envia is_official.
  const api = read('src/lib/centralTecnicaApi.js');
  assert.equal(/is_official\s*:/.test(api), false, 'a camada de dados não grava is_official');
  assert.equal(/is_official/.test(read('src/components/CentralTecnicaScreen.jsx')), false);
});

test('Frontend: a Central mostra só o caso publicado e a publicação parte de formulário vazio', () => {
  const api = read('src/lib/centralTecnicaApi.js');
  const fromCaso = api.slice(api.indexOf('const fromCaso'), api.indexOf('const fromPublicacao'));
  for (const field of ['wo_number', 'linked_notes', 'needs_return', 'work_order_id', 'client']) {
    assert.equal(fromCaso.includes(field), false, `fromCaso não lê ${field}`);
  }
  assert.ok(api.includes("supabase.rpc('zt_publish_work_order_technical_case'") && api.includes("supabase.rpc('zt_unpublish_work_order_technical_case'"));
  assert.equal(/p_company/.test(api.slice(api.indexOf('export async function publicarCasoTecnicoCT'), api.indexOf('export async function retirarCasoTecnicoCT'))), false, 'a publicação não envia company_id');

  const screen = read('src/components/CentralTecnicaScreen.jsx');
  for (const field of ['c.numero', 'c.obsVinculo', 'c.precisouRetorno']) assert.equal(screen.includes(field), false, `a tela de casos não mostra ${field}`);

  const panel = read('src/components/TechnicalCasePublishPanel.jsx');
  assert.ok(panel.includes("const VAZIO = { sintoma: '', causa: '', solucao: '', aprendizado: '' };"));
  assert.match(panel, /: VAZIO\);\s*setEditando\(true\);/, 'caso ainda não publicado abre o formulário vazio');
  assert.equal((panel.match(/usarRascunho/g) || []).length, 2, 'a Base Técnica só entra no formulário pelo botão explícito de rascunho');
  assert.ok(panel.includes('Usar a Base Técnica como rascunho') && panel.includes('toda a equipe'));
  assert.ok(panel.includes('real && podePublicar && concluida'), 'o painel só existe para quem gere a Central, em OS concluída');
  const app = read('src/legacy/ZiisTecApp.jsx');
  assert.ok(app.includes('podePublicar={permitido("gerirCentral")}'));
});

test('Gate: runner SQL/RLS, inventário de definers e verify:v2 cobrem o security fix', () => {
  const runner = read('scripts/run-sql-rls-ci.sh');
  assert.ok(runner.includes('supabase/tests/v2_central_tecnica_rls_rollback.sql') && runner.includes('supabase/tests/v2_central_tecnica_golden_path_rollback.sql'));
  const definers = read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql');
  assert.ok(definers.includes("if v_total<>164 then raise exception 'RC1B_DEFINER_INVENTORY_DRIFT expected=164 actual=%',v_total; end if;"));
  const definerCount = (sql) => [...stripComments(sql).matchAll(/create or replace function [\s\S]*?as \$\$/g)].filter((match) => /security definer/.test(match[0])).length;
  assert.deepEqual([definerCount(m0113), definerCount(m0114), definerCount(m0115)], [7, 1, 7], 'definers por migration: 149 + 15 = 164');

  const golden = read('supabase/tests/v2_central_tecnica_golden_path_rollback.sql');
  for (const marker of ['19h_ADVERSARIAL_nenhum_valor_sensivel_bruto_na_resposta', '19m_ADVERSARIAL_busca_pelos_valores_sensiveis_nao_devolve_nada', '17b_sem_publicacao_nao_ha_caso_para_a_equipe', '10000000-0000-0000-0000-000000000005']) {
    assert.ok(golden.includes(marker), `golden path contém ${marker}`);
  }
  const rls = read('supabase/tests/v2_central_tecnica_rls_rollback.sql');
  for (const marker of ['owner_ab_nao_move_fabricante_de_a_para_b', 'owner_ab_nao_move_categoria_de_a_para_b', 'owner_ab_nao_move_modelo_de_a_para_b', 'busca_nao_devolve_fabricante_de_outra_empresa_com_pai_corrompido', 'owner_a_nao_cria_documento_oficial', 'owner_a_nao_promove_documento_a_oficial', 'service_role_cria_documento_global_oficial', 'consulta_de_casos_nao_seleciona_texto_bruto_da_os']) {
    assert.ok(rls.includes(marker), `matriz RLS contém ${marker}`);
  }
  const verify = JSON.parse(read('package.json')).scripts['verify:v2'];
  assert.ok(verify.includes('tests/blockers/central_tech_security_fix.test.mjs'));
  // 0001–0112 não são tocadas por este fix: as três migrations continuam não renumeradas e não existe 0116.
  assert.equal(/0116/.test(runner), false);
});
