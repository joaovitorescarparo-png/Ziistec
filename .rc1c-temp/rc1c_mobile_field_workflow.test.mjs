import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacy = fs.readFileSync(new URL('../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');

test('shared mobile controls keep comfortable touch targets and safe-area modals', () => {
  assert.match(legacy, /const sizes = \{ sm: "min-h-11/);
  assert.match(legacy, /max-h-\[calc\(100dvh-env\(safe-area-inset-top\)\)\]/);
  assert.match(legacy, /pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(legacy, /sticky bottom-0 bg-white/);
});

test('work order mobile hierarchy keeps one primary execution CTA and moves admin actions under Mais', () => {
  assert.match(legacy, /const acaoPrincipal = acoes\.find\(\(acao\) => acao\.principal\)/);
  assert.match(legacy, /<summary[^>]*>Mais<ChevronDown/);
  assert.match(legacy, />Excluir OS<\/button>/);
  assert.match(legacy, />Cancelar OS<\/button>/);
  assert.match(legacy, /Cliente<\/p><p className="mt-1 font-medium/);
  assert.match(legacy, /Data e horário/);
  assert.match(legacy, /Endereço/);
  assert.match(legacy, /Serviço/);
});

test('quote items use vertical-first mobile cards instead of compressed three-column rows', () => {
  assert.match(legacy, /grid grid-cols-1 min-\[430px\]:grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 items-end/);
  assert.match(legacy, /type="number" inputMode="decimal" min="0" step="0\.5" value=\{i\.qtd\}/);
  assert.match(legacy, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/);
});

test('purchase form avoids compressed mobile fields and requests appropriate numeric keyboards', () => {
  assert.match(legacy, /grid grid-cols-1 min-\[430px\]:grid-cols-2 sm:grid-cols-3 gap-3 items-end mt-3/);
  assert.match(legacy, /inputMode="numeric" min="1" value=\{i\.qtd\}/);
  assert.match(legacy, /inputMode="decimal" step="0\.01" min="0" value=\{i\.custo\}/);
});

test('client contact fields request telephone keyboards without changing persistence', () => {
  assert.match(legacy, /label="Telefone"><Input inputMode="tel"/);
  assert.match(legacy, /label="WhatsApp"><Input inputMode="tel"/);
});
