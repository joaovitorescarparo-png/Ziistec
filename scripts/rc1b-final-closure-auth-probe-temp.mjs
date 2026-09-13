import { createClient } from '@supabase/supabase-js';
import { STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY } from '../api/_supabaseServerConfig.js';

const email = String(process.env.RC1B_STAGING_TEST_EMAIL || '').trim();
const password = String(process.env.RC1B_STAGING_TEST_PASSWORD || '');
const runId = String(process.env.GITHUB_RUN_ID || '').trim();

if (!email) throw new Error('MISSING_RC1B_STAGING_TEST_EMAIL');
if (!password) throw new Error('MISSING_RC1B_STAGING_TEST_PASSWORD');
if (!STAGING_SUPABASE_URL.includes('xadoktssibuuebzzjrhv')) throw new Error('STAGING_REF_MISMATCH');

const client = createClient(STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const { data, error } = await client.auth.signInWithPassword({ email, password });
if (error || !data?.user?.id || !data?.session) {
  const code = error?.code || `status_${error?.status || 'unknown'}`;
  throw new Error(`RC1B_STAGING_AUTH_FAILED:${code}`);
}

console.log(`RC1B_AUTH_PASS run_id=${runId} user_id=${data.user.id}`);
await client.auth.signOut();
