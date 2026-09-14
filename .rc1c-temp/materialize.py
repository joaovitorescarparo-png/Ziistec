from pathlib import Path
import sys, json

ROOT=Path('.')
LEG=ROOT/'src/legacy/ZiisTecApp.jsx'
PAY=Path('/tmp/rc1c-wave49-payload')

def fail(msg): raise SystemExit(msg)

def replace_once(text, old, new, label):
    c=text.count(old)
    if c!=1: fail(f'{label}: expected exactly 1 anchor, found {c}')
    return text.replace(old,new,1)

def fn_bounds(text,name):
    start=text.find(f'function {name}(')
    if start<0: fail(f'function {name} not found')
    nxt=text.find('\nfunction ',start+1)
    return start, len(text) if nxt<0 else nxt+1

def replace_in_fn(text,name,old,new,label):
    a,b=fn_bounds(text,name)
    region=text[a:b]
    c=region.count(old)
    if c!=1: fail(f'{label} in {name}: expected 1 anchor, found {c}')
    return text[:a]+region.replace(old,new,1)+text[b:]

def replace_whole_fn(text,name,new_source):
    a,b=fn_bounds(text,name)
    return text[:a]+new_source.rstrip()+"\n"+text[b:]

def load(): return LEG.read_text()
def save(s): LEG.write_text(s)

def wave4():
    s=load()
    s=replace_in_fn(s,'Btn','  const sizes = { sm: "text-sm px-3 py-2", md: "text-sm px-4 py-3", lg: "text-base px-5 py-3.5" };','  const sizes = { sm: "min-h-11 text-sm px-3 py-2", md: "min-h-11 text-sm px-4 py-3", lg: "min-h-12 text-base px-5 py-3.5" };','button touch targets')
    s=replace_in_fn(s,'Modal','    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>','    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6 pt-[env(safe-area-inset-top)]" role="dialog" aria-modal="true" aria-label={title}>','modal safe top')
    s=replace_in_fn(s,'Modal','      <div className={cx("relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[92dvh] sm:max-h-[88dvh]", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>','      <div className={cx("relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[calc(100dvh-env(safe-area-inset-top))] sm:max-h-[88dvh]", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>','modal dvh')
    s=replace_in_fn(s,'Modal','        <div className="overflow-y-auto px-5 sm:px-7 pb-6 space-y-5">{children}</div>','        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7 pb-6 space-y-5">{children}</div>','modal scroll')
    s=replace_in_fn(s,'Modal','        {footer && <div className="px-5 sm:px-7 py-4 border-t border-slate-100 flex gap-3 justify-end">{footer}</div>}','        {footer && <div className="shrink-0 sticky bottom-0 bg-white px-5 sm:px-7 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-slate-100 flex flex-wrap gap-3 justify-end">{footer}</div>}','modal sticky footer')
    s=replace_in_fn(s,'OSDetalhe','  if (os.status === "andamento") acoes.push({ label: "Finalizar atendimento", icon: Check, fn: () => setFinalizando(true), principal: true });','  if (os.status === "andamento") acoes.push({ label: "Finalizar atendimento", icon: Check, fn: () => setFinalizando(true), principal: true });\n  const acaoPrincipal = acoes.find((acao) => acao.principal);\n  const acoesSecundarias = acoes.filter((acao) => !acao.principal);','os primary action')
    old='''        <div className="flex flex-wrap gap-2">\n          {acoes.map((a) => <Btn key={a.label} size="sm" icon={a.icon} variant={a.principal ? "primary" : "soft"} onClick={a.fn}>{a.label}</Btn>)}\n          {papel === "proprietario" && <Btn size="sm" variant="danger" icon={Trash2} onClick={() => excluirRegistro("os", os.id, os.numero, () => setOsAberta(null))}>Excluir OS</Btn>}\n          {podeAdministrarOS && os.status !== "concluida" && os.status !== "cancelada" && (\n            <Btn size="sm" variant="danger" onClick={() => pedirConfirmacao({\n              titulo: `Cancelar a ${os.numero}?`, texto: "A ordem sai da agenda e da lista de trabalhos em aberto. O histórico continua disponível.",\n              confirmar: "Cancelar ordem", acao: () => mudarStatusOS(os, "cancelada"),\n            })}>Cancelar OS</Btn>\n          )}\n        </div>\n      </div>\n\n'''
    new='''        <div className="flex items-center gap-2">\n          {acaoPrincipal && <Btn icon={acaoPrincipal.icon} onClick={acaoPrincipal.fn}>{acaoPrincipal.label}</Btn>}\n          {(acoesSecundarias.length > 0 || papel === "proprietario" || (podeAdministrarOS && os.status !== "concluida" && os.status !== "cancelada")) && (\n            <details className="relative group" data-no-edge-swipe>\n              <summary className={cx("list-none min-h-11 cursor-pointer inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50", ring)}>Mais<ChevronDown className="w-4 h-4" /></summary>\n              <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl ring-1 ring-slate-200">\n                {acoesSecundarias.map((acao) => <button key={acao.label} type="button" onClick={acao.fn} className={cx("w-full min-h-11 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50", ring)}>{acao.label}</button>)}\n                {papel === "proprietario" && <button type="button" onClick={() => excluirRegistro("os", os.id, os.numero, () => setOsAberta(null))} className={cx("w-full min-h-11 rounded-xl px-3 py-2.5 text-left text-sm text-rose-700 hover:bg-rose-50", ring)}>Excluir OS</button>}\n                {podeAdministrarOS && os.status !== "concluida" && os.status !== "cancelada" && <button type="button" onClick={() => pedirConfirmacao({ titulo: `Cancelar a ${os.numero}?`, texto: "A ordem sai da agenda e da lista de trabalhos em aberto. O histórico continua disponível.", confirmar: "Cancelar ordem", acao: () => mudarStatusOS(os, "cancelada") })} className={cx("w-full min-h-11 rounded-xl px-3 py-2.5 text-left text-sm text-rose-700 hover:bg-rose-50", ring)}>Cancelar OS</button>}\n              </div>\n            </details>\n          )}\n        </div>\n      </div>\n\n      <Panel className="p-4 sm:p-5 mb-5">\n        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">\n          <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-slate-400">Cliente</p><p className="mt-1 font-medium text-slate-900 truncate">{c?.fantasia || c?.nome || nomeCliente(os.clienteId)}</p></div>\n          <div><p className="text-[11px] uppercase tracking-wide text-slate-400">Data e horário</p><p className="mt-1 text-sm text-slate-700">{os.data ? `${dataBR(os.data)}${os.hora ? ` · ${os.hora}` : ""}` : "Sem agendamento"}</p></div>\n          <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-slate-400">Endereço</p><div className="mt-1"><Endereco valor={os.local} local={os.localServico} compacto /></div></div>\n          <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-slate-400">Serviço</p><p className="mt-1 text-sm text-slate-700 line-clamp-2">{resumoOS(os)}</p></div>\n        </div>\n      </Panel>\n\n'''
    s=replace_in_fn(s,'OSDetalhe',old,new,'os action hierarchy and summary')
    save(s)
    t='''import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nconst legacy=fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx',import.meta.url),'utf8');\ntest('OS mobile exposes one execution CTA and groups admin/destructive actions',()=>{\n assert.match(legacy,/const acaoPrincipal = acoes\\.find/);\n assert.match(legacy,/<summary[^>]*>Mais<ChevronDown/);\n assert.match(legacy,/>Excluir OS<\\/button>/); assert.match(legacy,/>Cancelar OS<\\/button>/);\n assert.match(legacy,/Data e horário/); assert.match(legacy,/Endereco valor=\\{os\\.local\\}/); assert.match(legacy,/Serviço<\\/p>/);\n});\ntest('shared mobile modal keeps safe areas, sticky footer and comfortable touch targets',()=>{\n assert.match(legacy,/max-h-\\[calc\\(100dvh-env\\(safe-area-inset-top\\)\\)\\]/);\n assert.match(legacy,/sticky bottom-0 bg-white/); assert.match(legacy,/pb-\\[max\\(1rem,env\\(safe-area-inset-bottom\\)\\)\\]/);\n assert.match(legacy,/const sizes = \\{ sm: "min-h-11/);\n});\n'''
    (ROOT/'tests/blockers/rc1c_mobile_work_order.test.mjs').write_text(t)

def wave5():
    s=load()
    s=replace_once(s,'import GlobalSearchModal from "../components/GlobalSearchModal";','import GlobalSearchModal from "../components/GlobalSearchModal";\nimport BarcodeScanner from "../components/BarcodeScanner";','barcode import')
    s=replace_once(s,'import { resolverLogoEmpresaDB, persistirFotosOSDB } from "../lib/storageExtras";','import { resolverLogoEmpresaDB, persistirFotosOSDB, resolverImagemProdutoDB, salvarImagemProdutoDB, removerImagemProdutoDB } from "../lib/storageExtras";','product storage imports')
    old='''    setProdutos((l) => (p.id ? l.map((x) => (x.id === p.id ? p : x)) : [...l, { ...p, id: uid(), empresaId }]));\n    aviso(p.id ? "Produto atualizado" : "Produto cadastrado");\n  };'''
    new='''    let id = p.id;\n    if (p.id) setProdutos((l) => l.map((x) => (x.id === p.id ? p : x)));\n    else { id = uid(); setProdutos((l) => [...l, { ...p, id, empresaId }]); }\n    aviso(p.id ? "Produto atualizado" : "Produto cadastrado");\n    return id;\n  };'''
    s=replace_once(s,old,new,'mock product save returns id')
    s=replace_once(s,'    pedirConfirmacao: setConfirmar, excluirRegistro,\n  };','    pedirConfirmacao: setConfirmar, excluirRegistro, contexto,\n  };','context prop')
    cat=(PAY/'Catalogo.jsxpart').read_text()
    s=replace_whole_fn(s,'Catalogo',cat)
    save(s)
    (ROOT/'tests/blockers/rc1c_product_primary_parity.test.mjs').write_text((PAY/'rc1c_product_primary_parity.test.mjs').read_text())

def wave689():
    s=load()
    s=replace_in_fn(s,'ClienteForm','<Field label="Telefone"><Input value={form.telefone || ""} onChange={(e) => set("telefone", e.target.value)} placeholder="(00) 0000-0000" /></Field>','<Field label="Telefone"><Input inputMode="tel" value={form.telefone || ""} onChange={(e) => set("telefone", e.target.value)} placeholder="(00) 0000-0000" /></Field>','phone inputMode')
    s=replace_in_fn(s,'ClienteForm','<Field label="WhatsApp"><Input value={form.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} placeholder="(00) 00000-0000" /></Field>','<Field label="WhatsApp"><Input inputMode="tel" value={form.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} placeholder="(00) 00000-0000" /></Field>','whatsapp inputMode')
    s=replace_in_fn(s,'OrcamentoEditor','<div className="grid grid-cols-3 gap-3 sm:gap-4 items-end">','<div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 items-end">','quote item responsive grid')
    s=replace_in_fn(s,'OrcamentoEditor','<Input type="number" min="0" step="0.5" value={i.qtd} onChange={(e) => upItem(i.id, "qtd", num(e.target.value))} className="text-center" />','<Input type="number" inputMode="decimal" min="0" step="0.5" value={i.qtd} onChange={(e) => upItem(i.id, "qtd", num(e.target.value))} className="text-center" />','quote quantity inputmode')
    s=replace_in_fn(s,'OrcamentoEditor','<div className="text-right pb-3">\n                          <p className="text-[12px] text-slate-400">Total</p>','<div className="text-left sm:text-right pb-1 sm:pb-3">\n                          <p className="text-[12px] text-slate-400">Total</p>','quote total mobile align')
    s=replace_in_fn(s,'OrcamentoEditor','<div className="lg:hidden sticky bottom-0 -mx-4 sm:-mx-8 mt-6 border-t border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-8 py-3 flex items-center justify-between gap-4 z-20">','<div className="lg:hidden sticky bottom-0 -mx-4 sm:-mx-8 mt-6 border-t border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-8 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-4 z-20">','quote sticky safe area')
    s=replace_in_fn(s,'CompraForm','<div className="grid grid-cols-3 gap-3 items-end mt-3">','<div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 gap-3 items-end mt-3">','purchase responsive grid')
    s=replace_in_fn(s,'CompraForm','<Field label="Quantidade"><Input type="number" min="1" value={i.qtd} onChange={(e) => upItem(i.id, "qtd", Number(e.target.value))} /></Field>','<Field label="Quantidade"><Input type="number" inputMode="numeric" min="1" value={i.qtd} onChange={(e) => upItem(i.id, "qtd", Number(e.target.value))} /></Field>','purchase qty inputmode')
    s=replace_in_fn(s,'CompraForm','<Field label="Custo unitário"><Input type="number" min="0" value={i.custo} onChange={(e) => upItem(i.id, "custo", Number(e.target.value))} /></Field>','<Field label="Custo unitário"><Input type="number" inputMode="decimal" step="0.01" min="0" value={i.custo} onChange={(e) => upItem(i.id, "custo", Number(e.target.value))} /></Field>','purchase cost inputmode')
    s=replace_in_fn(s,'CompraForm','<div className="text-right pb-3"><p className="text-[12px] text-slate-400">Total</p>','<div className="text-left sm:text-right pb-1 sm:pb-3"><p className="text-[12px] text-slate-400">Total</p>','purchase total align')
    save(s)
    (ROOT/'tests/blockers/rc1c_mobile_field_workflow.test.mjs').write_text((PAY/'rc1c_mobile_field_workflow.test.mjs').read_text())

def wave7():
    (ROOT/'api/quote-pdf.js').write_text((PAY/'quote-pdf.js').read_text())
    (ROOT/'api/quotePdfLayout.js').write_text((PAY/'quotePdfLayout.js').read_text())
    (ROOT/'tests/blockers/rc1c_quote_pdf_pagination.test.mjs').write_text((PAY/'rc1c_quote_pdf_pagination.test.mjs').read_text())
    pkg=json.loads((ROOT/'package.json').read_text())
    verify=pkg['scripts']['verify:v2']
    extras=['tests/blockers/rc1c_mobile_work_order.test.mjs','tests/blockers/rc1c_mobile_field_workflow.test.mjs','tests/blockers/rc1c_product_primary_parity.test.mjs','tests/blockers/rc1c_quote_pdf_pagination.test.mjs']
    for x in extras:
      if x not in verify: verify += ' '+x
    pkg['scripts']['verify:v2']=verify
    (ROOT/'package.json').write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    if len(sys.argv)!=2: fail('usage: materialize.py wave4|wave5|wave689|wave7')
    globals()[sys.argv[1]]()
    print(f'RC1C_MATERIALIZE_{sys.argv[1].upper()}=PASS')
