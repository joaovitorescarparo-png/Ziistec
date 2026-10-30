import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const editor=fs.readFileSync(new URL('../../src/screens/v2/QuoteAIBaseV2.jsx',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../../src/lib/quoteV2Api.js',import.meta.url),'utf8');
const data=fs.readFileSync(new URL('../../src/lib/dataApi.js',import.meta.url),'utf8');

test('quote editor exposes image switch and product thumbnail',()=>{
  assert.match(editor,/Mostrar imagens dos produtos no PDF/);
  assert.match(editor,/ProductThumb/);
  assert.match(editor,/catalogProduct\?\.imagemPath/);
  assert.match(api,/image_path/);
  assert.match(api,/imagemPath:x\.image_path \|\| null/);
});

test('show_product_images persists through canonical quote row mapping',()=>{
  assert.match(data,/mostrarImagensProdutos:Boolean\(x\.show_product_images\)/);
  assert.match(data,/show_product_images:Boolean\(x\.mostrarImagensProdutos\)/);
});
