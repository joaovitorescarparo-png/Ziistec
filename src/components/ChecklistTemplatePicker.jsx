import React,{useEffect,useState} from 'react';
import {Check,ChevronDown,ChevronUp,ClipboardCheck,Plus,Save,Trash2,X} from 'lucide-react';
import {aplicarChecklistTemplateV2DB,carregarChecklistTemplatesV2DB,salvarChecklistTemplateV2DB} from '../lib/checklistReturnV2Api';

const blankItem=()=>({text:'',required:false});

export default function ChecklistTemplatePicker({companyId,workOrderId,onApplied}){
  const [templates,setTemplates]=useState([]);
  const [selected,setSelected]=useState('');
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState(null);
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [active,setActive]=useState(true);
  const [items,setItems]=useState([blankItem()]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  const load=async()=>{
    if(!companyId)return;
    try{
      const rows=await carregarChecklistTemplatesV2DB(companyId);
      setTemplates(rows);
      if(!selected&&rows.find(x=>x.active)) setSelected(rows.find(x=>x.active)?.id||'');
    }catch(e){setError(e?.message||'Não consegui carregar os templates.');}
  };
  useEffect(()=>{load();},[companyId]);

  const reset=()=>{setEditing(null);setName('');setDescription('');setActive(true);setItems([blankItem()]);};
  const edit=(t)=>{setEditing(t.id);setName(t.name);setDescription(t.description||'');setActive(t.active!==false);setItems((t.items||[]).length?(t.items||[]).map(i=>({text:i.text,required:Boolean(i.required)})):[blankItem()]);setOpen(true);};
  const save=async()=>{
    const clean=items.map(x=>({text:x.text.trim(),required:Boolean(x.required)})).filter(x=>x.text);
    if(!name.trim()){setError('Informe o nome do template.');return;}
    if(!clean.length){setError('Adicione ao menos um item ao template.');return;}
    setBusy(true);setError('');
    try{
      const id=await salvarChecklistTemplateV2DB({companyId,templateId:editing,name,description,active,items:clean});
      await load();setSelected(id);reset();setOpen(false);
    }catch(e){setError(e?.message||'Não consegui salvar o template.');}
    finally{setBusy(false);}
  };
  const apply=async()=>{
    if(!selected||!workOrderId)return;
    setBusy(true);setError('');
    try{await aplicarChecklistTemplateV2DB(workOrderId,selected);await onApplied?.();}
    catch(e){setError(e?.message||'Não consegui aplicar o template nesta OS.');}
    finally{setBusy(false);}
  };

  return <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-[12px] font-medium text-slate-600">Template do checklist
        <select value={selected} onChange={e=>setSelected(e.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-[14px] text-slate-800 outline-none focus:ring-2 focus:ring-teal-500">
          <option value="">Selecione um template</option>
          {templates.filter(t=>t.active).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <button type="button" onClick={apply} disabled={!selected||busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white disabled:opacity-40"><ClipboardCheck size={16}/>Aplicar à OS</button>
      <button type="button" onClick={()=>{if(open){reset();setOpen(false);}else{reset();setOpen(true);}}} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700">{open?<ChevronUp size={16}/>:<ChevronDown size={16}/>}Templates</button>
    </div>
    {error&&<div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700"><span className="flex-1">{error}</span><button type="button" onClick={()=>setError('')} className="min-h-11 min-w-11 -my-2 inline-flex items-center justify-center"><X size={14}/></button></div>}

    {open&&<div className="mt-4 border-t border-slate-200 pt-4">
      {templates.length>0&&<div className="mb-4 flex flex-wrap gap-2">{templates.map(t=><button type="button" key={t.id} onClick={()=>edit(t)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-left text-[12px] text-slate-700"><span className="font-semibold">{t.name}</span>{!t.active&&<span className="ml-2 text-slate-400">inativo</span>}</button>)}</div>}
      <div className="grid gap-3">
        <label className="text-[12px] font-medium text-slate-600">Nome<input value={name} onChange={e=>setName(e.target.value.slice(0,300))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] outline-none focus:ring-2 focus:ring-teal-500" placeholder="Ex.: Instalação de fechadura digital"/></label>
        <label className="text-[12px] font-medium text-slate-600">Descrição opcional<textarea value={description} onChange={e=>setDescription(e.target.value.slice(0,2000))} rows={2} className="mt-1 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:ring-2 focus:ring-teal-500"/></label>
        <div className="space-y-2"><p className="text-[12px] font-medium text-slate-600">Itens</p>{items.map((item,index)=><div key={index} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-slate-200 bg-white p-2">
          <input value={item.text} onChange={e=>setItems(list=>list.map((x,i)=>i===index?{...x,text:e.target.value.slice(0,500)}:x))} className="min-h-11 min-w-0 rounded-lg px-2 text-[14px] outline-none focus:ring-2 focus:ring-teal-500" placeholder={`Item ${index+1}`}/>
          <button type="button" onClick={()=>setItems(list=>list.length===1?[blankItem()]:list.filter((_,i)=>i!==index))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label={`Remover item ${index+1}`}><Trash2 size={16}/></button>
          <label className="col-span-2 inline-flex min-h-11 items-center gap-3 px-2 text-[12px] text-slate-600"><input type="checkbox" checked={item.required} onChange={e=>setItems(list=>list.map((x,i)=>i===index?{...x,required:e.target.checked}:x))} className="h-5 w-5 accent-teal-700"/>Obrigatório para concluir a OS</label>
        </div>)}</div>
        <button type="button" onClick={()=>setItems(list=>[...list,blankItem()])} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 text-[13px] font-medium text-slate-600"><Plus size={16}/>Adicionar item</button>
        <label className="inline-flex min-h-11 items-center gap-3 text-[13px] text-slate-600"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} className="h-5 w-5 accent-teal-700"/>Template ativo</label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={()=>{reset();setOpen(false);}} className="min-h-11 rounded-xl px-4 text-[13px] font-semibold text-slate-600">Cancelar</button><button type="button" onClick={save} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-[13px] font-semibold text-white disabled:opacity-50"><Save size={16}/>{editing?'Salvar alterações':'Criar template'}</button></div>
      </div>
    </div>}
  </div>;
}
