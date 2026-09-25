import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const migration=read('supabase/0087_field_workflow_global_search_post_sale.sql')+read('supabase/0088_field_workflow_wave4b_corrections.sql');
const search=read('src/components/GlobalSearchModal.jsx');
const post=read('src/screens/v2/PostSaleV2.jsx');
const apply=read('scripts/apply-field-workflow-wave4b.mjs');

test('Wave4B global search is backend, owner-only, bounded and contextual',()=>{
  assert.match(migration,/zt_global_operational_search/);
  assert.match(migration,/zt_private\.is_owner\(p_company\)/);
  assert.match(migration,/least\(greatest\(coalesce\(p_limit,30\),1\),50\)/);
  assert.match(migration,/client'::text result_type/);
  for(const type of ['location','work_order','quote','product','equipment','warranty']) assert.match(migration,new RegExp(`'${type}'`));
  assert.match(migration,/serial_number/);
  assert.match(migration,/sku/);
  assert.match(migration,/barcode/);
  assert.doesNotMatch(migration,/execute\s+format\(/i);
  assert.match(migration,/Busca global disponível somente ao proprietário/);
});

test('Wave4B search modal debounces, paginates, groups and remains mobile safe',()=>{
  assert.match(search,/setTimeout\(async\(\)=>\{/);
  assert.match(search,/,250\)/);
  assert.match(search,/Carregar mais resultados/);
  assert.match(search,/Buscar cliente, OS, produto, serial/);
  assert.match(search,/max-h-\[92dvh\]/);
  assert.match(search,/overflow-y-auto/);
  assert.match(search,/min-h-12/);
  assert.match(search,/break-words/);
  assert.match(search,/EQUIPAMENTOS INSTALADOS/);
  assert.match(search,/GARANTIAS/);
});

test('Wave4B extends the existing post_sale_followups instead of replacing it',()=>{
  assert.match(migration,/alter table public\.post_sale_followups/);
  assert.match(migration,/create table if not exists public\.post_sale_policies/);
  assert.doesNotMatch(migration,/create table if not exists public\.(?:crm|followup_events|post_sale_events)/i);
  assert.match(migration,/policy_snapshot jsonb/);
  assert.match(migration,/source_key text/);
  assert.match(migration,/unique index if not exists uq_post_sale_followups_source/);
  assert.match(migration,/services\.followup_days/);
  assert.match(migration,/coalesce\(new\.is_warranty_visit,false\)/);
  assert.match(migration,/warranty_expiring/);
});

test('Wave4B post-sale administration is owner-only, subscription guarded and records history',()=>{
  assert.match(migration,/Somente o proprietário configura o pós-venda/);
  assert.match(migration,/assert_operational_write_allowed/);
  assert.match(migration,/completed_by/);
  assert.match(migration,/work_order_reports/);
  assert.match(migration,/Pós-venda concluído/);
  assert.match(migration,/Nova data do pós-venda não pode estar no passado/);
  assert.match(migration,/Estado terminal é idempotente/);
});

test('Wave4B UI is simple owner workflow without automatic messaging',()=>{
  assert.match(post,/ATRASADOS/);
  assert.match(post,/HOJE/);
  assert.match(post,/PRÓXIMOS/);
  assert.match(post,/Políticas/);
  assert.match(post,/Concluir/);
  assert.match(post,/Adiar/);
  assert.match(post,/Falar com cliente/);
  assert.match(post,/https:\/\/wa\.me\//);
  assert.doesNotMatch(post,/sendMessage|messages\.send|graph\.facebook|whatsapp_business/i);
  assert.match(post,/min-h-11/);
  assert.match(post,/max-h-\[90dvh\]/);
  assert.match(post,/overflow-y-auto/);
});

test('Wave4B integrates after prior waves without replacing legacy pipeline',()=>{
  assert.match(apply,/patchLegacy/);
  assert.match(apply,/GlobalSearchModal/);
  assert.match(apply,/PostSaleV2/);
  assert.match(apply,/initialWorkOrderId/);
  assert.match(apply,/initialProductId/);
  assert.match(apply,/initialClientId/);
  assert.match(apply,/FIELD WORKFLOW V1 · wave 4b/);
});
