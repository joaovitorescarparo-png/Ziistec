import {readFileSync,writeFileSync} from 'node:fs';

const MARK='FIELD WORKFLOW V1 · wave 4b · global search + post sale';
const read=p=>readFileSync(p,'utf8');
const write=(p,s)=>writeFileSync(p,s,'utf8');
const must=(s,needle,label)=>{if(!s.includes(needle))throw new Error(`Wave 4B: marcador ausente em ${label}`)};

function patchApp(){
  const path='src/App.jsx';let s=read(path);if(s.includes(MARK)){console.log('App: Wave 4B already applied');return;}
  must(s,'const SettingsV2 = lazy(() => import("./screens/v2/SettingsV2"));',path);
  s=s.replace('const SettingsV2 = lazy(() => import("./screens/v2/SettingsV2"));','const SettingsV2 = lazy(() => import("./screens/v2/SettingsV2"));\nconst PostSaleV2 = lazy(() => import("./screens/v2/PostSaleV2"));');
  must(s,'if (workspaceV2 === "produtos" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo produtos e estoque"/>}><ProductStockV2 {...workspaceProps}/></Suspense>);',path);
  s=s.replace('if (workspaceV2 === "produtos" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo produtos e estoque"/>}><ProductStockV2 {...workspaceProps}/></Suspense>);','if (workspaceV2 === "produtos" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo produtos e estoque"/>}><ProductStockV2 {...workspaceProps} initialProductId={new URLSearchParams(window.location.search).get("product")}/></Suspense>);');
  must(s,'if (workspaceV2 === "clientes-locais" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo clientes e locais"/>}><ClientLocationsV2 {...workspaceProps}/></Suspense>);',path);
  s=s.replace('if (workspaceV2 === "clientes-locais" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo clientes e locais"/>}><ClientLocationsV2 {...workspaceProps}/></Suspense>);','if (workspaceV2 === "clientes-locais" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo clientes e locais"/>}><ClientLocationsV2 {...workspaceProps} initialClientId={new URLSearchParams(window.location.search).get("client")}/></Suspense>);');
  must(s,'if (workspaceV2 === "venda-os") return comConexao(',path);
  s=s.replace('  if (workspaceV2 === "venda-os") return comConexao(',`  if (workspaceV2 === "pos-venda" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo pós-venda"/>}><PostSaleV2 {...workspaceProps} onClose={() => navegarV2(null)}/></Suspense>);\n  if (workspaceV2 === "venda-os") return comConexao(`);
  must(s,'<WorkOrderMemoryV2 {...workspaceProps} owner={owner}/>','App memoria OS');
  s=s.replace('<WorkOrderMemoryV2 {...workspaceProps} owner={owner}/>','<WorkOrderMemoryV2 {...workspaceProps} owner={owner} initialWorkOrderId={new URLSearchParams(window.location.search).get("wo")}/>');
  write(path,`${s}\n/* ${MARK} */\n`);console.log('App: applied Wave 4B routes');
}

function patchProduct(){
  const path='src/screens/v2/ProductStockV2.jsx';let s=read(path);if(s.includes(MARK))return;
  must(s,"export default function ProductStockV2({ companyId, companyName='Sua empresa', onClose })",path);
  s=s.replace("export default function ProductStockV2({ companyId, companyName='Sua empresa', onClose })","export default function ProductStockV2({ companyId, companyName='Sua empresa', onClose, initialProductId=null })");
  must(s,"const openEdit = (p) => { setForm({ ...p, estoqueInicial:0 }); setImageFile(null); setRemoveImage(false); };",path);
  s=s.replace("const openEdit = (p) => { setForm({ ...p, estoqueInicial:0 }); setImageFile(null); setRemoveImage(false); };","const openEdit = (p) => { setForm({ ...p, estoqueInicial:0 }); setImageFile(null); setRemoveImage(false); };\n  useEffect(()=>{ if(initialProductId&&products.length){ const p=products.find(x=>x.id===initialProductId); if(p&&!form) openEdit(p); } },[initialProductId,products]);");
  write(path,`${s}\n/* ${MARK} */\n`);
}

function patchClients(){
  const path='src/screens/v2/ClientLocationsV2.jsx';let s=read(path);if(s.includes(MARK))return;
  must(s,"export default function ClientLocationsV2({companyId,companyName='Sua empresa',onClose})",path);
  s=s.replace("export default function ClientLocationsV2({companyId,companyName='Sua empresa',onClose})","export default function ClientLocationsV2({companyId,companyName='Sua empresa',onClose,initialClientId=null})");
  const needle="  const select=(client)=>{\n    setSelectedId(client.id);\n    setForm({address:client.address||'',mapsUrl:client.maps_url||'',latitude:coord(client.latitude),longitude:coord(client.longitude),googlePlaceId:client.google_place_id||''});\n    setError('');\n  };";
  must(s,needle,path);
  s=s.replace(needle,`${needle}\n  useEffect(()=>{if(initialClientId&&rows.length&&selectedId!==initialClientId){const c=rows.find(x=>x.id===initialClientId);if(c)select(c);}},[initialClientId,rows,selectedId]);`);
  write(path,`${s}\n/* ${MARK} */\n`);
}

function patchMemory(){
  const path='src/screens/v2/WorkOrderMemoryBaseV2.jsx';let s=read(path);if(s.includes(MARK))return;
  must(s,"export default function WorkOrderMemoryV2({companyId,companyName='Sua empresa',userId,owner=false,onClose})",path);
  s=s.replace("export default function WorkOrderMemoryV2({companyId,companyName='Sua empresa',userId,owner=false,onClose})","export default function WorkOrderMemoryV2({companyId,companyName='Sua empresa',userId,owner=false,onClose,initialWorkOrderId=null})");
  must(s,'const [selected,setSelected]=useState(null);',path);
  s=s.replace('const [selected,setSelected]=useState(null);','const [selected,setSelected]=useState(initialWorkOrderId||null);');
  write(path,`${s}\n/* ${MARK} */\n`);
}

function patchLegacy(){
  const path='src/legacy/ZiisTecApp.jsx';let s=read(path);if(s.includes(MARK)){console.log('Legacy shell: Wave 4B already applied');return;}
  must(s,'import { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";',path);
  s=s.replace('import { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";','import { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";\nimport GlobalSearchModal from "../components/GlobalSearchModal";');
  s=s.replace('Buscar cliente, orçamento, OS…','Buscar cliente, OS, produto, serial...');
  must(s,'{busca && <BuscaGlobal onClose={() => setBusca(false)} {...props} />}','legacy search render');
  s=s.replace('{busca && <BuscaGlobal onClose={() => setBusca(false)} {...props} />}','{busca && real && papel === "proprietario" ? <GlobalSearchModal companyId={empresaId} onClose={() => setBusca(false)} onClient={abrirCliente} onWorkOrder={abrirOS} onQuote={abrirOrc} onWarranty={abrirGarantia} onLocation={(item)=>{ if(item.work_order_id) abrirOS(item.work_order_id); else abrirCliente(item.client_id); return true; }} onProduct={(id)=>{ const u=new URL(window.location.href); u.searchParams.set("v2","produtos"); u.searchParams.set("product",id); window.location.assign(`${u.pathname}${u.search}${u.hash}`); }} /> : busca ? <BuscaGlobal onClose={() => setBusca(false)} {...props} /> : null}');
  must(s,'function Garantias({ garantias, ordens, clientes, nomeCliente, garantiaAberta, setGarantiaAberta, abrirOS, abrirCliente, abrirAtendimentoGarantia, produtos, empresaId, real, aviso })',path);
  s=s.replace('function Garantias({ garantias, ordens, clientes, nomeCliente, garantiaAberta, setGarantiaAberta, abrirOS, abrirCliente, abrirAtendimentoGarantia, produtos, empresaId, real, aviso })','function Garantias({ garantias, ordens, clientes, nomeCliente, garantiaAberta, setGarantiaAberta, abrirOS, abrirCliente, abrirAtendimentoGarantia, produtos, empresaId, real, aviso, abrirRecursoV2 })');
  const head='<PageHead title="Garantias" sub={`${ativas} ativa${ativas === 1 ? "" : "s"} agora. Cada uma nasceu de uma ordem de serviço concluída.`} />';
  must(s,head,'Guarantees PageHead');
  s=s.replace(head,'<PageHead title="Garantias" sub={`${ativas} ativa${ativas === 1 ? "" : "s"} agora. Cada uma nasceu de uma ordem de serviço concluída.`} action={real && abrirRecursoV2 ? <Btn icon={CalendarClock} onClick={()=>abrirRecursoV2("pos-venda")}>Pós-venda</Btn> : null} />');
  must(s,'usuarioAtual, papel, permitido, empresaId, assinatura, equipe, usuarios,','legacy props');
  s=s.replace('usuarioAtual, papel, permitido, empresaId, assinatura, equipe, usuarios,','usuarioAtual, papel, permitido, empresaId, assinatura, equipe, usuarios,\n    abrirRecursoV2: contexto?.abrirRecursoV2,');
  write(path,`${s}\n/* ${MARK} */\n`);console.log('Legacy shell: applied Wave 4B integration');
}

patchApp();patchProduct();patchClients();patchMemory();patchLegacy();
