import { readFileSync } from 'node:fs';

const legacy=readFileSync('src/legacy/ZiisTecApp.jsx','utf8');
const sales=readFileSync('src/screens/v2/TechnicianSalesV2.jsx','utf8');
const api=readFileSync('src/lib/fieldSalesApi.js','utf8');
const migration=readFileSync('supabase/0072_field_sales_for_technicians.sql','utf8');

const must=(ok,label)=>{if(!ok) throw new Error(`ROUND 3.8: ${label}`);};

must(legacy.includes('tecnico: ["inicio", "ordens", "registrarMateriais", "vendaCampo"]'),'technician must not have Agenda permission');
must(legacy.includes('{ id: "vendaCampo", label: "Produtos", icon: ShoppingCart }'),'technician Products nav missing');
must(legacy.includes('podeAdministrarOS && os.status === "aguardando"'),'schedule must be owner-only');
must(legacy.includes('if (podeAdministrarOS) acoes.push({ label: "Reagendar"'),'reschedule must be owner-only');
must(legacy.includes('{podeAdministrarOS && os.status !== "concluida"'),'cancel OS must be owner-only');
must(legacy.includes('Produtos para venda ·'),'owner Team products tab missing');
must(legacy.includes('Liberado para técnico'),'owner sale availability toggle missing');
must(legacy.includes('vendaHabilitada: !p.vendaHabilitada'),'sale_enabled toggle must use existing product setting');

must(sales.includes('Venda rápida'),'quick field sale UI missing');
must(sales.includes('Venda em uma OS'),'OS sale mode missing');
must(sales.includes('venderProdutoDiretoDB'),'direct sale API not connected');
must(sales.includes('venderProdutoNaOSCampoDB'),'idempotent OS sale API not connected');
must(!sales.includes('selectedProduct?.custo') && !sales.includes('selectedProduct.custo'),'technician UI must not render product cost');
must(api.includes("supabase.rpc('zt_sell_product_direct'"),'direct sale must call hardened RPC');
must(api.includes("supabase.rpc('zt_sell_product_on_work_order'"),'OS sale must call hardened RPC');
must(api.includes('p_request:req'),'OS sale must include client_request_id');

must(migration.includes('create table if not exists public.field_sales'),'field sales audit table missing');
must(migration.includes('sale_enabled=true'),'direct sale must honor owner availability flag');
must(migration.includes('v_product.price'),'server price source missing');
must(migration.includes("'Venda em campo'"),'financial field-sale category missing');
must(migration.includes('paid, paid_at'),'field sale financial entry must be received now');
must(migration.includes('field_sales_company_request_key'),'field sale idempotency constraint missing');
must(migration.includes('pg_advisory_xact_lock'),'field sale concurrent retry lock missing');

console.log('ROUND 3.8 TECHNICIAN FIELD MODE: OK');
