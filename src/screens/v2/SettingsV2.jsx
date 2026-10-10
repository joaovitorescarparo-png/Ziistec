import React,{useEffect,useRef,useState} from 'react';
import {
  AlertTriangle,ArrowLeft,Building2,CheckCircle2,CreditCard,Image,Loader2,RefreshCcw,
  Save,ShieldCheck,Upload,X,
} from 'lucide-react';
import {
  cancelarAssinaturaSettingsV2DB,carregarSettingsV2DB,reativarAssinaturaSettingsV2DB,
  salvarLogoSettingsV2DB,salvarSettingsEmpresaV2DB,
} from '../../lib/settingsV2Api';
import { mensagemErro } from '../../lib/supabase';

const brl=(v)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const dataBR=(v)=>v?String(v).slice(0,10).split('-').reverse().join('/'):'—';
const STATUS={trial:['Período de teste','bg-sky-50 text-sky-700'],active:['Ativa','bg-emerald-50 text-emerald-700'],past_due:['Pagamento pendente','bg-amber-50 text-amber-700'],suspended:['Suspensa','bg-rose-50 text-rose-700'],canceled:['Cancelada','bg-slate-100 text-slate-600']};
const input='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

function Field({label,children,hint}){return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}{hint&&<span className="mt-1 block text-[11px] leading-relaxed text-slate-400">{hint}</span>}</label>;}
function Btn({children,onClick,disabled=false,variant='primary',type='button',className=''}){const cls=variant==='primary'?'bg-emerald-700 text-white hover:bg-emerald-800':variant==='danger'?'border border-rose-200 bg-white text-rose-700 hover:bg-rose-50':'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${cls} ${className}`}>{children}</button>;}

export default function SettingsV2({companyId,companyName='Sua empresa',onClose}){
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [logoSaving,setLogoSaving]=useState(false);
  const [subscriptionSaving,setSubscriptionSaving]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [form,setForm]=useState(null);
  const [subscription,setSubscription]=useState(null);
  const [confirmAction,setConfirmAction]=useState(null);
  const logoRef=useRef(null);

  const load=async()=>{
    setLoading(true);setError('');
    try{const data=await carregarSettingsV2DB(companyId);setForm(data.company);setSubscription(data.subscription);}
    catch(e){setError(mensagemErro(e));}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[companyId]);

  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const save=async(e)=>{
    e.preventDefault();setSaving(true);setError('');setSuccess('');
    try{await salvarSettingsEmpresaV2DB(companyId,form);setSuccess('Configurações da empresa salvas.');await load();}
    catch(err){setError(mensagemErro(err));}
    finally{setSaving(false);}
  };
  const uploadLogo=async(file)=>{
    if(!file)return;
    setLogoSaving(true);setError('');setSuccess('');
    try{const saved=await salvarLogoSettingsV2DB(companyId,file);setForm(current=>({...current,logoPath:saved.path,logoUrl:saved.url}));setSuccess('Logo atualizada.');}
    catch(err){setError(mensagemErro(err));}
    finally{setLogoSaving(false);if(logoRef.current)logoRef.current.value='';}
  };
  const runSubscription=async(action)=>{
    setConfirmAction(null);setSubscriptionSaving(true);setError('');setSuccess('');
    try{
      const status=action==='cancel'?await cancelarAssinaturaSettingsV2DB(companyId):await reativarAssinaturaSettingsV2DB(companyId);
      setSuccess(action==='cancel'?'Assinatura cancelada sem apagar os dados.':'Assinatura reativada.');
      await load();
      return status;
    }catch(err){setError(mensagemErro(err));}
    finally{setSubscriptionSaving(false);}
  };

  if(loading&&!form)return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando configurações...</div>;

  const [statusLabel,statusClass]=STATUS[subscription?.status]||[subscription?.status||'Sem assinatura','bg-slate-100 text-slate-600'];
  const canCancel=subscription&&['trial','active'].includes(subscription.status);
  const canReactivate=subscription&&['canceled','suspended','past_due'].includes(subscription.status);

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Voltar"><ArrowLeft size={19}/></button><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Configurações</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div></div><Btn variant="secondary" onClick={load} disabled={loading}><RefreshCcw size={16}/><span className="hidden sm:inline">Atualizar</span></Btn></div></header>

    <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
      <div className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={20}/><div><p className="text-sm font-bold text-emerald-950">Somente ações reais</p><p className="mt-1 text-xs leading-relaxed text-emerald-800">Esta área usa os dados e RPCs reais do Supabase. Forma de pagamento não aparece como botão enquanto o provedor de checkout ainda não estiver integrado.</p></div></div></div>
      {error&&<div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><span className="flex-1">{error}</span><button onClick={()=>setError('')}><X size={17}/></button></div>}
      {success&&<div className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 shrink-0" size={18}/><span className="flex-1">{success}</span><button onClick={()=>setSuccess('')}><X size={17}/></button></div>}

      {form&&<div className="grid gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <form onSubmit={save} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center gap-3"><div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><Building2 size={20}/></div><div><h2 className="text-sm font-bold">Empresa e documentos</h2><p className="mt-1 text-xs text-slate-500">Dados usados em orçamento, OS e identificação do negócio.</p></div></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Nome da empresa *"><input className={input} value={form.nome} maxLength={200} onChange={e=>set('nome',e.target.value)} required/></Field><Field label="Nome fantasia"><input className={input} value={form.fantasia} maxLength={200} onChange={e=>set('fantasia',e.target.value)}/></Field><Field label="CPF/CNPJ"><input className={input} value={form.documento} maxLength={50} onChange={e=>set('documento',e.target.value)}/></Field><Field label="Atividade"><input className={input} value={form.atividade} maxLength={200} onChange={e=>set('atividade',e.target.value)}/></Field><Field label="Responsável"><input className={input} value={form.responsavel} maxLength={200} onChange={e=>set('responsavel',e.target.value)}/></Field><Field label="E-mail"><input type="email" className={input} value={form.email} maxLength={320} onChange={e=>set('email',e.target.value)}/></Field><Field label="Telefone"><input className={input} value={form.telefone} maxLength={40} onChange={e=>set('telefone',e.target.value)}/></Field><Field label="WhatsApp"><input className={input} value={form.whatsapp} maxLength={40} onChange={e=>set('whatsapp',e.target.value)}/></Field><div className="sm:col-span-2"><Field label="Endereço"><input className={input} value={form.endereco} maxLength={1000} onChange={e=>set('endereco',e.target.value)}/></Field></div></div>

          <div className="mt-6 border-t border-slate-100 pt-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-400">Padrões comerciais</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Validade padrão do orçamento" hint="Entre 1 e 365 dias."><input type="number" min="1" max="365" className={input} value={form.validadePadrao} onChange={e=>set('validadePadrao',e.target.value)}/></Field><label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3"><input type="checkbox" checked={form.temEquipe} onChange={e=>set('temEquipe',e.target.checked)} className="h-4 w-4 accent-emerald-700"/><span><span className="block text-sm font-semibold">Empresa com equipe</span><span className="mt-0.5 block text-[11px] text-slate-400">Mantém a configuração visual/operacional da empresa.</span></span></label><div className="sm:col-span-2"><Field label="Condição padrão de pagamento"><textarea rows={3} maxLength={5000} className={`${input} resize-none`} value={form.condicaoPadrao} onChange={e=>set('condicaoPadrao',e.target.value)}/></Field></div><div className="sm:col-span-2"><Field label="Observação padrão"><textarea rows={4} maxLength={5000} className={`${input} resize-none`} value={form.observacaoPadrao} onChange={e=>set('observacaoPadrao',e.target.value)}/></Field></div></div></div>
          <div className="mt-6 flex justify-end border-t border-slate-100 pt-5"><Btn type="submit" disabled={saving}>{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>}Salvar configurações</Btn></div>
        </form>

        <div className="space-y-5"><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><Image size={20}/></div><div><h2 className="text-sm font-bold">Logo da empresa</h2><p className="mt-1 text-xs text-slate-500">JPG, PNG ou WEBP · até 2 MB.</p></div></div><div className="mt-5 flex items-center gap-4"><div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">{form.logoUrl?<img src={form.logoUrl} alt="Logo da empresa" className="h-full w-full object-contain"/>:<Building2 className="text-slate-300" size={30}/>}</div><div className="min-w-0"><input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>uploadLogo(e.target.files?.[0])}/><Btn variant="secondary" onClick={()=>logoRef.current?.click()} disabled={logoSaving}>{logoSaving?<Loader2 className="animate-spin" size={16}/>:<Upload size={16}/>}Trocar logo</Btn><p className="mt-2 text-[11px] text-slate-400">A imagem fica no bucket privado de branding da empresa.</p></div></div></section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-2xl bg-slate-100 p-3 text-slate-600"><CreditCard size={20}/></div><div><h2 className="text-sm font-bold">Assinatura</h2><p className="mt-1 text-xs text-slate-500">Status real da conta.</p></div></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${statusClass}`}>{statusLabel}</span></div>{subscription?<div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4 text-sm"><div className="flex justify-between gap-3"><span className="text-slate-500">Plano</span><strong>{subscription.plano||'—'}</strong></div><div className="flex justify-between gap-3"><span className="text-slate-500">Valor cadastrado</span><strong>{brl(subscription.valor)}</strong></div><div className="flex justify-between gap-3"><span className="text-slate-500">Período atual</span><strong className="text-right">{dataBR(subscription.inicio)} — {dataBR(subscription.fim)}</strong></div></div>:<div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Nenhum registro de assinatura foi encontrado.</div>}<p className="mt-4 text-xs leading-relaxed text-slate-500">Checkout e troca de forma de pagamento só serão exibidos quando um provedor de pagamento real estiver integrado. Cancelar não apaga seus dados.</p><div className="mt-4">{canCancel&&<Btn variant="danger" className="w-full" disabled={subscriptionSaving} onClick={()=>setConfirmAction('cancel')}>Cancelar assinatura</Btn>}{canReactivate&&<Btn className="w-full" disabled={subscriptionSaving} onClick={()=>setConfirmAction('reactivate')}>{subscriptionSaving?<Loader2 className="animate-spin" size={16}/>:<ShieldCheck size={16}/>}Reativar assinatura</Btn>}</div></section>
        </div>
      </div>}
    </main>

    {confirmAction&&<div className="fixed inset-0 z-[16000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5" onMouseDown={e=>{if(e.target===e.currentTarget&&!subscriptionSaving)setConfirmAction(null);}}><div className="w-full rounded-t-3xl bg-white p-6 shadow-2xl sm:max-w-md sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="text-base font-bold">{confirmAction==='cancel'?'Cancelar assinatura?':'Reativar assinatura?'}</h3><p className="mt-2 text-sm leading-relaxed text-slate-500">{confirmAction==='cancel'?'O acesso seguirá a regra do servidor para assinatura cancelada. Os dados da empresa, clientes e histórico não são apagados.':'O servidor vai tentar reativar a assinatura mantendo todos os dados existentes.'}</p></div><button onClick={()=>setConfirmAction(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X size={18}/></button></div><div className="mt-6 flex gap-2"><Btn variant="secondary" className="flex-1" onClick={()=>setConfirmAction(null)}>Voltar</Btn><Btn variant={confirmAction==='cancel'?'danger':'primary'} className="flex-1" disabled={subscriptionSaving} onClick={()=>runSubscription(confirmAction)}>{subscriptionSaving?<Loader2 className="animate-spin" size={16}/>:null}{confirmAction==='cancel'?'Confirmar cancelamento':'Confirmar reativação'}</Btn></div></div></div>}
  </div>;
}