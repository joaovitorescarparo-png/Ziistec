import { supabase } from './supabase';
import { atualizarStatusOrcamentoDB } from './dataApi';
import { carregarEquipeDB, duplicarOrcamentoDB } from './dataApiExtras';

const n=(v)=>Number(v||0);
const STATUS_FROM_DB={draft:'rascunho',sent:'enviado',approved:'aprovado',declined:'recusado',expired:'vencido'};
const missingRpcCodes=new Set(['PGRST202','42883','42P01']);

const check=(r)=>{if(r?.error)throw r.error;return r?.data||[];};
const dateOnly=(v)=>String(v||'').slice(0,10);
const addDays=(base,days)=>{const d=new Date(`${base}T12:00:00`);d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10);};

export function conversaoQuoteV2AindaNaoMigrada(error){
  const code=String(error?.code||'');
  const msg=String(error?.message||'');
  return missingRpcCodes.has(code)
    || (/zt_create_work_order_from_quote/i.test(msg) && /(schema cache|does not exist|not find|could not find|function|não existe|não foi encontr)/i.test(msg));
}

const mapItem=(x)=>({
  id:x.id,
  tipo:x.kind==='service'?'servico':x.kind==='product'?'produto':'livre',
  catalogoId:x.service_id||x.product_id||null,
  nome:x.name||'Item',
  unidade:x.unit||'unidade',
  qtd:n(x.quantity)||1,
  preco:n(x.unit_price),
  custo:n(x.unit_cost),
  obs:x.notes||'',
});

const mapQuote=(x,clientMap,woMap)=>{
  const itens=(x.quote_items||[]).sort((a,b)=>(a.position||0)-(b.position||0)).map(mapItem);
  const bruto=itens.reduce((s,i)=>s+i.qtd*i.preco,0);
  const custo=itens.reduce((s,i)=>s+i.qtd*i.custo,0);
  const total=Math.max(0,bruto-n(x.discount)+n(x.surcharge));
  const margem=total-custo;
  const cliente=clientMap.get(x.client_id)||null;
  const os=woMap.get(x.id)||null;
  return {
    id:x.id,
    requestId:x.client_request_id||null,
    numero:x.number,
    clienteId:x.client_id,
    cliente:cliente?{id:cliente.id,nome:cliente.trade_name||cliente.name,telefone:cliente.phone||'',whatsapp:cliente.whatsapp||''}:null,
    status:STATUS_FROM_DB[x.status]||'rascunho',
    data:dateOnly(x.issue_date),
    validade:dateOnly(x.valid_until),
    desconto:n(x.discount),
    acrescimo:n(x.surcharge),
    condicao:x.payment_terms||'',
    obs:x.notes||'',
    local:x.address||'',
    localServico:x.service_place||'',
    criadoEm:x.created_at,
    atualizadoEm:x.updated_at,
    itens,
    bruto,custo,total,margem,margemPct:total>0?margem/total*100:0,
    os,
  };
};

export async function carregarOrcamentosV2DB(companyId){
  const [quotesRes,clientsRes,workOrdersRes]=await Promise.all([
    supabase.from('quotes').select('id,company_id,number,client_id,status,issue_date,valid_until,discount,surcharge,payment_terms,notes,address,service_place,created_at,updated_at,client_request_id,quote_items(id,kind,service_id,product_id,name,unit,quantity,unit_price,unit_cost,notes,position)').eq('company_id',companyId).order('updated_at',{ascending:false}),
    supabase.from('clients').select('id,name,trade_name,phone,whatsapp').eq('company_id',companyId),
    supabase.from('work_orders').select('id,number,quote_id,status,scheduled_date,scheduled_time,assigned_to,created_at').eq('company_id',companyId).not('quote_id','is',null).order('created_at',{ascending:true}),
  ]);
  const first=[quotesRes,clientsRes,workOrdersRes].find(r=>r.error)?.error;if(first)throw first;
  const clientMap=new Map(check(clientsRes).map(c=>[c.id,c]));
  const woMap=new Map();
  for(const wo of check(workOrdersRes)){if(wo.quote_id&&!woMap.has(wo.quote_id))woMap.set(wo.quote_id,wo);}
  return check(quotesRes).map(q=>mapQuote(q,clientMap,woMap));
}

export async function carregarEquipeParaOrcamentoV2DB(companyId){
  const data=await carregarEquipeDB(companyId);
  const userMap=new Map((data.usuarios||[]).filter(u=>!String(u.id).startsWith('invite:')).map(u=>[u.id,u]));
  return (data.membresias||[])
    .filter(m=>m.ativo&&!m.inviteId&&userMap.has(m.usuarioId))
    .map(m=>({id:m.usuarioId,papel:m.papel,nome:userMap.get(m.usuarioId)?.nome||userMap.get(m.usuarioId)?.email||'Colaborador'}));
}

export async function alterarStatusOrcamentoV2DB(id,status){
  return atualizarStatusOrcamentoDB(id,status);
}

export async function duplicarOrcamentoSeguroV2DB(quote,companyId,userId){
  const issue=new Date(`${quote.data||dateOnly(quote.criadoEm)}T12:00:00`);
  const valid=quote.validade?new Date(`${quote.validade}T12:00:00`):null;
  const days=valid&&Number.isFinite(valid.getTime())?Math.max(1,Math.round((valid-issue)/86400000)):15;
  const newValid=addDays(new Date().toISOString().slice(0,10),days);
  return duplicarOrcamentoDB({
    id:quote.id,requestId:quote.requestId,numero:quote.numero,clienteId:quote.clienteId,status:quote.status,
    data:quote.data,validade:quote.validade,desconto:quote.desconto,acrescimo:quote.acrescimo,
    condicao:quote.condicao,obs:quote.obs,local:quote.local,localServico:quote.localServico,
    itens:(quote.itens||[]).map(i=>({...i})),osId:quote.os?.id||null,
  },companyId,userId,newValid);
}

export async function criarOSDoOrcamentoV2DB({quoteId,assignedTo=null,scheduledDate=null,scheduledTime=null}){
  const result=await supabase.rpc('zt_create_work_order_from_quote',{
    p_quote:quoteId,
    p_assigned_to:assignedTo||null,
    p_scheduled_date:scheduledDate||null,
    p_scheduled_time:scheduledTime||null,
  });
  if(result.error){
    if(conversaoQuoteV2AindaNaoMigrada(result.error)){
      const error=new Error('A conversão segura orçamento → OS depende da migration 0057, ainda não aplicada neste banco.');
      error.code='V2_MIGRATION_PENDING';
      throw error;
    }
    throw result.error;
  }
  return result.data;
}
