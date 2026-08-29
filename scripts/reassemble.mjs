import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assembleText(dir, output, expected) {
  const parts = readdirSync(dir).filter((f) => /^part\d+\.txt$/.test(f)).sort();
  if (!parts.length) throw new Error(`No parts found in ${dir}`);
  const content = parts.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
  const hash = sha256(Buffer.from(content, 'utf8'));
  if (hash !== expected) throw new Error(`Integrity check failed for ${output}: ${hash}`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content, 'utf8');
  console.log(`Reassembled ${output} (${hash})`);
}

function assembleGzipBase64({ dir, output, partHashes, gzipHash, outputHash }) {
  const parts = readdirSync(dir).filter((f) => /^part\d{2}\.b64$/.test(f)).sort();
  if (parts.length !== partHashes.length) {
    throw new Error(`Expected ${partHashes.length} parts in ${dir}, found ${parts.length}`);
  }

  const encoded = parts.map((file, index) => {
    const content = readFileSync(join(dir, file), 'utf8');
    const actual = sha256(Buffer.from(content, 'utf8'));
    const expected = partHashes[index];
    if (actual !== expected) {
      throw new Error(`Integrity check failed for ${dir}/${file}: ${actual}`);
    }
    return content;
  }).join('');

  const compressed = Buffer.from(encoded, 'base64');
  const actualGzipHash = sha256(compressed);
  if (actualGzipHash !== gzipHash) {
    throw new Error(`Compressed integrity check failed for ${output}: ${actualGzipHash}`);
  }

  const content = gunzipSync(compressed);
  const actualOutputHash = sha256(content);
  if (actualOutputHash !== outputHash) {
    throw new Error(`Integrity check failed for ${output}: ${actualOutputHash}`);
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, content);
  console.log(`Reassembled ${output} (${actualOutputHash})`);
}

// Migration histórica de fundação.
assembleText(
  'supabase/0001_parts',
  'supabase/0001_ziistec_fundacao_FINAL.sql',
  '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd',
);

// Fonte consolidada: hardening V2 + Rodada 3 integrada.
assembleGzipBase64({
  dir: 'src/legacy/ZiisTecApp.gz.parts',
  output: 'src/legacy/ZiisTecApp.jsx',
  partHashes: [
    'd1474108571542f01fd3e507c868fa54714d241e1e0ba3a6dd18034ff68de9d2',
    '402906e0368e6ba6c42b6ad6652aa0a4fa1f25e469f0ad4cebcdbaff34da0090',
    '107317f702e1632a224fea1e91d8d4cdfc792d10e1e89335774466e3b91c75e5',
    'bc223e4d2447caac328cafc7f9fcc6e2788009ac2409cae088a3bda37b28e1e7',
    'd05e7ac31a18bccfcd902a1d970503aa7dbdd62acef7e879ecd68831844b4b26',
    'b726f003f311399202d335a0359936aaf4f3c709c86179a6e2115a59b996c956',
    '11d17564abc9252e620861a91d4f48313810c1fed16b5501032b3cf5d37f0aaa',
    'e6080734c6d45c3147b980cdfb4a64b5421c7d8dad5f52ea2165ab7455e7164',
  ],
  gzipHash: '340f818d0d260469045b2a7c75601a53a212d90254f0a8855f9e35dc3b7ab2e0',
  outputHash: 'ce1523f036d2db33d6bfe24631907ef2bf3d2aca144366c1fc64fbdb0a5e9104',
});
