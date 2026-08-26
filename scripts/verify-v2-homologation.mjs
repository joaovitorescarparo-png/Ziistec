import fs from 'node:fs';
import path from 'node:path';
import { PROD_SUPABASE_HOSTS, resolverConfigSupabase } from '../src/lib/supabaseConfig.js';

const root = process.cwd();
const failures = [];
const checks = [];

function fail(message) { failures.push(message); }
function ok(message) { checks.push(message); }
function read(rel) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) { fail(`Arquivo obrigatório ausente: ${rel}`); return ''; }
  return fs.readFileSync(full, 'utf8');
}
function requireText(rel, needles) {
  const text = read(rel);
  for (const needle of needles) {
    if (!text.includes(needle)) fail(`${rel}: marcador obrigatório ausente: ${needle}`);
  }
  if (text) ok(`${rel} contém os guards esperados`);
  return text;
}

// 1) Stack V2 de migrations: não permite buraco, duplicata ou renomeação silenciosa.
const expectedMigrations = [
  '0050_product_v2_core_catalog_contracts.sql',
  '0051_product_v2_stock_sales_manual_warranty.sql',
  '0052_product_v2_contract_cycles.sql',
  '0053_v2_security_cost_isolation.sql',
  '0054_v2_work_order_extra_cost_isolation.sql',
  '0055_v2_purchase_stock_reconciliation.sql',
  '0056_security_advisor_hardening.sql',
  '0057_v2_quote_to_work_order_idempotent.sql',
  '0058_v2_function_search_path_hardening.sql',
  '0059_legacy_rpc_tenant_hardening.sql',
  '0060_preserve_private_extra_cost_on_finalize.sql',
  '0061_work_order_technical_memory_media.sql',
];
const migrationDir = path.join(root, 'supabase');
const migrationFiles = fs.readdirSync(migrationDir).filter(x => /^\d{4}_.+\.sql$/.test(x));
for (const file of expectedMigrations) {
  if (!migrationFiles.includes(file)) fail(`Migration V2 obrigatória ausente: supabase/${file}`);
}
for (let n = 50; n <= 61; n += 1) {
  const prefix = String(n).padStart(4, '0') + '_';
  const matches = migrationFiles.filter(x => x.startsWith(prefix));
  if (matches.length !== 1) fail(`Prefixo ${prefix} precisa ter exatamente 1 migration V2; encontrado: ${matches.join(', ') || 'nenhuma'}`);
}
if (!failures.some(x => x.includes('Migration V2') || x.includes('Prefixo 00'))) ok('Migrations 0050→0061 presentes, únicas e em sequência');

// 2) Contrato SQL pós-migration precisa acompanhar a stack e cobrir os invariantes críticos.
requireText('supabase/tests/v2_post_migration_contract.sql', [
  'V2_POST_MIGRATION_CONTRACT_OK',
  "to_regclass('public.work_order_item_costs')",
  "to_regclass('public.work_order_material_costs')",
  "to_regclass('public.work_order_private_costs')",
  "to_regclass('public.uq_work_orders_one_per_quote')",
  'p_document_usage_events_no_client_access',
  "id='zt-work-orders'",
  'search_path=""',
  'v_allowed_definer_signatures',
  'pg_get_function_identity_arguments',
  'V2_CONTRACT_UNREVIEWED_SECURITY_DEFINER',
  'V2_CONTRACT_COMPLETE_WORK_ORDER_MUST_BE_SERVICE_ONLY',
]);

// 3) Smoke SQL de revogação/assinatura deve continuar reproduzível e rollback-only.
requireText('supabase/tests/v2_access_subscription_rollback_smoke.sql', [
  'V2_ACCESS_REVOCATION_OK',
  'active_member=true and active_wo=true and disabled_member=false and disabled_wo=false',
  'V2_SUBSCRIPTION_REACTIVATION_OK',
  'can_write_after_cancel=false',
  'can_write_after_reactivate=true',
  'rollback;',
]);

// 4) Preview/staging jamais pode cair silenciosamente no Supabase de produção.
const prodUrl = 'https://prod-ref.supabase.co';
const prodKey = 'sb_publishable_prod_test';
const stagingUrl = 'https://staging-ref.supabase.co';
const stagingKey = 'sb_publishable_staging_test';
const mainConfig = resolverConfigSupabase({
  host: PROD_SUPABASE_HOSTS[0], prodUrl, prodKey,
});
if (!mainConfig.configurado || mainConfig.origem !== 'production-fallback' || mainConfig.url !== prodUrl) {
  fail('Supabase env isolation: host oficial da main perdeu fallback controlado');
} else ok('Host oficial da main mantém fallback público controlado');

const previewConfig = resolverConfigSupabase({
  host: 'ziistec-git-product-v2-review-js-connect.vercel.app', prodUrl, prodKey,
});
if (previewConfig.configurado || previewConfig.origem !== 'unconfigured' || previewConfig.url || previewConfig.anonKey) {
  fail('Supabase env isolation: preview sem env tentou usar credencial de produção');
} else ok('Preview sem env falha fechado e não recebe Supabase de produção');

const stagingConfig = resolverConfigSupabase({
  host: 'ziistec-git-product-v2-review-js-connect.vercel.app',
  envUrl: stagingUrl,
  envKey: stagingKey,
  prodUrl,
  prodKey,
});
if (!stagingConfig.configurado || stagingConfig.origem !== 'env' || stagingConfig.url !== stagingUrl || stagingConfig.anonKey !== stagingKey) {
  fail('Supabase env isolation: preview com env própria não ficou isolado no staging');
} else ok('Preview com env própria usa somente o Supabase de staging');

const partialConfig = resolverConfigSupabase({
  host: PROD_SUPABASE_HOSTS[0],
  envUrl: stagingUrl,
  prodUrl,
  prodKey,
});
if (partialConfig.configurado || partialConfig.origem !== 'invalid-env' || partialConfig.url || partialConfig.anonKey) {
  fail('Supabase env isolation: configuração parcial misturou staging com produção');
} else ok('Env parcial falha fechado e nunca mistura credenciais entre ambientes');

requireText('src/lib/supabase.js', [
  'resolverConfigSupabase',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'PROD_PUBLISHABLE_KEY',
]);

// 5) Invariantes de segurança dos endpoints públicos/serverless.
requireText('api/ai.js', [
  "req.method !== 'POST'",
  "auth.startsWith('Bearer ')",
  '/auth/v1/user',
  '/rest/v1/rpc/zt_consume_ai_quota',
  'process.env.ANTHROPIC_API_KEY',
]);
requireText('api/finance-ai.js', [
  "req.method !== 'POST'",
  "auth.startsWith('Bearer ')",
  '/auth/v1/user',
  '/rest/v1/rpc/zt_is_owner',
  '/rest/v1/rpc/zt_consume_ai_quota',
  'sanitizeSnapshot',
]);
const pdfApi = requireText('api/quote-pdf.js', [
  "req.method!=='POST'",
  "auth.startsWith('Bearer ')",
  '/auth/v1/user',
  '/rest/v1/rpc/zt_is_owner',
  '/rest/v1/rpc/zt_consume_quote_pdf_quota',
  'select=id,product_id,name,unit,quantity,unit_price,notes,position',
]);
if (/quote_items[^'\n]*unit_cost/i.test(pdfApi)) fail('api/quote-pdf.js: custo interno apareceu na consulta de quote_items do PDF do cliente');
else ok('PDF comercial não consulta unit_cost de quote_items');

// 6) Rotas sensíveis continuam owner-only na borda da UI (RLS permanece a autoridade real).
const app = read('src/App.jsx');
for (const route of ['produtos','compras','clientes-locais','orcamentos','orcamento-ia','garantias','contratos','financeiro','configuracoes']) {
  const marker = `workspaceV2 === "${route}" && owner`;
  if (!app.includes(marker)) fail(`src/App.jsx: rota sensível perdeu owner gate: ${route}`);
}
if (app.includes('workspaceV2 === "venda-os" && owner')) fail('src/App.jsx: venda na OS não deve virar owner-only; técnico atribuído precisa do fluxo de campo');
else ok('Rotas administrativas V2 mantêm owner gate e venda na OS continua disponível ao campo');

// 7) Sessão deve depender de membresia ativa e revalidar acesso quando o app volta ao foco.
requireText('src/lib/useSessao.js', [
  '.eq("status", "active")',
  'ultimaRevalidacao',
  'window.addEventListener("focus"',
  'document.addEventListener("visibilitychange"',
  'Seu acesso ativo a esta empresa não está mais disponível.',
]);

// 8) Configurações V2 pode explicar que pagamento ainda não existe, mas não pode expor ação clicável falsa.
const settings = read('src/screens/v2/SettingsV2.jsx');
const fakePaymentAction = /<Btn[^>]*>[\s\S]{0,180}(?:Forma de pagamento|Checkout)[\s\S]{0,80}<\/Btn>/i.test(settings)
  || /onClick\s*=\s*\{[^}]{0,220}(?:pagamento|checkout)/i.test(settings);
if (fakePaymentAction) fail('Settings V2 contém ação clicável de pagamento não integrada');
else ok('Settings V2 não expõe ação clicável de checkout/pagamento fictício');
requireText('src/lib/settingsV2Api.js', ['companies', 'subscriptions', 'cancelarAssinaturaDB', 'reativarAssinaturaDB']);

// 9) Runbook real owner/technician precisa continuar versionado junto com o código.
requireText('docs/V2_HOMOLOGATION_RUNBOOK.md', [
  'Cross-tenant',
  'Orçamento aprovado → OS',
  'Memória técnica da OS',
  'Financeiro V2 + IA',
  'Mobile/tablet',
  'Regra de merge',
]);

// 10) Headers críticos do preview/deploy.
const vercel = read('vercel.json');
for (const marker of ["geolocation=(self)", 'payment=()', "frame-ancestors 'none'", "object-src 'none'"]) {
  if (!vercel.includes(marker)) fail(`vercel.json: header de segurança ausente: ${marker}`);
}
if (vercel) ok('Headers de geolocation/frames/object/payment preservados');

// 11) Caça a segredos privilegiados de formato reconhecível em arquivos versionados de runtime.
const scanRoots = ['api', 'src', 'scripts'];
const allowedExt = new Set(['.js','.jsx','.mjs','.ts','.tsx','.json']);
const secretPatterns = [
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/g],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI key', /sk-proj-[A-Za-z0-9_-]{20,}/g],
  ['Private key PEM', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes:true })) {
    if (['node_modules','dist','.git'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (allowedExt.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}
for (const full of scanRoots.flatMap(r => walk(path.join(root, r)))) {
  const text = fs.readFileSync(full, 'utf8');
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) fail(`${path.relative(root, full)}: possível ${label} versionada`);
  }
}
if (!failures.some(x => x.includes('versionada'))) ok('Nenhum segredo privilegiado de formato conhecido encontrado em api/src/scripts');

if (failures.length) {
  console.error('\nV2 HOMOLOGATION STATIC CHECK: FAIL\n');
  failures.forEach((x,i) => console.error(`${i+1}. ${x}`));
  process.exit(1);
}

console.log('\nV2 HOMOLOGATION STATIC CHECK: OK');
checks.forEach(x => console.log(`✓ ${x}`));
console.log(`✓ ${expectedMigrations.length} migrations V2 verificadas (0050→0061)`);
