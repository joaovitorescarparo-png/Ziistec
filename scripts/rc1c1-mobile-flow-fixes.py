from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing anchor: {label}')
    if text.count(old) != 1:
        raise SystemExit(f'non-unique anchor ({text.count(old)}): {label}')
    return text.replace(old, new, 1)


def sub_once(text, pattern, repl, label, flags=0):
    next_text, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'pattern count {count}: {label}')
    return next_text


# ---- Commit 1 surfaces: work-order write/read flow ----
path='src/lib/dataApi.js'
s=read(path)
loader_match=re.search(r"async function carregarOSCompletaDB\(id\) \{\n.*?\n\}", s, re.S)
if not loader_match:
    raise SystemExit('missing carregarOSCompletaDB')
loader=loader_match.group(0)
helpers=loader+"""

export async function carregarOSPorIdDB(id) {
  return fromWorkOrder(await carregarOSCompletaDB(id));
}

export async function carregarOSPorOrcamentoDB(quoteId, companyId) {
  if (!quoteId || !companyId) return null;
  const response = await supabase.from('work_orders').select(WO_SELECT)
    .eq('company_id',companyId).eq('quote_id',quoteId).is('deleted_at',null)
    .order('created_at',{ascending:true}).limit(1).maybeSingle();
  if (response.error) throw response.error;
  if (!response.data) return null;
  const { itemCosts, materialCosts, extraCosts } = await carregarCustosPrivados(companyId,response.data.id);
  return fromWorkOrder(aplicarCustosPrivados([response.data],itemCosts,materialCosts,extraCosts)[0]);
}"""
s=s[:loader_match.start()]+helpers+s[loader_match.end():]
count=s.count('return fromWorkOrder(await carregarOSCompletaDB(id));')
if count != 2:
    raise SystemExit(f'expected 2 individual reload callsites, got {count}')
s=s.replace('return fromWorkOrder(await carregarOSCompletaDB(id));','return carregarOSPorIdDB(id);')
write(path,s)

path='src/lib/dataApiExtras.js'
s=read(path)
s=replace_once(s,
    "import { carregarDadosEmpresa, salvarOSDB, salvarOrcamentoDB } from './dataApi';",
    "import { carregarOSPorIdDB, salvarOSDB, salvarOrcamentoDB } from './dataApi';",
    'dataApiExtras import')
s=replace_once(s,
    "  const id=check(response);\n  const dados=await carregarDadosEmpresa(companyId);\n  const nova=(dados?.ordens||[]).find((o)=>o.id===id);\n  if(!nova) throw new Error('A OS foi criada, mas não pôde ser recarregada.');\n  return nova;",
    "  const id=check(response);\n  const nova=await carregarOSPorIdDB(id);\n  if(!nova) throw new Error('A OS foi criada, mas não pôde ser recarregada.');\n  return nova;",
    'quote to work order reload')
write(path,s)

path='src/legacy/ZiisTecApp.jsx'
s=read(path)
s=replace_once(s,
    '  recarregarSeguro, salvarClienteDB, salvarServicoDB, salvarProdutoDB, salvarOrcamentoDB,\n  salvarOSDB, atualizarOSDB, finalizarOSDB, resolverPrecificacaoOSDB, baixarLancamentoDB, salvarLancamentoDB, atualizarStatusOrcamentoDB,',
    '  recarregarSeguro, salvarClienteDB, salvarServicoDB, salvarProdutoDB, salvarOrcamentoDB,\n  salvarOSDB, carregarOSPorOrcamentoDB, atualizarOSDB, finalizarOSDB, resolverPrecificacaoOSDB, baixarLancamentoDB, salvarLancamentoDB, atualizarStatusOrcamentoDB,',
    'legacy dataApi import')

salvar_pattern=r"  const salvarOS = async \(os\) => \{\n.*?\n  \};\n  const agendarOS = async"
salvar_new="""  const abrirOSVinculada = (existente, orcamentoId) => {
    setOrdens((lista) => lista.some((x) => x.id === existente.id)
      ? lista.map((x) => x.id === existente.id ? existente : x)
      : [existente, ...lista]);
    setOrcamentos((lista) => lista.map((o) => o.id === orcamentoId ? { ...o, osId: existente.id } : o));
    setOsAberta(existente.id);
    aviso(`${existente.numero || "A OS"} já está vinculada a este orçamento.`);
    return existente.id;
  };
  const salvarOS = async (os) => {
    const orcamentoId = os.orcamentoId || null;
    if (!os.id && orcamentoId) {
      const local = ordens.find((x) => x.orcamentoId === orcamentoId);
      if (local) return abrirOSVinculada(local, orcamentoId);
      if (real) {
        try {
          const existente = await carregarOSPorOrcamentoDB(orcamentoId, empresaId);
          if (existente) return abrirOSVinculada(existente, orcamentoId);
        } catch (e) {
          aviso(mensagemErro(e));
          return null;
        }
      }
    }
    if (real) {
      try {
        const salvo = await salvarOSDB(os,empresaId,usuarioAtual?.id);
        setOrdens((lista) => lista.some((x) => x.id === salvo.id)
          ? lista.map((x) => x.id === salvo.id ? salvo : x)
          : [salvo, ...lista]);
        if (salvo.orcamentoId) setOrcamentos((lista) => lista.map((o) => o.id === salvo.orcamentoId ? { ...o, osId: salvo.id } : o));
        setOsAberta(salvo.id);
        aviso("Ordem de serviço salva");
        return salvo.id;
      } catch(e) {
        if (!os.id && orcamentoId) {
          try {
            const existente = await carregarOSPorOrcamentoDB(orcamentoId, empresaId);
            if (existente) return abrirOSVinculada(existente, orcamentoId);
          } catch {}
        }
        aviso(mensagemErro(e));
        return null;
      }
    }
    let salvoId = os.id || null;
    if (os.id) setOrdens((l) => l.map((x) => (x.id === os.id ? os : x)));
    else {
      const nova = { ...osBase, ...os, id: uid(), empresaId, numero: proxNumero(doTenant(ordens), "OS"), responsavelId: os.responsavelId || usuarioAtual?.id, historico: [{ id: uid(), quando: HOJE, texto: "Ordem de serviço criada" }] };
      salvoId = nova.id;
      setOrdens((l) => [nova, ...l]);
      if (nova.orcamentoId) setOrcamentos((l) => l.map((o) => o.id === nova.orcamentoId ? { ...o, osId: nova.id } : o));
      setOsAberta(nova.id);
    }
    aviso("Ordem de serviço salva");
    return salvoId;
  };
  const agendarOS = async"""
s=sub_once(s,salvar_pattern,salvar_new,'salvarOS block',re.S)

s=replace_once(s,
    'function Agenda({ ordens, nomeCliente, abrirOS, agendarOS, desagendarOS, empresa, equipe, clientes, servicos, produtos, salvarOS, salvarCliente, usuarioAtual, papel, pedirConfirmacao }) {',
    'function Agenda({ ordens, nomeCliente, abrirOS, agendarOS, desagendarOS, empresa, equipe, clientes, servicos, produtos, orcamentos, salvarOS, salvarCliente, usuarioAtual, papel, pedirConfirmacao }) {',
    'Agenda props')
s=replace_once(s,
    'salvarOS={salvarOS} salvarCliente={salvarCliente} equipe={equipe} usuarioAtual={usuarioAtual} dataInicial={dia} />',
    'salvarOS={salvarOS} salvarCliente={salvarCliente} equipe={equipe} usuarioAtual={usuarioAtual} dataInicial={dia} orcamentos={orcamentos} />',
    'Agenda NovaOS quote prop')
s=replace_once(s,
    'function NovaOS({ onClose, clientes, servicos, produtos, empresa, salvarOS, salvarCliente, equipe = [], usuarioAtual, dataInicial = "" }) {',
    'function NovaOS({ onClose, clientes, servicos, produtos, orcamentos = [], empresa, salvarOS, salvarCliente, equipe = [], usuarioAtual, dataInicial = "" }) {',
    'NovaOS props')
s=replace_once(s,
    '    clienteId: "", descricaoLivre: "", local: "", localServico: "",\n    itens: [], data: dataInicial || "", hora: "09:00", responsavel: empresa.responsavel, responsavelId: usuarioAtual?.id || null, obs: "",',
    '    clienteId: "", orcamentoId: "", descricaoLivre: "", local: "", localServico: "",\n    itens: [], data: dataInicial || "", hora: "09:00", responsavel: empresa.responsavel, responsavelId: usuarioAtual?.id || null, obs: "",',
    'NovaOS state quote id')
s=replace_once(s,
    '  const [catalogo, setCatalogo] = useState(false);\n  const [abaCat, setAbaCat] = useState("servicos");',
    '  const [catalogo, setCatalogo] = useState(false);\n  const [abaCat, setAbaCat] = useState("servicos");\n  const [erroCriacao, setErroCriacao] = useState("");\n  const requestIdRef = useRef(null);',
    'NovaOS retry state')
s=replace_once(s,
    '  const escolherCliente = (id) => {\n    const cl = clientes.find((x) => x.id === id);\n    setF((s) => ({ ...s, clienteId: id, local: cl?.endereco || s.local }));\n  };\n  const pronto = f.clienteId && (f.descricaoLivre.trim() || f.itens.length > 0);',
    '  const escolherCliente = (id) => {\n    const cl = clientes.find((x) => x.id === id);\n    setF((s) => ({ ...s, clienteId: id, orcamentoId: orcamentos.some((o) => o.id === s.orcamentoId && o.clienteId === id) ? s.orcamentoId : "", local: cl?.endereco || s.local }));\n  };\n  const orcamentosCliente = f.clienteId ? orcamentos.filter((o) => o.clienteId === f.clienteId) : [];\n  const pronto = f.clienteId && (f.descricaoLivre.trim() || f.itens.length > 0);',
    'NovaOS client quote filtering')
create_old='''  const [criando, setCriando] = useState(false);\n  const criar = async () => {\n    if (criando) return;\n    setCriando(true);\n    try {\n      await salvarOS({\n        ...f, status: f.data ? "agendada" : "aguardando", checklist: [],\n        responsavel: f.responsavel || empresa.responsavel,\n      });\n      onClose();\n    } finally {\n      setCriando(false);\n    }\n  };'''
create_new='''  const [criando, setCriando] = useState(false);\n  const criar = async () => {\n    if (criando) return;\n    setCriando(true);\n    setErroCriacao("");\n    try {\n      if (!requestIdRef.current) {\n        if (!globalThis.crypto?.randomUUID) throw new Error("Seu navegador precisa ser atualizado para salvar esta OS com segurança.");\n        requestIdRef.current = globalThis.crypto.randomUUID();\n      }\n      const salvoId = await salvarOS({\n        ...f, requestId: requestIdRef.current, status: f.data ? "agendada" : "aguardando", checklist: [],\n        responsavel: f.responsavel || empresa.responsavel,\n      });\n      if (!salvoId) {\n        setErroCriacao("Não foi possível salvar a ordem. Os dados preenchidos foram mantidos; tente novamente.");\n        return;\n      }\n      onClose();\n    } catch (e) {\n      setErroCriacao(mensagemErro(e) || "Não foi possível salvar a ordem. Tente novamente.");\n    } finally {\n      setCriando(false);\n    }\n  };'''
s=replace_once(s,create_old,create_new,'NovaOS create flow')

client_pattern=r'(        <Field label="Cliente">\n.*?\n        </Field>)'
client_match=re.search(client_pattern,s,re.S)
if not client_match:
    raise SystemExit('missing NovaOS client field')
quote_field='''\n\n        {f.clienteId && <Field label="Orçamento vinculado (opcional)">\n          <Select value={f.orcamentoId || ""} onChange={(e) => set("orcamentoId", e.target.value)}>\n            <option value="">Sem orçamento vinculado</option>\n            {orcamentosCliente.map((o) => <option key={o.id} value={o.id}>{o.numero}{o.osId ? " · OS já criada" : ""}</option>)}\n          </Select>\n          <p className="mt-1.5 text-[12px] text-slate-500">Mostra somente orçamentos deste cliente. Se já houver uma OS vinculada, ela será aberta em vez de criar outra.</p>\n        </Field>}'''
s=s[:client_match.end()]+quote_field+s[client_match.end():]
s=replace_once(s,
    '        footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>\n          <Btn disabled={!pronto || criando} onClick={criar}>{criando ? "Criando…" : "Abrir ordem de serviço"}</Btn></>}>\n\n        <Field label="Cliente">',
    '        footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>\n          <Btn disabled={!pronto || criando} onClick={criar}>{criando ? "Criando…" : "Abrir ordem de serviço"}</Btn></>}>\n\n        {erroCriacao && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{erroCriacao}</div>}\n        <Field label="Cliente">',
    'NovaOS local error')
write(path,s)

Path('tests/blockers/rc1c1_mobile_flow_fixes.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacy=fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../../src/lib/dataApi.js',import.meta.url),'utf8');
const extras=fs.readFileSync(new URL('../../src/lib/dataApiExtras.js',import.meta.url),'utf8');
const session=fs.readFileSync(new URL('../../src/lib/useSessao.js',import.meta.url),'utf8');

test('manual NovaOS keeps modal/data on failed save and reuses one request id across retry',()=>{
  const start=legacy.indexOf('function NovaOS(');
  const end=legacy.indexOf('\nfunction ',start+20);
  const block=legacy.slice(start,end);
  assert.match(block,/const requestIdRef = useRef\(null\)/);
  assert.match(block,/requestId: requestIdRef\.current/);
  assert.match(block,/const salvoId = await salvarOS/);
  assert.match(block,/if \(!salvoId\)[\s\S]*setErroCriacao/);
  assert.match(block,/if \(!salvoId\)[\s\S]*return;[\s\S]*onClose\(\)/);
  assert.match(block,/role="alert"/);
});

test('manual NovaOS can link client quotes and opens an existing linked OS instead of duplicating',()=>{
  assert.match(legacy,/Orçamento vinculado \(opcional\)/);
  assert.match(legacy,/orcamentos\.filter\(\(o\) => o\.clienteId === f\.clienteId\)/);
  assert.match(legacy,/carregarOSPorOrcamentoDB\(orcamentoId, empresaId\)/);
  assert.match(legacy,/return abrirOSVinculada\(existente, orcamentoId\)/);
  assert.match(data,/quote_id:x\.orcamentoId\|\|null/);
  assert.match(data,/export async function carregarOSPorOrcamentoDB/);
});

test('quote to OS reloads only the newly created work order',()=>{
  assert.doesNotMatch(extras,/carregarDadosEmpresa/);
  assert.match(extras,/const nova=await carregarOSPorIdDB\(id\)/);
  assert.match(data,/export async function carregarOSPorIdDB/);
});

test('local OS save does not invoke tenant-wide reload and access revalidation remains enabled',()=>{
  const start=legacy.indexOf('const salvarOS = async (os) =>');
  const end=legacy.indexOf('const agendarOS = async',start);
  const block=legacy.slice(start,end);
  assert.doesNotMatch(block,/recarregarDados|recarregarSeguro/);
  assert.match(session,/window\.addEventListener\("focus", aoFocar\)/);
  assert.match(session,/document\.addEventListener\("visibilitychange", aoVisibilizar\)/);
});
''')

# ---- Commit 2 surfaces: product image editor/PDF flow ----
path='src/lib/quoteV2Api.js'
s=read(path)
s=replace_once(s,
    "const mapProduct = (x) => ({ id:x.id, tipo:'produto', nome:x.name, marca:x.brand || '', modelo:x.model || '', unidade:x.unit || 'unidade', preco:n(x.price), custo:n(x.cost), ativo:x.active !== false });",
    "const mapProduct = (x) => ({ id:x.id, tipo:'produto', nome:x.name, marca:x.brand || '', modelo:x.model || '', unidade:x.unit || 'unidade', preco:n(x.price), custo:n(x.cost), ativo:x.active !== false, imagemPath:x.image_path || null });",
    'quoteV2 product image mapping')
s=replace_once(s,
    ".from('products').select('id,name,brand,model,unit,price,cost,active').eq('company_id',companyId)",
    ".from('products').select('id,name,brand,model,unit,price,cost,active,image_path').eq('company_id',companyId)",
    'quoteV2 image_path select')
write(path,s)

path='src/screens/v2/QuoteAIBaseV2.jsx'
s=read(path)
s=replace_once(s,
    "import { mensagemErro } from '../../lib/supabase';",
    "import { mensagemErro } from '../../lib/supabase';\nimport { resolverImagemProdutoDB } from '../../lib/storageExtras';",
    'quote editor storage import')
anchor="function SummaryCard({label,value,detail,tone='default'}) {\n  const valueClass=tone==='good'?'text-emerald-700':tone==='warn'?'text-amber-700':'text-slate-900';\n  return <div className=\"rounded-2xl border border-slate-200 bg-white p-4\"><p className=\"text-[10px] font-bold uppercase tracking-wider text-slate-400\">{label}</p><p className={`mt-1 text-lg font-bold ${valueClass}`}>{value}</p>{detail&&<p className=\"mt-1 text-xs text-slate-500\">{detail}</p>}</div>;\n}"
thumb=anchor+"""

function ProductThumb({path,name}) {
  const [url,setUrl]=useState('');
  useEffect(()=>{
    let active=true;
    if(!path){setUrl('');return()=>{active=false;};}
    resolverImagemProdutoDB(path).then(value=>{if(active)setUrl(value||'');}).catch(()=>{if(active)setUrl('');});
    return()=>{active=false;};
  },[path]);
  if(!path)return null;
  return <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">{url?<img src={url} alt={`Miniatura de ${name||'produto'}`} className="h-14 w-14 rounded-lg object-cover"/>:<div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-200 text-[10px] text-slate-500">Sem prévia</div>}<div><p className="text-xs font-semibold text-slate-700">Miniatura do produto</p><p className="text-[11px] text-slate-500">Será usada no PDF quando a opção de imagens estiver ativada.</p></div></div>;
}"""
s=replace_once(s,anchor,thumb,'ProductThumb component')
s=replace_once(s,
    "const rowCost=num(item.qtd)*num(item.custo);return <div",
    "const rowCost=num(item.qtd)*num(item.custo);const catalogProduct=item.tipo==='produto'?productMap.get(item.catalogoId):null;return <div",
    'catalog product in item editor')
s=replace_once(s,
    "</div>{item.tipo==='livre'&&<div className=\"mt-3 grid gap-3 sm:grid-cols-[1fr_180px]\">",
    "</div>{catalogProduct?.imagemPath&&<ProductThumb path={catalogProduct.imagemPath} name={catalogProduct.nome}/>} {item.tipo==='livre'&&<div className=\"mt-3 grid gap-3 sm:grid-cols-[1fr_180px]\">",
    'product thumbnail render')
write(path,s)

path='api/quote-pdf.js'
s=read(path)
func_pattern=r"async function carregarImagemProduto\(path,auth,pdf\)\{\n.*?\n\}"
func_new="""async function carregarImagemProduto(path,auth,pdf){
  if(!path)return {image:null,note:''};
  const encoded=String(path).split('/').map(encodeURIComponent).join('/');
  for(const bucket of ['zt-product-images','zt-branding']){
    try{
      const r=await sbFetch(`/storage/v1/object/authenticated/${bucket}/${encoded}`,auth);
      const bytes=new Uint8Array(await r.arrayBuffer());
      if(bytes.byteLength>2*1024*1024)continue;
      const ct=String(r.headers.get('content-type')||'').toLowerCase();
      if(ct.includes('png')) return {image:await pdf.embedPng(bytes),note:''};
      if(ct.includes('jpeg')||ct.includes('jpg')) return {image:await pdf.embedJpg(bytes),note:''};
      if(ct.includes('webp')) return {image:null,note:'Imagem do produto em WEBP não pode ser incorporada diretamente; use JPG ou PNG para exibi-la no PDF.'};
    }catch{}
  }
  return {image:null,note:''};
}"""
s=sub_once(s,func_pattern,func_new,'PDF product image loader',re.S)
s=replace_once(s,
    "      const productImage=quote.show_product_images&&productMeta?.image_path ? await carregarImagemProduto(productMeta.image_path,auth,pdf) : null;\n      const textW=productImage?218:270;\n      const desc = wrapText(item.name || 'Item', normal, 9.2, textW);\n      const notes = item.notes ? wrapText(item.notes, normal, 7.5, textW) : [];\n      const rowH = Math.max(productImage?58:40, desc.length * 12 + notes.length * 9 + 15);",
    "      const productImageResult=quote.show_product_images&&productMeta?.image_path ? await carregarImagemProduto(productMeta.image_path,auth,pdf) : {image:null,note:''};\n      const productImage=productImageResult.image;\n      const textW=productImage?218:270;\n      const desc = wrapText(item.name || 'Item', normal, 9.2, textW);\n      const notes = [\n        ...(item.notes ? wrapText(item.notes, normal, 7.5, textW) : []),\n        ...(productImageResult.note ? wrapText(productImageResult.note, normal, 7.5, textW) : []),\n      ];\n      const rowH = Math.max(productImage?58:40, desc.length * 12 + notes.length * 9 + 15);",
    'PDF image result use')
write(path,s)

path='api/quotePdfLayout.js'
s=read(path)
s=replace_once(s,
    "    G: simulateQuotePages({ rowHeights:[40,40,40], closingHeight:340 }),\n  };",
    "    G: simulateQuotePages({ rowHeights:[40,40,40], closingHeight:340 }),\n    H: simulateQuotePages({ rowHeights:[58], closingHeight:206 }),\n    I: simulateQuotePages({ rowHeights:[40], closingHeight:206 }),\n    J: simulateQuotePages({ rowHeights:Array(8).fill(58), closingHeight:206 }),\n    K: simulateQuotePages({ rowHeights:[40], closingHeight:206 }),\n  };",
    'PDF H-K layout scenarios')
write(path,s)

path='tests/blockers/rc1c_quote_pdf_pagination.test.mjs'
s=read(path)
s=replace_once(s,
    "  assert.deepEqual(pages, { A:1, B:1, C:2, D:2, E:1, F:2, G:2 });\n  console.log(`RC1C_PDF_PAGES A=${pages.A} B=${pages.B} C=${pages.C} D=${pages.D} E=${pages.E} F=${pages.F} G=${pages.G}`);",
    "  assert.deepEqual(pages, { A:1, B:1, C:2, D:2, E:1, F:2, G:2, H:1, I:1, J:2, K:1 });\n  console.log(`RC1C_PDF_PAGES A=${pages.A} B=${pages.B} C=${pages.C} D=${pages.D} E=${pages.E} F=${pages.F} G=${pages.G} H=${pages.H} I=${pages.I} J=${pages.J} K=${pages.K}`);",
    'PDF H-K expected counts')
s += r'''

test('H-K product-image PDF flow is explicit for ON, OFF, JPG/PNG and WEBP', () => {
  assert.match(pdf, /quote\.show_product_images&&productMeta\?\.image_path/);
  assert.match(pdf, /pdf\.embedPng\(bytes\)/);
  assert.match(pdf, /pdf\.embedJpg\(bytes\)/);
  assert.match(pdf, /WEBP não pode ser incorporada diretamente/);
  assert.match(pdf, /productImageResult\.note/);
});
'''
write(path,s)

Path('tests/blockers/rc1c1_quote_product_images.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const editor=fs.readFileSync(new URL('../../src/screens/v2/QuoteAIBaseV2.jsx',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../../src/lib/quoteV2Api.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../../src/lib/dataApi.js',import.meta.url),'utf8');

test('quote editor exposes image switch and product thumbnail',()=>{
  assert.match(editor,/Mostrar imagens dos produtos no PDF/);
  assert.match(editor,/ProductThumb/);
  assert.match(editor,/catalogProduct\?\.imagemPath/);
  assert.match(api,/image_path/);
  assert.match(api,/imagemPath:x\.image_path \|\| null/);
});

test('show_product_images persists through canonical quote row mapping',()=>{
  assert.match(data,/mostrarImagensProdutos:Boolean\(x\.show_product_images\)/);
  assert.match(data,/show_product_images:Boolean\(x\.mostrarImagensProdutos\)/);
});
''')

print('RC1C1_PATCH_APPLIED')
