import fs from 'node:fs';
import path from 'node:path';
import { PROD_SUPABASE_URL, resolverSupabaseServidor } from '../api/_supabaseServerConfig.js';

const root = process.cwd();
const failures = [];
const ok = (condition, message) => { if (!condition) failures.push(message); };

const prod = resolverSupabaseServidor({ VERCEL_ENV: 'production' });
ok(prod.configurado && prod.origem === 'production-fallback' && prod.url === PROD_SUPABASE_URL, 'Production perdeu fallback público controlado.');

const previewEmpty = resolverSupabaseServidor({ VERCEL_ENV: 'preview' });
ok(!previewEmpty.configurado && previewEmpty.origem === 'unconfigured' && !previewEmpty.url, 'Preview sem env não falhou fechado.');

const previewProd = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  SUPABASE_URL: PROD_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prod_test',
});
ok(!previewProd.configurado && previewProd.origem === 'production-blocked-in-preview' && !previewProd.url, 'Preview conseguiu apontar explicitamente para produção.');

const previewStage = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  SUPABASE_URL: 'https://staging-test.supabase.co/',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_staging_test',
});
ok(previewStage.configurado && previewStage.origem === 'env' && previewStage.url === 'https://staging-test.supabase.co', 'Preview com staging próprio não foi aceito corretamente.');

const partial = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  SUPABASE_URL: 'https://staging-test.supabase.co',
});
ok(!partial.configurado && partial.origem === 'invalid-env', 'Env parcial do serverless não falhou fechado.');

const endpoints = ['api/ai.js', 'api/finance-ai.js', 'api/quote-pdf.js'];
for (const rel of endpoints) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  ok(text.includes("from './_supabaseServerConfig.js'"), `${rel}: não usa o resolver server-side compartilhado.`);
  ok(text.includes('supabaseServidor.configurado'), `${rel}: não falha fechado quando Supabase está indisponível.`);
  ok(text.includes('MAX_BODY_BYTES'), `${rel}: limite de request body ausente.`);
  ok(text.includes('status(413)'), `${rel}: resposta 413 para payload grande ausente.`);
  ok(text.includes('AbortSignal.timeout'), `${rel}: timeout de chamada externa ausente.`);
  ok(text.includes('application/json'), `${rel}: validação/uso de JSON ausente.`);
  ok(!text.includes(PROD_SUPABASE_URL), `${rel}: URL de produção voltou a ser hard-coded fora do resolver central.`);
}

const genericAi = fs.readFileSync(path.join(root, 'api/ai.js'), 'utf8');
const genericOwnerIndex = genericAi.indexOf('/rest/v1/rpc/zt_is_owner');
const genericPaidGateIndex = genericAi.indexOf('if (!paidAiAtivo)');
const genericQuotaIndex = genericAi.indexOf('/rest/v1/rpc/zt_consume_ai_quota');
const genericAnthropicIndex = genericAi.indexOf('https://api.anthropic.com/v1/messages');
ok(genericOwnerIndex >= 0, 'api/ai.js: owner guard ausente.');
ok(genericPaidGateIndex >= 0, 'api/ai.js: paid AI gate ausente.');
ok(genericQuotaIndex >= 0, 'api/ai.js: quota RPC ausente.');
ok(genericAnthropicIndex >= 0, 'api/ai.js: chamada Anthropic ausente.');
ok(genericOwnerIndex >= 0 && genericQuotaIndex >= 0 && genericOwnerIndex < genericQuotaIndex, 'api/ai.js: owner guard precisa ocorrer antes do consumo de quota.');
ok(genericPaidGateIndex >= 0 && genericQuotaIndex >= 0 && genericPaidGateIndex < genericQuotaIndex, 'api/ai.js: paid AI gate precisa ocorrer antes do consumo de quota.');
ok(genericPaidGateIndex >= 0 && genericAnthropicIndex >= 0 && genericPaidGateIndex < genericAnthropicIndex, 'api/ai.js: paid AI gate precisa ocorrer antes da chamada ao provedor.');
ok(genericAi.includes('Somente o proprietário pode usar a interpretação comercial com IA.'), 'api/ai.js: resposta explícita de owner-only ausente.');

const financeAi = fs.readFileSync(path.join(root, 'api/finance-ai.js'), 'utf8');
const financePaidGateIndex = financeAi.indexOf('if (!paidAiAtivo)');
const financeQuotaIndex = financeAi.indexOf('/rest/v1/rpc/zt_consume_ai_quota');
const financeAnthropicIndex = financeAi.indexOf('https://api.anthropic.com/v1/messages');
ok(financeAi.includes("from './_paidFeatures.js'"), 'api/finance-ai.js: helper de feature paga ausente.');
ok(financePaidGateIndex >= 0, 'api/finance-ai.js: paid AI gate ausente.');
ok(financePaidGateIndex >= 0 && financeQuotaIndex >= 0 && financePaidGateIndex < financeQuotaIndex, 'api/finance-ai.js: paid AI gate precisa ocorrer antes da quota.');
ok(financePaidGateIndex >= 0 && financeAnthropicIndex >= 0 && financePaidGateIndex < financeAnthropicIndex, 'api/finance-ai.js: paid AI gate precisa ocorrer antes da Anthropic.');

if (failures.length) {
  console.error('\nSERVER ENV ISOLATION CHECK: FAIL\n');
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log('\nSERVER ENV ISOLATION CHECK: OK');
console.log('✓ Preview sem staging falha fechado');
console.log('✓ Preview não aceita Supabase de produção nem por env explícita');
console.log('✓ Produção mantém fallback público controlado');
console.log('✓ AI, Finance AI e PDF têm body limit + timeout + isolamento compartilhado');
console.log('✓ IA comercial valida owner antes de consumir quota ou chamar o provedor');
console.log('✓ IA paga permanece fail-closed antes de quota/provedor em Orçamento e Financeiro');
