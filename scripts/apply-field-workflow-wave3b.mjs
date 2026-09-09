import {readFileSync,writeFileSync} from 'node:fs';

function patchFile(file,marker,mutate){
  let src=readFileSync(file,'utf8');
  if(src.includes(marker)){console.log(`${file}: Wave 3B already applied`);return;}
  const before=src;
  const replace=(needle,replacement,label)=>{
    const count=src.split(needle).length-1;
    if(count!==1) throw new Error(`${file} · ${label}: expected 1 marker, got ${count}`);
    src=src.replace(needle,replacement);
  };
  mutate(src,replace);
  if(src===before) throw new Error(`${file}: no Wave 3B change applied`);
  src+=`\n/* ${marker} */\n`;
  writeFileSync(file,src,'utf8');
  console.log(`${file}: applied Wave 3B`);
}

patchFile('src/lib/dataApi.js','FIELD WORKFLOW V1 · wave 3b · return mapping',(src,replace)=>{
  replace("pendencia:x.pending_note||'', valorAdicional:0, emGarantia:Boolean(x.is_warranty_visit)",
    "pendencia:x.pending_note||'', precisaRetorno:Boolean(x.needs_return), valorAdicional:0, emGarantia:Boolean(x.is_warranty_visit)",'work order needs return mapping');
});

patchFile('src/lib/runtimeApi.js','FIELD WORKFLOW V1 · wave 3b · checklist and return hydration',(src,replace)=>{
  replace("const [rr,aa,mm,cc]=await Promise.all([\n    supabase.from('work_order_reports').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n    supabase.from('attachments').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n    supabase.from('work_order_materials').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n    supabase.from('work_order_checklists').select('*').eq('company_id',companyId).order('position',{ascending:true}),\n  ]);\n  check(rr);check(aa);check(mm);check(cc);",
    "const [rr,aa,mm,cc,rt]=await Promise.all([\n    supabase.from('work_order_reports').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n    supabase.from('attachments').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n    supabase.from('work_order_materials').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n    supabase.from('work_order_checklists').select('*').eq('company_id',companyId).order('position',{ascending:true}),\n    supabase.from('work_order_returns').select('*').eq('company_id',companyId).order('created_at',{ascending:true}),\n  ]);\n  check(rr);check(aa);check(mm);check(cc);check(rt);",'hydrate return source');
  replace("const checklist=(cc.data||[]).filter(c=>c.work_order_id===o.id).map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done)}));\n    const fotos=attachments.filter(a=>a.work_order_id===o.id)",
    "const checklist=(cc.data||[]).filter(c=>c.work_order_id===o.id).map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done),obrigatorio:Boolean(c.required),templateId:c.source_template_id||null}));\n    const retornos=(rt.data||[]).filter(r=>r.work_order_id===o.id);\n    const retornoHist=retornos.map(r=>({id:`return-${r.id}`,quando:(r.created_at||'').slice(0,10),texto:[`Precisa retornar · ${r.reason}`,r.material_needed?`Material necessário: ${r.material_needed}`:null,`Prioridade: ${{low:'baixa',normal:'normal',high:'alta',urgent:'urgente'}[r.priority]||r.priority}`,r.expected_return_date?`Previsão: ${String(r.expected_return_date).split('-').reverse().join('/')}`:null,r.returned_at?`Retorno realizado: ${new Date(r.returned_at).toLocaleDateString('pt-BR')}`:null,r.notes?`Observação: ${r.notes}`:null].filter(Boolean).join(' · ')}));\n    const fotos=attachments.filter(a=>a.work_order_id===o.id)",'checklist metadata and return history');
  replace("return {...o,relato:reports.at(-1)?.body||o.relato||'',historico:hist.length?hist:o.historico||[],checklist,fotos,itens:",
    "return {...o,relato:reports.at(-1)?.body||o.relato||'',historico:[...(hist.length?hist:o.historico||[]),...retornoHist].sort((a,b)=>(a.quando||'').localeCompare(b.quando||'')),retornos,checklist,fotos,itens:",'merge return history');
  replace("return fresh.map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done)}));",
    "return fresh.map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done),obrigatorio:Boolean(c.required),templateId:c.source_template_id||null}));",'fresh checklist metadata');
});

patchFile('src/legacy/ZiisTecApp.jsx','FIELD WORKFLOW V1 · wave 3b · checklist templates and return flow',(src,replace)=>{
  replace("import { resolverLogoEmpresaDB, persistirFotosOSDB } from \"../lib/storageExtras\";",
    "import { resolverLogoEmpresaDB, persistirFotosOSDB } from \"../lib/storageExtras\";\nimport ChecklistTemplatePicker from \"../components/ChecklistTemplatePicker\";\nimport { carregarChecklistOSV2DB, marcarRetornoOSV2DB, novoReturnRequestId } from \"../lib/checklistReturnV2Api\";",'wave3b imports');

  replace("          <section>\n            <Rotulo>Checklist do atendimento</Rotulo>\n            <Panel className=\"p-5\">",
    "          <section>\n            <Rotulo>Checklist do atendimento</Rotulo>\n            <Panel className=\"p-4 sm:p-5\">\n              {papel === \"proprietario\" && <ChecklistTemplatePicker companyId={empresaId} workOrderId={os.id} onApplied={async()=>{const checklist=await carregarChecklistOSV2DB(os.id);setOrdens(l=>l.map(x=>x.id===os.id?{...x,checklist:checklist.map(c=>({id:c.id,texto:c.text,feito:Boolean(c.done),obrigatorio:Boolean(c.required),templateId:c.source_template_id||null}))}:x));}} />}", 'owner template picker');
  replace("className={cx(\"w-full flex items-center gap-3 py-2.5 text-left group\", ring)}>",
    "className={cx(\"w-full min-h-11 flex items-center gap-3 py-2.5 text-left group\", ring)}>",'checklist touch target');
  replace("<span className={cx(\"text-[14px]\", k.feito ? \"text-slate-400 line-through\" : \"text-slate-700\")}>{k.texto}</span>",
    "<span className={cx(\"min-w-0 flex-1 break-words text-[14px]\", k.feito ? \"text-slate-400 line-through\" : \"text-slate-700\")}>{k.texto}</span>{k.obrigatorio&&<span className=\"shrink-0 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800\">Obrigatório</span>}",'required badge');

  replace("  const [resultado, setResultado] = useState(\"finalizado\");",
    "  const [resultado, setResultado] = useState(\"finalizado\");\n  const [retornoMotivo,setRetornoMotivo]=useState('');\n  const [retornoMaterial,setRetornoMaterial]=useState('');\n  const [retornoObs,setRetornoObs]=useState('');\n  const [retornoPrioridade,setRetornoPrioridade]=useState('normal');\n  const [retornoPrevisao,setRetornoPrevisao]=useState('');\n  const [retornoRequestId]=useState(()=>novoReturnRequestId());",'return form state');

  replace("    pendencia: temPendencia ? pendencia : (resultado === \"retorno\" ? \"Cliente precisa de novo atendimento.\" : \"\"),\n    precisaRetornar: resultado === \"retorno\",\n    fotos,",
    "    pendencia: temPendencia ? pendencia : (resultado === \"retorno\" ? retornoMotivo.trim() : \"\"),\n    precisaRetornar: resultado === \"retorno\",\n    retornoMotivo:retornoMotivo.trim(),retornoMaterial:retornoMaterial.trim(),retornoObs:retornoObs.trim(),\n    retornoPrioridade,retornoPrevisao:retornoPrevisao||null,retornoRequestId,\n    fotos,",'return payload');

  replace("            {resultado === \"retorno\" && (\n              <p className=\"text-[12.5px] text-amber-800 bg-amber-50 ring-1 ring-amber-200/70 rounded-xl px-3.5 py-3 mt-3 leading-relaxed\">\n                O atendimento é concluído e a pendência fica registrada para você abrir o retorno depois.\n              </p>\n            )}",
    "            {resultado === \"retorno\" && (\n              <div className=\"mt-3 space-y-3 rounded-2xl bg-amber-50 p-3.5 ring-1 ring-amber-200/70\">\n                <p className=\"text-[12.5px] leading-relaxed text-amber-900\">A OS continuará em andamento. Nenhuma cobrança, garantia ou relatório final será criado agora.</p>\n                <Field label=\"Motivo do retorno\"><textarea value={retornoMotivo} onChange={e=>setRetornoMotivo(e.target.value.slice(0,3000))} rows={3} placeholder=\"Ex.: falta peça de acabamento\" className=\"w-full min-w-0 resize-y rounded-xl border border-amber-200 bg-white px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-amber-500\" /></Field>\n                <Field label=\"Material necessário\"><textarea value={retornoMaterial} onChange={e=>setRetornoMaterial(e.target.value.slice(0,3000))} rows={2} placeholder=\"Peça, cabo, fonte, ferramenta...\" className=\"w-full min-w-0 resize-y rounded-xl border border-amber-200 bg-white px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-amber-500\" /></Field>\n                <Field label=\"Observação\"><textarea value={retornoObs} onChange={e=>setRetornoObs(e.target.value.slice(0,5000))} rows={3} className=\"w-full min-w-0 resize-y rounded-xl border border-amber-200 bg-white px-3 py-3 text-[14px] outline-none focus:ring-2 focus:ring-amber-500\" /></Field>\n                <div className=\"grid gap-3 sm:grid-cols-2\"><Field label=\"Prioridade\"><select value={retornoPrioridade} onChange={e=>setRetornoPrioridade(e.target.value)} className=\"min-h-11 w-full min-w-0 rounded-xl border border-amber-200 bg-white px-3 text-[14px] outline-none focus:ring-2 focus:ring-amber-500\"><option value=\"low\">Baixa</option><option value=\"normal\">Normal</option><option value=\"high\">Alta</option><option value=\"urgent\">Urgente</option></select></Field><Field label=\"Previsão de retorno\"><input type=\"date\" min={HOJE} value={retornoPrevisao} onChange={e=>setRetornoPrevisao(e.target.value)} className=\"min-h-11 w-full min-w-0 rounded-xl border border-amber-200 bg-white px-3 text-[14px] outline-none focus:ring-2 focus:ring-amber-500\" /></Field></div>\n              </div>\n            )}", 'return detail form');

  replace("                    : <Btn icon={Check} onClick={() => onFinalizar(extras)}>\n                        {resultado === \"retorno\" ? \"Concluir e marcar retorno\" : \"Concluir atendimento\"}\n                      </Btn>)",
    "                    : <Btn icon={Check} disabled={resultado===\"retorno\"&&!retornoMotivo.trim()} onClick={() => onFinalizar(extras)}>\n                        {resultado === \"retorno\" ? \"Salvar retorno sem concluir\" : \"Concluir atendimento\"}\n                      </Btn>)",'return final action');

  replace("      {finalizando && <FinalizarAtendimento os={os} onClose={() => setFinalizando(false)} servicos={servicos} produtos={produtos}\n        onSalvarParcial={(patch) => up(patch)} onFinalizar={(extras) => { finalizarOS(os.id, extras); setFinalizando(false); }} jaConcluida={os.status === \"concluida\"} verValores={verValores} />}",
    "      {finalizando && <FinalizarAtendimento os={os} onClose={() => setFinalizando(false)} servicos={servicos} produtos={produtos}\n        onSalvarParcial={(patch) => up(patch)} onFinalizar={async(extras) => {\n          if(extras.precisaRetornar){\n            try{\n              up({relato:extras.relato,fotos:extras.fotos,pendencia:extras.pendencia});\n              if(real) await marcarRetornoOSV2DB({workOrderId:os.id,reason:extras.retornoMotivo,materialNeeded:extras.retornoMaterial,notes:extras.retornoObs,priority:extras.retornoPrioridade,expectedReturnDate:extras.retornoPrevisao,requestId:extras.retornoRequestId});\n              setOrdens(l=>l.map(x=>x.id===os.id?{...x,precisaRetorno:true,pendencia:extras.pendencia||x.pendencia,historico:[...(x.historico||[]),{id:uid(),quando:HOJE,texto:`Precisa retornar · ${extras.retornoMotivo}` }]}:x));\n              setFinalizando(false);\n            }catch(e){aviso(mensagemErro(e));}\n            return;\n          }\n          finalizarOS(os.id, extras); setFinalizando(false);\n        }} jaConcluida={os.status === \"concluida\"} verValores={verValores} />}", 'route return away from finalization');
});
