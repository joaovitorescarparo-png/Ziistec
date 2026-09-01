import { supabase } from './supabase';

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const n=(v)=>Number(v||0);

export async function venderProdutoDiretoDB({
  companyId,
  productId,
  quantity = 1,
  paymentMethod = 'Pix',
  notes = '',
  requestId = null,
  clientId = null,
  servicePlace = null,
}) {
  const req = requestId || crypto.randomUUID();
  const id = check(await supabase.rpc('zt_sell_product_direct', {
    p_company: companyId,
    p_product: productId,
    p_quantity: Number(quantity || 0),
    p_payment_method: paymentMethod,
    p_notes: notes || null,
    p_request: req,
    p_client: clientId || null,
    p_service_place: servicePlace || null,
  }));
  return { id, requestId:req };
}

export async function carregarConfiguracaoVendaCampoDB(companyId){
  const row=check(await supabase.from('companies')
    .select('id,pix_key,pix_qr_path,field_sales_allow_pix,field_sales_allow_cash,field_sales_allow_card')
    .eq('id',companyId).single());
  return {
    pixKey:row?.pix_key||'', pixQrPath:row?.pix_qr_path||null,
    allowPix:row?.field_sales_allow_pix!==false,
    allowCash:row?.field_sales_allow_cash!==false,
    allowCard:row?.field_sales_allow_card!==false,
  };
}

export async function salvarConfiguracaoVendaCampoDB(companyId,x){
  const row=check(await supabase.from('companies').update({
    pix_key:String(x.pixKey||'').trim().slice(0,300)||null,
    pix_qr_path:x.pixQrPath||null,
    field_sales_allow_pix:Boolean(x.allowPix),
    field_sales_allow_cash:Boolean(x.allowCash),
    field_sales_allow_card:Boolean(x.allowCard),
  }).eq('id',companyId).select('id,pix_key,pix_qr_path,field_sales_allow_pix,field_sales_allow_cash,field_sales_allow_card').single());
  return {
    pixKey:row.pix_key||'',pixQrPath:row.pix_qr_path||null,
    allowPix:row.field_sales_allow_pix!==false,allowCash:row.field_sales_allow_cash!==false,allowCard:row.field_sales_allow_card!==false,
  };
}

export async function carregarVendasCampoDB(companyId){
  const rows=check(await supabase.from('field_sales')
    .select('id,company_id,sold_by,product_id,quantity,unit_price,total,payment_method,notes,client_id,service_place,created_at,products(name,brand,model),clients(name,trade_name)')
    .eq('company_id',companyId).order('created_at',{ascending:false}).limit(100));
  const ids=[...new Set((rows||[]).map(x=>x.sold_by).filter(Boolean))];
  let perfis=[];
  if(ids.length){const r=await supabase.from('profiles').select('id,full_name,email').in('id',ids);if(!r.error)perfis=r.data||[];}
  const byId=Object.fromEntries(perfis.map(p=>[p.id,p]));
  return (rows||[]).map(x=>({
    id:x.id,soldBy:x.sold_by,productId:x.product_id,produto:x.products?.name||'Produto',marca:x.products?.brand||'',modelo:x.products?.model||'',
    quantidade:n(x.quantity),preco:n(x.unit_price),total:n(x.total),pagamento:x.payment_method||'',obs:x.notes||'',clienteId:x.client_id||null,
    cliente:x.clients?.trade_name||x.clients?.name||'',local:x.service_place||'',tecnico:byId[x.sold_by]?.full_name||byId[x.sold_by]?.email||'Técnico',criadoEm:x.created_at,
  }));
}

export async function carregarClientesHistoricoDB(companyId){
  const rows=check(await supabase.from('clients').select('id,name,trade_name,address,person_type').eq('company_id',companyId).is('deleted_at',null).order('name'));
  return rows||[];
}

export async function carregarHistoricoClienteDB(companyId,clientId){
  const [os,sales,warranties]=await Promise.all([
    supabase.from('work_orders').select('id,number,status,request,service_place,address,scheduled_date,completed_at,created_at').eq('company_id',companyId).eq('client_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}),
    supabase.from('field_sales').select('id,quantity,total,payment_method,service_place,created_at,products(name)').eq('company_id',companyId).eq('client_id',clientId).order('created_at',{ascending:false}),
    supabase.from('warranties').select('id,kind,description,service_place,starts_on,ends_on,created_at').eq('company_id',companyId).eq('client_id',clientId).is('deleted_at',null).order('created_at',{ascending:false}),
  ]);
  const err=[os,sales,warranties].find(x=>x.error)?.error;if(err)throw err;
  return [
    ...(os.data||[]).map(x=>({id:`os:${x.id}`,tipo:'OS',titulo:`OS #${x.number}`,descricao:x.request||'Atendimento técnico',local:x.service_place||x.address||'',data:x.completed_at||x.created_at,status:x.status})),
    ...(sales.data||[]).map(x=>({id:`sale:${x.id}`,tipo:'Venda',titulo:x.products?.name||'Venda em campo',descricao:`${n(x.quantity)} un · ${n(x.total).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})} · ${x.payment_method||''}`,local:x.service_place||'',data:x.created_at})),
    ...(warranties.data||[]).map(x=>({id:`war:${x.id}`,tipo:'Garantia',titulo:x.description||'Garantia',descricao:`${x.starts_on||''}${x.ends_on?` até ${x.ends_on}`:''}`,local:x.service_place||'',data:x.created_at})),
  ].sort((a,b)=>new Date(b.data||0)-new Date(a.data||0));
}
