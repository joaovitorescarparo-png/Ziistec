import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const expectedSqlSha = '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd';
const legacyPath = 'src/legacy/ZiisTecApp.jsx';
const pdfPath = 'api/quote-pdf.js';
const sqlPath = 'supabase/0001_ziistec_fundacao_FINAL.sql';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

test('reassemble --sql-only creates verified SQL without mutating tracked application files', () => {
  const legacyBefore = fs.readFileSync(legacyPath);
  const pdfBefore = fs.readFileSync(pdfPath);
  const legacyHash = sha256(legacyBefore);
  const pdfHash = sha256(pdfBefore);

  fs.rmSync(sqlPath, { force: true });
  const result = run(process.execPath, ['scripts/reassemble.mjs', '--sql-only']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.existsSync(sqlPath), true, '0001 final SQL missing');
  assert.equal(sha256(fs.readFileSync(sqlPath)), expectedSqlSha, '0001 SQL SHA mismatch');
  assert.equal(sha256(fs.readFileSync(legacyPath)), legacyHash, 'legacy hash changed');
  assert.equal(sha256(fs.readFileSync(pdfPath)), pdfHash, 'PDF hash changed');
  assert.deepEqual(fs.readFileSync(legacyPath), legacyBefore, 'legacy content changed');
  assert.deepEqual(fs.readFileSync(pdfPath), pdfBefore, 'PDF content changed');

  const worktree = run('git', ['diff', '--exit-code']);
  assert.equal(worktree.status, 0, `tracked worktree changed:\n${worktree.stdout}${worktree.stderr}`);
  const index = run('git', ['diff', '--cached', '--exit-code']);
  assert.equal(index.status, 0, `tracked index changed:\n${index.stdout}${index.stderr}`);
  const tracked = run('git', ['status', '--porcelain=v1', '--untracked-files=no']);
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(tracked.stdout.trim(), '', `tracked files changed:\n${tracked.stdout}`);
});
