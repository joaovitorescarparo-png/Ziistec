import { supabase } from './supabase';
import { idempotentWrite } from './reliability';

// Comprovante de Serviço (0097): somente proprietário; a RLS devolve zero linhas para técnico.
const RECEIPT_SELECT='id,company_id,work_order_id,client_id,number,version,is_active,snapshot,notes,reissue_reason,request_id,issued_by,issued_at,superseded_at';

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const migrationPending=(e)=>['PGRST202','PGRST205','42P01'].includes(String(e?.code||''))
  ||/(service_receipts|zt_issue_service_receipt).*(schema cache|does not exist|could not find)/i.test(String(e?.message||''));

export function novoRequestIdComprovante(){
  if(!globalThis.crypto?.randomUUID) throw new Error('Atualize o navegador para emitir o comprovante com segurança.');
  return globalThis.crypto.randomUUID();
}

export async function carregarComprovantesOSDB(workOrderId){
  if(!workOrderId) return {ativo:null,versoes:[],disponivel:true};
  const r=await supabase.from('service_receipts').select(RECEIPT_SELECT).eq('work_order_id',workOrderId).order('version',{ascending:false});
  if(r.error&&migrationPending(r.error)) return {ativo:null,versoes:[],disponivel:false};
  const versoes=check(r)||[];
  return {ativo:versoes.find(x=>x.is_active)||null,versoes,disponivel:true};
}

// Mesmo requestId devolve a mesma emissão; sem motivo, a OS mantém o comprovante ativo.
export async function emitirComprovanteServicoDB({workOrderId,requestId,notes='',reissueReason=''}){
  if(!workOrderId) throw new Error('OS inválida.');
  if(!requestId) throw new Error('Identificador da emissão ausente. Feche e abra o comprovante novamente.');
  const r=await idempotentWrite(()=>supabase.rpc('zt_issue_service_receipt',{
    p_wo:workOrderId,
    p_request:requestId,
    p_notes:String(notes||'').trim()||null,
    p_reissue_reason:String(reissueReason||'').trim()||null,
  }));
  if(r?.error&&migrationPending(r.error)){
    const e=new Error('O Comprovante de Serviço ainda não está disponível neste ambiente (migration pendente).');
    e.code='V2_MIGRATION_PENDING';
    throw e;
  }
  return check(r);
}
