import { createClient } from '@supabase/supabase-js';
import { STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY } from '../api/_supabaseServerConfig.js';

const email = String(process.env.RC1B_STAGING_TEST_EMAIL || '').trim();
const password = String(process.env.RC1B_STAGING_TEST_PASSWORD || '');
const runId = String(process.env.GITHUB_RUN_ID || '').trim();
if (!email) throw new Error('MISSING_RC1B_STAGING_TEST_EMAIL');
if (!password) throw new Error('MISSING_RC1B_STAGING_TEST_PASSWORD');
if (!STAGING_SUPABASE_URL.includes('xadoktssibuuebzzjrhv')) throw new Error('STAGING_REF_MISMATCH');

const A='9a100000-0000-0000-0000-000000000001';
const B='9a100000-0000-0000-0000-000000000002';
const A1='9a120000-0000-0000-0000-000000000001';
const A2='9a120000-0000-0000-0000-000000000002';
const B1='9a120000-0000-0000-0000-000000000003';
const B2='9a120000-0000-0000-0000-000000000004';
const B3='9a120000-0000-0000-0000-000000000005';
const BUCKET='zt-work-orders';

const client=createClient(STAGING_SUPABASE_URL,STAGING_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const {data,error}=await client.auth.signInWithPassword({email,password});
if(error||!data?.user?.id||!data?.session) throw new Error('RC1B_CLEANUP_AUTH_FAILED');
console.log(`RC1B_CLEANUP auth=PASS run_id=${runId} user_id=${data.user.id}`);

const leaves=[
 `${A}/work-orders/${A1}/before`,`${A}/work-orders/${A1}/during`,`${A}/work-orders/${A1}/after`,`${A}/work-orders/${A1}/other`,`${A}/work-orders/${A2}/before`,
 `${B}/work-orders/${B1}/before`,`${B}/work-orders/${B2}/before`,`${B}/work-orders/${B3}/before`
];
let storageOk=true;
for(const leaf of leaves){
  const listed=await client.storage.from(BUCKET).list(leaf,{limit:100});
  if(listed.error){storageOk=false;continue;}
  const paths=(listed.data||[]).filter(x=>x?.name).map(x=>`${leaf}/${x.name}`);
  if(paths.length){
    const removed=await client.storage.from(BUCKET).remove(paths);
    if(removed.error) storageOk=false;
  }
}
console.log(`RC1B_CLEANUP storage=${storageOk?'PASS':'FAIL'}`);
if(!storageOk) throw new Error('RC1B_CLEANUP_STORAGE_FAILED');

const deleted=await client.from('attachments').delete().in('company_id',[A,B]);
if(deleted.error) throw new Error('RC1B_CLEANUP_ATTACHMENTS_FAILED');
const verify=await client.from('attachments').select('id').in('company_id',[A,B]);
const attachmentsOk=!verify.error&&(verify.data||[]).length===0;
console.log(`RC1B_CLEANUP attachments=${attachmentsOk?'PASS':'FAIL'}`);
if(!attachmentsOk) throw new Error('RC1B_CLEANUP_ATTACHMENTS_REMAIN');

await client.auth.signOut();
console.log('RC1B_CLEANUP_RESULT=PASS');
