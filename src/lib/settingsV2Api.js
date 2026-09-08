import { supabase } from './supabase';
import { uploadLogoEmpresaDB } from './runtimeApi';
import { resolverLogoEmpresaDB } from './storageExtras';
import { cancelarAssinaturaDB, reativarAssinaturaDB } from './subscriptionApi';

const check=(r)=>{if(r?.error) throw r.error;return r?.data;};
const clean=(v,max)=>{const s=String(v??'').trim();return s?s.slice(0,max):null;};
const clampInt=(v,min,max,fallback)=>{const n=Number(v);return Number.isInteger(n)?Math.max(min,Math.min(max,n)):fallback;};

export async function carregarSettingsV2DB(companyId){
  const [companyR,subR]=await Promise.all([
    supabase.from('companies').select('id,name,trade_name,tax_id,activity,phone,whatsapp,email,address,logo_path,owner_name,has_team,default_validity_days,default_payment_terms,default_notes,created_at').eq('id',companyId).single(),
    supabase.from('subscriptions').select('id,company_id,plan,amount,status,current_period_start,current_period_end,created_at').eq('company_id',companyId).maybeSingle(),
  ]);
  const company=check(companyR);
  const subscription=check(subR)||null;
  return {
    company:{
      id:company.id,
      nome:company.name||'',
      fantasia:company.trade_name||'',
      documento:company.tax_id||'',
      atividade:company.activity||'',
      telefone:company.phone||'',
      whatsapp:company.whatsapp||'',
      email:company.email||'',
      endereco:company.address||'',
      responsavel:company.owner_name||'',
      temEquipe:Boolean(company.has_team),
      validadePadrao:Number(company.default_validity_days??15),
      condicaoPadrao:company.default_payment_terms||'',
      observacaoPadrao:company.default_notes||'',
      logoPath:company.logo_path||null,
      logoUrl:company.logo_path?await resolverLogoEmpresaDB(company.logo_path):null,
      criadaEm:company.created_at||null,
    },
    subscription:subscription?{
      id:subscription.id,
      plano:subscription.plan||'',
      valor:Number(subscription.amount||0),
      status:subscription.status,
      inicio:subscription.current_period_start||null,
      fim:subscription.current_period_end||null,
    }:null,
  };
}

export async function salvarSettingsEmpresaV2DB(companyId,form){
  const nome=clean(form?.nome,200);
  if(!nome) throw new Error('Informe o nome da empresa.');
  const row={
    name:nome,
    trade_name:clean(form?.fantasia,200),
    tax_id:clean(form?.documento,50),
    activity:clean(form?.atividade,200),
    phone:clean(form?.telefone,40),
    whatsapp:clean(form?.whatsapp,40),
    email:clean(form?.email,320),
    address:clean(form?.endereco,1000),
    owner_name:clean(form?.responsavel,200),
    has_team:Boolean(form?.temEquipe),
    default_validity_days:clampInt(Number(form?.validadePadrao),1,365,15),
    default_payment_terms:clean(form?.condicaoPadrao,5000),
    default_notes:clean(form?.observacaoPadrao,5000),
  };
  check(await supabase.from('companies').update(row).eq('id',companyId).select('id').single());
  return true;
}

export async function salvarLogoSettingsV2DB(companyId,file){
  return uploadLogoEmpresaDB(file,companyId);
}

export async function cancelarAssinaturaSettingsV2DB(companyId){
  return cancelarAssinaturaDB(companyId);
}

export async function reativarAssinaturaSettingsV2DB(companyId){
  return reativarAssinaturaDB(companyId);
}
