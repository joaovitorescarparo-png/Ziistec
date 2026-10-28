import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brl } from '../../src/lib/money.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// A expressão que existia copiada em onze arquivos.
const antiga = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

test('brl compartilhado é equivalente às onze cópias antigas para toda entrada numérica ou vazia', () => {
  const entradas = [0, 1, -1, 0.5, 0.005, 12.345, 1234.5, -1234.56, 99999999.99, '15', '15.5', '', null, undefined, false, 1e-9, 1e12];
  for (const v of entradas) assert.equal(brl(v), antiga(v), `entrada ${String(v)}`);
  assert.match(brl(1234.5), /^R\$\s1\.234,50$/);
  assert.match(brl(-10), /^-R\$\s10,00$/);
});

test('entrada que não é número aparece como R$ 0,00 em vez de R$ NaN', () => {
  assert.match(antiga('abc'), /NaN/);
  for (const v of ['abc', NaN, {}, [1, 2], 'R$ 10']) assert.match(brl(v), /^R\$\s0,00$/, `entrada ${String(v)}`);
});

test('nenhum arquivo do app volta a declarar a mesma formatação de moeda (exceções documentadas)', () => {
  const excecoes = new Set([
    'src/lib/money.js',
    'src/legacy/ZiisTecApp.jsx', // fonte canônica compilada do shell; refatorar o legado é trabalho separado
    'src/screens/PlatformAdmin.jsx', // Intl.NumberFormat, mesmo resultado, tela de plataforma
    'src/lib/serviceReportPdf.js', // formato "R$ 1.234,56" com espaço comum para fonte do PDF
  ]);
  const copias = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const nome = rel(file);
    if (excecoes.has(nome)) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (/toLocaleString\(\s*['"]pt-BR['"]\s*,\s*\{\s*style\s*:\s*['"]currency['"]/.test(text)) copias.push(nome);
  }
  assert.deepEqual(copias, []);
});
