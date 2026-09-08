import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('wave 5 team UI remains owner-facing and stacks its page header on narrow mobile',()=>{
  const legacy=read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy,/MOBILE HOMOLOGATION · team\/finance · wave 5/);
  assert.match(legacy,/min-\[390px\]:flex-row min-\[390px\]:items-start min-\[390px\]:justify-between/);
  assert.match(legacy,/function Equipe\(/);
  assert.match(legacy,/Adicionar colaborador/);
  assert.match(legacy,/convite === "pendente"/);
  assert.match(legacy,/Desativar/);
  assert.match(legacy,/Reativar/);
  const permissions=legacy.slice(legacy.indexOf('const PERMISSOES'),legacy.indexOf('const pode'));
  assert.match(permissions,/proprietario:[\s\S]*"financeiro"[\s\S]*"equipe"/);
  assert.match(permissions,/tecnico:[^\n]*"ordens"[^\n]*"registrarMateriais"[^\n]*"vendaCampo"/);
  assert.doesNotMatch(permissions,/tecnico:[^\n]*"financeiro"/);
  assert.doesNotMatch(permissions,/tecnico:[^\n]*"equipe"/);
});

test('wave 5 finance keeps amounts and movements readable instead of truncating at 320-390px',()=>{
  const finance=read('src/screens/v2/FinanceV2.jsx');
  assert.match(finance,/MOBILE HOMOLOGATION · finance · wave 5/);
  assert.match(finance,/break-words text-lg font-bold min-\[390px\]:text-xl/);
  assert.equal((finance.match(/grid grid-cols-1 gap-3 min-\[390px\]:grid-cols-2 lg:grid-cols-4/g)||[]).length,2);
  assert.match(finance,/sm:grid-cols-3/);
  assert.match(finance,/grid-cols-\[auto_minmax\(0,1fr\)\]/);
  assert.match(finance,/col-span-2 justify-self-end/);
  assert.doesNotMatch(finance,/mt-1 truncate text-xl font-bold/);
});

test('V2 finance route is owner-gated and private finance loader requests no public technician projection',()=>{
  const app=read('src/App.jsx');
  assert.match(app,/workspaceV2 === "financeiro" && owner/);
  const api=read('src/lib/financeV2Api.js');
  assert.match(api,/from\('financial_entries'\)/);
  assert.match(api,/work_order_item_costs/);
  assert.match(api,/work_order_material_costs/);
  assert.match(api,/work_order_private_costs/);
});

test('database keeps finance and cost ledgers owner-only',()=>{
  const foundation=read('supabase/0001_parts/part002.txt');
  assert.match(foundation,/array\['quotes','quote_items','purchases','purchase_items','financial_entries'\]/);
  assert.match(foundation,/create policy p_%1\$s_owner[\s\S]*public\.zt_is_owner\(company_id\)/);
  const costs=read('supabase/0053_v2_security_cost_isolation.sql');
  assert.match(costs,/p_work_order_item_costs_owner_select[\s\S]*zt_is_owner\(company_id\)/);
  assert.match(costs,/p_work_order_material_costs_owner_select[\s\S]*zt_is_owner\(company_id\)/);
  assert.match(costs,/Custo interno não pode ser gravado diretamente na OS/);
});

test('team roster and member editing stay owner-authoritative while disabled users lose active membership',()=>{
  const roster=read('supabase/0018_restrict_team_roster_visibility.sql');
  assert.match(roster,/user_id = auth\.uid\(\)/);
  assert.match(roster,/zt_is_owner\(company_id\)/);
  const update=read('supabase/0005_owner_update_team_member.sql');
  assert.match(update,/Somente o proprietário pode editar a equipe/);
  assert.match(update,/role = 'technician'/);
  const base=read('supabase/0001_parts/part000.txt');
  assert.match(base,/m\.status = 'active'/);
  const session=read('src/lib/useSessao.js');
  assert.match(session,/\.eq\("status", "active"\)/);
  assert.match(session,/Seu acesso ativo a esta empresa não está mais disponível/);
});

test('F11 confirmed-email authority remains unchanged in wave 5',()=>{
  const f11=read('supabase/0080_require_confirmed_email_for_invite_acceptance.sql');
  assert.match(f11,/auth\.uid\(\)/);
  assert.match(f11,/email_confirmed_at/);
  assert.match(f11,/zt_accept_invites/);
  const regression=read('supabase/tests/v2_f11_invite_confirmed_email_rollback.sql');
  assert.match(regression,/technician/);
});
