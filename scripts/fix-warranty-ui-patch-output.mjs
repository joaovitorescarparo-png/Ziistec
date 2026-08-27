import fs from 'node:fs';

const path = 'src/legacy/ZiisTecApp.jsx';
let source = fs.readFileSync(path, 'utf8');

const duplicateDeclaration = '  const adicionaisFinais = temAdicional ? adicionais : [];  const adicionaisFinais = temAdicional ? adicionais : [];';
if (source.split(duplicateDeclaration).length - 1 !== 1) {
  throw new Error('Warranty patch fix: duplicate declaration signature not found exactly once');
}
source = source.replace(duplicateDeclaration, '  const adicionaisFinais = temAdicional ? adicionais : [];');

const duplicateBoundary = `            <p className="text-[13px] font-medium text-slate-600 mb-2">Como este atendimento terminou?</p>            </div>\n          </div>\n\n          <div>\n            <p className="text-[13px] font-medium text-slate-600 mb-2">Como este atendimento terminou?</p>`;
if (source.split(duplicateBoundary).length - 1 !== 1) {
  throw new Error('Warranty patch fix: duplicated JSX boundary signature not found exactly once');
}
source = source.replace(
  duplicateBoundary,
  '            <p className="text-[13px] font-medium text-slate-600 mb-2">Como este atendimento terminou?</p>',
);

fs.writeFileSync(path, source, 'utf8');
console.log('Warranty UI patch output normalized successfully.');
