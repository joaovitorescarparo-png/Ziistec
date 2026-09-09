import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('wave 1 migration separates customer copy, execution forecast and product identifiers',()=>{
  const sql=read('supabase/0081_field_workflow_quote_product_fields.sql');
  assert.match(sql,/customer_message text/);
  assert.match(sql,/execution_forecast_date date/);
  assert.match(sql,/show_product_images boolean not null default false/);
  assert.match(sql,/add column if not exists sku text/);
  assert.match(sql,/add column if not exists barcode text/);
  assert.match(sql,/uq_products_company_barcode_live/);
  assert.match(sql,/zt-product-images/);
  assert.match(sql,/zt_product_images_read/);
  assert.match(sql,/p\.sale_enabled=true/);
  assert.match(sql,/zt_product_images_write/);
  assert.match(sql,/zt_subscription_can_write/);
});

test('barcode scanner is native-first, local and has manual fallback',()=>{
  const scanner=read('src/components/BarcodeScanner.jsx');
  assert.match(scanner,/BarcodeDetector/);
  assert.match(scanner,/getSupportedFormats/);
  assert.match(scanner,/getUserMedia/);
  assert.match(scanner,/facingMode/);
  assert.match(scanner,/Digitar manualmente/);
  assert.doesNotMatch(scanner,/fetch\s*\(/);
  assert.doesNotMatch(scanner,/https?:\/\//);
});

test('wave 1 codemod preserves backend authority and adds quote workflow UX',()=>{
  const patch=read('scripts/apply-field-workflow-wave1.mjs');
  assert.match(patch,/lg:grid-cols-\[1\.4fr_0\.55fr_0\.7fr_auto\]/);
  assert.match(patch,/min-h-11 min-w-11/);
  assert.match(patch,/Mensagem ao cliente/);
  assert.match(patch,/Ditar mensagem/);
  assert.match(patch,/Previsão de execução/);
  assert.match(patch,/Mostrar imagens dos produtos no PDF/);
  assert.match(patch,/SKU \/ código interno/);
  assert.match(patch,/Código de barras/);
  assert.match(patch,/zt-product-images/);
  assert.match(patch,/LEGACY_PRODUCT_IMAGE_BUCKET='zt-branding'/);
});

test('quote PDF remains commercial-only and gets workflow sections without fiscal claims',()=>{
  const pdf=read('api/quote-pdf.js');
  const patch=read('scripts/apply-field-workflow-wave1.mjs');
  assert.doesNotMatch(pdf,/select=[^\n]*unit_cost/);
  assert.doesNotMatch(patch,/Nota Fiscal|NFS-e/i);
  assert.match(patch,/SOBRE ESTA PROPOSTA/);
  assert.match(patch,/PREVISÃO DE EXECUÇÃO/);
  assert.match(patch,/PRODUTOS E SERVIÇOS/);
  assert.match(patch,/GARANTIA/);
  assert.match(patch,/Validade da proposta/);
  assert.match(patch,/show_product_images/);
  assert.match(patch,/carregarImagemProduto/);
});

test('new product metadata never changes technician cost isolation contract',()=>{
  const api=read('src/lib/v2Api.js');
  const start=api.indexOf('export async function carregarCatalogoTecnicoDB');
  const end=api.indexOf('export async function carregarOSVendaDB',start);
  assert.ok(start>=0&&end>start);
  const catalog=api.slice(start,end);
  assert.doesNotMatch(catalog,/custo\s*:/i);
  assert.doesNotMatch(catalog,/margem\s*:/i);
  assert.doesNotMatch(catalog,/fornecedor\s*:/i);
});
