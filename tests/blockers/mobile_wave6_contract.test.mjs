import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('wave 6 client history makes service locations actionable on mobile',()=>{
  const legacy=read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy,/MOBILE HOMOLOGATION · history\/warranty · wave 6/);
  assert.match(legacy,/const \[localCliente, setLocalCliente\] = useState\(""\)/);
  assert.match(legacy,/const ossVisiveis = localCliente \? oss\.filter/);
  assert.match(legacy,/Todos os locais/);
  assert.match(legacy,/aria-pressed=\{localCliente === l\}/);
  assert.match(legacy,/min-h-11 rounded-xl/);
  assert.match(legacy,/ossVisiveis\.map/);
});

test('wave 6 post-sale actions wrap and remain touch-safe',()=>{
  const legacy=read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy,/Pós-venda programado/);
  assert.match(legacy,/flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0/);
  assert.match(legacy,/className="min-h-11 flex-1 sm:flex-none" onClick=\{\(\)=>mudarRevisao\(r,"done"\)\}/);
  assert.match(legacy,/className="min-h-11 flex-1 sm:flex-none" onClick=\{\(\)=>mudarRevisao\(r,"dismissed"\)\}/);
});

test('wave 6 work-order memory preserves lookup context at 320-390px',()=>{
  // Wave 4A wraps the hardened screen but copies the fully codemodded implementation
  // into WorkOrderMemoryBaseV2 before installing its reuse UI. The previous mobile
  // contract therefore spans wrapper + base instead of assuming one physical file.
  const memory=read('src/screens/v2/WorkOrderMemoryV2.jsx')+'\n'+read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(memory,/MOBILE HOMOLOGATION · history lookup · wave 6/);
  assert.match(memory,/grid grid-cols-1 gap-2 min-\[360px\]:grid-cols-3 lg:w-\[360px\]/);
  assert.match(memory,/line-clamp-2 break-words/);
  assert.match(memory,/min-\[390px\]:flex-row min-\[390px\]:items-center min-\[390px\]:justify-between/);
  assert.match(memory,/mt-4 grid grid-cols-1 gap-3 min-\[390px\]:grid-cols-2/);
  assert.doesNotMatch(memory,/grid grid-cols-3 gap-2 lg:w-\[360px\]/);
});

test('wave 6 client location and warranty detail stay within the mobile visual viewport',()=>{
  const clients=read('src/screens/v2/ClientLocationsV2.jsx');
  const warranty=read('src/screens/v2/ManualWarrantyV2.jsx');
  assert.match(clients,/MOBILE HOMOLOGATION · client location detail · wave 6/);
  assert.match(clients,/flex flex-col gap-3 min-\[390px\]:flex-row/);
  assert.match(clients,/min-h-11 w-full items-center justify-center/);
  assert.match(warranty,/MOBILE HOMOLOGATION · warranties · wave 6/);
  assert.match(warranty,/min-h-\[100dvh\] overflow-x-hidden/);
  assert.match(warranty,/inline-flex min-h-11 items-center justify-center/);
  assert.match(warranty,/aria-label="Fechar erro"/);
  assert.match(warranty,/aria-label="Fechar confirmação"/);
});

test('technical memory still excludes private technician data and keeps evidence/report history',()=>{
  const api=read('src/lib/workOrderMemoryV2Api.js');
  assert.match(api,/work_order_reports/);
  assert.match(api,/attachments/);
  assert.match(api,/work_order_items/);
  assert.match(api,/work_order_materials/);
  assert.doesNotMatch(api,/unit_cost/);
  assert.doesNotMatch(api,/supplier/);
  assert.doesNotMatch(api,/margin/);
  assert.doesNotMatch(api,/financial_entries/);
});

test('wave 6 leaves F11 and subscription authority untouched',()=>{
  const f11=read('supabase/0080_require_confirmed_email_for_invite_acceptance.sql');
  const regression=read('supabase/tests/v2_f11_invite_confirmed_email_rollback.sql');
  assert.match(f11,/auth\.uid\(\)/);
  assert.match(f11,/email_confirmed_at/);
  assert.match(regression,/technician/);
  const direct=read('supabase/0079_fix_direct_field_sale_subscription_guard.sql');
  const onOs=read('supabase/0078_fix_field_sale_subscription_guard.sql');
  assert.match(direct,/zt_private\.assert_operational_write_allowed/);
  assert.match(onOs,/zt_private\.assert_operational_write_allowed/);
});
