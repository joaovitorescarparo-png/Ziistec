import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = 'src/legacy/ZiisTecApp.jsx';
const expected = '25e14019f5a9b8b40f2112e0563a2f4d9f4b945aab0d54313cf63cf576234c64';
const content = readFileSync(file);
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) {
  throw new Error(`Consolidated source integrity check failed: ${actual}`);
}
console.log(`Consolidated source verified (${actual})`);
