import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const oldText='        await prepararFinalizacaoOSDB(alvo, extras, empresaId, usuarioAtual?.id, papel);';
const newText='        const preparado = await prepararFinalizacaoOSDB(alvo, extras, empresaId, usuarioAtual?.id, papel);\n        extras = { ...extras, ...preparado };';
const i=s.indexOf(oldText);
if(i<0) throw new Error('phase14: não encontrei preparação da finalização');
if(s.indexOf(oldText,i+1)>=0) throw new Error('phase14: preparação apareceu mais de uma vez');
s=s.slice(0,i)+newText+s.slice(i+oldText.length);
fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 14 atomic finalization payload patch');
