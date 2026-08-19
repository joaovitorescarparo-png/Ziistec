import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const oldText=`persistirEdicaoOSDB(next, patch, empresaId, usuarioAtual?.id, papel).catch((e) => aviso(mensagemErro(e)))`;
const newText=`persistirEdicaoOSDB(next, patch, empresaId, usuarioAtual?.id, papel)
          .then((saved) => {
            if (saved?.checklist) {
              setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, checklist: saved.checklist } : x));
            }
          })
          .catch((e) => aviso(mensagemErro(e)))`;
const i=s.indexOf(oldText);
if(i<0) throw new Error('phase15: não encontrei chamada do autosave da OS');
if(s.indexOf(oldText,i+1)>=0) throw new Error('phase15: chamada do autosave apareceu mais de uma vez');
s=s.slice(0,i)+newText+s.slice(i+oldText.length);
fs.writeFileSync(file,s);
console.log('Applied ZiisTec phase 15 persisted checklist identity patch');
