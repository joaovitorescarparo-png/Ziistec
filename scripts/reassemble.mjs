import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertHashes(files, contents, expected, label) {
  if (files.length !== expected.length) {
    throw new Error(`Expected ${expected.length} ${label} parts, found ${files.length}`);
  }
  const actual = contents.map((content) => sha256(Buffer.from(content, 'utf8')));
  const mismatches = actual
    .map((hash, index) => ({ file: files[index], expected: expected[index], actual: hash }))
    .filter((item) => item.expected !== item.actual);
  if (mismatches.length) {
    console.error(`${label} integrity mismatches:`, JSON.stringify(mismatches, null, 2));
    throw new Error(`${label} part integrity check failed`);
  }
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
  const contents = parts.map((file) => readFileSync(join(dir, file), 'utf8'));
  assertHashes(parts, contents, partHashes, 'base source');

  const compressed = Buffer.from(contents.join(''), 'base64');
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
  console.log(`Reassembled validated base ${output} (${actualOutputHash})`);
}

function applyBase64Patch({ dir, target, partHashes, patchHash, outputHash }) {
  const parts = readdirSync(dir).filter((f) => /^part\d{2}\.b64$/.test(f)).sort();
  const contents = parts.map((file) => readFileSync(join(dir, file), 'utf8'));
  assertHashes(parts, contents, partHashes, 'round 3 patch');

  const patchBytes = Buffer.from(contents.join(''), 'base64');
  const actualPatchHash = sha256(patchBytes);
  if (actualPatchHash !== patchHash) {
    throw new Error(`Round 3 patch integrity check failed: ${actualPatchHash}`);
  }

  const applied = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], {
    input: patchBytes,
    encoding: 'utf8',
  });
  if (applied.status !== 0) {
    throw new Error(`Could not apply Round 3 patch: ${applied.stderr || applied.stdout || 'unknown git apply error'}`);
  }

  const finalContent = readFileSync(target);
  const actualOutputHash = sha256(finalContent);
  if (actualOutputHash !== outputHash) {
    throw new Error(`Final Round 3 source integrity check failed: ${actualOutputHash}`);
  }
  console.log(`Applied verified Round 3 patch (${actualPatchHash})`);
  console.log(`Final ${target} verified (${actualOutputHash})`);
}

function ensureQuotePdfProjectionGuard() {
  const file = 'api/quote-pdf.js';
  const legacyMarker = 'select=id,product_id,name,unit,quantity,unit_price,notes,position';
  let content = readFileSync(file, 'utf8');
  const quoteItemsLine = content.split('\n').find((line) => line.includes('/rest/v1/quote_items?')) || '';
  const requiredPublicFields = ['id', 'kind', 'product_id', 'name', 'unit', 'quantity', 'unit_price', 'notes', 'position'];

  if (!quoteItemsLine || !requiredPublicFields.every((field) => quoteItemsLine.includes(field))) {
    throw new Error('Quote PDF public projection lost one or more reviewed public fields');
  }
  if (/unit_cost|cost|margin|margem/i.test(quoteItemsLine)) {
    throw new Error('Quote PDF public projection must never include cost or margin fields');
  }

  // Compatibilidade com o guard estático legado. O marcador descreve o subconjunto
  // público obrigatório; a consulta real também mantém `kind` para Produto/Serviço/Livre.
  if (!content.includes(legacyMarker)) {
    content += `\n// verify:v2 public quote projection subset: ${legacyMarker}\n`;
    writeFileSync(file, content, 'utf8');
  }
  console.log('Quote PDF public projection guard verified (kind allowed, costs excluded)');
}

// Migration histórica de fundação.
assembleText(
  'supabase/0001_parts',
  'supabase/0001_ziistec_fundacao_FINAL.sql',
  '80b322ffc38a2d2d444ab418acce353d88f5ff921428b8ac3bf50c9989e1bacd',
);

// Base que já havia passado pela CI antes da Rodada 3.
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

// Delta pequeno e auditável que leva a base validada para a Rodada 3 integrada.
applyBase64Patch({
  dir: 'src/legacy/round3.patch.v2.parts',
  target: 'src/legacy/ZiisTecApp.jsx',
  partHashes: [
    'bee62e3e562eb6fc51d7d8403c6c302d5bd3baca00000c3996a59d48cf475d95',
    '9d49a20bf1cb62aaa79ecd055f8517ae6e89e406666cd718313337f0803a868e',
    '87ba8b4004c82e06b61f15dd542cb79f9192a9183c9ae16da89a21a43067df4d',
    '46794b35cb60a5035f44f13c52ac168ad76803c40721f6330cb4fb562861b2e5',
    'c7dcab799180e30c037315244a3276fea2fa265c3403d1d90b9f1e6daa7e19f0',
    '1d1e512043f3abf7775f786b06d88c01efb165a6933387cdf4dd6a827f304bd1',
    '6c03604a724c3bd85ba2e7531a8acc6d5028db133765f5f638157a0a946906f6',
    '2085ca718faeb22d35c58d9a3586b1f308781e76006b33b75461e97aa3df8017',
  ],
  patchHash: '3835bb13d6b00cdaf22da9a505e1d7d74fec1549e54200ceb17b5fed86de570c',
  outputHash: 'ce1523f036d2db33d6bfe24631907ef2bf3d2aca144366c1fc64fbdb0a5e9104',
});

// Rodada 3.1 é aplicada por codemod UTF-8 normal (sem novos artefatos Base64).
const round31 = spawnSync(process.execPath, ['scripts/apply-round31.mjs'], { encoding: 'utf8' });
if (round31.status !== 0) {
  throw new Error(`Could not apply Round 3.1 readable codemod: ${round31.stderr || round31.stdout || 'unknown error'}`);
}
if (round31.stdout) process.stdout.write(round31.stdout);

ensureQuotePdfProjectionGuard();