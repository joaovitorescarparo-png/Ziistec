import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = 'src/legacy/ZiisTecApp.jsx';
const expected = '91edc5619d96a8ece1b6172b084d2426a128baa1a7334c3c5ebe2f6cb5bdefd4';
const content = readFileSync(file);
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) {
  throw new Error(`Consolidated source integrity check failed: ${actual}`);
}
console.log(`Consolidated source verified (${actual})`);