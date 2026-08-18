import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

function assemble(dir, output, expected, trimTrailingSpaceAt = []) {
  const parts = readdirSync(dir).filter((f) => /^part\d+\.txt$/.test(f)).sort();
  if (!parts.length) throw new Error(`No parts found in ${dir}`);
  const trimSet = new Set(trimTrailingSpaceAt.map((n) => `part${String(n).padStart(3, '0')}.txt`));
  const content = parts.map((f) => {
    let piece = readFileSync(join(dir, f), 'utf8');
    if (trimSet.has(f) && piece.endsWith(' ')) piece = piece.slice(0, -1);
    return piece;
  }).join('');
  const hash = createHash('sha256').update(content, 'utf8').digest('hex');
  if (hash !== expected) throw new Error(`Integrity check failed for ${output}: ${hash}`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content, 'utf8');
  console.log(`Reassembled ${output} (${hash})`);
}

assemble(
  'src/legacy_parts',
  'src/legacy/ZiisTecApp.jsx',
  '6810efaac27ec494ca8436ade6d10a5f37e9a21ede25162b581c48f9d06faf31',
  [5, 14, 15, 17],
);
assemble(
  'supabase/0001_parts',
  'supabase/0001_ziistec_fundacao_FINAL.sql',
  '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd',
);
