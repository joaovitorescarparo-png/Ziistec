import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const once=(oldText,newText,label)=>{
  const i=s.indexOf(oldText); if(i<0) throw new Error(`phase11: não encontrei ${label}`);
  if(s.indexOf(oldText,i+1)>=0) throw new Error(`phase11: ${label} apareceu mais de uma vez`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};

once(
  'import { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";\n',
  'import { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";\nimport { carregarDocumentosCompraDB, persistirDocumentosCompraDB } from "../lib/purchaseDocuments";\n',
  'import documentos de compra'
);

once(
  'const salva=await salvarCompraDB(c,empresaId,usuarioAtual?.id);',
  'const salva=await salvarCompraDB(c,empresaId,usuarioAtual?.id); await persistirDocumentosCompraDB(salva.id,c.anexos||[],empresaId,usuarioAtual?.id);',
  'persistência de documentos ao salvar compra'
);

once(
  'function Compras({ compras, produtos, lancamentos, salvarCompra, compraAberta, setCompraAberta, setTela, pedirConfirmacao }) {\n  const [form, setForm] = useState(null);\n',
  `function Compras({ compras, produtos, lancamentos, salvarCompra, compraAberta, setCompraAberta, setTela, pedirConfirmacao, empresaId, real, aviso }) {
  const [form, setForm] = useState(null);
  const [docsCompra,setDocsCompra]=useState([]);
  useEffect(()=>{
    if(!real||!compraAberta){setDocsCompra([]);return;}
    let ativo=true;
    carregarDocumentosCompraDB(compraAberta).then((d)=>{if(ativo)setDocsCompra(d);}).catch((e)=>aviso?.(e?.message||"Não foi possível carregar os documentos da compra."));
    return()=>{ativo=false;};
  },[real,compraAberta,empresaId]);
`,
  'estado documentos da compra'
);

once(
  `                  {c.anexos?.length ? c.anexos.map((a) => (
                    <div key={a.id} className="flex items-center gap-2.5 text-[13.5px] text-slate-700 py-1.5">
                      <Paperclip className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{a.nome}</span>
                    </div>
                  )) : <p className="text-[13.5px] text-slate-500">Nenhum documento anexado.</p>}
                  <p className="text-[12px] text-slate-400 mt-3 leading-relaxed">Os arquivos ficam apenas nesta sessão até conectarmos o armazenamento.</p>`,
  `                  {(real ? docsCompra : (c.anexos||[])).length ? (real ? docsCompra : (c.anexos||[])).map((a) => (
                    a.url ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 text-[13.5px] text-slate-700 py-1.5 hover:underline">
                      <Paperclip className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{a.nome}</span><span className="text-[11px] text-slate-400">Abrir</span>
                    </a> : <div key={a.id} className="flex items-center gap-2.5 text-[13.5px] text-slate-700 py-1.5"><Paperclip className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{a.nome}</span></div>
                  )) : <p className="text-[13.5px] text-slate-500">Nenhum documento anexado.</p>}
                  {real && <p className="text-[12px] text-slate-400 mt-3 leading-relaxed">Documentos privados da empresa. O link de abertura é temporário e expira automaticamente.</p>}`,
  'visualização persistente dos documentos'
);

once(
  '<Field label="Documentos" hint="Boleto, nota ou pedido. Ficam apenas nesta sessão até conectarmos o armazenamento.">',
  '<Field label="Documentos" hint="Boleto, nota ou pedido. PDF ou imagem, até 20 MB por arquivo.">',
  'texto do campo documentos'
);

once(
  '<input type="file" multiple className="hidden"\n              onChange={(e) => set("anexos", [...(form.anexos || []), ...Array.from(e.target.files || []).map((a) => ({ id: uid(), nome: a.name }))])} />',
  '<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"\n              onChange={(e) => set("anexos", [...(form.anexos || []), ...Array.from(e.target.files || []).map((a) => ({ id: uid(), nome: a.name, arquivo: a, categoria: "Documento de compra" }))])} />',
  'captura do arquivo real'
);

once(
  `          <p className="text-[13px] text-slate-500 leading-relaxed">
            Importação automática de boletos e notas do e-mail do fornecedor depende de conexão segura com o Gmail e de um servidor para processar os anexos —
            ainda não conectada. Quando estiver, os documentos encontrados aparecerão aqui para você confirmar antes de virarem compra.
          </p>`,
  `          <p className="text-[13px] text-slate-500 leading-relaxed">
            Boletos, notas e pedidos anexados manualmente ficam salvos no armazenamento privado da empresa. A importação automática pelo Gmail continua separada e só será ligada com autorização explícita da conta.
          </p>`,
  'texto informativo de documentos'
);

fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 11 purchase documents patch (7 changes)');
