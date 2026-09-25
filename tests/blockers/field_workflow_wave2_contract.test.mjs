import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync('supabase/0082_field_workflow_service_report.sql','utf8');
const api=readFileSync('src/lib/workOrderMemoryV2Api.js','utf8');
const pdf=readFileSync('src/lib/serviceReportPdf.js','utf8');
// Wave 4A compõe a tela endurecida anterior como Base. O contrato Wave 2 deve
// verificar a composição inteira, não assumir que tudo continua em um único arquivo.
const screen=readFileSync('src/screens/v2/WorkOrderMemoryV2.jsx','utf8')+'\n'+readFileSync('src/screens/v2/WorkOrderMemoryBaseV2.jsx','utf8');
const sqlRunner=readFileSync('scripts/run-sql-rls-ci.sh','utf8');

const compact=(s)=>s.replace(/\s+/g,' ');

test('Wave 2 reutiliza work_order_reports e attachments sem tabela paralela',()=>{
  assert.match(migration,/alter table public\.work_order_reports/i);
  assert.match(migration,/alter table public\.attachments/i);
  assert.doesNotMatch(migration,/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(?:service_reports|attendance_reports|work_order_service_reports)/i);
  assert.match(migration,/entry_type\s+in\s*\('report','history','service_report'\)/i);
});

test('snapshot inicial é versionado, único e acoplado à conclusão real da OS',()=>{
  const src=compact(migration);
  assert.match(src,/uq_work_order_service_report_version/i);
  assert.match(src,/uq_work_order_service_report_active/i);
  assert.match(src,/report_version=1/i);
  assert.match(src,/on conflict do nothing/i);
  assert.match(src,/create constraint trigger zt_service_report_after_done/i);
  assert.match(src,/deferrable initially deferred/i);
  assert.match(src,/new\.status='done'/i);
});

test('gerador de snapshot não grava financeiro, estoque ou field sales',()=>{
  const match=migration.match(/create or replace function zt_private\.zt_create_initial_service_report[\s\S]*?\$\$;/i);
  assert.ok(match,'função de snapshot ausente');
  const fn=match[0];
  assert.doesNotMatch(fn,/insert\s+into\s+public\.financial_entries/i);
  assert.doesNotMatch(fn,/update\s+public\.products/i);
  assert.doesNotMatch(fn,/insert\s+into\s+public\.inventory_movements/i);
  assert.doesNotMatch(fn,/insert\s+into\s+public\.field_sales/i);
  assert.doesNotMatch(fn,/'unit_cost'\s*,/i);
  assert.doesNotMatch(fn,/'extra_cost'\s*,/i);
  assert.doesNotMatch(fn,/'margin'\s*,/i);
  assert.doesNotMatch(fn,/'supplier'\s*,/i);
});

test('evidência do relatório é opt-in, limitada e fechada na conclusão',()=>{
  assert.match(migration,/include_in_service_report boolean not null default false/i);
  assert.match(migration,/v_selected\s*>=\s*6/i);
  assert.match(migration,/status in \('done','canceled'\)/i);
  assert.match(api,/zt_set_service_report_evidence/);
  assert.match(api,/application\/pdf/);
  assert.match(screen,/Incluir no relatório/);
  assert.match(screen,/canSelectEvidence/);
});

test('PDF é relatório operacional, usa share com fallback e limita fotos',()=>{
  assert.match(pdf,/RELATÓRIO DE ATENDIMENTO/);
  assert.doesNotMatch(pdf,/Nota Fiscal/i);
  assert.doesNotMatch(pdf,/NFS-e/i);
  assert.match(pdf,/MAX_REPORT_PHOTOS\s*=\s*6/);
  assert.match(pdf,/navigator\.share/);
  assert.match(pdf,/navigator\.canShare/);
  assert.match(pdf,/zt-branding/);
  assert.match(screen,/result\?\.unsupported/);
  assert.match(screen,/baixarRelatorioAtendimentoPDF/);
  assert.match(screen,/compartilharRelatorioAtendimentoPDF/);
});

test('UI do relatório mantém alvos mobile e conteúdo longo quebrável',()=>{
  assert.match(screen,/min-h-11/);
  assert.match(screen,/break-words/);
  assert.match(screen,/Relatório disponível/);
  assert.match(screen,/Snapshot v/);
  assert.match(screen,/Imutável/);
});

test('regressão SQL da Wave 2 faz parte do gate SQL/RLS',()=>{
  assert.match(sqlRunner,/v2_field_workflow_wave2_service_report_rollback\.sql/);
});
