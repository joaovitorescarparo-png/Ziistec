import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

function assemble(dir, output, expected) {
  const parts = readdirSync(dir).filter((f) => /^part\d+\.txt$/.test(f)).sort();
  if (!parts.length) throw new Error(`No parts found in ${dir}`);
  const content = parts.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
  const hash = createHash('sha256').update(content, 'utf8').digest('hex');
  if (hash !== expected) throw new Error(`Integrity check failed for ${output}: ${hash}`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content, 'utf8');
  console.log(`Reassembled ${output} (${hash})`);
}

// O frontend consolidado agora é fonte versionada normal em src/legacy/ZiisTecApp.jsx.
// Mantemos reconstrução somente da migration de fundação histórica.
assemble(
  'supabase/0001_parts',
  'supabase/0001_ziistec_fundacao_FINAL.sql',
  '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd',
);
