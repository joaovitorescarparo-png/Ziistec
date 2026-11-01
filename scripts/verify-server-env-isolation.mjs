import fs from 'node:fs';
import path from 'node:path';
import {
  PROD_SUPABASE_URL,
  STAGING_BRANCH,
  STAGING_SUPABASE_URL,
  STAGING_PUBLISHABLE_KEY,
  resolverSupabaseServidor,
} from '../api/_supabaseServerConfig.js';
import { ANTHROPIC_MESSAGES_URL, GEMINI_API_BASE } from '../api/_aiGateway.js';

const root = process.cwd();
const failures = [];
const ok = (condition, message) => { if (!condition) failures.push(message); };

const prod = resolverSupabaseServidor({ VERCEL_ENV: 'production' });
ok(prod.configurado && prod.origem === 'production-fallback' && prod.url === PROD_SUPABASE_URL, 'Production perdeu fallback público controlado.');

const previewEmpty = resolverSupabaseServidor({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'outra-branch' });
ok(!previewEmpty.configurado && previewEmpty.origem === 'unconfigured' && !previewEmpty.url, 'Preview fora da homologação não falhou fechado.');

const previewV2 = resolverSupabaseServidor({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: STAGING_BRANCH });
ok(previewV2.configurado && previewV2.origem === 'staging-fallback' && previewV2.url === STAGING_SUPABASE_URL, 'Product V2 preview não recebeu o staging isolado.');

const previewProd = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: STAGING_BRANCH,
  SUPABASE_URL: PROD_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_prod_test',
});
ok(!previewProd.configurado && !previewProd.url, 'Preview conseguiu apontar explicitamente para produção.');

const previewStage = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: STAGING_BRANCH,
  SUPABASE_URL: STAGING_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE_KEY,
});
ok(previewStage.configurado && previewStage.url === STAGING_SUPABASE_URL, 'Preview allowlisted não aceitou o par exato do staging.');

const previewUnknownExplicit = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'outra-branch',
  SUPABASE_URL: STAGING_SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: STAGING_PUBLISHABLE_KEY,
});
ok(!previewUnknownExplicit.configurado && !previewUnknownExplicit.url, 'Preview desconhecido aceitou staging explicitamente.');

const partial = resolverSupabaseServidor({
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: STAGING_BRANCH,
  SUPABASE_URL: STAGING_SUPABASE_URL,
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

// Endpoints de IA: owner → trava de IA externa → quota → gateway neutro, nessa ordem.
const aiGateFlow = (rel, ownerMarker) => {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const owner = ownerMarker ? text.indexOf(ownerMarker) : -1;
  const gate = text.indexOf('if (!externalAiEnabled(process.env))');
  const ready = text.indexOf('if (!externalAiReady(process.env))');
  const quota = text.indexOf('/rest/v1/rpc/zt_consume_ai_quota');
  const provider = text.indexOf('requestAiText(');
  ok(text.includes("from './_aiGateway.js'"), `${rel}: não usa o gateway neutro de IA.`);
  ok(gate >= 0 && ready >= 0 && quota >= 0 && provider >= 0, `${rel}: trava de IA externa, configuração, quota ou chamada ao gateway ausente.`);
  ok(gate < ready && ready < quota && quota < provider, `${rel}: IA externa precisa falhar fechada antes da quota e da chamada ao provedor.`);
  if (ownerMarker) ok(owner >= 0 && owner < gate, `${rel}: owner guard precisa ocorrer antes da trava de IA e da quota.`);
  return text;
};
const genericAi = aiGateFlow('api/ai.js', '/rest/v1/rpc/zt_is_owner');
ok(genericAi.includes('Somente o proprietário pode usar a interpretação comercial com IA.'), 'api/ai.js: resposta explícita de owner-only ausente.');
aiGateFlow('api/finance-ai.js', '/rest/v1/rpc/zt_is_owner');

// Gateway neutro: só ele conhece provedores, URLs e headers, e repete a trava fail-closed antes do fetch.
const gateway = fs.readFileSync(path.join(root, 'api/_aiGateway.js'), 'utf8');
const gatewayEnabledIndex = gateway.indexOf("if (!externalAiEnabled(env)) return { ok: false, code: 'EXTERNAL_AI_DISABLED' }");
const gatewayProviderIndex = gateway.indexOf("if (!adapter) return { ok: false, code: 'AI_PROVIDER_INVALID' }");
const gatewayKeyIndex = gateway.indexOf("if (!key) return { ok: false, code: 'AI_KEY_MISSING' }");
const gatewayResolveIndex = gateway.indexOf('if (!provider.ok) throw');
const gatewayFetchIndex = gateway.indexOf('fetchImpl(request.url');
ok(gatewayEnabledIndex >= 0 && gatewayProviderIndex > gatewayEnabledIndex && gatewayKeyIndex > gatewayProviderIndex, 'api/_aiGateway.js: flag, provedor e chave precisam falhar fechados nessa ordem.');
ok(gatewayResolveIndex >= 0 && gatewayFetchIndex > gatewayResolveIndex, 'api/_aiGateway.js: a configuração precisa ser validada antes da chamada ao provedor.');
ok(gateway.includes('AbortSignal.timeout'), 'api/_aiGateway.js: timeout ausente.');
ok(gateway.includes("'x-goog-api-key': key") && !/[?&]key=/.test(gateway), 'api/_aiGateway.js: a chave do Gemini deve ir em header, nunca na URL.');
for (const line of gateway.split('\n').filter((item) => item.includes('console.'))) {
  ok(!/\b(key|request|messages|system|headers|body)\b/.test(line.replace(/`[^`]*`/g, '')), 'api/_aiGateway.js: log não pode incluir chave, pedido ou corpo.');
}
// Hosts derivados das constantes do gateway: a verificação procura chamadas diretas, não valida URL de entrada.
const providerUrls = [new URL(GEMINI_API_BASE), new URL(ANTHROPIC_MESSAGES_URL)];
ok(providerUrls.every((url) => url.protocol === 'https:') && providerUrls[0].hostname === 'generativelanguage.googleapis.com'
  && providerUrls[1].hostname === 'api.anthropic.com', 'api/_aiGateway.js: URL de provedor inesperada.');
for (const rel of fs.readdirSync(path.join(root, 'api')).filter((name) => name.endsWith('.js') && name !== '_aiGateway.js').map((name) => `api/${name}`)) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  ok(providerUrls.every((url) => !text.includes(url.hostname)), `${rel}: chama provedor de IA fora do gateway neutro.`);
}
ok(fs.readFileSync(path.join(root, 'api/_assistantPlanner.js'), 'utf8').includes("from './_aiGateway.js'"), 'api/_assistantPlanner.js: não usa o gateway neutro de IA.');
const assistantApi = fs.readFileSync(path.join(root, 'api/assistant.js'), 'utf8');
const assistantGateIndex = assistantApi.indexOf('if (!externalAiReady(env))');
const assistantQuotaIndex = assistantApi.indexOf("rpc('zt_assistant_consume_ai_quota'");
ok(assistantGateIndex >= 0 && assistantQuotaIndex >= 0 && assistantGateIndex < assistantQuotaIndex, 'api/assistant.js: IA externa precisa falhar fechada antes da quota.');

if (failures.length) {
  console.error('\nSERVER ENV ISOLATION CHECK: FAIL\n');
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exit(1);
}

console.log('\nSERVER ENV ISOLATION CHECK: OK');
console.log('✓ Production aceita somente o project ref autorizado');
console.log('✓ Preview allowlisted aceita somente o staging autorizado');
console.log('✓ Preview desconhecido e env parcial falham fechado');
console.log('✓ AI, Finance AI e PDF usam o resolver compartilhado com body limit + timeout');
console.log('✓ IA comercial valida owner antes de consumir quota ou chamar o provedor');
console.log('✓ IA externa permanece fail-closed (flag, provedor, chave) antes de quota/provedor em Orçamento, Financeiro e Assistente');
console.log('✓ Provedores de IA (Gemini principal, Anthropic opcional) chamados somente pelo gateway neutro');
