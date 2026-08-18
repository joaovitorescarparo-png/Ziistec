import { supabase } from './supabase';

const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
const statusFromDb={trial:'trial',active:'ativa',past_due:'pendente',suspended:'suspensa',canceled:'cancelada'};

export async function carregarPlataformaDB(){
  const [companies,subs,members,profiles,audit]=await Promise.all([
    supabase.from('companies').select('id,name,trade_name,owner_name,email,phone,created_at').order('created_at',{ascending:false}),
    supabase.from('subscriptions').select('*').order('created_at',{ascending:false}),
    supabase.from('company_members').select('id,company_id,user_id,role,status,created_at').eq('status','active'),
    supabase.from('profiles').select('id,full_name,email,phone,last_seen_at,is_platform_admin'),
    supabase.from('platform_audit_logs').select('*').order('created_at',{ascending:false}).limit(30),
  ]);
  [companies,subs,members,profiles,audit].forEach(check);
  const ps=new Map((profiles.data||[]).map(p=>[p.id,p]));
  const ss=new Map((subs.data||[]).map(s=>[s.company_id,s]));
  const empresas=(companies.data||[]).map(c=>{
    const ms=(members.data||[]).filter(m=>m.company_id===c.id);
    const owner=ms.find(m=>m.role==='owner');
    const p=owner?ps.get(owner.user_id):null;
    const s=ss.get(c.id)||null;
    return {
      id:c.id,nome:c.trade_name||c.name,responsavel:p?.full_name||c.owner_name||'',email:p?.email||c.email||'',telefone:p?.phone||c.phone||'',
      criadaEm:(c.created_at||'').slice(0,10),ultimoAcesso:(p?.last_seen_at||'').slice(0,10)||null,usuarios:ms.length,
      assinatura:s?{id:s.id,status:statusFromDb[s.status]||s.status,valor:Number(s.amount||0),plano:s.plan||'',inicio:s.current_period_start,fim:s.current_period_end}:null,
    };
  });
  return {empresas,auditoria:audit.data||[]};
}

export async function mudarStatusPlataformaDB(companyId,status){
  const toDb={ativa:'active',suspensa:'suspended',cancelada:'canceled'};
  const db=toDb[status]||status;
  check(await supabase.rpc('zt_platform_set_subscription_status',{p_company:companyId,p_status:db}));
}
