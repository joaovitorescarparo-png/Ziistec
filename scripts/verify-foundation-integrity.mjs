import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/0001_parts';
const expected = '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd';
const parts = readdirSync(dir)
  .filter((name) => /^part\d+\.txt$/.test(name))
  .sort();

if (!parts.length) {
  throw new Error(`FOUNDATION_INTEGRITY: no migration parts found in ${dir}`);
}

const hash = createHash('sha256');
for (const part of parts) {
  hash.update(readFileSync(join(dir, part)));
}

const actual = hash.digest('hex');
if (actual !== expected) {
  throw new Error(`FOUNDATION_INTEGRITY: expected ${expected}, got ${actual}`);
}

console.log(`FOUNDATION_INTEGRITY: PASS — ${parts.length} canonical parts => ${actual}`);
