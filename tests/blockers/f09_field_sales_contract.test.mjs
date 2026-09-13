import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

async function collectSourceFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes:true });
  const files = [];
  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dirUrl);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(url));
    else if (/\.(?:js|jsx|mjs|ts|tsx)$/.test(entry.name)) files.push(url);
  }
  return files;
}

const [admin, technician, api, v2Api, migration75, migration76, migration77, migration78, migration79] = await Promise.all([
  read('src/screens/v2/FieldSalesAdminV2.jsx'),
  read('src/screens/v2/TechnicianSalesV2.jsx'),
  read('src/lib/fieldSalesApi.js'),
  read('src/lib/v2Api.js'),
  read('supabase/0075_field_sales_consistency_and_work_order_trace.sql'),
  read('supabase/0076_remove_legacy_static_pix_qr.sql'),
  read('supabase/0077_remove_legacy_field_sale_rpc_overloads.sql'),
  read('supabase/0078_fix_field_sale_subscription_guard.sql'),
  read('supabase/0079_fix_direct_field_sale_subscription_guard.sql'),
]);

test('F09 owner: FieldSalesAdmin sobrevive ao reassemble/codemods e mostra o contrato administrativo completo', () => {
  assert.match(admin, /F09_FIELD_SALES_ADMIN_COMPLETE/);
  for (const token of [
    'pixReceiverName', 'pixReceiverCity', 'sale.produto', 'sale.quantidade', 'sale.preco',
    'sale.total', 'sale.tecnico', 'sale.criadoEm', 'sale.origemLabel', 'sale.osNumero',
    'sale.cliente', 'sale.local', 'sale.pagamentoLabel', 'sale.statusRecebimento',
    'sale.statusFinanceiro', 'sale.financialEntryId',
  ]) {
    assert.ok(admin.includes(token), `FieldSalesAdmin precisa preservar ${token}`);
  }
  assert.match(admin, /QR Pix dinâmico/);
  assert.match(admin, /valor exato daquela venda/);
  assert.match(admin, /cliente\/condomínio → local → OS\/atendimento → produtos vendidos → garantias/i);
});

test('F09 owner: modelo legado de QR fixo não existe mais na UI nem na API', async () => {
  assert.doesNotMatch(admin, /fieldSalesStorage|pixQrPath|type="file"|Enviar QR Code|QR Code cadastrado/i);
  assert.doesNotMatch(technician, /fieldSalesStorage|pixQrPath/i);
  assert.doesNotMatch(api, /pix_qr_path|pixQrPath/i);
  await assert.rejects(
    access(new URL('src/lib/fieldSalesStorage.js', root)),
    (error) => error?.code === 'ENOENT',
    'helper de upload do QR fixo não deve voltar ao repositório',
  );
  assert.match(migration76, /drop column if exists pix_qr_path/i);
});

test('F09 técnico: Pix é local, venda rápida confirma recebimento e cliente/local vêm somente de contexto seguro', () => {
  assert.match(technician, /buildPixPayload/);
  assert.match(technician, /pixQrSvgDataUri/);
  assert.match(technician, /carregarContextosVendaCampoDB/);
  assert.match(technician, /Confirmar pagamento recebido/);
  assert.match(technician, /Confirmar recebimento de/);
  assert.match(technician, /Pagamento aprovado \/ recebido/);
  assert.match(technician, /clientes e locais das suas OS abertas/i);
  assert.match(technician, /clientId:selectedContext\?\.clientId \|\| null/);
  assert.match(technician, /servicePlace:selectedContext\?\.local \|\| null/);
});

test('F09 backend API: frontend não envia preço e retry usa client_request_id nas duas origens', () => {
  assert.match(api, /p_request: req/);
  assert.match(api, /p_request:req/);
  assert.doesNotMatch(api, /p_price|p_unit_price|unitPrice:/);
  assert.match(api, /zt_sell_product_direct/);
  assert.match(api, /zt_sell_product_on_work_order/);
  assert.match(api, /zt_field_sale_client_contexts/);
  assert.match(api, /origin,work_order_id,work_order_item_id,financial_entry_id/);
  assert.match(v2Api, /p_request:requestId\|\|crypto\.randomUUID\(\)/);
});

test('F09 código: nenhuma chamada de venda volta às assinaturas RPC legadas', async () => {
  const files = await collectSourceFiles(new URL('src/', root));
  for (const url of files) {
    const source = await readFile(url, 'utf8');
    if (source.includes("supabase.rpc('zt_sell_product_direct'")) {
      assert.match(source, /p_client\s*:/, `${url.pathname} precisa enviar p_client explicitamente`);
      assert.match(source, /p_service_place\s*:/, `${url.pathname} precisa enviar p_service_place explicitamente`);
    }
    if (source.includes("supabase.rpc('zt_sell_product_on_work_order'")) {
      assert.match(source, /p_request\s*:/, `${url.pathname} precisa enviar p_request explicitamente`);
    }
  }
  assert.match(migration77, /drop function if exists public\.zt_sell_product_direct\(uuid,uuid,numeric,text,text,uuid\)/);
  assert.match(migration77, /drop function if exists public\.zt_sell_product_on_work_order\(uuid,uuid,numeric,text\)/);
});

test('F09 banco: métodos canônicos, origem, preço e guards de assinatura permanecem autoritativos', () => {
  assert.match(migration75, /payment_method in \('pix','cash','card','transfer','other'\)/);
  assert.match(migration75, /origin in \('quick','work_order'\)/);
  assert.match(migration75, /v_total := round\(v_product\.price\s*\*\s*p_quantity\s*,\s*2\)/);
  assert.match(migration75, /v_product\.price/);
  assert.match(migration75, /pg_advisory_xact_lock/);
  assert.match(migration75, /client_request_id/);
  assert.match(migration75, /zt_field_sale_client_contexts/);
  assert.match(migration78, /zt_private\.assert_operational_write_allowed\(v_wo\.company_id\)/);
  assert.doesNotMatch(migration78, /public\.zt_assert_subscription_write/);
  assert.match(migration79, /zt_private\.assert_operational_write_allowed\(p_company\)/);
  assert.doesNotMatch(migration79, /public\.zt_assert_subscription_write/);
});
