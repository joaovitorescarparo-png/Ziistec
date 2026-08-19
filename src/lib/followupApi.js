import { supabase, mensagemErro } from './supabase';

const map = (x) => ({
  id:x.id,
  empresaId:x.company_id,
  clienteId:x.client_id,
  osId:x.work_order_id,
  servicoId:x.service_id,
  descricao:x.description,
  data:x.due_on,
  status:x.status,
  concluidaEm:x.completed_at||null,
});

export async function carregarRevisoesDB(companyId){
  const {data,error}=await supabase.from('post_sale_followups')
    .select('*').eq('company_id',companyId).order('due_on',{ascending:true});
  if(error) throw new Error(mensagemErro(error));
  return (data||[]).map(map);
}

export async function atualizarRevisaoDB(id,status){
  const {error}=await supabase.rpc('zt_set_followup_status',{p_followup:id,p_status:status});
  if(error) throw new Error(mensagemErro(error));
  const {data,error:readError}=await supabase.from('post_sale_followups').select('*').eq('id',id).single();
  if(readError) throw new Error(mensagemErro(readError));
  return map(data);
}
