import {existsSync,readFileSync,writeFileSync} from 'node:fs';

const MARK='FIELD WORKFLOW V1 · wave 4a · quote reuse wrappers';

function unwrap(wrapperPath,basePath,label){
  if(!existsSync(wrapperPath)||!existsSync(basePath)) return;
  const current=readFileSync(wrapperPath,'utf8');
  if(!current.includes(MARK)) return;
  const base=readFileSync(basePath,'utf8');
  if(!base.trim()) throw new Error(`${label}: base da Wave 4A está vazia`);
  writeFileSync(wrapperPath,base,'utf8');
  console.log(`${label}: restored hardened base before legacy codemods`);
}

// verify:v2 e prebuild podem rodar em sequência no mesmo checkout (Vercel faz isso).
// Nesse segundo ciclo, os codemods das Waves anteriores precisam enxergar a tela que eles
// conhecem. Restauramos apenas o arquivo de trabalho; apply-field-workflow-wave4a.mjs
// reinstala o wrapper no fim do pipeline. Em checkout limpo isto é no-op.
unwrap('src/screens/v2/QuoteAIV2.jsx','src/screens/v2/QuoteAIBaseV2.jsx','Quote authoring');
unwrap('src/screens/v2/WorkOrderMemoryV2.jsx','src/screens/v2/WorkOrderMemoryBaseV2.jsx','Work-order memory');
