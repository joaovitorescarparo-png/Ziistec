import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATES_URL = pathToFileURL(path.join(ROOT, 'src', 'lib', 'dates.js')).href;

// Roda um trecho num processo novo com o fuso do Brasil: o fuso do CI (UTC) escondia o defeito.
function noFuso(tz, code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('o defeito de origem: em UTC-3, 22h30 do dia 28 já é dia 29 no ISO (UTC)', () => {
  const out = noFuso('America/Sao_Paulo', `
    const d = new Date('2026-10-29T01:30:00Z');
    console.log(JSON.stringify({ utc: d.toISOString().slice(0, 10), local: d.getDate() }));
  `);
  assert.equal(out.utc, '2026-10-29');
  assert.equal(out.local, 28);
});

test('hojeISO devolve o dia do aparelho, não o dia em UTC (21h–24h no Brasil)', () => {
  const out = noFuso('America/Sao_Paulo', `
    const { hojeISO } = await import(${JSON.stringify(DATES_URL)});
    console.log(JSON.stringify({
      noite: hojeISO(new Date('2026-10-29T01:30:00Z')),
      meiaNoite: hojeISO(new Date('2026-10-29T03:00:00Z')),
      antes: hojeISO(new Date('2026-10-29T02:59:59Z')),
    }));
  `);
  assert.deepEqual(out, { noite: '2026-10-28', meiaNoite: '2026-10-29', antes: '2026-10-28' });
});

test('addDiasISO e addMesesISO andam no calendário local e preservam o comportamento de soma de dias e meses', () => {
  const out = noFuso('America/Sao_Paulo', `
    const { addDiasISO, addMesesISO } = await import(${JSON.stringify(DATES_URL)});
    console.log(JSON.stringify({
      d1: addDiasISO('2026-10-28', 15), d2: addDiasISO('2026-12-25', 10), d3: addDiasISO('2026-03-01', -1), d4: addDiasISO('2026-10-28', '3'),
      m1: addMesesISO('2026-10-28', 1), m2: addMesesISO('2026-11-15', 3), m3: addMesesISO('2026-10-28', 12),
      vazio: addDiasISO('', 3), ruim: addDiasISO('abc', 3),
    }));
  `);
  assert.deepEqual(out, {
    d1: '2026-11-12', d2: '2027-01-04', d3: '2026-02-28', d4: '2026-10-31',
    m1: '2026-11-28', m2: '2027-02-15', m3: '2027-10-28',
    vazio: '', ruim: '',
  });
});

test('dataBR formata AAAA-MM-DD e aceita carimbo ISO completo e vazio configurável', async () => {
  const { dataBR } = await import(DATES_URL);
  assert.equal(dataBR('2026-10-28'), '28/10/2026');
  assert.equal(dataBR('2026-10-28T23:10:00Z'), '28/10/2026');
  assert.equal(dataBR(''), '—');
  assert.equal(dataBR(null, 'Sem data'), 'Sem data');
  assert.equal(dataBR(undefined, '-'), '-');
});

test('subscriptionDisplay reaproveita o mesmo hojeISO (uma implementação só)', async () => {
  const { hojeISO } = await import(DATES_URL);
  const sub = await import(pathToFileURL(path.join(ROOT, 'src', 'lib', 'subscriptionDisplay.js')).href);
  assert.equal(sub.hojeISO, hojeISO);
});

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

test('guarda: nenhum arquivo de src/ usa o dia em UTC como "hoje" (new Date().toISOString().slice)', () => {
  const ofensores = [];
  for (const file of walk(path.join(ROOT, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (/new Date\(\)\.toISOString\(\)\.slice\(/.test(text)) ofensores.push(`${rel}: hoje em UTC`);
    // soma de dias/meses feita com toISOString().slice(0, 10) de uma data local também cai no dia UTC
    if (rel !== 'src/lib/dashboardInicio.js' && /\b[a-z]\.toISOString\(\)\.slice\(0, ?10\)/.test(text)) ofensores.push(`${rel}: data local convertida para UTC`);
  }
  assert.deepEqual(ofensores, []);
});

test('guarda: as telas V2 e libs que precisam de "hoje" importam o helper único', () => {
  const usam = [
    'src/lib/dataApi.js', 'src/lib/dataApiExtras.js', 'src/lib/quoteV2Api.js', 'src/lib/quotesV2Api.js', 'src/lib/reciboPdf.js',
    'src/screens/v2/FinanceV2.jsx', 'src/screens/v2/MaintenanceContractsV2.jsx', 'src/screens/v2/ManualWarrantyV2.jsx',
    'src/screens/v2/PostSaleV2.jsx', 'src/screens/v2/PurchasesV2.jsx', 'src/screens/v2/QuoteReuseEditorV2.jsx',
  ];
  for (const rel of usam) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(text, /from ['"](\.\.?\/)+(lib\/)?dates(\.js)?['"]/, `${rel} deve importar de dates`);
  }
});
