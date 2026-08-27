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

// Fonte consolidada validada na CI da rodada de garantias.
assembleGzipBase64({
  dir: 'src/legacy/ZiisTecApp.gz.parts',
  output: 'src/legacy/ZiisTecApp.jsx',
  partHashes: [
    '93ca2dc2759834f9513bb1d8aac0a05d5a348c533bdf901f783fe19c8e78a199',
    '68d5b0a21ad58963d0f4b76cbdd133fb613d2003236b598b294b4ac2b252e4ed',
    'fa39ece10c892d031174782affa353a0e9ccdef5d7c280a7b183a0512d770e24',
    'e52d06294933388511b0af107162bfa4ca9a4f76872c8abfa8df2d130c8fb224',
    '02718cc20823a0f43e46d424c5b7d583dc28fbdae0816f71f40124fd1adf4bbc',
    '655b86c428145c791fb220eeb7d68ca31b4165e3f0be409c28e7508edaedbcfe',
    'b77d88cca14974b45021425482e8037dab293886cf0bce53cccd5beb303e5b98',
    '06baf80d0126b60d4496c9a170facfb3a54fa862a6ee01c500f54309f2f683d2',
  ],
  gzipHash: '1c78beeff724d9469872a47a3cb629fa1a71848e73f730b555f1be753f53534a',
  outputHash: '3289874849f1e5ee87c30d8d0670b0c6f302a8589c508467bb86d966dff98cbd',
});
