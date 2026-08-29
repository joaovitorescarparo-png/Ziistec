import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const round32 = spawnSync(process.execPath, ['scripts/apply-round32.mjs'], { encoding: 'utf8' });
if (round32.status !== 0) {
  throw new Error(`Could not apply Round 3.2 readable codemod: ${round32.stderr || round32.stdout || 'unknown error'}`);
}
if (round32.stdout) process.stdout.write(round32.stdout);

const file = 'src/legacy/ZiisTecApp.jsx';
const expected = '91edc5619d96a8ece1b6172b084d2426a128baa1a7334c3c5ebe2f6cb5bdefd4';
const content = readFileSync(file);
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) {
  throw new Error(`Consolidated source integrity check failed: ${actual}`);
}
console.log(`Consolidated source verified (${actual})`);