import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as preview from '../../src/lib/productImagePreview.js';

const origin = 'https://test-project.supabase.co';
const company = '10000000-0000-4000-8000-000000000001';
const product = '20000000-0000-4000-8000-000000000002';
const path = `${company}/products/${product}/photo.png`;
const signed = (p = path, bucket = 'zt-product-images') => `${origin}/storage/v1/object/sign/${bucket}/${p}?token=test-placeholder`;
const read = name => fs.readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

test('accepts signed Supabase images including legacy product paths and bucket', () => {
  for (const p of [path, `${company}/products/motor-rc1c2.jpg`, `${company}/products/foto.jfif`, `${company}/products/foto`]) {
    for (const bucket of ['zt-product-images', 'zt-branding']) {
      assert.equal(preview.safeProductImageUrl(signed(p, bucket), origin, p), signed(p, bucket));
    }
  }
});

test('rejects executable schemes, arbitrary origins, credentials, foreign paths and unsigned URLs', () => {
  for (const url of [
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'data:image/svg+xml,<svg/>',
    `blob:${origin}/not-issued-by-preview`, signed().replace(origin, 'https://evil.example'),
    signed().replace(origin, `${origin}.evil.example`), signed().replace('https:', 'http:'),
    signed().replace('https://', 'https://user:password@'), signed() + '#fragment',
    signed().replace('zt-product-images', 'zt-work-orders'), signed().replace('/sign/', '/public/'),
    signed().replace('photo.png', 'different.png'), signed().split('?')[0],
  ]) assert.equal(preview.safeProductImageUrl(url, origin, path), null);
  for (const p of ['javascript:alert(1)', signed(), `${company}/products/../photo.png`,
    `${company}/products/%2e%2e/photo.png`, `${company}/products/.`, `${company}/products/..`]) {
    assert.equal(preview.isProductImagePath(p), false);
    assert.equal(preview.safeProductImageUrl(signed(p), origin, p), null);
  }
});

test('local preview uses only a fresh PNG Blob after decoding and closes bitmap', async t => {
  const source = new Blob(['untrusted encoded input'], { type: 'image/jpeg' });
  const png = new Blob(['pixels encoded by canvas'], { type: 'image/png' });
  let closed = false, drawn = false;
  const bitmap = { width: 1200, height: 600, close() { closed = true; } };
  const canvas = {
    getContext: () => ({ drawImage(image, x, y, width, height) {
      assert.equal(image, bitmap); assert.deepEqual([x, y, width, height], [0, 0, 512, 256]); drawn = true;
    } }),
    toBlob(callback, type) { assert.equal(type, 'image/png'); assert.ok(drawn); callback(png); },
  };
  const previousBitmap = globalThis.createImageBitmap, previousDocument = globalThis.document;
  globalThis.createImageBitmap = async blob => { assert.equal(blob, source); return bitmap; };
  globalThis.document = { createElement: tag => { assert.equal(tag, 'canvas'); return canvas; } };
  t.after(() => { globalThis.createImageBitmap = previousBitmap; globalThis.document = previousDocument; });
  const nativeCreate = URL.createObjectURL.bind(URL);
  t.mock.method(URL, 'createObjectURL', blob => { assert.equal(blob, png); assert.notEqual(blob, source); return nativeCreate(blob); });
  const url = await preview.createProductImagePreview(source);
  assert.match(url, /^blob:/);
  assert.ok(closed);
  URL.revokeObjectURL(url);
});

test('invalid MIME and undecodable local content never produce an object URL', async t => {
  let urls = 0;
  t.mock.method(URL, 'createObjectURL', () => { urls++; throw new Error('Must not be called'); });
  for (const type of ['text/html', 'image/svg+xml', 'image/heic', 'application/octet-stream']) {
    await assert.rejects(preview.createProductImagePreview(new Blob(['bad'], { type })), /Use uma foto/);
  }
  await assert.rejects(preview.createProductImagePreview(new Blob([], { type: 'image/png' })), /Use uma foto/);
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => { throw new Error('Image decode failed'); };
  t.after(() => { globalThis.createImageBitmap = previous; });
  await assert.rejects(preview.createProductImagePreview(new Blob(['<svg/>'], { type: 'image/png' })), /decode failed/);
  assert.equal(urls, 0);
});

test('remote preview validates URL before fetch, forbids redirects and rejects active MIME despite image filename', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, blob: async () => new Blob(['<svg/>'], { type: 'image/svg+xml' }) };
  });
  await assert.rejects(preview.createSignedProductImagePreview('https://evil.example/x', origin, path), /Origem/);
  assert.equal(calls.length, 0);
  await assert.rejects(preview.createSignedProductImagePreview(signed(), origin, path), /Use uma foto/);
  assert.deepEqual(calls, [{ url: signed(), options: { credentials: 'omit', redirect: 'error' } }]);
});

test('storage resolver validates persisted path before signing and checks current and legacy responses', async () => {
  const calls = [], module = { exports: {} };
  let current = signed(), legacy = signed(path, 'zt-branding');
  vm.runInNewContext(transformSync(read('src/lib/storageExtras.js'), { format: 'cjs' }).code, {
    module, exports: module.exports, require(name) {
      if (name === './productImagePreview') return preview;
      if (name === './supabase') return { supabase: { supabaseUrl: origin, storage: { from(bucket) {
        return { async createSignedUrl(p) { calls.push({ bucket, path: p }); return { data: { signedUrl: bucket === 'zt-product-images' ? current : legacy } }; } };
      } } } };
      return {};
    },
  });
  const resolve = module.exports.resolverImagemProdutoDB;
  assert.equal(await resolve('javascript:alert(1)'), null);
  assert.equal(calls.length, 0);
  assert.equal(await resolve(path), signed());
  current = 'https://evil.example/image.png';
  assert.equal(await resolve(path), legacy);
  legacy = 'data:text/html,bad';
  assert.equal(await resolve(path), null);
});

test('product editor uses decoded preview and revokes obsolete asynchronous object URLs', () => {
  const app = read('src/legacy/ZiisTecApp.jsx');
  assert.doesNotMatch(app, /URL\.createObjectURL\(imagemArquivo\)/);
  assert.match(app, /createProductImagePreview\(imagemArquivo\)/);
  assert.match(app, /if \(!active\) \{ URL.revokeObjectURL\(url\); return; \}/);
  assert.match(app, /if \(objectUrl\) URL.revokeObjectURL\(objectUrl\)/);
});
