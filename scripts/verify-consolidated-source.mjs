import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = 'src/legacy/ZiisTecApp.jsx';
const expected = 'f0a107774cacce85418cfe1ebbf2d4a3f9654fd430841e1b21f7e04e45cbf4f6';
const content = readFileSync(file);
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) {
  throw new Error(`Consolidated source integrity check failed: ${actual}`);
}
console.log(`Consolidated source verified (${actual})`);
