import fs from 'node:fs';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

function replaceOnce(src, find, replacement, label) {
  const first = src.indexOf(find);
  if (first < 0) throw new Error(`Patch ${label}: trecho esperado não encontrado`);
  if (src.indexOf(find, first + find.length) >= 0) throw new Error(`Patch ${label}: trecho não é único`);
  return src.slice(0, first) + replacement + src.slice(first + find.length);
}

function replaceRange(src, start, end, replacement, label) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`Patch ${label}: início não encontrado`);
  const b = src.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`Patch ${label}: fim não encontrado`);
  if (src.indexOf(start, a + start.length) >= 0) throw new Error(`Patch ${label}: início não é único`);
  return src.slice(0, a) + replacement + src.slice(b);
}

// ---------------------------------------------------------------- data API
{
  const path = 'src/lib/dataApi.js';
  let s = read(path);

  const oldItem = `const fromItem = (x) => ({ id:x.id, tipo:itemKindFromDb[x.kind]||'livre', catalogoId:x.service_id||x.product_id||null, nome:x.name, unidade:x.unit||'unidade', qtd:n(x.quantity)||1, preco:n(x.unit_price), custo:n(x.unit_cost), obs:x.notes||'', adicional:Boolean(x.is_extra), aguardandoValor:Boolean(x.price_pending) });`;
  const newItem = `const fromItem = (x) => ({ id:x.id, tipo:itemKindFromDb[x.kind]||'livre', catalogoId:x.service_id||x.product_id||null, nome:x.name, unidade:x.unit||'unidade', qtd:n(x.quantity)||1, preco:n(x.unit_price), custo:n(x.unit_cost), obs:x.notes||'', adicional:Boolean(x.is_extra), aguardandoValor:Boolean(x.price_pending), garantiaPolitica:x.warranty_policy||'catalog', garantiaDiasOverride:x.warranty_override_days==null?null:Number(x.warranty_override_days), garantiaMesesOverride:x.warranty_override_months==null?null:Number(x.warranty_override_months) });`;
  if (!s.includes('garantiaPolitica:x.warranty_policy')) s = replaceOnce(s, oldItem, newItem, 'dataApi/fromItem');

  const oldFinalize = `export async function finalizarOSDB(id, extras={}){\n  const r=await supabase.rpc('zt_finalize_work_order_atomic',{\n    p_wo:id,\n    p_report:extras.relato||extras.relatorio||null,\n    p_pending:extras.pendencia||null,\n    p_extra_cost:Object.prototype.hasOwnProperty.call(extras,'custosExtras') ? n(extras.custosExtras) : null,\n    p_due_days:7,\n    p_materials:extras.materiaisDB||[],\n    p_additions:extras.adicionaisDB||[],\n  });\n  check(r);\n  return true;\n}`;
  const newFinalize = `export async function finalizarOSDB(id, extras={}){\n  const r=await supabase.rpc('zt_finalize_work_order_with_warranty_overrides',{\n    p_wo:id,\n    p_report:extras.relato||extras.relatorio||null,\n    p_pending:extras.pendencia||null,\n    p_extra_cost:Object.prototype.hasOwnProperty.call(extras,'custosExtras') ? n(extras.custosExtras) : null,\n    p_due_days:7,\n    p_materials:extras.materiaisDB||[],\n    p_additions:extras.adicionaisDB||[],\n    p_warranty_overrides:Array.isArray(extras.garantiaOverrides)?extras.garantiaOverrides:null,\n  });\n  check(r);\n  return true;\n}`;
  if (!s.includes("supabase.rpc('zt_finalize_work_order_with_warranty_overrides'")) s = replaceOnce(s, oldFinalize, newFinalize, 'dataApi/finalizarOSDB');

  write(path, s);
}

// --------------------------------------------------------------- runtime API
{
  const path = 'src/lib/runtimeApi.js';
  let s = read(path);

  const oldHydrate = `const mats=(mm.data||[]).filter(m=>m.work_order_id===o.id).map(m=>({id:m.id,tipo:'produto',catalogoId:m.product_id,nome:m.name,unidade:'unidade',qtd:Number(m.quantity||1),preco:0,custo:Number(m.unit_cost||0),materialRegistrado:true,serie:m.serial_number||''}));`;
  const newHydrate = `const mats=(mm.data||[]).filter(m=>m.work_order_id===o.id).map(m=>({id:m.id,tipo:'produto',catalogoId:m.product_id,nome:m.name,unidade:'unidade',qtd:Number(m.quantity||1),preco:0,custo:Number(m.unit_cost||0),materialRegistrado:true,serie:m.serial_number||'',garantiaPolitica:m.warranty_policy||'catalog',garantiaMesesOverride:m.warranty_override_months==null?null:Number(m.warranty_override_months)}));`;
  if (!s.includes("garantiaPolitica:m.warranty_policy")) s = replaceOnce(s, oldHydrate, newHydrate, 'runtime/hidratar material');

  const oldMaterial = `  const materiais=(extras.itens||[]).filter(i=>!baseIds.has(i.id) && !i.adicional && !i.isExtra).map(m=>({\n    product_id:isUuid(m.catalogoId)?m.catalogoId:null,\n    name:m.nome||'Material',\n    quantity:Number(m.qtd||1),\n    unit_cost:papel==='proprietario'?Number(m.custo||0):0,\n    serial_number:m.serie||null,\n  }));`;
  const newMaterial = `  const materiais=(extras.itens||[]).filter(i=>!baseIds.has(i.id) && !i.adicional && !i.isExtra).map(m=>{\n    const politica=papel==='proprietario'?(m.garantiaPolitica||'catalog'):'catalog';\n    return {\n      product_id:isUuid(m.catalogoId)?m.catalogoId:null,\n      name:m.nome||'Material',\n      quantity:Number(m.qtd||1),\n      unit_cost:papel==='proprietario'?Number(m.custo||0):0,\n      serial_number:m.serie||null,\n      warranty_policy:politica,\n      warranty_override_months:papel==='proprietario'&&politica==='custom'?Math.max(1,Math.min(120,Number(m.garantiaMesesOverride||1))):null,\n    };\n  });`;
  if (!s.includes('warranty_override_months:papel===')) s = replaceOnce(s, oldMaterial, newMaterial, 'runtime/preparar materiais');

  write(path, s);
}

// -------------------------------------------------------------- main UI flow
{
  const path = 'src/legacy/ZiisTecApp.jsx';
  let s = read(path);

  const stateNeedle = `  const [fotos, setFotos] = useState(os.fotos || []);\n  const [addProduto, setAddProduto] = useState(false);`;
  const stateReplacement = `  const [fotos, setFotos] = useState(os.fotos || []);\n  const [addProduto, setAddProduto] = useState(false);\n  const [garantiaOverrides, setGarantiaOverrides] = useState({});`;
  if (!s.includes('const [garantiaOverrides, setGarantiaOverrides]')) s = replaceOnce(s, stateNeedle, stateReplacement, 'ui/state garantia');

  const previewStart = `  /* Prévia das garantias que a conclusão vai registrar. O prazo vem do catálogo:`;
  const previewEnd = `  const adicionaisFinais = temAdicional ? adicionais : [];`;
  const newPreview = `  /* Garantia efetiva por linha da OS. O proprietário pode mudar apenas este\n     atendimento; o catálogo continua sendo o padrão dos próximos serviços. */\n  const execucaoPrevista = os.data || HOJE;\n  const itensGarantia = os.emGarantia ? [] : itensFinais.filter((i) =>\n    (i.tipo === "servico" || i.tipo === "produto") && i.catalogoId\n  );\n  const garantiaAtual = (i) => {\n    const local = garantiaOverrides[i.id] || {};\n    const politica = local.policy || i.garantiaPolitica || "catalog";\n    if (i.tipo === "servico") {\n      const cat = servicos.find((x) => x.id === i.catalogoId);\n      const catalogo = Math.max(0, Number(cat?.garantiaDias || 0));\n      const dias = Math.max(1, Math.min(3650, Number(local.days ?? i.garantiaDiasOverride ?? (catalogo || 90))));\n      const efetivo = politica === "disabled" ? 0 : politica === "custom" ? dias : catalogo;\n      return { politica, dias, meses: null, efetivo, unidade: "dias", origem: "Serviço", prazo: efetivo > 0 ? \`\${efetivo} dias\` : "sem garantia", ate: efetivo > 0 ? addDays(execucaoPrevista, efetivo) : null };\n    }\n    const cat = produtos.find((x) => x.id === i.catalogoId);\n    const catalogo = Math.max(0, Number(cat?.garantiaMeses || 0));\n    const meses = Math.max(1, Math.min(120, Number(local.months ?? i.garantiaMesesOverride ?? (catalogo || 12))));\n    const efetivo = politica === "disabled" ? 0 : politica === "custom" ? meses : catalogo;\n    return { politica, dias: null, meses, efetivo, unidade: "meses", origem: "Fabricante", prazo: efetivo > 0 ? \`\${efetivo} meses\` : "sem garantia", ate: efetivo > 0 ? addMeses(execucaoPrevista, efetivo) : null };\n  };\n  const ajustarGarantia = (i, patch) => {\n    const atual = garantiaAtual(i);\n    setGarantiaOverrides((prev) => ({\n      ...prev,\n      [i.id]: { policy: patch.policy ?? atual.politica, days: patch.days ?? atual.dias, months: patch.months ?? atual.meses },\n    }));\n  };\n  const itensComGarantia = itensFinais.map((i) => {\n    if (!itensGarantia.some((x) => x.id === i.id)) return i;\n    const g = garantiaAtual(i);\n    return { ...i, garantiaPolitica: g.politica, garantiaDiasOverride: g.politica === "custom" ? g.dias : null, garantiaMesesOverride: g.politica === "custom" ? g.meses : null };\n  });\n  const garantiaPayload = verValores && !os.emGarantia ? (os.itens || [])\n    .filter((i) => (i.tipo === "servico" || i.tipo === "produto") && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(i.id || "")))\n    .map((i) => {\n      const g = garantiaAtual(i);\n      return { item_id: i.id, policy: g.politica, ...(g.politica === "custom" ? (i.tipo === "servico" ? { days: g.dias } : { months: g.meses }) : {}) };\n    }) : null;\n  const garantiasPrevistas = itensGarantia.map((i) => ({ item: i, ...garantiaAtual(i) })).filter((g) => g.efetivo > 0);\n`;
  if (!s.includes('const [garantiaOverrides, setGarantiaOverrides]') || s.includes('Alterar prazo só para esta OS exigiria mudança')) {
    s = replaceRange(s, previewStart, previewEnd, newPreview + previewEnd, 'ui/previsao garantia');
  }

  const extrasOld = `  const extras = {\n    relato, itens: itensFinais, adicionais: adicionaisFinais, valorAdicional: 0, descricaoAdicional: "",\n    custosExtras: num(custosExtras),\n    pendencia: temPendencia ? pendencia : (resultado === "retorno" ? "Cliente precisa de novo atendimento." : ""),\n    precisaRetornar: resultado === "retorno",\n    fotos,\n  };`;
  const extrasNew = `  const extras = {\n    relato, itens: itensComGarantia, adicionais: adicionaisFinais, valorAdicional: 0, descricaoAdicional: "",\n    custosExtras: num(custosExtras),\n    pendencia: temPendencia ? pendencia : (resultado === "retorno" ? "Cliente precisa de novo atendimento." : ""),\n    precisaRetornar: resultado === "retorno",\n    garantiaOverrides: garantiaPayload,\n    fotos,\n  };`;
  if (!s.includes('garantiaOverrides: garantiaPayload')) s = replaceOnce(s, extrasOld, extrasNew, 'ui/extras garantia');

  const warrantyBlockStart = `            <div className="px-4 py-3.5">\n              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2">Garantias deste atendimento</p>`;
  const warrantyBlockEnd = `            </div>\n          </div>\n\n          <div>\n            <p className="text-[13px] font-medium text-slate-600 mb-2">Como este atendimento terminou?</p>`;
  const warrantyBlockNew = `            <div className="px-4 py-3.5">\n              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2">Garantias deste atendimento</p>\n              {itensGarantia.length === 0 ? (\n                <p className="text-[13.5px] text-slate-500 leading-relaxed">\n                  {os.emGarantia\n                    ? "Atendimento em garantia: a garantia original continua valendo."\n                    : "Nenhum serviço ou produto deste atendimento está ligado ao catálogo."}\n                </p>\n              ) : (\n                <div className="space-y-3">\n                  {itensGarantia.map((i) => {\n                    const g = garantiaAtual(i);\n                    return (\n                      <div key={i.id} className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">\n                        <div className="flex items-start justify-between gap-3">\n                          <div className="min-w-0">\n                            <p className="text-[13.5px] font-medium text-slate-800 truncate">{i.nome}</p>\n                            <p className="text-[12px] text-slate-400">{g.origem} · {g.prazo}{g.ate ? \` · até \${dataBR(g.ate)}\` : ""}</p>\n                          </div>\n                          {!verValores && <span className="text-[12px] text-slate-500 shrink-0">Padrão do catálogo</span>}\n                        </div>\n                        {verValores && (\n                          <div className="grid sm:grid-cols-[1fr_150px] gap-2 mt-3">\n                            <Select value={g.politica} onChange={(e) => ajustarGarantia(i, { policy: e.target.value })} aria-label={\`Garantia de \${i.nome}\`}>\n                              <option value="catalog">Padrão do catálogo</option>\n                              <option value="disabled">Sem garantia nesta OS</option>\n                              <option value="custom">Prazo personalizado</option>\n                            </Select>\n                            {g.politica === "custom" ? (\n                              <div className="flex items-center gap-2">\n                                <Input type="number" min="1" max={i.tipo === "servico" ? 3650 : 120}\n                                  value={i.tipo === "servico" ? g.dias : g.meses}\n                                  onChange={(e) => i.tipo === "servico"\n                                    ? ajustarGarantia(i, { days: Math.max(1, Math.min(3650, Number(e.target.value) || 1)) })\n                                    : ajustarGarantia(i, { months: Math.max(1, Math.min(120, Number(e.target.value) || 1)) })} />\n                                <span className="text-[12px] text-slate-500 shrink-0">{i.tipo === "servico" ? "dias" : "meses"}</span>\n                              </div>\n                            ) : <div className="hidden sm:block" />}\n                          </div>\n                        )}\n                      </div>\n                    );\n                  })}\n                  {verValores && (\n                    <p className="text-[12px] text-slate-400 leading-relaxed">\n                      A mudança feita aqui vale somente para esta OS e não altera o prazo padrão em “Serviços e produtos”.\n                    </p>\n                  )}\n                </div>\n              )}\n            </div>\n          </div>\n\n          <div>\n            <p className="text-[13px] font-medium text-slate-600 mb-2">Como este atendimento terminou?</p>`;
  if (s.includes('Para mudar, ajuste o item no catálogo antes de concluir.')) s = replaceRange(s, warrantyBlockStart, warrantyBlockEnd, warrantyBlockNew, 'ui/bloco garantia');

  // Demo/local mode must obey the same per-OS policy as real Supabase mode.
  const demoStart = `    /* garantias nascem do serviço executado; serviço e produto são registros separados */\n    const novasGarantias = [];`;
  const demoEnd = `    if (novasGarantias.length) setGarantias((g) => [...novasGarantias, ...g.filter((x) => x.osId !== osId)]);`;
  const demoNew = `    /* garantias nascem do serviço executado; serviço e produto são registros separados */\n    const novasGarantias = [];\n    if (!os.emGarantia) {\n      os.itens.forEach((i) => {\n        const politica = i.garantiaPolitica || "catalog";\n        if (i.tipo === "servico") {\n          const sv = servicos.find((x) => x.id === i.catalogoId);\n          const dias = politica === "disabled" ? 0 : politica === "custom" ? Number(i.garantiaDiasOverride || 0) : Number(sv?.garantiaDias || 0);\n          if (dias > 0) novasGarantias.push({\n            id: uid(), empresaId, clienteId: os.clienteId, osId, tipo: "servico", descricao: sv?.nome || i.nome, servicoId: sv?.id || i.catalogoId,\n            local: os.localServico, inicio: execucao, dias, ate: addDays(execucao, dias), serie: "",\n          });\n        } else if (i.tipo === "produto") {\n          const pr = produtos.find((x) => x.id === i.catalogoId);\n          const meses = politica === "disabled" ? 0 : politica === "custom" ? Number(i.garantiaMesesOverride || 0) : Number(pr?.garantiaMeses || 0);\n          if (meses > 0) novasGarantias.push({\n            id: uid(), empresaId, clienteId: os.clienteId, osId, tipo: "produto", descricao: i.nome, produtoId: pr?.id || i.catalogoId,\n            local: os.localServico, inicio: execucao, meses, ate: addMeses(execucao, meses), serie: extras.series?.[i.id] || "",\n          });\n        }\n      });\n    }\n    if (novasGarantias.length) setGarantias((g) => [...novasGarantias, ...g.filter((x) => x.osId !== osId)]);`;
  if (!s.includes('const politica = i.garantiaPolitica || "catalog";')) s = replaceRange(s, demoStart, demoEnd, demoNew, 'ui/demo garantia');

  write(path, s);
}

console.log('Warranty UI patch applied successfully.');
