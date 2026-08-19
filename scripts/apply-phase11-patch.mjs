import fs from 'node:fs';

const file='src/legacy/ZiisTecApp.jsx';
let s=fs.readFileSync(file,'utf8');
const once=(oldText,newText,label)=>{
  const i=s.indexOf(oldText); if(i<0) throw new Error(`phase11: não encontrei ${label}`);
  if(s.indexOf(oldText,i+1)>=0) throw new Error(`phase11: ${label} apareceu mais de uma vez`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};
const after=(marker,oldText,newText,label)=>{
  const start=s.indexOf(marker); if(start<0) throw new Error(`phase11: não encontrei marcador ${label}`);
  const i=s.indexOf(oldText,start); if(i<0) throw new Error(`phase11: não encontrei ${label}`);
  s=s.slice(0,i)+newText+s.slice(i+oldText.length);
};

after(
  'function Compras(',
  '<Btn variant="soft" size="sm" icon={Pencil} onClick={() => setForm(c)}>Editar</Btn>',
  '<Btn variant="soft" size="sm" icon={Pencil} onClick={() => setForm({ ...c, jaPago: Boolean(lanc?.pago) })}>Editar</Btn>',
  'estado de pagamento ao editar compra'
);

after(
  'function CompraForm(',
  '{ id: uid(), produtoId: p.id, nome:',
  '{ id: uid(), catalogoId: p.id, nome:',
  'vínculo do produto de catálogo'
);

once(
  '<Field label="Documentos" hint="Boleto, nota ou pedido. Os novos arquivos são enviados ao salvar a compra.">',
  '<Field label="Documentos" hint="Boleto, nota ou pedido. PDF ou imagem, até 20 MB por arquivo.">',
  'texto do campo documentos'
);

once(
  '<input type="file" multiple className="hidden"',
  '<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"',
  'formatos aceitos para documentos'
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
console.log('Applied ZiisTec phase 11 purchase documents patch (5 changes)');
