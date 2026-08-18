import { supabase } from './supabase';

const check=(r)=>{if(r?.error) throw r.error; return r?.data;};
const fromDb={trial:'trial',active:'ativa',past_due:'pendente',suspended:'suspensa',canceled:'cancelada'};

export async function cancelarAssinaturaDB(companyId){
  const status=check(await supabase.rpc('zt_cancel_subscription',{p_company:companyId}));
  return fromDb[status]||status;
}

export async function reativarAssinaturaDB(companyId){
  const status=check(await supabase.rpc('zt_reactivate_subscription',{p_company:companyId}));
  return fromDb[status]||status;
}
