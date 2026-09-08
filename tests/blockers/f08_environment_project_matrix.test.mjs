import test from 'node:test';
import assert from 'node:assert/strict';
import { resolverConfigSupabase } from '../../src/lib/supabaseConfig.js';
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
