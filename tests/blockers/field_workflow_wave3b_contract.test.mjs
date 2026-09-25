import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const migration=readFileSync('supabase/0084_field_workflow_checklists_return.sql','utf8');
const api=readFileSync('src/lib/checklistReturnV2Api.js','utf8');
const component=readFileSync('src/components/ChecklistTemplatePicker.jsx','utf8');
const legacy=readFileSync('src/legacy/ZiisTecApp.jsx','utf8');
const runtime=readFileSync('src/lib/runtimeApi.js','utf8');

test('Wave 3B reuses work_order_checklists and adds owner-only templates',()=>{
  assert.match(migration,/alter table public\.work_order_checklists[\s\S]*required boolean/i);
  assert.match(migration,/create table if not exists public\.checklist_templates/i);
  assert.match(migration,/Somente o proprietário administra templates/i);
  assert.doesNotMatch(migration,/create table if not exists public\.work_order_checklists/i);
});

test('template application is a snapshot and idempotent per OS',()=>{
  assert.match(migration,/source_template_id/i);
  assert.match(migration,/if exists\([\s\S]*source_template_id=p_template[\s\S]*return v_count/i);
  assert.match(migration,/insert into public\.work_order_checklists/i);
  assert.match(api,/zt_apply_checklist_template/);
});

test('required checklist is enforced by backend done transition',()=>{
  assert.match(migration,/zt_wave3b_before_work_order_done/);
  assert.match(migration,/c\.required and not c\.done/);
  assert.match(migration,/before update of status on public\.work_orders/i);
});

test('needs-return path does not call definitive finalization',()=>{
  assert.match(migration,/create table if not exists public\.work_order_returns/i);
  assert.match(migration,/zt_mark_work_order_needs_return/i);
  assert.doesNotMatch(migration.match(/create or replace function public\.zt_mark_work_order_needs_return[\s\S]*?\n\$\$;/i)?.[0]||'',/financial_entries|insert into public\.warranties|service_report/i);
  assert.match(legacy,/Salvar retorno sem concluir/);
  assert.match(legacy,/if\(extras\.precisaRetornar\)[\s\S]*marcarRetornoOSV2DB/);
});

test('return captures reason, material, priority and forecast with mobile-safe controls',()=>{
  assert.match(legacy,/Motivo do retorno/);
  assert.match(legacy,/Material necessário/);
  assert.match(legacy,/retornoPrioridade/);
  assert.match(legacy,/Previsão de retorno/);
  assert.match(legacy,/min-h-11/);
  assert.match(migration,/priority in \('low','normal','high','urgent'\)/);
});

test('technician cannot mutate template semantics or required template item',()=>{
  assert.match(migration,/if not public\.zt_is_owner\(old\.company_id\)[\s\S]*new\.text := old\.text[\s\S]*new\.required := old\.required/i);
  assert.match(migration,/source_template_id is null/);
});

test('history hydration preserves returns without private financial projection',()=>{
  assert.match(runtime,/work_order_returns/);
  assert.match(runtime,/Precisa retornar/);
  assert.match(runtime,/Material necessário/);
  assert.doesNotMatch(api,/unit_cost|margin|supplier|fornecedor/);
});

test('owner template UI is embedded in existing OS checklist flow',()=>{
  assert.match(component,/Aplicar à OS/);
  assert.match(component,/Obrigatório para concluir a OS/);
  assert.match(legacy,/ChecklistTemplatePicker/);
  assert.match(legacy,/Checklist do atendimento/);
});
