import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('work-order memory remains field-safe and mobile touch-safe',()=>{
  // Wave 4A composes the prior hardened memory screen as WorkOrderMemoryBaseV2.
  const src=read('src/screens/v2/WorkOrderMemoryV2.jsx')+'\n'+read('src/screens/v2/WorkOrderMemoryBaseV2.jsx');
  assert.match(src,/MOBILE HOMOLOGATION · work order memory · wave 3/);
  assert.match(src,/min-h-\[100dvh\] overflow-x-hidden/);
  assert.match(src,/min-h-11 min-w-11/);
  assert.match(src,/min-h-11 whitespace-nowrap/);
  assert.match(src,/min-h-11 rounded-xl bg-sky-500/);
  assert.match(src,/min-h-11 rounded-xl px-3 py-2/);
  assert.match(src,/min-h-11 w-full rounded-xl bg-amber-400/);
  assert.match(src,/Nenhum custo interno ou margem é carregado nesta tela/);
  assert.match(src,/carregarDetalheMemoriaOSV2DB/);
  assert.match(src,/salvarRelatoTecnicoV2DB/);
  assert.match(src,/enviarEvidenciaOSV2DB/);
  assert.doesNotMatch(src,/\bmin-h-screen\b/);
});

test('legacy technician completion choices stay readable on narrow screens',()=>{
  const src=read('src/legacy/ZiisTecApp.jsx');
  assert.match(src,/resultado operacional do atendimento: finalizado, precisa voltar ou não finalizado/);
  assert.match(src,/\[\["finalizado", "Finalizado"\], \["retorno", "Precisa retornar"\], \["naoFinalizado", "Não finalizado"\]\]/);
  assert.match(src,/grid sm:grid-cols-3 gap-2/);
  assert.match(src,/py-3\.5 rounded-xl text-\[14px\]/);
});
