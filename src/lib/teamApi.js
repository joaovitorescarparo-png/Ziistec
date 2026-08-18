import { supabase } from './supabase';

const check=(r)=>{if(r?.error) throw r.error; return r?.data;};

export async function atualizarColaboradorDB(companyId,userId,dados){
  check(await supabase.rpc('zt_update_team_member',{
    p_company:companyId,
    p_user:userId,
    p_name:dados.nome||null,
    p_phone:dados.telefone??null,
    p_job_title:dados.funcao??null,
  }));
}
