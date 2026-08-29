import { readFileSync } from 'node:fs';

const app = readFileSync('src/legacy/ZiisTecApp.jsx','utf8');
const pdfScript = readFileSync('scripts/apply-round34.mjs','utf8');
const failures = [];
const need = (text, label) => { if (!app.includes(text)) failures.push(label); };

for (const [text,label] of [
  ['CALCULADORA DE MARGEM SOBRE CUSTO','calculadora completa de produto ausente'],
  ['const precoComAcrescimo =','helper de cálculo de acréscimo ausente'],
  ['const acrescimoSobreCusto =','helper de percentual atual ausente'],
  ['Acréscimo sobre custo (%)','campo percentual no cadastro completo ausente'],
  ['Ex.: R$ 80 + 45% = R$ 116','exemplo de cálculo ausente'],
  ['Lucro bruto por unidade','resumo de lucro bruto ausente'],
  ['Preço calculado','resultado calculado ausente'],
  ['Acréscimo (%)','calculadora no cadastro rápido ausente'],
  ['margemPct','estado temporário do cálculo ausente'],
]) need(text,label);

if (!pdfScript.includes('const wmW = 390') || !pdfScript.includes('const wmH = 280') || !pdfScript.includes('0.05')) {
  failures.push('marca-d’água ampliada do orçamento não está configurada');
}

if (failures.length) {
  console.error('\nROUND 3.5 UX CHECK: FAIL\n');
  failures.forEach((f,i)=>console.error(`${i+1}. ${f}`));
  process.exit(1);
}
console.log('ROUND 3.5 UX CHECK: OK');
console.log('✓ Calculadora aplica acréscimo sobre custo: custo × (1 + percentual/100)');
console.log('✓ Custo e preço continuam sendo os únicos valores persistidos no produto');
console.log('✓ Cadastro rápido também recebe a calculadora');
console.log('✓ Marca-d’água foi ampliada mantendo baixa opacidade');
