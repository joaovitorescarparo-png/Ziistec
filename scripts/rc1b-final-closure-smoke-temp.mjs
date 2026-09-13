import { createClient } from '@supabase/supabase-js';
import { STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY } from '../api/_supabaseServerConfig.js';

const email = String(process.env.RC1B_STAGING_TEST_EMAIL || '').trim();
const password = String(process.env.RC1B_STAGING_TEST_PASSWORD || '');
const runId = String(process.env.GITHUB_RUN_ID || '').trim();

if (!email) throw new Error('MISSING_RC1B_STAGING_TEST_EMAIL');
if (!password) throw new Error('MISSING_RC1B_STAGING_TEST_PASSWORD');
if (!STAGING_SUPABASE_URL.includes('xadoktssibuuebzzjrhv')) throw new Error('STAGING_REF_MISMATCH');

const A = '9a100000-0000-0000-0000-000000000001';
const B = '9a100000-0000-0000-0000-000000000002';
const C = '9a100000-0000-0000-0000-000000000003';
const A1 = '9a120000-0000-0000-0000-000000000001';
const A2 = '9a120000-0000-0000-0000-000000000002';
const B1 = '9a120000-0000-0000-0000-000000000003';
const B2 = '9a120000-0000-0000-0000-000000000004';
const B3 = '9a120000-0000-0000-0000-000000000005';
const C1 = '9a120000-0000-0000-0000-000000000006';
const BUCKET = 'zt-work-orders';
const CATEGORY = 'RC1B Same Category';

const client = createClient(STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const storagePaths = new Set();
const attachmentIds = new Set();
const results = new Map();
let userId = '';

function mark(name, ok) {
  results.set(name, Boolean(ok));
  console.log(`RC1B_SMOKE ${name}=${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) throw new Error(`RC1B_SMOKE_FAILED:${name}`);
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

function evidencePath(company, workOrder, stage, hash, ext = 'jpg') {
  return `${company}/work-orders/${workOrder}/${stage}/${hash}.${ext}`;
}

function alreadyExists(error) {
  if (!error) return false;
  const status = Number(error.statusCode || error.status || 0);
  return status === 400 || status === 409 || /exist|duplicate/i.test(String(error.message || error.error || error.code || ''));
}

async function upload(path, bytes, { expectExisting = false, expectBlocked = false } = {}) {
  const { error } = await client.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (!error) {
    storagePaths.add(path);
    if (expectExisting || expectBlocked) return { ok: false, error: null };
    return { ok: true, error: null };
  }
  if (expectExisting) return { ok: alreadyExists(error), error };
  if (expectBlocked) return { ok: true, error };
  return { ok: false, error };
}

async function downloadExists(path) {
  const { error } = await client.storage.from(BUCKET).download(path);
  return !error;
}

async function rpcEvidence({ company, workOrder, path, fileName, bytes, stage, hash, category = CATEGORY, caption = 'RC1B closure' }) {
  const { data, error } = await client.rpc('zt_register_work_order_evidence', {
    p_company: company,
    p_work_order: workOrder,
    p_path: path,
    p_file_name: fileName,
    p_content_type: 'image/jpeg',
    p_size_bytes: bytes.byteLength,
    p_media_stage: stage,
    p_caption: caption,
    p_category: category,
    p_content_sha256: hash,
  });
  if (!error && data?.id) attachmentIds.add(data.id);
  return { data, error };
}

async function attachmentCount(company, workOrder, stage, hash) {
  const { count, error } = await client
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company)
    .eq('work_order_id', workOrder)
    .eq('media_stage', stage)
    .eq('content_sha256', hash);
  if (error) return { count: null, error };
  return { count, error: null };
}

async function cleanupExternal() {
  let ok = true;

  if (attachmentIds.size) {
    const ids = [...attachmentIds];
    const { error } = await client.from('attachments').delete().in('id', ids);
    if (error) ok = false;
  }

  for (const path of [...storagePaths]) {
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) ok = false;
  }

  return ok;
}

try {
  const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password });
  mark('authenticated_external_smoke', !authError && Boolean(authData?.session) && Boolean(authData?.user?.id));
  userId = authData.user.id;
  console.log(`RC1B_AUTH_PASS run_id=${runId} user_id=${userId}`);

  const baseBytes = new TextEncoder().encode(`ziistec-rc1b-closure:${runId}:base`).buffer;
  const concurrentBytes = new TextEncoder().encode(`ziistec-rc1b-closure:${runId}:concurrent`).buffer;
  const techBytes = new TextEncoder().encode(`ziistec-rc1b-closure:${runId}:technician`).buffer;
  const orphanBytes = new TextEncoder().encode(`ziistec-rc1b-closure:${runId}:orphan`).buffer;

  const baseHash = await sha256(baseBytes);
  const concurrentHash = await sha256(concurrentBytes);
  const techHash = await sha256(techBytes);
  const orphanHash = await sha256(orphanBytes);

  const baseBeforePath = evidencePath(A, A1, 'before', baseHash);
  const firstUpload = await upload(baseBeforePath, baseBytes);
  mark('storage_first_upload', firstUpload.ok && await downloadExists(baseBeforePath));

  const objectRetry = await upload(baseBeforePath, baseBytes, { expectExisting: true });
  mark('object_retry_existing', objectRetry.ok && await downloadExists(baseBeforePath));

  const meta1 = await rpcEvidence({ company: A, workOrder: A1, path: baseBeforePath, fileName: 'base.jpg', bytes: baseBytes, stage: 'before', hash: baseHash });
  mark('metadata_first_registration', !meta1.error && Boolean(meta1.data?.id));

  const metaRetry = await rpcEvidence({ company: A, workOrder: A1, path: baseBeforePath, fileName: 'base-retry.jpg', bytes: baseBytes, stage: 'before', hash: baseHash });
  const metaCount = await attachmentCount(A, A1, 'before', baseHash);
  mark('metadata_retry_same_id', !metaRetry.error && meta1.data.id === metaRetry.data?.id && metaCount.count === 1);
  mark('attachments_final_count_one', metaCount.count === 1);

  const concurrentPath = evidencePath(A, A1, 'during', concurrentHash);
  const concurrentUpload = await upload(concurrentPath, concurrentBytes);
  mark('concurrency_storage_seed', concurrentUpload.ok);

  const concurrentArgs = { company: A, workOrder: A1, path: concurrentPath, fileName: 'concurrent.jpg', bytes: concurrentBytes, stage: 'during', hash: concurrentHash };
  const [concurrent1, concurrent2] = await Promise.all([
    rpcEvidence(concurrentArgs),
    rpcEvidence({ ...concurrentArgs, fileName: 'concurrent-retry.jpg' }),
  ]);
  const concurrentCount = await attachmentCount(A, A1, 'during', concurrentHash);
  mark('concurrency_http', !concurrent1.error && !concurrent2.error && Boolean(concurrent1.data?.id) && concurrent1.data.id === concurrent2.data?.id && concurrentCount.count === 1);
  mark('concurrent_ids_equal', concurrent1.data?.id === concurrent2.data?.id);
  mark('concurrent_count_one', concurrentCount.count === 1);

  const afterPath = evidencePath(A, A1, 'after', baseHash);
  const afterUpload = await upload(afterPath, baseBytes);
  mark('different_stage_storage', afterUpload.ok);
  const afterMeta = await rpcEvidence({ company: A, workOrder: A1, path: afterPath, fileName: 'same-category.jpg', bytes: baseBytes, stage: 'after', hash: baseHash, category: CATEGORY });
  mark('different_stage', !afterMeta.error && Boolean(afterMeta.data?.id) && afterMeta.data.id !== meta1.data.id);
  mark('same_category_different_stage', !afterMeta.error && afterMeta.data?.category === CATEGORY && meta1.data?.category === CATEGORY && afterMeta.data.id !== meta1.data.id);

  const otherWoPath = evidencePath(A, A2, 'before', baseHash);
  const otherWoUpload = await upload(otherWoPath, baseBytes);
  mark('other_work_order_storage', otherWoUpload.ok);
  const otherWoMeta = await rpcEvidence({ company: A, workOrder: A2, path: otherWoPath, fileName: 'other-wo.jpg', bytes: baseBytes, stage: 'before', hash: baseHash });
  mark('other_work_order', !otherWoMeta.error && Boolean(otherWoMeta.data?.id) && otherWoMeta.data.id !== meta1.data.id);

  const foreignPath = evidencePath(C, C1, 'before', baseHash);
  const foreignStorage = await upload(foreignPath, baseBytes, { expectBlocked: true });
  const foreignRpc = await rpcEvidence({ company: C, workOrder: C1, path: foreignPath, fileName: 'foreign.jpg', bytes: baseBytes, stage: 'before', hash: baseHash });
  mark('cross_tenant', foreignStorage.ok && Boolean(foreignRpc.error));

  const techAssignedPath = evidencePath(B, B1, 'before', techHash);
  const techAssignedUpload = await upload(techAssignedPath, techBytes);
  const techAssignedRpc = await rpcEvidence({ company: B, workOrder: B1, path: techAssignedPath, fileName: 'tech-assigned.jpg', bytes: techBytes, stage: 'before', hash: techHash });
  mark('technician_assigned_open', techAssignedUpload.ok && !techAssignedRpc.error && Boolean(techAssignedRpc.data?.id));

  const techUnassignedPath = evidencePath(B, B2, 'before', techHash);
  const techUnassignedUpload = await upload(techUnassignedPath, techBytes, { expectBlocked: true });
  const techUnassignedRpc = await rpcEvidence({ company: B, workOrder: B2, path: techUnassignedPath, fileName: 'tech-unassigned.jpg', bytes: techBytes, stage: 'before', hash: techHash });
  mark('technician_unassigned_blocked', techUnassignedUpload.ok && Boolean(techUnassignedRpc.error));

  const techClosedPath = evidencePath(B, B3, 'before', techHash);
  const techClosedUpload = await upload(techClosedPath, techBytes, { expectBlocked: true });
  const techClosedRpc = await rpcEvidence({ company: B, workOrder: B3, path: techClosedPath, fileName: 'tech-closed.jpg', bytes: techBytes, stage: 'before', hash: techHash });
  mark('technician_closed_blocked', techClosedUpload.ok && Boolean(techClosedRpc.error));
  mark('technician_permissions_preserved', results.get('technician_assigned_open') && results.get('technician_unassigned_blocked') && results.get('technician_closed_blocked'));

  const orphanPath = evidencePath(A, A1, 'other', orphanHash);
  const orphanUpload = await upload(orphanPath, orphanBytes);
  mark('orphan_storage_upload', orphanUpload.ok && await downloadExists(orphanPath));

  const orphanBadMeta = await client.rpc('zt_register_work_order_evidence', {
    p_company: A,
    p_work_order: A1,
    p_path: orphanPath,
    p_file_name: 'orphan.jpg',
    p_content_type: 'image/jpeg',
    p_size_bytes: orphanBytes.byteLength,
    p_media_stage: 'other',
    p_caption: 'invalid metadata cleanup proof',
    p_category: CATEGORY,
    p_content_sha256: 'not-a-valid-sha256',
  });
  const { count: orphanAttachmentCount, error: orphanCountError } = await client
    .from('attachments')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', A)
    .eq('work_order_id', A1)
    .eq('path', orphanPath);
  mark('orphan_metadata_rejected', Boolean(orphanBadMeta.error) && !orphanCountError && orphanAttachmentCount === 0);

  const orphanRemove = await client.storage.from(BUCKET).remove([orphanPath]);
  if (!orphanRemove.error) storagePaths.delete(orphanPath);
  const orphanGone = !(await downloadExists(orphanPath));
  mark('orphan_cleanup', !orphanRemove.error && orphanAttachmentCount === 0 && orphanGone);

  console.log('RC1B_SMOKE_RESULT=PASS');
} catch (error) {
  console.log('RC1B_SMOKE_RESULT=FAIL');
  throw error;
} finally {
  const cleanupOk = await cleanupExternal().catch(() => false);
  console.log(`RC1B_SMOKE external_resource_cleanup=${cleanupOk ? 'PASS' : 'FAIL'}`);
  await client.auth.signOut().catch(() => {});
}
