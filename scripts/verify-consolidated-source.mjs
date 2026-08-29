import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const file = 'src/legacy/ZiisTecApp.jsx';
const expected = 'ce1523f036d2db33d6bfe24631907ef2bf3d2aca144366c1fc64fbdb0a5e9104';
const content = readFileSync(file);
const actual = createHash('sha256').update(content).digest('hex');
if (actual !== expected) {
  throw new Error(`Consolidated source integrity check failed: ${actual}`);
}
console.log(`Consolidated source verified (${actual})`);
