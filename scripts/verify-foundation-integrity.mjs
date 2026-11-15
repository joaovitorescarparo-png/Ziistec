import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Integridade da fundação (0001): sha256 dos BYTES das partes canônicas, na ordem.
//
// O gate compara bytes de propósito e NÃO normaliza fim de linha: qualquer diferença em relação ao que está
// versionado — inclusive CRLF — é falha. O que garante o mesmo hash em Linux, macOS e Windows é o checkout:
// `.gitattributes` fixa `supabase/0001_parts/part*.txt text eol=lf`, então um clone com core.autocrlf=true recebe
// os mesmos bytes do CI. Um clone antigo do Windows, feito antes dessa regra, continua com CRLF no disco e falha
// aqui com a instrução de como refazer o checkout das partes — o hash esperado nunca é ajustado para acomodar CRLF.
const dir = 'supabase/0001_parts';
const expected = '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd';
const parts = readdirSync(dir)
  .filter((name) => /^part\d+\.txt$/.test(name))
  .sort();

if (!parts.length) {
  throw new Error(`FOUNDATION_INTEGRITY: no migration parts found in ${dir}`);
}

const hash = createHash('sha256');
const withCarriageReturn = [];
for (const part of parts) {
  const bytes = readFileSync(join(dir, part));
  if (bytes.includes(0x0d)) withCarriageReturn.push(part);
  hash.update(bytes);
}

const actual = hash.digest('hex');
if (actual !== expected) {
  const hint = withCarriageReturn.length
    ? ` — CRLF_DETECTED in ${withCarriageReturn.join(', ')}: the working tree has Windows line endings, so the bytes differ from the`
      + ' versioned ones. The gate is not relaxed for this. Refresh the checkout of the parts so .gitattributes (eol=lf) applies:'
      + ' git rm --cached -r -q supabase/0001_parts && git checkout HEAD -- supabase/0001_parts (or re-clone).'
    : '';
  throw new Error(`FOUNDATION_INTEGRITY: expected ${expected}, got ${actual}${hint}`);
}

console.log(`FOUNDATION_INTEGRITY: PASS — ${parts.length} canonical parts => ${actual}`);
