import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Segurança V1.1 — um checkout limpo no Windows (core.autocrlf=true) precisa reproduzir os mesmos testes do CI Linux.
// Causa comprovada: a 0100 chegava com CRLF e o teste block3_service_receipt, que casa texto multilinha, falhava (520/521).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

test('.gitattributes fixa LF para migrations SQL, scripts de shell e partes da fundação, sem tocar em binários', () => {
  const rules = readFileSync(path.join(root, '.gitattributes'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(rules.sort(), ['*.sh text eol=lf', '*.sql text eol=lf', 'supabase/0001_parts/part*.txt text eol=lf']);
  const attrs = (file) => Object.fromEntries(git('check-attr', 'text', 'eol', '--', file).trim().split(/\r?\n/).map((line) => { const [, key, value] = line.split(': '); return [key, value]; }));
  assert.deepEqual(attrs('supabase/0100_service_receipts.sql'), { text: 'set', eol: 'lf' });
  assert.deepEqual(attrs('scripts/run-sql-rls-ci.sh'), { text: 'set', eol: 'lf' });
  assert.deepEqual(attrs('public/brand/ziistec-icon.png'), { text: 'unspecified', eol: 'unspecified' });
  // A regra das partes é restrita: outros .txt e os .b64 do legado continuam sem normalização forçada.
  assert.deepEqual(attrs('src/screens/v2/wave4a/QuoteAIV2.wrapper.txt'), { text: 'unspecified', eol: 'unspecified' });
  assert.deepEqual(attrs('src/legacy/ZiisTecApp.gz.parts/part01.b64'), { text: 'unspecified', eol: 'unspecified' });
});

// Gate de integridade da fundação no Windows: o verificador compara BYTES; quem garante bytes iguais é o checkout.
const PARTS_DIR = 'supabase/0001_parts';
const FOUNDATION_HASH = '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd';
const VERIFIER = path.join(root, 'scripts', 'verify-foundation-integrity.mjs');
const foundationParts = () => readdirSync(path.join(root, PARTS_DIR)).filter((f) => /^part\d+\.txt$/.test(f)).sort();
const sha = (buffers) => { const h = createHash('sha256'); for (const b of buffers) h.update(b); return h.digest('hex'); };
// Roda o verificador real contra uma cópia das partes, transformada por `mutate` (Buffer -> Buffer).
const runVerifierOn = (mutate) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'zt-foundation-'));
  try {
    mkdirSync(path.join(dir, PARTS_DIR), { recursive: true });
    for (const part of foundationParts()) {
      writeFileSync(path.join(dir, PARTS_DIR, part), mutate(readFileSync(path.join(root, PARTS_DIR, part)), part));
    }
    try {
      return { ok: true, out: execFileSync(process.execPath, [VERIFIER], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (error) {
      return { ok: false, out: `${error.stdout || ''}${error.stderr || ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const toCrlf = (buffer) => Buffer.from(buffer.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');

test('as partes da fundação são texto com LF fixo no índice, no checkout e no atributo', () => {
  const parts = foundationParts();
  assert.equal(parts.length, 4, 'a fundação tem quatro partes canônicas');
  const attrs = (file) => Object.fromEntries(git('check-attr', 'text', 'eol', '--', file).trim().split(/\r?\n/).map((line) => { const [, key, value] = line.split(': '); return [key, value]; }));
  for (const part of parts) {
    assert.deepEqual(attrs(`${PARTS_DIR}/${part}`), { text: 'set', eol: 'lf' }, `${part}: eol=lf`);
    assert.equal(readFileSync(path.join(root, PARTS_DIR, part)).includes(0x0d), false, `${part} não pode ter CR no checkout`);
  }
  const listing = git('ls-files', '--eol', '--', `${PARTS_DIR}/part*.txt`).trim().split(/\r?\n/).filter(Boolean);
  assert.equal(listing.length, 4);
  for (const line of listing) assert.match(line, /^i\/lf\s+w\/lf\s+attr\/text eol=lf\s/, `índice, checkout e atributo em LF: ${line}`);
});

test('o gate de integridade passa com LF e o hash esperado é o do conteúdo versionado (não foi trocado)', () => {
  assert.equal(sha(foundationParts().map((part) => readFileSync(path.join(root, PARTS_DIR, part)))), FOUNDATION_HASH);
  // O que o Git guarda (blob) tem o mesmo hash: é o conteúdo canônico, igual em qualquer sistema.
  assert.equal(sha(foundationParts().map((part) => execFileSync('git', ['cat-file', 'blob', `HEAD:${PARTS_DIR}/${part}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 }))), FOUNDATION_HASH);
  const verifier = readFileSync(VERIFIER, 'utf8');
  assert.ok(verifier.includes(`const expected = '${FOUNDATION_HASH}';`), 'o hash esperado do verificador não mudou');
  assert.ok(readFileSync(path.join(root, 'scripts', 'reassemble.mjs'), 'utf8').includes(`'${FOUNDATION_HASH}'`), 'reassemble.mjs confere o mesmo hash');
  const result = runVerifierOn((buffer) => buffer);
  assert.equal(result.ok, true, result.out);
  assert.match(result.out, new RegExp(`FOUNDATION_INTEGRITY: PASS — 4 canonical parts => ${FOUNDATION_HASH}`));
});

test('regressão CRLF: um checkout com CRLF falha no gate com diagnóstico, e a causa é só o fim de linha', () => {
  const crlf = foundationParts().map((part) => toCrlf(readFileSync(path.join(root, PARTS_DIR, part))));
  assert.notEqual(sha(crlf), FOUNDATION_HASH, 'CRLF muda os bytes e portanto o hash');
  // Causa comprovada do relato do Windows: o mesmo conteúdo, com LF, tem o hash esperado.
  assert.equal(sha(crlf.map((buffer) => Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))), FOUNDATION_HASH);
  const result = runVerifierOn(toCrlf);
  assert.equal(result.ok, false, 'o gate não aceita CRLF: a correção é no checkout, não no verificador');
  assert.match(result.out, /FOUNDATION_INTEGRITY: expected 80b322ff/);
  assert.match(result.out, /CRLF_DETECTED in part000\.txt, part001\.txt, part002\.txt, part003\.txt/);
  assert.match(result.out, /\.gitattributes/);
});

test('o gate não foi enfraquecido: mudança real de conteúdo continua mudando o hash', () => {
  const mutations = {
    'um caractere trocado': (buffer, part) => (part === 'part001.txt' ? Buffer.concat([buffer.subarray(0, 100), Buffer.from('X'), buffer.subarray(101)]) : buffer),
    'linha acrescentada no fim': (buffer, part) => (part === 'part003.txt' ? Buffer.concat([buffer, Buffer.from('-- extra\n')]) : buffer),
    'espaço no fim de uma linha': (buffer, part) => (part === 'part000.txt' ? Buffer.from(buffer.toString('latin1').replace('\n', ' \n'), 'latin1') : buffer),
    'linha em branco removida': (buffer, part) => (part === 'part002.txt' ? Buffer.from(buffer.toString('latin1').replace('\n\n', '\n'), 'latin1') : buffer),
    'CR solto no meio': (buffer, part) => (part === 'part002.txt' ? Buffer.concat([buffer.subarray(0, 50), Buffer.from('\r'), buffer.subarray(50)]) : buffer),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const result = runVerifierOn(mutate);
    assert.equal(result.ok, false, `${name}: o gate precisa falhar`);
    assert.match(result.out, /FOUNDATION_INTEGRITY: expected 80b322ff/, name);
  }
  const verifier = readFileSync(VERIFIER, 'utf8');
  assert.equal(/\.replace\(|\.split\(|toString\(/.test(verifier), false, 'o verificador não normaliza o conteúdo antes do hash');
  assert.match(verifier, /hash\.update\(bytes\)/, 'o hash é sobre os bytes lidos');
});

test('nenhuma migration, teste SQL ou script de shell foi commitado com CRLF', () => {
  const listing = git('ls-files', '--eol', '--', '*.sql', '*.sh').trim().split(/\r?\n/).filter(Boolean);
  assert.ok(listing.length > 100, 'o inventário precisa enxergar as migrations e os testes SQL');
  const crlf = listing.filter((line) => !/^i\/lf\s/.test(line));
  assert.deepEqual(crlf, []);
});

test('o arquivo que quebrou no clone limpo do Windows chega com LF e casa o texto multilinha esperado', () => {
  const sql = readFileSync(path.join(root, 'supabase', '0100_service_receipts.sql'), 'utf8');
  assert.equal(sql.includes('\r'), false, 'a 0100 não pode ter CR no checkout');
  assert.match(sql, /security definer\nset search_path=''/);
});

test('o gate verify:v2 executa este contrato', () => {
  assert.ok(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['verify:v2'].includes('tests/blockers/repo_line_endings.test.mjs'));
  assert.ok(readdirSync(path.join(root, 'supabase')).some((f) => f.endsWith('.sql')));
});
