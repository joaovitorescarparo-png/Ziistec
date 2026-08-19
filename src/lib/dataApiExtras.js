import { supabase } from './supabase';
import { salvarOSDB, salvarOrcamentoDB } from './dataApi';

const n=(v)=>Number(v||0);
const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
const papelFromDb={owner:'proprietario',technician:'tecnico'};
const papelToDb={proprietario:'owner',tecnico:'technician'};
const requestIdFor=(x)=>{
  if(x?.id) return x.requestId||null;
  if(!x.requestId){
    if(!globalThis.crypto?.randomUUID) throw new Error('Seu navegador não suporta criação segura deste documento. Atualize o navegador.');
    x.requestId=globalThis.crypto.randomUUID();
  }
  return x.requestId;
};

const fromPurchase=(x)=>({id:x.id,requestId:x.client_request_id||null,empresaId:x.company_id,numero:x.number,fornecedor:x.supplier_name,data:x.purchase_date,forma:x.payment_method||'',vencimento:x.due_date||'',obs:x.notes||'',lancamentoId:x.entry_id,itens:(x.purchase_items||[]).map(i=>({id:i.id,catalogoId:i.product_id,nome:i.name,qtd:n(i.quantity),custo:n(i.unit_cost)}))});

export async function salvarCompraDB(x,companyId,userId){
  const row={supplier_name:x.fornecedor?.trim()||'Fornecedor',purchase_date:x.data||new Date().toISOString().slice(0,10),payment_method:x.forma||null,due_date:x.vencimento||null,notes:x.obs||null,paid:Boolean(x.jaPago)};
  const items=(x.itens||[]).map(i=>({product_id:i.catalogoId||null,name:i.nome||'Item',quantity:n(i.qtd)||1,unit_cost:n(i.custo)}));
  const req=requestIdFor(x);
  const id=check(await supabase.rpc('zt_save_purchase_idempotent',{p_company:companyId,p_purchase:x.id||null,p_request:req,p_row:row,p_items:items}));
  const full=check(await supabase.from('purchases').select('*, purchase_items(*)').eq('id',id).single());
  return fromPurchase(full);
}

export async function duplicarOrcamentoDB(x,companyId,userId,validUntil){
  return salvarOrcamentoDB({...x,id:null,requestId:null,numero:null,status:'rascunho',data:new Date().toISOString().slice(0,10),validade:validUntil||x.validade,itens:(x.itens||[]).map(i=>({...i,id:null})),osId:null},companyId,userId);
}

export async function criarOSDeOrcamentoDB(orc,companyId,userId,defaults={}){
  return salvarOSDB({clienteId:orc.clienteId,orcamentoId:orc.id,responsavelId:userId,status:'aguardando',data:'',hora:'',local:orc.local||defaults.endereco||'',localServico:orc.localServico||'',descricaoLivre:`Gerada a partir do ${orc.numero}`,obs:orc.obs||'',itens:(orc.itens||[]).map(i=>({...i,id:null})),emGarantia:false},companyId,userId);
}

export async function abrirAtendimentoGarantiaDB(g,companyId,userId,defaults={}){
  return salvarOSDB({clienteId:g.clienteId,responsavelId:userId,status:'aguardando',data:'',hora:'',local:defaults.local||'',localServico:g.local||defaults.localServico||'',descricaoLivre:`Atendimento em garantia de ${g.descricao}`,obs:`Atendimento em garantia de \"${g.descricao}\", executado em ${g.inicio}.`,itens:[],emGarantia:true,garantiaId:g.id,osOrigemId:g.osId,relatoProblema:defaults.relatoProblema||''},companyId,userId);
}

export async function carregarEquipeDB(companyId){
  const ms=check(await supabase.from('company_members').select('*').eq('company_id',companyId).order('created_at'))||[];
  const ids=[...new Set(ms.map(m=>m.user_id).filter(Boolean))];
  let ps=[];if(ids.length) ps=check(await supabase.from('profiles').select('id,full_name,email,phone,last_seen_at').in('id',ids))||[];
  const pmap=new Map(ps.map(p=>[p.id,p]));
  const invites=check(await supabase.from('company_invites').select('*').eq('company_id',companyId).is('accepted_at',null).order('created_at'))||[];
  const usuarios=ms.map(m=>{const p=pmap.get(m.user_id)||{};return{id:m.user_id,nome:p.full_name||p.email||'Colaborador',email:p.email||'',telefone:p.phone||'',funcao:m.job_title||'',ultimoAcesso:(p.last_seen_at||'').slice(0,10)||null,precisaTrocarSenha:false};});
  const membresias=ms.map(m=>({id:m.id,usuarioId:m.user_id,empresaId:m.company_id,papel:papelFromDb[m.role]||'tecnico',ativo:m.status==='active',desde:(m.created_at||'').slice(0,10),convite:'aceito'}));
  for(const i of invites){const fake=`invite:${i.id}`;usuarios.push({id:fake,nome:i.name||i.email,email:i.email,telefone:i.phone||'',funcao:i.job_title||'',ultimoAcesso:null,precisaTrocarSenha:true});membresias.push({id:i.id,usuarioId:fake,empresaId:i.company_id,papel:papelFromDb[i.role]||'tecnico',ativo:true,desde:(i.created_at||'').slice(0,10),convite:'pendente',inviteId:i.id});}
  return {usuarios,membresias};
}

export async function convidarColaboradorDB(x,companyId,userId){
  const email=x.email.trim().toLowerCase();
  const existing=await supabase.from('company_invites').select('id').eq('company_id',companyId).ilike('email',email).is('accepted_at',null).maybeSingle();
  if(existing.error) throw existing.error;
  const payload={company_id:companyId,email,role:papelToDb[x.papel]||'technician',job_title:x.funcao||null,invited_by:userId||null,name:x.nome||null,phone:x.telefone||null};
  if(existing.data) check(await supabase.from('company_invites').update(payload).eq('id',existing.data.id));else check(await supabase.from('company_invites').insert(payload));
  return carregarEquipeDB(companyId);
}

export async function alternarColaboradorDB(m){
  if(m.inviteId){if(m.ativo) check(await supabase.from('company_invites').delete().eq('id',m.inviteId));return;}
  check(await supabase.from('company_members').update({status:m.ativo?'disabled':'active'}).eq('id',m.id));
}

export async function atualizarFuncaoColaboradorDB(membershipId,funcao){check(await supabase.from('company_members').update({job_title:funcao||null}).eq('id',membershipId));}
