import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Bot, Check, ChevronDown, CircleDollarSign, Loader2,
  Mic, MicOff, PencilLine, Plus, RefreshCcw, Save, Sparkles, Trash2, UserPlus, X,
} from 'lucide-react';
import useSpeechInput from '../../hooks/useSpeechInput';
import {
  carregarBaseOrcamentoV2DB, criarClienteRapidoOrcamentoV2DB,
  interpretarOrcamentoV2DB, salvarOrcamentoV2DB,
} from '../../lib/quoteV2Api';
import { mensagemErro } from '../../lib/supabase';

const brl = (v) => Number(v || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const num = (v) => Number(String(v ?? '').replace(',','.')) || 0;
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const emptyItem = () => ({ id:uid(), tipo:'livre', catalogoId:null, nome:'', unidade:'unidade', qtd:1, preco:0, custo:0, precoFoiInformado:true, obs:'' });

function Button({children,onClick,disabled=false,type='button',variant='primary',className=''}) {
  const styles=variant==='primary'?'bg-emerald-700 text-white hover:bg-emerald-800':variant==='soft'?'bg-emerald-50 text-emerald-800 hover:bg-emerald-100':'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50';
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}>{children}</button>;
}

function Field({label,children}) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>{children}</label>; }
const inputClass='w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

function NewClientModal({onClose,onSave,saving}) {
  const [form,setForm]=useState({nome:'',telefone:'',whatsapp:'',endereco:''});
  return <div className="fixed inset-0 z-[14000] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-5" onMouseDown={e=>{if(e.target===e.currentTarget&&!saving)onClose();}}><form onSubmit={e=>{e.preventDefault();onSave(form);}} className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-bold text-slate-900">Cadastrar cliente</h3><p className="mt-1 text-xs text-slate-500">Sem sair do orçamento.</p></div><button type="button" onClick={onClose} disabled={saving} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><X size={18}/></button></div><div className="space-y-3"><Field label="Nome"><input autoFocus className={inputClass} value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} required/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Telefone"><input className={inputClass} value={form.telefone} onChange={e=>setForm({...form,telefone:e.target.value})}/></Field><Field label="WhatsApp"><input className={inputClass} value={form.whatsapp} onChange={e=>setForm({...form,whatsapp:e.target.value})}/></Field></div><Field label="Endereço"><input className={inputClass} value={form.endereco} onChange={e=>setForm({...form,endereco:e.target.value})}/></Field></div><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" disabled={saving||!form.nome.trim()}>{saving?<Loader2 className="animate-spin" size={16}/>:<Check size={16}/>}Cadastrar</Button></div></form></div>;
}

function SummaryCard({label,value,detail,tone='default'}) {
  const valueClass=tone==='good'?'text-emerald-700':tone==='warn'?'text-amber-700':'text-slate-900';
  return <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-1 text-lg font-bold ${valueClass}`}>{value}</p>{detail&&<p className="mt-1 text-xs text-slate-500">{detail}</p>}</div>;
}

export default function QuoteAIV2({companyId,companyName='Sua empresa',userId,onClose,initialText=''}) {
  const [loading,setLoading]=useState(true);
  const [interpreting,setInterpreting]=useState(false);
  const [saving,setSaving]=useState(false);
  const [base,setBase]=useState(null);
  const [text,setText]=useState(()=>String(initialText||'').slice(0,12000));
  const [interim,setInterim]=useState('');
  const [preview,setPreview]=useState(null);
  const [correction,setCorrection]=useState('');
  const [ambiguitiesReviewed,setAmbiguitiesReviewed]=useState(false);
  const [error,setError]=useState('');
  const [newClient,setNewClient]=useState(false);
  const [saved,setSaved]=useState(null);

  const voice=useSpeechInput({onText:({finalText,interimText})=>{
    setInterim(interimText||'');
    if(finalText) setText(current=>`${current}${current.trim()?' ':''}${finalText}`.trim());
  }});

  const load=async()=>{
    setLoading(true);setError('');
    try{setBase(await carregarBaseOrcamentoV2DB(companyId));}
    catch(e){setError(mensagemErro(e));}
    finally{setLoading(false);}
  };
  useEffect(()=>{load();},[companyId]);

  const serviceMap=useMemo(()=>new Map((base?.servicos||[]).map(x=>[x.id,x])),[base]);
  const productMap=useMemo(()=>new Map((base?.produtos||[]).map(x=>[x.id,x])),[base]);

  const interpret=async(asCorrection=false)=>{
    if(!base||!text.trim())return;
    setInterpreting(true);setError('');setSaved(null);setAmbiguitiesReviewed(false);
    try{
      const next=await interpretarOrcamentoV2DB({texto:text,base,correcao:asCorrection?correction:null,previa:asCorrection?preview?.bruto:null});
      setPreview(next);setCorrection('');
    }catch(e){setError(mensagemErro(e));}
    finally{setInterpreting(false);}
  };

  const totals=useMemo(()=>{
    const sale=(preview?.itens||[]).reduce((s,i)=>s+num(i.qtd)*num(i.preco),0);
    const cost=(preview?.itens||[]).reduce((s,i)=>s+num(i.qtd)*num(i.custo),0);
    const final=Math.max(0,sale-num(preview?.desconto)+num(preview?.acrescimo));
    const margin=final-cost;
    const pct=final>0?margin/final*100:0;
    return {sale,cost,final,margin,pct};
  },[preview]);

  const currentIssues=useMemo(()=>{
    if(!preview||!base)return [];
    const issues=[];
    if(!preview.clienteId||!(base.clientes||[]).some(c=>c.id===preview.clienteId))issues.push('Selecione um cliente válido.');
    if(!preview.itens?.length)issues.push('Adicione ao menos um item.');
    (preview.itens||[]).forEach((item,index)=>{
      if(!item.nome?.trim())issues.push(`Informe o nome do item ${index+1}.`);
      if(!(num(item.qtd)>0))issues.push(`Quantidade inválida no item ${index+1}.`);
      if(num(item.preco)<0)issues.push(`Preço inválido no item ${index+1}.`);
      if(item.tipo==='servico'&&!serviceMap.has(item.catalogoId))issues.push(`Confirme o serviço do item ${index+1} ou mude para item livre.`);
      if(item.tipo==='produto'&&!productMap.has(item.catalogoId))issues.push(`Confirme o produto do item ${index+1} ou mude para item livre.`);
    });
    if((preview.ambiguidades||[]).length&&!ambiguitiesReviewed)issues.push('Revise e confirme as ambiguidades indicadas pela IA.');
    return [...new Set(issues)];
  },[preview,base,serviceMap,productMap,ambiguitiesReviewed]);

  const updateItem=(index,patch)=>setPreview(current=>({...current,itens:current.itens.map((item,i)=>i===index?{...item,...patch}:item)}));
  const removeItem=(index)=>setPreview(current=>({...current,itens:current.itens.filter((_,i)=>i!==index)}));
  const addItem=()=>setPreview(current=>({...current,itens:[...(current?.itens||[]),emptyItem()]}));

  const changeCatalog=(index,value)=>{
    if(value==='livre') { updateItem(index,{tipo:'livre',catalogoId:null,nome:'',unidade:'unidade',preco:0,custo:0,precoFoiInformado:true}); return; }
    const [tipo,id]=value.split(':');
    const cat=tipo==='servico'?serviceMap.get(id):productMap.get(id);
    if(!cat)return;
    updateItem(index,{tipo,catalogoId:id,nome:cat.nome,unidade:cat.unidade,preco:cat.preco,custo:cat.custo,precoFoiInformado:false});
  };

  const save=async()=>{
    if(!preview||currentIssues.length)return;
    setSaving(true);setError('');
    try{const quote=await salvarOrcamentoV2DB(preview,base,companyId,userId);setSaved(quote);}
    catch(e){setError(mensagemErro(e));}
    finally{setSaving(false);}
  };

  const createClient=async(form)=>{
    setSaving(true);setError('');
    try{
      const client=await criarClienteRapidoOrcamentoV2DB(form,companyId);
      const refreshed=await carregarBaseOrcamentoV2DB(companyId);
      setBase(refreshed);setPreview(current=>current?{...current,clienteId:client.id}:current);setNewClient(false);
    }catch(e){setError(mensagemErro(e));}
    finally{setSaving(false);}
  };

  const newQuote=()=>{setText('');setInterim('');setPreview(null);setCorrection('');setAmbiguitiesReviewed(false);setSaved(null);setError('');};

  if(loading)return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando orçamento V2...</div>;

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6"><div className="flex min-w-0 items-center gap-3"><button onClick={onClose} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50"><ArrowLeft size={19}/></button><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-base font-bold">Orçamento com IA</h1><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">V2</span></div><p className="truncate text-xs text-slate-500">{companyName}</p></div></div><Button variant="secondary" onClick={newQuote}><RefreshCcw size={15}/><span className="hidden sm:inline">Novo</span></Button></div></header>

    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-7">
      {error&&<div className="mb-5 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mt-0.5 shrink-0" size={18}/><span className="flex-1">{error}</span><button onClick={()=>setError('')}><X size={17}/></button></div>}

      {saved?<section className="mx-auto max-w-xl rounded-3xl border border-emerald-200 bg-white p-7 text-center shadow-sm"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Check size={28}/></div><h2 className="mt-4 text-xl font-bold">Orçamento salvo</h2><p className="mt-2 text-sm text-slate-600">{saved.numero||'Novo orçamento'} foi salvo como rascunho e já está disponível no ZiisTec.</p><div className="mt-6 flex justify-center gap-2"><Button variant="secondary" onClick={onClose}>Voltar</Button><Button onClick={newQuote}><Plus size={16}/>Outro orçamento</Button></div></section>:
      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.4fr]">
        <section className="space-y-4"><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start gap-3"><div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><Mic size={21}/></div><div><h2 className="text-sm font-bold">Fale como você trabalha</h2><p className="mt-1 text-xs leading-relaxed text-slate-500">Exemplo: “Orçamento para João, duas fechaduras Intelbras a 890 cada e instalação 400. Pix na entrega.”</p></div></div><textarea value={text} onChange={e=>setText(e.target.value)} rows={7} placeholder="Fale ou digite o pedido do cliente..." className="mt-4 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"/>{interim&&<p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-xs italic text-slate-500">Ouvindo: {interim}</p>}{voice.error&&<p className="mt-2 text-xs text-amber-700">{voice.error}</p>}<div className="mt-3 flex flex-col gap-2 sm:flex-row"><Button variant={voice.listening?'secondary':'soft'} onClick={voice.listening?voice.stop:voice.start} disabled={!voice.supported}>{voice.listening?<><MicOff size={16}/>Parar microfone</>:<><Mic size={16}/>Ditado por voz</>}</Button><Button onClick={()=>interpret(false)} disabled={!text.trim()||interpreting} className="flex-1">{interpreting?<Loader2 className="animate-spin" size={16}/>:<Sparkles size={16}/>}Interpretar orçamento</Button></div>{!voice.supported&&<p className="mt-2 text-[11px] text-slate-400">Seu navegador não oferece reconhecimento de voz; a digitação continua funcionando normalmente.</p>}</div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="flex items-start gap-3"><Bot className="mt-0.5 text-emerald-700" size={19}/><div><p className="text-sm font-bold">IA com confirmação humana</p><p className="mt-1 text-xs leading-relaxed text-slate-500">Ela pode montar a primeira versão, mas não pode inventar cliente, produto ou serviço. Quando houver dúvida, o orçamento fica pendente de sua confirmação.</p></div></div></div>
        </section>

        <section className="min-w-0">{!preview?<div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><PencilLine size={25}/></div><h2 className="mt-4 text-base font-bold">A prévia aparece aqui</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-500">Depois de interpretar, você revisa cliente, itens, quantidades, preços, custo e margem antes de salvar.</p></div></div>:
          <div className="space-y-4"><div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><Field label="Cliente"><div className="relative"><select value={preview.clienteId||''} onChange={e=>setPreview({...preview,clienteId:e.target.value||null})} className={`${inputClass} appearance-none pr-9`}><option value="">Selecione o cliente</option>{(base?.clientes||[]).map(c=><option key={c.id} value={c.id}>{c.fantasia||c.nome}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/></div></Field><Button variant="secondary" onClick={()=>setNewClient(true)}><UserPlus size={15}/>Cadastrar cliente</Button></div>{preview.resumo&&<p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{preview.resumo}</p>}</div>

            {(preview.ambiguidades||[]).length>0&&<div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><div className="flex gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={19}/><div className="min-w-0 flex-1"><p className="text-sm font-bold text-amber-900">Confirme {preview.ambiguidades.length} ponto{preview.ambiguidades.length===1?'':'s'}</p><div className="mt-3 space-y-2">{preview.ambiguidades.map((a,i)=><div key={`${a.campo}-${i}`} className="rounded-xl bg-white/70 p-3"><p className="text-xs font-semibold text-amber-900">{a.mensagem}</p>{a.opcoes?.length>0&&<p className="mt-1 text-[11px] text-amber-700">Opções: {a.opcoes.join(' · ')}</p>}</div>)}</div><label className="mt-4 flex items-start gap-2 text-xs text-amber-900"><input type="checkbox" checked={ambiguitiesReviewed} onChange={e=>setAmbiguitiesReviewed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-700"/><span>Revisei os pontos acima e corrigi a prévia quando necessário.</span></label><div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Ex.: use o João da Rua 440 e preço 850" className={`${inputClass} flex-1`}/><Button variant="secondary" onClick={()=>interpret(true)} disabled={!correction.trim()||interpreting}>{interpreting?<Loader2 className="animate-spin" size={15}/>:<Sparkles size={15}/>}Corrigir com IA</Button></div></div></div></div>}

            <div className="rounded-3xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h3 className="text-sm font-bold">Itens</h3><p className="mt-0.5 text-xs text-slate-500">Preço é editável; custo é interno e não vai para o cliente.</p></div><Button variant="secondary" onClick={addItem}><Plus size={15}/>Item</Button></div><div className="divide-y divide-slate-100">{preview.itens.map((item,index)=>{const selected=item.tipo==='livre'?'livre':`${item.tipo}:${item.catalogoId||''}`;const rowSale=num(item.qtd)*num(item.preco);const rowCost=num(item.qtd)*num(item.custo);return <div key={item.id||index} className="p-4 sm:p-5"><div className="grid gap-3 md:grid-cols-[1.4fr_0.55fr_0.7fr_auto]"><Field label={`Item ${index+1}`}><div className="relative"><select value={selected} onChange={e=>changeCatalog(index,e.target.value)} className={`${inputClass} appearance-none pr-9`}><option value="livre">Item livre</option><optgroup label="Serviços">{(base?.servicos||[]).filter(s=>s.ativo).map(s=><option key={s.id} value={`servico:${s.id}`}>{s.nome}</option>)}</optgroup><optgroup label="Produtos">{(base?.produtos||[]).filter(p=>p.ativo).map(p=><option key={p.id} value={`produto:${p.id}`}>{p.nome}{p.marca?` · ${p.marca}`:''}{p.modelo?` ${p.modelo}`:''}</option>)}</optgroup></select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/></div></Field><Field label="Quantidade"><input type="number" min="0.001" step="0.001" value={item.qtd} onChange={e=>updateItem(index,{qtd:e.target.value})} className={inputClass}/></Field><Field label="Preço unitário"><input type="number" min="0" step="0.01" value={item.preco} onChange={e=>updateItem(index,{preco:e.target.value,precoFoiInformado:true})} className={inputClass}/></Field><button onClick={()=>removeItem(index)} className="mt-5 h-10 rounded-xl px-3 text-rose-600 hover:bg-rose-50" title="Remover"><Trash2 size={17}/></button></div>{item.tipo==='livre'&&<div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]"><Field label="Descrição do item livre"><input value={item.nome} onChange={e=>updateItem(index,{nome:e.target.value})} className={inputClass}/></Field><Field label="Custo interno"><input type="number" min="0" step="0.01" value={item.custo} onChange={e=>updateItem(index,{custo:e.target.value})} className={inputClass}/></Field></div>}<div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500"><span>Venda: <strong className="text-slate-800">{brl(rowSale)}</strong></span><span>Custo: <strong className="text-slate-800">{brl(rowCost)}</strong></span><span>Margem: <strong className={rowSale-rowCost>=0?'text-emerald-700':'text-rose-700'}>{brl(rowSale-rowCost)}</strong></span>{item.precoFoiInformado&&<span className="text-sky-700">Preço informado/ajustado</span>}</div></div>;})}</div></div>

            <div className="grid gap-3 sm:grid-cols-3"><SummaryCard label="Venda dos itens" value={brl(totals.sale)}/><SummaryCard label="Custo interno" value={brl(totals.cost)}/><SummaryCard label="Margem estimada" value={brl(totals.margin)} detail={`${totals.pct.toFixed(1)}% sobre o valor final`} tone={totals.margin>=0?'good':'warn'}/></div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5"><div className="grid gap-3 sm:grid-cols-2"><Field label="Desconto"><input type="number" min="0" step="0.01" value={preview.desconto} onChange={e=>setPreview({...preview,desconto:e.target.value})} className={inputClass}/></Field><Field label="Acréscimo"><input type="number" min="0" step="0.01" value={preview.acrescimo} onChange={e=>setPreview({...preview,acrescimo:e.target.value})} className={inputClass}/></Field></div><Field label="Condição de pagamento"><input value={preview.condicao||''} onChange={e=>setPreview({...preview,condicao:e.target.value})} className={`${inputClass} mt-3`}/></Field><Field label="Observações"><textarea rows={3} value={preview.obs||''} onChange={e=>setPreview({...preview,obs:e.target.value})} className={`${inputClass} mt-3 resize-none`}/></Field><div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold text-slate-500">Total para o cliente</p><p className="mt-1 text-3xl font-bold text-slate-900">{brl(totals.final)}</p></div><Button onClick={save} disabled={saving||currentIssues.length>0} className="sm:min-w-44">{saving?<Loader2 className="animate-spin" size={16}/>:<Save size={16}/>}Salvar rascunho</Button></div>{currentIssues.length>0&&<div className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"><p className="font-bold">Antes de salvar:</p><ul className="mt-1 list-disc space-y-1 pl-4">{currentIssues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}</div>
          </div>}
        </section>
      </div>}
    </main>
    {newClient&&<NewClientModal onClose={()=>setNewClient(false)} onSave={createClient} saving={saving}/>} 
  </div>;
}