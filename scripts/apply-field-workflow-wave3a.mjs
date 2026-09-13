import { readFileSync, writeFileSync } from 'node:fs';

const file='src/screens/v2/WorkOrderMemoryV2.jsx';
let src=readFileSync(file,'utf8');
const importLine="import InstalledEquipmentPanel from '../../components/InstalledEquipmentPanel';\n";
if(!src.includes(importLine)){
  const marker="import { baixarRelatorioAtendimentoPDF,compartilharRelatorioAtendimentoPDF } from '../../lib/serviceReportPdf';\n";
  if(!src.includes(marker)) throw new Error('Wave3A: marcador de import da memória técnica não encontrado.');
  src=src.replace(marker,marker+importLine);
}

const panel='          <InstalledEquipmentPanel detail={detail} owner={owner} onNavigateWorkOrder={setSelected}/>\n\n';
if(!src.includes(panel.trim())){
  const marker='          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-2"><FileText className="text-sky-300" size={18}/><h3 className="text-sm font-bold">Relato técnico</h3></div>';
  if(!src.includes(marker)) throw new Error('Wave3A: marcador do painel de relato técnico não encontrado.');
  src=src.replace(marker,panel+marker);
}
writeFileSync(file,src);
console.log('FIELD_WORKFLOW_WAVE3A: installed-equipment panel applied');
