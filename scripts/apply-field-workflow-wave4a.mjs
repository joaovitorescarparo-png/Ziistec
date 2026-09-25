import {readFileSync,writeFileSync} from 'node:fs';

const MARK='FIELD WORKFLOW V1 · wave 4a · quote reuse wrappers';

function installWrapper(sourcePath,basePath,templatePath,label){
  const current=readFileSync(sourcePath,'utf8');
  if(current.includes(MARK)){
    console.log(`${label}: Wave 4A already applied`);
    return;
  }
  // Todos os codemods anteriores rodam antes daqui. O Base recebe exatamente a
  // versão já endurecida por essas waves; o wrapper só acrescenta o fluxo Wave 4A.
  writeFileSync(basePath,current,'utf8');
  const wrapper=readFileSync(templatePath,'utf8');
  // Os codemods antigos são idempotentes por marcadores. Preservamos os comentários
  // de marca para que verify:v2 seguido de build no MESMO checkout não tente remendar
  // o wrapper na segunda passagem.
  const markers=(current.match(/\/\*[\s\S]*?\*\//g)||[]).filter(x=>/MOBILE|FIELD WORKFLOW|ROUND|HOMOLOG/i.test(x));
  writeFileSync(sourcePath,`${wrapper.trim()}\n\n${markers.join('\n')}\n/* ${MARK} */\n`,'utf8');
  console.log(`${label}: applied Wave 4A wrapper`);
}

installWrapper('src/screens/v2/QuoteAIV2.jsx','src/screens/v2/QuoteAIBaseV2.jsx','src/screens/v2/wave4a/QuoteAIV2.wrapper.txt','Quote authoring');
installWrapper('src/screens/v2/WorkOrderMemoryV2.jsx','src/screens/v2/WorkOrderMemoryBaseV2.jsx','src/screens/v2/wave4a/WorkOrderMemoryV2.wrapper.txt','Work-order memory');
