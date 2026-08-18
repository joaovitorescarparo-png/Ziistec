import { readFileSync, writeFileSync } from 'node:fs';
const file='src/legacy/ZiisTecApp.jsx';
let s=readFileSync(file,'utf8');
function replaceOne(oldText,newText,label){
  const count=s.split(oldText).length-1;
  if(count!==1) throw new Error(`Phase 8 ${label} anchor count ${count}`);
  s=s.replace(oldText,newText);
}
replaceOne(
  'import { chamarIAReal } from "../lib/aiApi";',
  'import { chamarIAReal } from "../lib/aiApi";\nimport { resolverLogoEmpresaDB, persistirFotosOSDB } from "../lib/storageExtras";',
  'storage import'
);
replaceOne(
  '      persistTimer.current = setTimeout(() => { persistirEdicaoOSDB(next, patch, empresaId, usuarioAtual?.id, papel).then((r) => { if (r?.checklist) setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, checklist: r.checklist } : x)); }).catch((e) => aviso(mensagemErro(e))); }, 500);',
  '      persistTimer.current = setTimeout(() => { const tarefa = patch.fotos ? persistirFotosOSDB(os.id, patch.fotos, empresaId, usuarioAtual?.id) : persistirEdicaoOSDB(next, patch, empresaId, usuarioAtual?.id, papel); tarefa.then((r) => { if (r?.checklist) setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, checklist: r.checklist } : x)); if (r?.fotos) setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, fotos: r.fotos } : x)); }).catch((e) => aviso(mensagemErro(e))); }, 500);',
  'OS persistence result'
);
replaceOne(
  '<Paperclip className="w-4 h-4 text-slate-400 shrink-0" /><span className="truncate">{a.nome}</span>',
  '<Paperclip className="w-4 h-4 text-slate-400 shrink-0" />{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-teal-800 hover:underline" onClick={(e) => e.stopPropagation()}>{a.nome}</a> : <span className="truncate">{a.nome}</span>}',
  'purchase attachment link'
);
replaceOne(
  '  const set = (k, v) => setF({ ...f, [k]: v });\n  const enviarLogo = async (file) => {',
  '  const set = (k, v) => setF({ ...f, [k]: v });\n  useEffect(() => {\n    let ativo = true;\n    if (f.logoPath && !f.logoUrl) resolverLogoEmpresaDB(f.logoPath).then((url) => { if (ativo && url) { setF((v) => ({ ...v, logoUrl: url })); setEmpresa((v) => ({ ...v, logoUrl: url })); } }).catch(() => {});\n    return () => { ativo = false; };\n  }, [f.logoPath]);\n  const enviarLogo = async (file) => {',
  'logo hydration'
);
writeFileSync(file,s,'utf8');
console.log('Applied ZiisTec phase 8 storage UX patch (4 changes)');
