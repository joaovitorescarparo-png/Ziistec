import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {appendKitSeed,applyTemplateSeed,emptyReuseSeed,seedFromWorkOrder} from '../../src/lib/quoteReuseMerge.js';

const read=(p)=>fs.readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const migration=read('supabase/0085_field_workflow_templates_kits_reuse.sql');
const locationMigration=read('supabase/0086_field_workflow_client_location_binding.sql');
const api=read('src/lib/quoteReuseV2Api.js');
const quote=read('src/screens/v2/QuoteAIV2.jsx');
const editor=read('src/screens/v2/QuoteReuseEditorV2.jsx');
const locationField=read('src/components/QuoteClientLocationField.jsx');
const picker=read('src/components/QuoteReusePicker.jsx');
const admin=read('src/components/QuoteReuseAdmin.jsx');
const history=read('src/screens/v2/WorkOrderMemoryV2.jsx');

test('Wave 4A backend keeps tenant/owner/subscription and current catalog authority',()=>{
  for(const token of ['quote_templates','quote_template_items','quote_kits','quote_kit_items','zt_assert_wave4a_owner','assert_operational_write_allowed','zt_resolve_quote_template','zt_resolve_quote_kit','s.active and s.deleted_at is null','p.active and p.deleted_at is null']) assert.match(migration,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(migration,/Somente o proprietário administra modelos e kits/);
  assert.doesNotMatch(migration,/quote_template_items[\s\S]{0,500}unit_price/);
  assert.doesNotMatch(migration,/quote_kit_items[\s\S]{0,500}unit_price/);
});

test('kit retry merge is deterministic and never duplicates the same kit lines',()=>{
  const start=emptyReuseSeed();
  const kit={source_id:'k1',items:[{reuse_key:'kit:k1:i1',kind:'product',product_id:'p1',name:'Câmera',quantity:1,unit_price:200,unit_cost:100,available:true},{reuse_key:'kit:k1:i2',kind:'service',service_id:'s1',name:'Instalação',quantity:1,unit_price:150,unit_cost:20,available:true}]};
  const once=appendKitSeed(start,kit);const twice=appendKitSeed(once,kit);
  assert.equal(once.items.length,2);assert.equal(twice.items.length,2);assert.deepEqual(twice.items.map(x=>x.reuseKey),once.items.map(x=>x.reuseKey));
});

test('template application preserves selected relational client/location inputs',()=>{
  const start={...emptyReuseSeed(),clientId:'c1',clientLocationId:'l1',clientLocationName:'Apto 12',clientLocationAddress:'Rua A',address:'Rua A',servicePlace:'Apto 12',items:[{reuseKey:'old',name:'old',quantity:1,unitPrice:1}]};
  const next=applyTemplateSeed(start,{source_id:'t1',title:'Fechadura',items:[{reuse_key:'template:t1:i1',kind:'product',product_id:'p1',name:'FR220',quantity:1,unit_price:720,unit_cost:500,available:true}]});
  assert.equal(next.clientId,'c1');assert.equal(next.clientLocationId,'l1');assert.equal(next.address,'Rua A');assert.equal(next.servicePlace,'Apto 12');assert.equal(next.items.length,1);assert.equal(next.items[0].unitPrice,720);
});

test('legacy work-order text never becomes a confirmed client location in the frontend seed',()=>{
  const seed=seedFromWorkOrder({source_id:'w1',source_number:'OS-10',client_id:'c1',address:'Rua atual',service_place:null,legacy_service_place:'Porta antiga',location_confirmed:false,client_location_id:null,description:'Troca',items:[],billing_entry_id:'never',warranty_id:'never',report:'never'});
  assert.equal(seed.clientId,'c1');assert.equal(seed.address,'Rua atual');assert.equal(seed.clientLocationId,null);assert.equal(seed.servicePlace,'');assert.equal(seed.legacyServicePlace,'Porta antiga');
  for(const key of ['billing_entry_id','warranty_id','report','status','completed_at','signature','return']) assert.equal(Object.prototype.hasOwnProperty.call(seed,key),false);
});

test('confirmed work-order relation maps id/name/address while keeping legacy text separate',()=>{
  const seed=seedFromWorkOrder({source_id:'w2',source_number:'OS-11',client_id:'c1',client_location_id:'l1',client_location_name:'Porta social',client_location_address:'Rua local',location_confirmed:true,legacy_service_place:'Texto histórico',address:'Rua local',items:[]});
  assert.equal(seed.clientLocationId,'l1');assert.equal(seed.clientLocationName,'Porta social');assert.equal(seed.clientLocationAddress,'Rua local');assert.equal(seed.servicePlace,'Porta social');assert.equal(seed.legacyServicePlace,'Texto histórico');
});

test('SQL seed excludes post-sale sources and conversion snapshots checklist only at OS creation',()=>{
  const seedFn=locationMigration.slice(locationMigration.indexOf('create or replace function public.zt_quote_seed_from_work_order'),locationMigration.indexOf('create or replace function public.zt_save_reuse_quote_idempotent'));
  assert.match(seedFn,/from public\.work_order_items/);
  for(const forbidden of ['from public.financial_entries','from public.warranties','from public.work_order_reports','from public.attachments','work_order_returns','work_order_materials']) assert.doesNotMatch(seedFn,new RegExp(forbidden.replaceAll('.','\\.')));
  assert.match(migration,/perform public\.zt_apply_checklist_template\(v_wo,v_quote\.checklist_template_id\)/);
  assert.match(migration,/perform public\.zt_apply_checklist_template\(v_existing,v_quote\.checklist_template_id\)/);
});

test('Wave 4A.1 binds quote/work order to client_locations with composite tenant+client FK',()=>{
  assert.match(locationMigration,/alter table public\.quotes add column if not exists client_location_id uuid/);
  assert.match(locationMigration,/alter table public\.work_orders add column if not exists client_location_id uuid/);
  assert.match(locationMigration,/foreign key\(company_id,client_id,client_location_id\)[\s\S]*references public\.client_locations\(company_id,client_id,id\)/);
  assert.match(locationMigration,/zt_save_quote_from_work_order_idempotent/);
  assert.match(locationMigration,/l\.id=p_location and l\.company_id=w\.company_id and l\.client_id=v_client/);
  assert.match(locationMigration,/'legacy_service_place',w\.service_place/);
  assert.match(locationMigration,/'service_place',case when v_location_confirmed then l\.name else null end/);
  assert.doesNotMatch(locationMigration,/update public\.work_orders[\s\S]{0,500}zt_normalize_location_key/);
});

test('frontend requires a current client location for work-order reuse and can create one safely',()=>{
  assert.match(api,/zt_list_client_locations_for_quote/);assert.match(api,/zt_create_client_location_for_quote/);assert.match(api,/zt_save_quote_from_work_order_idempotent/);
  assert.match(editor,/seed\.sourceKind==='work_order'&&!seed\.clientLocationId/);
  assert.match(editor,/client_location_id:seed\.clientLocationId\|\|null/);
  assert.match(editor,/sourceWorkOrderId:seed\.sourceKind==='work_order'\?seed\.sourceId:null/);
  assert.match(locationField,/Local registrado no atendimento anterior:/);assert.match(locationField,/Referência histórica apenas/);assert.match(locationField,/Local reutilizado:/);assert.match(locationField,/Cadastrar local/);
  assert.match(locationField,/min-h-11/);assert.match(locationField,/break-words/);
});

test('frontend exposes required fast actions, owner admin and mobile-safe searchable selectors',()=>{
  assert.match(quote,/Usar modelo/);assert.match(quote,/Adicionar kit/);assert.match(editor,/Usar modelo/);assert.match(editor,/Adicionar kit/);assert.match(history,/Criar orçamento baseado neste atendimento/);
  for(const source of [picker,admin,history]){assert.match(source,/overflow-y-auto/);assert.match(source,/max-h-\[min\(/);assert.match(source,/min-h-11/);assert.match(source,/break-words/);}
  assert.match(picker,/Buscar/);assert.match(history,/Buscar OS, cliente ou local/);assert.match(editor,/Substitua ou remova antes de salvar/);
});

test('frontend template/kit admin never sends prices as stored configuration',()=>{
  const adminSegment=api.slice(api.indexOf('const adminItems'),api.indexOf('export function novoQuoteReuseRequestId'));
  assert.doesNotMatch(adminSegment,/unit_price|unit_cost|price|cost/);
  assert.match(admin,/Preço é resolvido pelo catálogo ao usar/);
});
