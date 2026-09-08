import { readFileSync } from 'node:fs';

const file = 'src/legacy/ZiisTecApp.jsx';
const src = readFileSync(file, 'utf8');

const mustContain = [
  'APROVACAO RAPIDA ORCAMENTO',
  '["rascunho", "enviado"].includes(o.status)',
  'mudarStatusOrc(o.id, "aprovado")',
  'aria-label={`Aprovar ${o.numero}`}',
  'Aprovar orçamento',
];

for (const marker of mustContain) {
  if (!src.includes(marker)) throw new Error(`Round 3.6 missing marker: ${marker}`);
}

if (src.includes('<Linha key={o.id} onClick={() => setOrcamentoAberto(o.id)}>')) {
  throw new Error('Round 3.6 regression: quote list still uses a button row that would nest the approval button');
}

const approvalMarker = src.indexOf('APROVACAO RAPIDA ORCAMENTO');
const listStart = src.lastIndexOf('filtrados.map((o)', approvalMarker);
const listEnd = src.indexOf('))}', approvalMarker);
if (approvalMarker < 0 || listStart < 0 || listEnd < 0) {
  throw new Error('Round 3.6 could not delimit quote-list approval block');
}
const block = src.slice(listStart, listEnd + 3);
if (!block.includes('setOrcamentoAberto(o.id)') || !block.includes('mudarStatusOrc(o.id, "aprovado")')) {
  throw new Error('Round 3.6 quote row must preserve open-details action and add direct approval');
}

console.log('ROUND 3.6 QUICK QUOTE APPROVAL CHECK: PASS');
