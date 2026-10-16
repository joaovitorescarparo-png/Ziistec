import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration=readFileSync('supabase/0083_field_workflow_installed_equipment.sql','utf8');
const api=readFileSync('src/lib/installedEquipmentV2Api.js','utf8');
const panel=readFileSync('src/components/InstalledEquipmentPanel.jsx','utf8');
const scanner=readFileSync('src/components/BarcodeScanner.jsx','utf8');
const patch=readFileSync('scripts/apply-field-workflow-wave3a.mjs','utf8');
const sqlRunner=readFileSync('scripts/run-sql-rls-ci.sh','utf8');
const compact=(s)=>s.replace(/\s+/g,' ');

test('Wave 3A cria entidade durável sem duplicar warranties ou storage',()=>{
  assert.match(migration,/create table if not exists public\.installed_equipment/i);
  assert.match(migration,/create table if not exists public\.client_locations/i);
  assert.doesNotMatch(migration,/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(?:warranties|attachments)/i);
  assert.doesNotMatch(migration,/insert\s+into\s+storage\.buckets/i);
  assert.match(migration,/image_attachment_id uuid references public\.attachments/i);
  assert.match(migration,/bucket='zt-work-orders'/i);
  assert.match(migration,/media_stage='equipment'/i);
});

test('registro deriva tenant da OS e exige finalização/contexto atribuído',()=>{
  const fn=compact(migration.match(/create or replace function public\.zt_register_installed_equipment[\s\S]*?\$\$;/i)?.[0]||'');
  assert.ok(fn,'RPC de registro ausente');
  assert.match(fn,/select \* into v_wo from public\.work_orders where id=p_wo for update/i);
  assert.match(fn,/v_wo\.status <> 'done'/i);
  assert.match(fn,/m\.role='technician' and m\.status='active'/i);
  assert.match(fn,/zt_private\.assert_operational_write_allowed\(v_wo\.company_id\)/i);
  assert.doesNotMatch(fn,/p_company/i);
});

test('serial, barcode e SKU permanecem conceitos separados',()=>{
  assert.match(migration,/serial_number text/);
  assert.match(migration,/barcode text/);
  assert.match(migration,/Serial físico do equipamento/i);
  assert.match(migration,/distinto de SKU e barcode/i);
  assert.match(api,/p_serial:/);
  assert.match(api,/p_barcode:/);
  assert.doesNotMatch(api,/p_sku/);
});

test('retry de equipamento é idempotente e registro não cria garantia',()=>{
  assert.match(migration,/unique\(company_id,registration_key\)/i);
  assert.match(migration,/on conflict\(company_id,registration_key\) do nothing/i);
  const fn=migration.match(/create or replace function public\.zt_register_installed_equipment[\s\S]*?\$\$;/i)?.[0]||'';
  assert.doesNotMatch(fn,/insert\s+into\s+public\.warranties/i);
  assert.match(fn,/from public\.warranties w/i);
  assert.match(fn,/v_wo\.warranty_id/i);
});

test('RLS do técnico depende da OS e a projeção não contém campos privados',()=>{
  assert.match(migration,/installed_equipment_visible/i);
  assert.match(migration,/public\.zt_wo_is_mine\(work_order_id\)/i);
  const history=migration.match(/create or replace function public\.zt_installed_equipment_history[\s\S]*?\$\$;/i)?.[0]||'';
  assert.ok(history,'projeção histórica ausente');
  assert.doesNotMatch(history,/unit_cost|margin|supplier|fornecedor|financial_entries/i);
  assert.match(history,/m\.role='technician' and m\.status='active'/i);
  assert.match(migration,/revoke all on public\.installed_equipment from anon, authenticated/i);
  assert.match(migration,/grant select on public\.installed_equipment to authenticated/i);
});

test('UI é manual-first, touch-safe, copiável e scanner não é obrigatório',()=>{
  assert.match(panel,/Registrar como equipamento instalado/);
  assert.match(panel,/min-h-11/);
  assert.match(panel,/min-w-11/);
  assert.match(panel,/break-all/);
  assert.match(panel,/Copiar serial/);
  assert.match(panel,/Copiar barcode/);
  assert.match(panel,/capture a evidência antes de finalizar/i);
  assert.match(scanner,/mode='barcode'/);
  assert.match(scanner,/SERIAL_FORMATS/);
  assert.match(scanner,/code_128/);
  assert.match(scanner,/qr_code/);
  assert.match(scanner,/Digite o .* manualmente/i);
  assert.doesNotMatch(scanner,/fetch\s*\(/);
});

test('painel entra na memória técnica pelo pipeline persistente',()=>{
  assert.match(patch,/InstalledEquipmentPanel/);
  assert.match(patch,/Relato técnico/);
});

test('regressão SQL Wave 3A faz parte do gate SQL/RLS',()=>{
  assert.match(sqlRunner,/v2_field_workflow_wave3a_installed_equipment_rollback\.sql/);
});
