import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('RC-1B hashes real file bytes and derives deterministic evidence paths',()=>{
  const helper=read('src/lib/workOrderEvidence.js');
  assert.match(helper,/crypto\.subtle\.digest\('SHA-256',bytes\)/);
  assert.match(helper,/file\.arrayBuffer\(\)/);
  assert.match(helper,/\$\{companyId\}\/work-orders\/\$\{workOrderId\}\/\$\{stage\}\/\$\{sha256\}\.\$\{extension\}/);
  assert.doesNotMatch(helper,/randomUUID\(/);
  for(const mime of ['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm','application/pdf']) assert.match(helper,new RegExp(mime.replace('/','\\/')));
  for(const limit of ['15*1024*1024','30*1024*1024','20*1024*1024']) assert.ok(helper.includes(limit),`missing limit ${limit}`);
});

test('RC-1B retries use storage continuation plus DB idempotency and safe cleanup',()=>{
  const helper=read('src/lib/workOrderEvidence.js');
  assert.match(helper,/upsert:false/);
  assert.match(helper,/isAlreadyStored/);
  assert.match(helper,/zt_register_work_order_evidence/);
  assert.match(helper,/findExisting\(companyId,workOrderId,stage,hash\)/);
  assert.match(helper,/cleanupIfUnreferenced/);
  assert.match(helper,/if\(ref\.error\|\|ref\.data\) return false/);
  assert.match(helper,/isAmbiguousNetwork/);
});

test('RC-1B both technical-memory and legacy OS-photo paths use one evidence helper',()=>{
  const memory=read('src/lib/workOrderMemoryV2Api.js');
  const storage=read('src/lib/storageExtras.js');
  assert.match(memory,/persistWorkOrderEvidence/);
  assert.doesNotMatch(memory,/randomUUID\(/);
  const legacy=storage.slice(storage.indexOf('export async function persistirFotosOSDB'));
  assert.match(legacy,/persistWorkOrderEvidence/);
  assert.doesNotMatch(legacy,/randomUUID\(/);
});

test('RC-1B database is final dedupe authority and RPC stays SECURITY INVOKER',()=>{
  const sql=read('supabase/0089_rc1b_attachment_upload_idempotency.sql');
  assert.match(sql,/uq_attachments_wo_stage_content/);
  assert.match(sql,/company_id, work_order_id, media_stage, content_sha256/);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/on conflict \(company_id,work_order_id,media_stage,content_sha256\)/i);
  assert.match(sql,/revoke all on function public\.zt_register_work_order_evidence[\s\S]*from public/i);
  assert.match(sql,/from anon/i);
  assert.match(sql,/to authenticated/i);
  assert.doesNotMatch(sql,/security definer/i);
});

test('RC-1B forward-only reconciliation drops only the superseded work-order uniqueness',()=>{
  const sql=read('supabase/0090_rc1b_reconcile_legacy_attachment_idempotency.sql');
  assert.match(sql,/drop index if exists public\.uq_attachments_wo_content\s*;/i);
  assert.doesNotMatch(sql,/drop\s+index[\s\S]*uq_attachments_purchase_content/i);
  assert.doesNotMatch(sql,/drop\s+index[\s\S]*uq_attachments_wo_stage_content/i);
  assert.doesNotMatch(sql,/alter\s+table|create\s+table|create\s+policy|drop\s+policy|disable\s+row\s+level\s+security|drop\s+trigger/i);
});

test('RC-1B UI never appends the same attachment id twice after an idempotent retry',()=>{
  const ui=read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(ui,/filter\(x=>x\.id!==created\.id\)/);
});

test('RC-1B SECURITY DEFINER audit document records complete staging inventory and no cosmetic hardening',()=>{
  const doc=read('docs/engineering/SECURITY_DEFINER_AUDIT.md');
  assert.match(doc,/116 application SECURITY DEFINER/i);
  assert.match(doc,/69.*public/i);
  assert.match(doc,/47.*zt_private/i);
  assert.match(doc,/119.*including platform-managed/i);
  assert.match(doc,/0090.*not required/i);
  assert.match(doc,/rls_auto_enable/);
  assert.match(doc,/SAFE/);
});
