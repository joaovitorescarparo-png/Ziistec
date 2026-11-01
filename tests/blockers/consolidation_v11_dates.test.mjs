import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATES_URL = pathToFileURL(path.join(ROOT, 'src', 'lib', 'dates.js')).href;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const LEGACY = read('src/legacy/ZiisTecApp.jsx');

// Roda um trecho num processo novo, com fuso e relógio controlados.
function noFuso(tz, code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: tz }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------- B4: soma de meses

const CASOS_MESES = [
  ['2026-01-31', 1, '2026-02-28'], // ano comum
  ['2028-01-31', 1, '2028-02-29'], // bissexto
  ['2026-03-31', 1, '2026-04-30'],
  ['2026-05-31', 1, '2026-06-30'],
  ['2026-08-31', 1, '2026-09-30'],
  ['2026-11-30', 3, '2027-02-28'], // fevereiro de ano comum
  ['2027-11-30', 3, '2028-02-29'], // fevereiro de ano bissexto
  ['2028-02-29', 12, '2029-02-28'],
  ['2028-02-29', 48, '2032-02-29'],
  ['2026-12-31', 2, '2027-02-28'],
  ['2026-01-31', 13, '2027-02-28'],
  ['2026-03-31', -1, '2026-02-28'],
  ['2026-01-15', -1, '2025-12-15'],
  ['2026-12-15', 1, '2027-01-15'],
  ['2026-10-28', 0, '2026-10-28'],
  ['2026-10-28', 12, '2027-10-28'],
  ['2026-10-28', '3', '2027-01-28'],
  ['2026-01-31', 1.9, '2026-02-28'], // fração é descartada, como no Date
  ['2000-01-31', 1, '2000-02-29'], // 2000 é bissexto
  ['1900-01-31', 1, '1900-02-28'], // 1900 não é
  ['2100-01-31', 1, '2100-02-28'], // 2100 não é
  ['2026-10-31T10:00:00Z', 1, '2026-11-30'], // aceita carimbo ISO e usa só a data
];

test('B4: somar meses fixa no último dia válido do mês de destino (nunca transborda)', () => {
  for (const tz of ['America/Sao_Paulo', 'America/New_York', 'UTC']) {
    const out = noFuso(tz, `
      const { addMesesISO } = await import(${JSON.stringify(DATES_URL)});
      const casos = ${JSON.stringify(CASOS_MESES)};
      console.log(JSON.stringify(casos.map(([base, meses]) => addMesesISO(base, meses))));
    `);
    assert.deepEqual(out, CASOS_MESES.map((c) => c[2]), `fuso ${tz}`);
  }
});

test('B4: entrada inválida continua como antes (base ruim ou quantidade não numérica devolve vazio)', () => {
  const out = noFuso('America/Sao_Paulo', `
    const { addMesesISO } = await import(${JSON.stringify(DATES_URL)});
    console.log(JSON.stringify([addMesesISO('', 1), addMesesISO(null, 1), addMesesISO('abc', 1), addMesesISO('2026-10-28', 'x'), addMesesISO('2026-10-28', Infinity), addMesesISO('2026-10-28', undefined), addMesesISO('2026-10-28', NaN)]));
  `);
  // NaN e undefined viram 0 (Number(meses || 0)), como no comportamento anterior: a data volta igual.
  assert.deepEqual(out, ['', '', '', '', '', '2026-10-28', '2026-10-28']);
});

test('B4: propriedade em seis anos — o mês de destino é sempre o esperado e o dia nunca passa do último do mês', () => {
  const out = noFuso('America/Sao_Paulo', `
    const { addMesesISO } = await import(${JSON.stringify(DATES_URL)});
    const dois = (n) => String(n).padStart(2, '0');
    let falhas = [];
    let checados = 0;
    for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2029, 11, 31); t += 86400000) {
      const base = new Date(t);
      const a = base.getUTCFullYear(), m0 = base.getUTCMonth(), d = base.getUTCDate();
      const iso = a + '-' + dois(m0 + 1) + '-' + dois(d);
      for (let n = -13; n <= 25; n++) {
        const alvo = new Date(Date.UTC(a, m0 + n, 1));
        const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
        const esperado = alvo.getUTCFullYear() + '-' + dois(alvo.getUTCMonth() + 1) + '-' + dois(Math.min(d, ultimo));
        const obtido = addMesesISO(iso, n);
        checados++;
        if (obtido !== esperado && falhas.length < 5) falhas.push([iso, n, esperado, obtido]);
      }
    }
    console.log(JSON.stringify({ checados, falhas }));
  `);
  assert.ok(out.checados > 80000);
  assert.deepEqual(out.falhas, []);
});

test('B4: o shell usa a soma canônica; o único setMonth do app é a navegação de calendário que zera o dia antes', () => {
  assert.equal(/const addMeses\s*=/.test(LEGACY), false, 'o helper local de soma de meses saiu do shell');
  assert.match(LEGACY, /import \{[^}]*\baddMesesISO\b[^}]*\} from "\.\.\/lib\/dates"/);
  const usos = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(e.name)) {
        fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((linha, i) => { if (/\.setMonth\(/.test(linha)) usos.push({ arquivo: path.relative(ROOT, p).split(path.sep).join('/'), linha }); });
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'api'));
  assert.equal(usos.length, 1, JSON.stringify(usos));
  assert.equal(usos[0].arquivo, 'src/legacy/ZiisTecApp.jsx');
  assert.match(usos[0].linha, /setDate\(1\);\s*x\.setMonth/);
});

// ---------------------------------------------------------------- B3: "hoje" não congela

// Trecho real do shell: as duas regras que dependem de "hoje" (garantia e vencimento de lançamento).
function trechoDoShell() {
  const linhas = LEGACY.split(/\r?\n/);
  const iDias = linhas.findIndex((l) => l.startsWith('const diasEntre = '));
  const iGar = linhas.findIndex((l) => l.startsWith('const statusGarantia = '));
  const fimGar = linhas.findIndex((l, i) => i > iGar && l === '};');
  const iLanc = linhas.findIndex((l) => l.startsWith('const statusLanc = '));
  assert.ok(iDias > 0 && iGar > 0 && fimGar > iGar && iLanc > 0, 'trechos do shell encontrados');
  return [linhas[iDias], ...linhas.slice(iGar, fimGar + 1), linhas[iLanc]].join('\n');
}

test('B3: hojeISO() acompanha o relógio — abre às 23h50 e, 20 minutos depois, já é o dia seguinte', () => {
  const out = noFuso('America/Sao_Paulo', `
    import { mock } from 'node:test';
    const { hojeISO } = await import(${JSON.stringify(DATES_URL)});
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-29T02:50:00Z') }); // 23h50 de 28/10 no Brasil
    const antes = hojeISO();
    mock.timers.tick(20 * 60 * 1000);
    const depois = hojeISO();
    console.log(JSON.stringify({ antes, depois }));
  `);
  assert.deepEqual(out, { antes: '2026-10-28', depois: '2026-10-29' });
});

test('B3: o código real do shell (garantia e vencimento) usa o dia novo depois da meia-noite, sem recarregar', () => {
  const out = noFuso('America/Sao_Paulo', `
    import { mock } from 'node:test';
    const { hojeISO } = await import(${JSON.stringify(DATES_URL)});
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-29T02:50:00Z') });
    const HOJE_NA_CARGA = hojeISO(); // o que a constante antiga guardava ao abrir o app
    const { statusLanc, statusGarantia } = new Function('hojeISO', 'HOJE', ${JSON.stringify(trechoDoShell())} + '\\nreturn { statusLanc, statusGarantia };')(hojeISO, HOJE_NA_CARGA);
    const lanc = { tipo: 'receita', pago: false, vencimento: '2026-10-28' };
    const garantia = { ate: '2026-10-28' };
    const antes = { lanc: statusLanc(lanc).label, garantia: statusGarantia(garantia).detalhe };
    mock.timers.tick(20 * 60 * 1000);
    const depois = { lanc: statusLanc(lanc).label, garantia: statusGarantia(garantia).detalhe };
    console.log(JSON.stringify({ antes, depois }));
  `);
  assert.deepEqual(out.antes, { lanc: 'A receber', garantia: 'vence hoje' });
  assert.deepEqual(out.depois, { lanc: 'Vencido', garantia: 'expirada há 1 dia' });
});

test('B3: nenhuma leitura do relógio fica congelada na carga do módulo (varredura da árvore sintática)', () => {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const { parse } = require('@babel/parser');
  const achados = [];
  const arquivos = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(e.name)) arquivos.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  for (const file of arquivos) {
    const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const locais = new Set(['iso']);
    for (const n of ast.program.body) {
      if (n.type === 'ImportDeclaration' && /dates(\.js)?$/.test(n.source.value)) {
        for (const s of n.specifiers) if (s.imported && ['hojeISO', 'dataLocalISO'].includes(s.imported.name)) locais.add(s.local.name);
      }
    }
    const visita = (node) => {
      if (!node || typeof node.type !== 'string') return;
      if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ObjectMethod|ClassPrivateMethod)$/.test(node.type)) return;
      const chamaRelogio = node.type === 'CallExpression' && node.callee.type === 'Identifier' && locais.has(node.callee.name);
      const novaData = node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0;
      if (chamaRelogio || novaData) achados.push(`${path.relative(ROOT, file).split(path.sep).join('/')}:${node.loc.start.line}`);
      for (const k of Object.keys(node)) {
        if (k === 'loc' || k === 'start' || k === 'end') continue;
        const v = node[k];
        if (Array.isArray(v)) v.forEach(visita);
        else if (v && typeof v.type === 'string') visita(v);
      }
    };
    ast.program.body.forEach(visita);
  }
  // Única exceção: a semente de demonstração do shell (dados fictícios montados uma vez, nunca regra de negócio).
  const semente = LEGACY.split(/\r?\n/).findIndex((l) => /^const HOJE_SEED = hojeISO\(\);/.test(l)) + 1;
  assert.ok(semente > 0, 'HOJE_SEED declarada');
  assert.deepEqual(achados, [`src/legacy/ZiisTecApp.jsx:${semente}`]);
});

test('B3: o shell não tem mais a constante HOJE; a semente de demonstração fica antes do primeiro componente', () => {
  assert.equal(/\bHOJE\b/.test(LEGACY), false);
  const linhas = LEGACY.split(/\r?\n/);
  const primeiroComponente = linhas.findIndex((l) => l.startsWith('function Btn('));
  assert.ok(primeiroComponente > 0);
  linhas.forEach((l, i) => { if (/\bHOJE_SEED\b/.test(l)) assert.ok(i < primeiroComponente, `HOJE_SEED fora da semente na linha ${i + 1}`); });
  assert.match(LEGACY, /import \{[^}]*\bhojeISO\b[^}]*\} from "\.\.\/lib\/dates"/);
});

test('B3: aplicativo reaberto depois da meia-noite recalcula o dia (hook por evento, sem polling)', () => {
  const hook = read('src/hooks/useDiaLocal.js');
  assert.equal(/setInterval|setTimeout/.test(hook), false, 'nada de polling');
  for (const evento of ['visibilitychange', 'focus', 'pageshow']) {
    assert.match(hook, new RegExp(`addEventListener\\('${evento}'`));
    assert.match(hook, new RegExp(`removeEventListener\\('${evento}'`));
  }
  assert.match(LEGACY, /import useDiaLocal from "\.\.\/hooks\/useDiaLocal";/);
  assert.match(LEGACY, /export default function ZiisTec\(\{ contexto \}\) \{\s*useDiaLocal\(\);/);

  // Comportamento: React trocado por um simulado mínimo; a aba volta do segundo plano depois da meia-noite.
  const fonte = hook
    .replace("import { useEffect, useState } from 'react';", 'const { useEffect, useState } = globalThis.__reactFalso;')
    .replace("import { hojeISO } from '../lib/dates';", `import { hojeISO } from ${JSON.stringify(DATES_URL)};`);
  assert.ok(fonte.includes('__reactFalso') && fonte.includes(DATES_URL), 'importações do hook substituídas');
  const out = noFuso('America/Sao_Paulo', `
    import { mock } from 'node:test';
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-29T02:50:00Z') });
    const ouvintes = {};
    let estado; let rerenders = 0; const limpezas = [];
    globalThis.window = { addEventListener: (n, f) => { ouvintes['w:' + n] = f; }, removeEventListener: (n) => { delete ouvintes['w:' + n]; } };
    globalThis.document = { addEventListener: (n, f) => { ouvintes['d:' + n] = f; }, removeEventListener: (n) => { delete ouvintes['d:' + n]; } };
    globalThis.__reactFalso = {
      useState: (ini) => { if (estado === undefined) estado = typeof ini === 'function' ? ini() : ini; return [estado, (v) => { const novo = typeof v === 'function' ? v(estado) : v; if (novo !== estado) { estado = novo; rerenders++; } }]; },
      useEffect: (fn) => { const r = fn(); if (typeof r === 'function') limpezas.push(r); },
    };
    const useDiaLocal = (await import('data:text/javascript;base64,' + Buffer.from(${JSON.stringify(fonte)}).toString('base64'))).default;
    const aberto = useDiaLocal();
    mock.timers.tick(5 * 60 * 1000);                 // ainda 23h55: nada muda
    ouvintes['d:visibilitychange']();
    const mesmoDia = { estado, rerenders };
    mock.timers.tick(20 * 60 * 1000);                // 00h15 do dia seguinte
    ouvintes['d:visibilitychange']();
    const novoDia = { estado, rerenders };
    limpezas.forEach((f) => f());
    console.log(JSON.stringify({ aberto, mesmoDia, novoDia, ouvintesRestantes: Object.keys(ouvintes).length }));
  `);
  assert.equal(out.aberto, '2026-10-28');
  assert.deepEqual(out.mesmoDia, { estado: '2026-10-28', rerenders: 0 });
  assert.deepEqual(out.novoDia, { estado: '2026-10-29', rerenders: 1 });
  assert.equal(out.ouvintesRestantes, 0, 'os ouvintes são removidos ao desmontar');
});

test('B3: formulários novos de contrato e de garantia manual calculam a data na hora de abrir', () => {
  const contratos = read('src/screens/v2/MaintenanceContractsV2.jsx');
  const garantia = read('src/screens/v2/ManualWarrantyV2.jsx');
  assert.equal(/^const VAZIO\s*=/m.test(contratos), false);
  assert.equal(/^const VAZIO\s*=/m.test(garantia), false);
  assert.match(contratos, /const formVazio\s*=\s*\(\)\s*=>/);
  assert.match(garantia, /const formVazio\s*=\s*\(\)\s*=>/);
  assert.match(contratos, /setForm\(\{\.\.\.formVazio\(\),/);
  assert.match(garantia, /useState\(\(\)\s*=>\s*formVazio\(\)\)/);
  assert.match(garantia, /setForm\(\{\.\.\.formVazio\(\),/);
});
