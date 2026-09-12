import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { STAGING_SUPABASE_URL, STAGING_PUBLISHABLE_KEY } from './_supabaseServerConfig.js';

const COMPANY_A='d1b00000-0000-4000-8000-000000000001';
const COMPANY_B='d1b00000-0000-4000-8000-000000000002';
const WO_A1='d1b20000-0000-4000-8000-000000000001';
const WO_A2='d1b20000-0000-4000-8000-000000000002';
const WO_B1='d1b20000-0000-4000-8000-000000000003';
const EXPECTED_REF='xadoktssibuuebzzjrhv';
const cleanRun=(value)=>String(value||'').replace(/[^a-zA-Z0-9-]/g,'').slice(0,64);
const credentials=(run)=>{
  const digest=crypto.createHash('sha256').update(`rc1b-final:${run}`).digest('hex');
  return {email:`rc1b-final-${run}@example.com`,password:`R1b!${digest.slice(0,24)}Aa9`};
};
const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const rpcArgs=(company,wo,stage,hash,category='Antes',fileName='evidence.jpg')=>({
  p_company:company,
  p_work_order:wo,
  p_path:`${company}/work-orders/${wo}/${stage}/${hash}.jpg`,
  p_file_name:fileName,
  p_content_type:'image/jpeg',
  p_size_bytes:123,
  p_media_stage:stage,
  p_caption:null,
  p_category:category,
  p_content_sha256:hash,
});

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  if(process.env.VERCEL_ENV!=='preview') return res.status(403).json({ok:false,error:'PREVIEW_ONLY'});
  if(!STAGING_SUPABASE_URL.includes(EXPECTED_REF)) return res.status(500).json({ok:false,error:'STAGING_REF_MISMATCH'});
  const run=cleanRun(req.query?.run);
  const phase=String(req.query?.phase||'');
  if(run.length<8) return res.status(400).json({ok:false,error:'INVALID_RUN'});
  const {email,password}=credentials(run);
  const supabase=createClient(STAGING_SUPABASE_URL,STAGING_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});

  if(phase==='signup'){
    const out=await supabase.auth.signUp({email,password});
    if(out.error) return res.status(400).json({ok:false,error:out.error.message,email});
    return res.status(200).json({ok:true,phase,userId:out.data.user?.id||null,email});
  }
  if(phase!=='run') return res.status(400).json({ok:false,error:'INVALID_PHASE'});

  const signed=await supabase.auth.signInWithPassword({email,password});
  if(signed.error||!signed.data.session) return res.status(401).json({ok:false,error:signed.error?.message||'NO_SESSION',email});

  const hSeq=sha(`seq:${run}`);
  const hRace=sha(`race:${run}`);
  const hOrphan=sha(`orphan:${run}`);
  const hCross=sha(`cross:${run}`);
  const paths=[];
  const result={
    ok:false,email,userId:signed.data.user.id,
    firstUpload:false,retryObject:false,retryMetadata:false,
    concurrency:false,sameId:false,finalCount:null,
    differentStage:false,sameCategoryDifferentStage:false,
    otherWorkOrder:false,crossTenantBlocked:false,orphanCleanup:false,
    ids:{},
  };
  const storage=supabase.storage.from('zt-work-orders');
  const upload=async(company,wo,stage,hash,body)=>{
    const path=`${company}/work-orders/${wo}/${stage}/${hash}.jpg`;
    const out=await storage.upload(path,new Blob([body],{type:'image/jpeg'}),{contentType:'image/jpeg',upsert:false});
    if(!out.error) paths.push(path);
    return out;
  };
  const must=(condition,message)=>{if(!condition) throw new Error(message)};

  try{
    const up1=await upload(COMPANY_A,WO_A1,'before',hSeq,`seq:${run}`);
    must(!up1.error,`FIRST_UPLOAD:${up1.error?.message||''}`); result.firstUpload=true;
    const upRetry=await upload(COMPANY_A,WO_A1,'before',hSeq,`seq:${run}`);
    must(!!upRetry.error,'OBJECT_RETRY_OVERWROTE'); result.retryObject=true;

    const first=await supabase.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'before',hSeq,'Antes'));
    must(!first.error&&first.data?.id,`FIRST_METADATA:${first.error?.message||''}`);
    const retry=await supabase.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'before',hSeq,'Antes'));
    must(!retry.error&&retry.data?.id===first.data.id,`RETRY_METADATA:${retry.error?.message||'ID_MISMATCH'}`);
    const seqCount=await supabase.from('attachments').select('id').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('media_stage','before').eq('content_sha256',hSeq);
    must(!seqCount.error&&seqCount.data.length===1,'RETRY_COUNT_NOT_ONE');
    result.retryMetadata=true; result.ids.first=first.data.id;

    const upAfter=await upload(COMPANY_A,WO_A1,'after',hSeq,`seq:${run}`);
    must(!upAfter.error,`AFTER_UPLOAD:${upAfter.error?.message||''}`);
    const after=await supabase.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'after',hSeq,'Antes'));
    must(!after.error&&after.data?.id&&after.data.id!==first.data.id,`DIFFERENT_STAGE:${after.error?.message||'ID_REUSED'}`);
    const stageRows=await supabase.from('attachments').select('id,media_stage,category').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('content_sha256',hSeq).eq('category','Antes');
    must(!stageRows.error&&stageRows.data.length===2&&new Set(stageRows.data.map(x=>x.media_stage)).size===2,'SAME_CATEGORY_DIFFERENT_STAGE_FAILED');
    result.differentStage=true; result.sameCategoryDifferentStage=true; result.ids.after=after.data.id;

    const upOther=await upload(COMPANY_A,WO_A2,'before',hSeq,`seq:${run}`);
    must(!upOther.error,`OTHER_WO_UPLOAD:${upOther.error?.message||''}`);
    const other=await supabase.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A2,'before',hSeq,'Antes'));
    must(!other.error&&other.data?.id&&other.data.id!==first.data.id,`OTHER_WO:${other.error?.message||'ID_REUSED'}`);
    result.otherWorkOrder=true; result.ids.otherWorkOrder=other.data.id;

    const upRace=await upload(COMPANY_A,WO_A1,'during',hRace,`race:${run}`);
    must(!upRace.error,`RACE_UPLOAD:${upRace.error?.message||''}`);
    const raceArgs=rpcArgs(COMPANY_A,WO_A1,'during',hRace,'Durante');
    const [r1,r2]=await Promise.all([
      supabase.rpc('zt_register_work_order_evidence',raceArgs),
      supabase.rpc('zt_register_work_order_evidence',raceArgs),
    ]);
    must(!r1.error&&!r2.error,`RACE_RPC:${r1.error?.message||''}|${r2.error?.message||''}`);
    result.sameId=!!r1.data?.id&&r1.data.id===r2.data?.id;
    must(result.sameId,`RACE_ID_MISMATCH:${r1.data?.id||''}/${r2.data?.id||''}`);
    const raceRows=await supabase.from('attachments').select('id').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('media_stage','during').eq('content_sha256',hRace);
    result.finalCount=raceRows.data?.length??null;
    must(!raceRows.error&&result.finalCount===1,'RACE_COUNT_NOT_ONE');
    result.concurrency=true; result.ids.race=r1.data.id;

    const cross=await supabase.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_B,WO_B1,'before',hCross,'Antes'));
    must(!!cross.error,'CROSS_TENANT_NOT_BLOCKED'); result.crossTenantBlocked=true;

    const upOrphan=await upload(COMPANY_A,WO_A1,'other',hOrphan,`orphan:${run}`);
    must(!upOrphan.error,`ORPHAN_UPLOAD:${upOrphan.error?.message||''}`);
    const invalid=await supabase.rpc('zt_register_work_order_evidence',rpcArgs(COMPANY_A,WO_A1,'other',hOrphan,'Outro',''));
    must(!!invalid.error,'INVALID_METADATA_ACCEPTED');
    const orphanRows=await supabase.from('attachments').select('id').eq('company_id',COMPANY_A).eq('work_order_id',WO_A1).eq('media_stage','other').eq('content_sha256',hOrphan);
    must(!orphanRows.error&&orphanRows.data.length===0,'ORPHAN_METADATA_PRESENT');
    const orphanPath=`${COMPANY_A}/work-orders/${WO_A1}/other/${hOrphan}.jpg`;
    const rm=await storage.remove([orphanPath]);
    must(!rm.error,`ORPHAN_REMOVE:${rm.error?.message||''}`);
    const dl=await storage.download(orphanPath);
    must(!!dl.error,'ORPHAN_STILL_DOWNLOADABLE'); result.orphanCleanup=true;

    result.ok=true;
    return res.status(200).json(result);
  }catch(error){
    return res.status(500).json({...result,error:String(error?.message||error)});
  }finally{
    await supabase.from('attachments').delete().eq('company_id',COMPANY_A).in('work_order_id',[WO_A1,WO_A2]);
    if(paths.length) await storage.remove([...new Set(paths)]);
    await supabase.auth.signOut();
  }
}
