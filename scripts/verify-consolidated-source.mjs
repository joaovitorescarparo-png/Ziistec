import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = 'src/legacy/ZiisTecApp.jsx';
const expected = 'ed57ec7779d15f2e105d966557ee6e9e2c59279775eb0fa958f46e7f17b7319b';
const content = readFileSync(file);
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) {
  throw new Error(`Consolidated source integrity check failed: ${actual}`);
}
console.log(`Consolidated source verified (${actual})`);
