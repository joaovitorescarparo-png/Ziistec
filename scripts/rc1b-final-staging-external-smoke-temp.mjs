import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY } from '../api/_supabaseServerConfig.js';

const EXPECTED_REF='xadoktssibuuebzzjrhv';
if(!STAGING_SUPABASE_URL.includes(EXPECTED_REF)) throw new Error('STAGING_REF_MISMATCH');
const run=String(process.env.RC1B_SMOKE_RUN||'').replace(/[^a-zA-Z0-9-]/g,'').slice(0,64);
if(run.length<8) throw new Error('INVALID_RUN');
const digest=crypto.createHash('sha256').update(`rc1b-final:${run}`).digest('hex');
const email=`rc1b-final-${run}@example.com`;
const password=`R1b!${digest.slice(0,24)}Aa9`;
const COMPANY_A='d1b00000-0000-4000-8000-000000000001';
const COMPANY_B='d1b00000-0000-4000-8000-000000000002';
const WO_A1='d1b20000-0000-4000-8000-000000000001';
const WO_A2='d1b20000-0000-4000-8000-000000000002';
const WO_B1='d1b20000-0000-4000-8000-000000000003';
const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const must=(ok,msg)=>{if(!ok) throw new Error(msg)};
const rpcArgs=(company,wo,stage,hash,category='Antes',fileName='evidence.jpg')=>({
  p_company:company,p_work_order:wo,
  p_path:`${company}/work-orders/${wo}/${stage}/${hash}.jpg`,
  p_file_name:fileName,p_content_type:'image/jpeg',p_size_bytes:123,
  p_media_stage:stage,p_caption:null,p_category:category,p_content_sha256:hash,
});
const client=createClient(STAGING_SUPABASE_URL,STAGING_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const signup=await client.auth.signUp({email,password});
if(signup.error) throw signup.error;
console.log(`RC1B_EXTERNAL_SIGNUP email=${email} user=${signup.data.user?.id||'unknown'}`);

let signed=null;
for(let attempt=1;attempt<=120;attempt++){
  const login=await client.auth.signInWithPassword({email,password});
  if(!login.error&&login.data.session){signed=login;break}
  if(attempt%10===0) console.log(`RC1B_EXTERNAL_WAIT_CONFIRM attempt=${attempt}`);
  await sleep(2000);
}
must(signed?.data?.session,'RC1B_EXTERNAL_LOGIN_TIMEOUT');
console.log(`RC1B_EXTERNAL_AUTH_READY user=${signed.data.user.id}`);

const storage=client.storage.from('zt-work-orders');
const paths=[];
const upload=async(company,wo,stage,hash,body)=>{
  const path=`${company}/work-orders/${wo}/${stage}/${hash}.jpg`;
  const out=await storage.upload(path,new Blob([body],{type:'image/jpeg'}),{contentType:'image/jpeg',upsert:false});
  if(!out.error) paths.push(path);
  return out;
};
const hSeq=sha(`seq:${run}`);
const hRace=sha(`race:${run}`);
const hOrphan=sha(`orphan:${run}`);
const hCross=sha(`cross:${run}`);
const result={firstUpload:false,retryObject:false,retryMetadata:false,concurrency:false,sameId:false,finalCount:null,differentStage:false,sameCategoryDifferentStage:false,otherWorkOrder:false,crossTenantBlocked:false,orphanCleanup:false,ids:{}};

try{
  const up1=await upload(COMPANY_A,WO_A1,'before',hSeq,`seq:${run}`);
  must(!up1.error,`FIRST_UPLOAD:${up1.error?.message||''}`); result.firstUpload=true;
  const upRetry=await upload(COMPANY_A,WO_A1,'before',hSeq,`seq:${run}`);
  must(!!upRetry.error,'OBJECT_RETRY_OVERWROTE'); result.retryObject=true;

  const first=await client.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'before',hSeq,'Antes'));
  must(!first.error&&first.data?.id,`FIRST_METADATA:${first.error?.message||''}`);
  const retry=await client.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'before',hSeq,'Antes'));
  must(!retry.error&&retry.data?.id===first.data.id,`RETRY_METADATA:${retry.error?.message||'ID_MISMATCH'}`);
  const seqRows=await client.from('attachments').select('id').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('media_stage','before').eq('content_sha256',hSeq);
  must(!seqRows.error&&seqRows.data.length===1,'RETRY_COUNT_NOT_ONE'); result.retryMetadata=true; result.ids.first=first.data.id;

  const upAfter=await upload(COMPANY_A,WO_A1,'after',hSeq,`seq:${run}`);
  must(!upAfter.error,`AFTER_UPLOAD:${upAfter.error?.message||''}`);
  const after=await client.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'after',hSeq,'Antes'));
  must(!after.error&&after.data?.id&&after.data.id!==first.data.id,`DIFFERENT_STAGE:${after.error?.message||'ID_REUSED'}`);
  const stageRows=await client.from('attachments').select('id,media_stage,category').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('content_sha256',hSeq).eq('category','Antes');
  must(!stageRows.error&&stageRows.data.length===2&&new Set(stageRows.data.map(x=>x.media_stage)).size===2,'SAME_CATEGORY_DIFFERENT_STAGE_FAILED');
  result.differentStage=true; result.sameCategoryDifferentStage=true; result.ids.after=after.data.id;

  const upOther=await upload(COMPANY_A,WO_A2,'before',hSeq,`seq:${run}`);
  must(!upOther.error,`OTHER_WO_UPLOAD:${upOther.error?.message||''}`);
  const other=await client.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A2,'before',hSeq,'Antes'));
  must(!other.error&&other.data?.id&&other.data.id!==first.data.id,`OTHER_WO:${other.error?.message||'ID_REUSED'}`);
  result.otherWorkOrder=true; result.ids.otherWorkOrder=other.data.id;

  const upRace=await upload(COMPANY_A,WO_A1,'during',hRace,`race:${run}`);
  must(!upRace.error,`RACE_UPLOAD:${upRace.error?.message||''}`);
  const raceArgs=rpcArgs(COMPANY_A,WO_A1,'during',hRace,'Durante');
  const [r1,r2]=await Promise.all([client.rpc('zt_register_work_order_evidence',raceArgs),client.rpc('zt_register_work_order_evidence',raceArgs)]);
  must(!r1.error&&!r2.error,`RACE_RPC:${r1.error?.message||''}|${r2.error?.message||''}`);
  result.sameId=!!r1.data?.id&&r1.data.id===r2.data?.id;
  must(result.sameId,`RACE_ID_MISMATCH:${r1.data?.id||''}/${r2.data?.id||''}`);
  const raceRows=await client.from('attachments').select('id').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('media_stage','during').eq('content_sha256',hRace);
  result.finalCount=raceRows.data?.length??null;
  must(!raceRows.error&&result.finalCount===1,'RACE_COUNT_NOT_ONE'); result.concurrency=true; result.ids.race=r1.data.id;

  const cross=await client.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_B,WO_B1,'before',hCross,'Antes'));
  must(!!cross.error,'CROSS_TENANT_NOT_BLOCKED'); result.crossTenantBlocked=true;

  const upOrphan=await upload(COMPANY_A,WO_A1,'other',hOrphan,`orphan:${run}`);
  must(!upOrphan.error,`ORPHAN_UPLOAD:${upOrphan.error?.message||''}`);
  const invalid=await client.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'other',hOrphan,'Outro',''));
  must(!!invalid.error,'INVALID_METADATA_ACCEPTED');
  const orphanRows=await client.from('attachments').select('id').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('media_stage','other').eq('content_sha256',hOrphan);
  must(!orphanRows.error&&orphanRows.data.length===0,'ORPHAN_METADATA_PRESENT');
  const orphanPath=`${COMPANY_A}/work-orders/${WO_A1}/other/${hOrphan}.jpg`;
  const rm=await storage.remove([orphanPath]);
  must(!rm.error,`ORPHAN_REMOVE:${rm.error?.message||''}`);
  const dl=await storage.download(orphanPath);
  must(!!dl.error,'ORPHAN_STILL_DOWNLOADABLE'); result.orphanCleanup=true;

  console.log('RC1B_STAGING_EXTERNAL_SMOKE_PASS '+JSON.stringify(result));
} finally {
  await client.from('attachments').delete().eq('company_id',COMPANY_A).in('work_order_id',[WO_A1,WO_A2]);
  if(paths.length) await storage.remove([...new Set(paths)]);
  await client.auth.signOut();
}
