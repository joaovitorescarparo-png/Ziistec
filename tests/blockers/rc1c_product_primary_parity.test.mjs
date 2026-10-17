import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legacy = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
const dataApi = fs.readFileSync(new URL('../../src/lib/dataApi.js', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../../src/lib/storageExtras.js', import.meta.url), 'utf8');

test('primary product workflow exposes modern V2 identifiers and existing scanner', () => {
  assert.match(legacy, /import BarcodeScanner from "\.\.\/components\/BarcodeScanner"/);
  assert.match(legacy, /label="SKU"/);
  assert.match(legacy, /label="Código de barras"/);
  assert.match(legacy, /<BarcodeScanner mode="barcode"/);
  assert.match(dataApi, /sku:String\(x\.sku\|\|''\)/);
  assert.match(dataApi, /barcode:String\(x\.codigoBarras\|\|''\)\.replace/);
});

test('primary product photo reuses zt-product-images and does not accept unsupported HEIC blindly', () => {
  assert.match(legacy, /resolverImagemProdutoDB, salvarImagemProdutoDB, removerImagemProdutoDB/);
  assert.match(legacy, /Foto do produto/);
  assert.match(legacy, /accept="image\/jpeg,image\/png,image\/webp" capture="environment"/);
  assert.match(legacy, /HEIC\/HEIF ainda não é processado com segurança/);
  assert.match(storage, /const PRODUCT_IMAGE_BUCKET='zt-product-images'/);
  assert.match(storage, /\['image\/jpeg','image\/png','image\/webp'\]/);
  assert.match(storage, /file\.size>2\*1024\*1024/);
});

test('product flow keeps stock and field-sale metadata on the existing backend model', () => {
  assert.match(legacy, /Controlar estoque deste produto/);
  assert.match(legacy, /Estoque e movimentações/);
  assert.match(legacy, /contexto\.abrirRecursoV2\("produtos"\)/);
  assert.match(legacy, /Liberado para venda em campo/);
  assert.match(dataApi, /track_stock:Boolean\(x\.controlaEstoque\)/);
  assert.match(dataApi, /low_stock_threshold:Math\.max/);
  assert.match(dataApi, /sale_enabled:x\.vendaHabilitada!==false/);
});

test('product cost stays in the owner catalog path and no technician catalog permission is introduced', () => {
  assert.match(legacy, /proprietario: \["inicio", "agenda", "clientes", "catalogo"/);
  assert.doesNotMatch(legacy, /tecnico: \[[^\]]*"catalogo"/);
  assert.match(legacy, /label="Custo de compra"/);
});
