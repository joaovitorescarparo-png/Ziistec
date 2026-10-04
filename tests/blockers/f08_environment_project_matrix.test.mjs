import test from 'node:test';
import assert from 'node:assert/strict';
import { PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS, resolverConfigSupabase } from '../../src/lib/supabaseConfig.js';
import {
  PROD_SUPABASE_URL,
  STAGING_SUPABASE_URL,
  resolverSupabaseServidor,
} from '../../api/_supabaseServerConfig.js';

const PROD_KEY = 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw';
const STAGING_KEY = 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
const INVALID_URL = 'https://projeto-errado.supabase.co';
const INVALID_KEY = 'sb_publishable_invalid_test';
const PROD_HOST = 'ziistec.vercel.app';
const STAGING_HOST = 'ziistec-git-hardening-v2-staging-js-connect.vercel.app';
const FIELD_WORKFLOW_BRANCH = 'field-workflow-v1';
const FIELD_WORKFLOW_HOST = 'ziistec-git-field-workflow-v1-js-connect.vercel.app';
const RC1C_BRANCH = 'rc1c-mobile-ux-stabilization';
const RC1C_HOST = 'ziistec-git-rc1c-mobile-ux-stabilization-js-connect.vercel.app';
const ASSISTANT_HOST = 'ziistec-git-codex-ziistec-assistant-mvp-v1-js-connect.vercel.app';

const client = ({ deploymentEnv, host, envUrl = '', envKey = '' }) => resolverConfigSupabase({
  deploymentEnv,
  host,
  envUrl,
  envKey,
  prodUrl: PROD_SUPABASE_URL,
  prodKey: PROD_KEY,
  stagingUrl: STAGING_SUPABASE_URL,
  stagingKey: STAGING_KEY,
});

const server = ({ vercelEnv, branch = 'hardening-v2-staging', url = '', key = '' }) => resolverSupabaseServidor({
  VERCEL_ENV: vercelEnv,
  VERCEL_GIT_COMMIT_REF: branch,
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: key,
});

const mustConfigure = (result, url, label) => {
  assert.equal(result.configurado, true, `${label}: deveria configurar`);
  assert.equal(result.url, url, `${label}: project URL incorreta`);
};
const mustFailClosed = (result, label) => {
  assert.equal(result.configurado, false, `${label}: deveria falhar fechado`);
  assert.equal(result.url, '', `${label}: não pode expor URL utilizável`);
};

test('F08 server: production aceita somente o par exato de produção', () => {
  mustConfigure(server({ vercelEnv: 'production' }), PROD_SUPABASE_URL, 'production fallback');
  mustConfigure(server({ vercelEnv: 'production', url: PROD_SUPABASE_URL, key: PROD_KEY }), PROD_SUPABASE_URL, 'production explicit prod');
  mustFailClosed(server({ vercelEnv: 'production', url: STAGING_SUPABASE_URL, key: STAGING_KEY }), 'production com staging');
  mustFailClosed(server({ vercelEnv: 'production', url: INVALID_URL, key: INVALID_KEY }), 'production com projeto terceiro');
  mustFailClosed(server({ vercelEnv: 'production', url: PROD_SUPABASE_URL, key: INVALID_KEY }), 'production com key errada');
  mustFailClosed(server({ vercelEnv: 'production', url: PROD_SUPABASE_URL }), 'production env parcial');
});

test('F08 server: preview allowlisted aceita somente staging autorizado', () => {
  mustConfigure(server({ vercelEnv: 'preview' }), STAGING_SUPABASE_URL, 'preview fallback staging');
  mustConfigure(server({ vercelEnv: 'preview', url: STAGING_SUPABASE_URL, key: STAGING_KEY }), STAGING_SUPABASE_URL, 'preview explicit staging');
  mustFailClosed(server({ vercelEnv: 'preview', url: PROD_SUPABASE_URL, key: PROD_KEY }), 'preview com produção');
  mustFailClosed(server({ vercelEnv: 'preview', url: INVALID_URL, key: INVALID_KEY }), 'preview com projeto terceiro');
  mustFailClosed(server({ vercelEnv: 'preview', url: STAGING_SUPABASE_URL, key: INVALID_KEY }), 'preview com key errada');
  mustFailClosed(server({ vercelEnv: 'preview', branch: 'outra-branch', url: STAGING_SUPABASE_URL, key: STAGING_KEY }), 'preview desconhecido com staging explícito');
});

test('F08 field-workflow-v1: branch e host estável aceitam somente Staging', () => {
  mustConfigure(
    server({ vercelEnv: 'preview', branch: FIELD_WORKFLOW_BRANCH, url: STAGING_SUPABASE_URL, key: STAGING_KEY }),
    STAGING_SUPABASE_URL,
    'field-workflow server staging',
  );
  mustFailClosed(
    server({ vercelEnv: 'preview', branch: FIELD_WORKFLOW_BRANCH, url: PROD_SUPABASE_URL, key: PROD_KEY }),
    'field-workflow server production',
  );
  mustFailClosed(
    server({ vercelEnv: 'preview', branch: FIELD_WORKFLOW_BRANCH, url: STAGING_SUPABASE_URL, key: INVALID_KEY }),
    'field-workflow server key incompatível',
  );

  mustConfigure(
    client({ deploymentEnv: 'preview', host: FIELD_WORKFLOW_HOST, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }),
    STAGING_SUPABASE_URL,
    'field-workflow client staging',
  );
  mustFailClosed(
    client({ deploymentEnv: 'preview', host: FIELD_WORKFLOW_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_KEY }),
    'field-workflow client production',
  );
  mustFailClosed(
    client({ deploymentEnv: 'preview', host: FIELD_WORKFLOW_HOST, envUrl: INVALID_URL, envKey: INVALID_KEY }),
    'field-workflow client par incompatível',
  );
});

test('F08 RC-1C: branch e host autorizam somente Staging e preservam fail-closed', () => {
  mustConfigure(
    server({ vercelEnv: 'preview', branch: RC1C_BRANCH, url: STAGING_SUPABASE_URL, key: STAGING_KEY }),
    STAGING_SUPABASE_URL,
    'rc1c server staging',
  );
  mustFailClosed(
    server({ vercelEnv: 'preview', branch: RC1C_BRANCH, url: PROD_SUPABASE_URL, key: PROD_KEY }),
    'rc1c server production',
  );
  mustFailClosed(
    server({ vercelEnv: 'preview', branch: RC1C_BRANCH, url: STAGING_SUPABASE_URL, key: INVALID_KEY }),
    'rc1c server key staging inválida',
  );

  mustConfigure(
    client({ deploymentEnv: 'preview', host: RC1C_HOST, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }),
    STAGING_SUPABASE_URL,
    'rc1c client staging',
  );
  mustFailClosed(
    client({ deploymentEnv: 'preview', host: RC1C_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_KEY }),
    'rc1c client production',
  );
  mustFailClosed(
    client({ deploymentEnv: 'preview', host: RC1C_HOST, envUrl: INVALID_URL, envKey: INVALID_KEY }),
    'rc1c client terceiro',
  );

  mustFailClosed(
    server({ vercelEnv: 'preview', branch: 'rc1c-preview-desconhecido', url: STAGING_SUPABASE_URL, key: STAGING_KEY }),
    'preview server realmente desconhecido',
  );
  mustFailClosed(
    client({ deploymentEnv: 'preview', host: 'rc1c-preview-desconhecido.vercel.app', envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }),
    'preview client realmente desconhecido',
  );
});

test('F08 server: development aceita staging explícito e nunca produção/terceiro', () => {
  mustConfigure(server({ vercelEnv: 'development', url: STAGING_SUPABASE_URL, key: STAGING_KEY }), STAGING_SUPABASE_URL, 'development staging');
  mustFailClosed(server({ vercelEnv: 'development', url: PROD_SUPABASE_URL, key: PROD_KEY }), 'development produção');
  mustFailClosed(server({ vercelEnv: 'development', url: INVALID_URL, key: INVALID_KEY }), 'development terceiro');
  mustFailClosed(server({ vercelEnv: 'development' }), 'development sem env');
});

test('F08 client: production host/env aceita somente produção', () => {
  mustConfigure(client({ deploymentEnv: 'production', host: PROD_HOST }), PROD_SUPABASE_URL, 'client production fallback');
  mustConfigure(client({ deploymentEnv: 'production', host: PROD_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_KEY }), PROD_SUPABASE_URL, 'client production explicit');
  mustFailClosed(client({ deploymentEnv: 'production', host: PROD_HOST, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }), 'client production staging');
  mustFailClosed(client({ deploymentEnv: 'production', host: PROD_HOST, envUrl: INVALID_URL, envKey: INVALID_KEY }), 'client production terceiro');
  mustFailClosed(client({ deploymentEnv: 'production', host: PROD_HOST, envUrl: PROD_SUPABASE_URL, envKey: INVALID_KEY }), 'client production key errada');
});

test('F08 client: preview conhecido aceita somente staging; host desconhecido falha', () => {
  mustConfigure(client({ deploymentEnv: 'preview', host: STAGING_HOST }), STAGING_SUPABASE_URL, 'client preview fallback');
  mustConfigure(client({ deploymentEnv: 'preview', host: STAGING_HOST, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }), STAGING_SUPABASE_URL, 'client preview explicit staging');
  mustFailClosed(client({ deploymentEnv: 'preview', host: STAGING_HOST, envUrl: PROD_SUPABASE_URL, envKey: PROD_KEY }), 'client preview produção');
  mustFailClosed(client({ deploymentEnv: 'preview', host: STAGING_HOST, envUrl: INVALID_URL, envKey: INVALID_KEY }), 'client preview terceiro');
  mustFailClosed(client({ deploymentEnv: 'preview', host: 'preview-desconhecido.vercel.app', envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }), 'client preview host desconhecido');
});

test('F08 client: development aceita apenas staging explícito', () => {
  mustConfigure(client({ deploymentEnv: 'development', host: 'localhost', envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }), STAGING_SUPABASE_URL, 'client development staging');
  mustFailClosed(client({ deploymentEnv: 'development', host: 'localhost', envUrl: PROD_SUPABASE_URL, envKey: PROD_KEY }), 'client development produção');
  mustFailClosed(client({ deploymentEnv: 'development', host: 'localhost', envUrl: INVALID_URL, envKey: INVALID_KEY }), 'client development terceiro');
  mustFailClosed(client({ deploymentEnv: 'development', host: 'localhost', envUrl: STAGING_SUPABASE_URL }), 'client development parcial');
});

test('F08 Assistant client: somente o alias exato do Preview do Assistant usa Staging', () => {
  assert.equal(STAGING_SUPABASE_HOSTS.filter((host) => host === ASSISTANT_HOST).length, 1, 'assistant host exato na allowlist de staging');
  assert.equal(PROD_SUPABASE_HOSTS.includes(ASSISTANT_HOST), false, 'assistant host nunca na allowlist de produção');
  assert.equal([...PROD_SUPABASE_HOSTS, ...STAGING_SUPABASE_HOSTS].some((host) => host.includes('*')), false, 'allowlists sem wildcard');

  for (const deploymentEnv of ['preview', '']) {
    const label = `assistant client staging explícito (${deploymentEnv || 'env inferido'})`;
    const result = client({ deploymentEnv, host: ASSISTANT_HOST, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY });
    mustConfigure(result, STAGING_SUPABASE_URL, label);
    assert.equal(result.anonKey, STAGING_KEY, `${label}: key de staging`);
    assert.equal(result.origem, 'env-staging', `${label}: contexto de preview staging`);
  }
  mustConfigure(client({ deploymentEnv: 'preview', host: ASSISTANT_HOST }), STAGING_SUPABASE_URL, 'assistant client fallback staging');

  for (const [envUrl, envKey] of [[PROD_SUPABASE_URL, PROD_KEY], [STAGING_SUPABASE_URL, INVALID_KEY], [INVALID_URL, INVALID_KEY]]) {
    mustFailClosed(client({ deploymentEnv: 'preview', host: ASSISTANT_HOST, envUrl, envKey }), `assistant client par não autorizado ${envUrl}`);
  }
  mustFailClosed(client({ deploymentEnv: 'preview', host: ASSISTANT_HOST, envUrl: STAGING_SUPABASE_URL }), 'assistant client env parcial');
  for (const [envUrl, envKey] of [[PROD_SUPABASE_URL, PROD_KEY], [STAGING_SUPABASE_URL, STAGING_KEY], ['', '']]) {
    mustFailClosed(client({ deploymentEnv: 'production', host: ASSISTANT_HOST, envUrl, envKey }), `assistant client nunca recebe production ${envUrl || 'sem env'}`);
  }

  for (const host of [
    'ziistec-git-codex-ziistec-assistant-mvp-v2-js-connect.vercel.app',
    'ziistec-git-codex-ziistec-assistant-mvp-js-connect.vercel.app',
    `${ASSISTANT_HOST}.example.com`,
    'ziistec-a1b2c3d4e-js-connect.vercel.app',
  ]) {
    mustFailClosed(client({ deploymentEnv: 'preview', host, envUrl: STAGING_SUPABASE_URL, envKey: STAGING_KEY }), `preview desconhecido ${host} com staging`);
    mustFailClosed(client({ deploymentEnv: 'preview', host }), `preview desconhecido ${host} sem env`);
  }
});
