import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=(p)=>readFileSync(p,'utf8');

test('wave 4 mobile ergonomics keep field sales and Pix usable on narrow screens',()=>{
  const css=read('src/index.css');
  assert.match(css,/MOBILE HOMOLOGATION · waves 4-6 shared field ergonomics/);
  assert.match(css,/@media \(max-width: 820px\)/);
  assert.match(css,/min-width:\s*44px/);
  assert.match(css,/min-height:\s*44px/);
  assert.match(css,/min-height:\s*100dvh/);
  assert.match(css,/max-height:\s*94dvh/);
  assert.match(css,/img\[alt\^="QR Code Pix"\]/);
  assert.match(css,/width:\s*min\(16rem, 100%\)/);
  assert.match(css,/height:\s*auto/);
  assert.match(css,/aspect-ratio:\s*1 \/ 1/);
});

test('technician catalog projection excludes private product economics',()=>{
  const api=read('src/lib/v2Api.js');
  const start=api.indexOf('export async function carregarCatalogoTecnicoDB');
  const end=api.indexOf('export async function carregarOSVendaDB',start);
  assert.ok(start>=0&&end>start,'technician catalog function must exist');
  const catalog=api.slice(start,end);
  assert.match(catalog,/zt_technician_catalog/);
  assert.match(catalog,/preco:n\(p\.price\)/);
  assert.doesNotMatch(catalog,/custo\s*:/i);
  assert.doesNotMatch(catalog,/margem\s*:/i);
  assert.doesNotMatch(catalog,/fornecedor\s*:/i);
});

test('field sale client sends intent only and never supplies authoritative price',()=>{
  const api=read('src/lib/fieldSalesApi.js');
  const direct=api.slice(api.indexOf('export async function venderProdutoDiretoDB'),api.indexOf('export async function venderProdutoNaOSCampoDB'));
  const onWo=api.slice(api.indexOf('export async function venderProdutoNaOSCampoDB'),api.indexOf('export async function carregarContextosVendaCampoDB'));
  for(const source of [direct,onWo]){
    assert.match(source,/requestId|p_request/);
    assert.doesNotMatch(source,/unit_price|p_price|unitPrice|preco\s*:/i);
  }
});

test('canonical quick sale keeps backend price, sale_enabled, idempotency, stock lock and finance atomicity',()=>{
  const sql=read('supabase/0079_fix_direct_field_sale_subscription_guard.sql');
  assert.match(sql,/zt_private\.assert_operational_write_allowed\(p_company\)/);
  assert.match(sql,/p\.sale_enabled=true/);
  assert.match(sql,/for update;/i);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/client_request_id=p_request/);
  assert.match(sql,/v_total := round\(v_product\.price\*p_quantity,2\)/);
  assert.match(sql,/insert into public\.financial_entries/);
  assert.match(sql,/insert into public\.field_sales/);
  assert.match(sql,/stock_qty=stock_qty-p_quantity/);
  assert.match(sql,/insert into public\.inventory_movements/);
});

test('canonical work-order sale stays assigned/open, idempotent and does not create immediate duplicate revenue',()=>{
  const sql=read('supabase/0078_fix_field_sale_subscription_guard.sql');
  assert.match(sql,/v_wo\.status in \('done','canceled'\)/);
  assert.match(sql,/v_wo\.assigned_to is distinct from v_user/);
  assert.match(sql,/zt_private\.assert_operational_write_allowed\(v_wo\.company_id\)/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/client_request_id=p_request/);
  assert.match(sql,/p\.sale_enabled=true/);
  assert.match(sql,/for update;/i);
  assert.match(sql,/v_total := round\(v_product\.price\*p_quantity,2\)/);
  assert.match(sql,/insert into public\.work_order_items/);
  assert.match(sql,/insert into public\.field_sales/);
  assert.match(sql,/stock_qty=stock_qty-p_quantity/);
  assert.doesNotMatch(sql,/insert into public\.financial_entries/i);
});
