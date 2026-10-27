import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Segurança V1.1 — um checkout limpo no Windows (core.autocrlf=true) precisa reproduzir os mesmos testes do CI Linux.
// Causa comprovada: a 0100 chegava com CRLF e o teste block3_service_receipt, que casa texto multilinha, falhava (520/521).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

test('.gitattributes fixa LF para migrations SQL e scripts de shell, sem tocar em binários', () => {
  const rules = readFileSync(path.join(root, '.gitattributes'), 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(rules.sort(), ['*.sh text eol=lf', '*.sql text eol=lf']);
  const attrs = (file) => Object.fromEntries(git('check-attr', 'text', 'eol', '--', file).trim().split(/\r?\n/).map((line) => { const [, key, value] = line.split(': '); return [key, value]; }));
  assert.deepEqual(attrs('supabase/0100_service_receipts.sql'), { text: 'set', eol: 'lf' });
  assert.deepEqual(attrs('scripts/run-sql-rls-ci.sh'), { text: 'set', eol: 'lf' });
  assert.deepEqual(attrs('public/brand/ziistec-icon.png'), { text: 'unspecified', eol: 'unspecified' });
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
