const PROD_SUPABASE_URL = 'https://diztevlpbcfqleizswxr.supabase.co';
const PROD_PUBLISHABLE_KEY = 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw';
const STAGING_SUPABASE_URL = 'https://xadoktssibuuebzzjrhv.supabase.co';
const STAGING_PUBLISHABLE_KEY = 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
const STAGING_BRANCH = 'product-v2-review';
const STAGING_BRANCHES = Object.freeze([
  STAGING_BRANCH,
  'ui-v1-v2-merge',
  'hardening-v2-staging',
]);

const clean = (value) => String(value || '').trim();
const normalizeUrl = (value) => clean(value).replace(/\/+$/, '');
const fail = (origem) => ({ configurado: false, origem, url: '', publishableKey: '' });

export function resolverSupabaseServidor(env = process.env) {
  const vercelEnv = clean(env?.VERCEL_ENV).toLowerCase();
  const gitBranch = clean(env?.VERCEL_GIT_COMMIT_REF);
  const isProduction = vercelEnv === 'production';
  const isStagingPreview = vercelEnv === 'preview' && STAGING_BRANCHES.includes(gitBranch);
  const isDevelopment = vercelEnv === 'development';
  const envUrl = normalizeUrl(env?.SUPABASE_URL);
  const envKey = clean(env?.SUPABASE_PUBLISHABLE_KEY);
  const hasUrl = Boolean(envUrl);
  const hasKey = Boolean(envKey);

  if (hasUrl !== hasKey) return fail('invalid-env');

  const explicitPair = hasUrl && hasKey;
  const isExactProdPair = envUrl === PROD_SUPABASE_URL && envKey === PROD_PUBLISHABLE_KEY;
  const isExactStagingPair = envUrl === STAGING_SUPABASE_URL && envKey === STAGING_PUBLISHABLE_KEY;

  if (explicitPair) {
    if (isProduction) {
      return isExactProdPair
        ? { configurado: true, origem: 'env-production', url: PROD_SUPABASE_URL, publishableKey: PROD_PUBLISHABLE_KEY }
        : fail('environment-project-mismatch');
    }
    if (isStagingPreview || isDevelopment) {
      return isExactStagingPair
        ? { configurado: true, origem: isDevelopment ? 'env-development-staging' : 'env-staging', url: STAGING_SUPABASE_URL, publishableKey: STAGING_PUBLISHABLE_KEY }
        : fail('environment-project-mismatch');
    }
    return fail('environment-project-mismatch');
  }

  if (isStagingPreview) {
    return {
      configurado: true,
      origem: 'staging-fallback',
      url: STAGING_SUPABASE_URL,
      publishableKey: STAGING_PUBLISHABLE_KEY,
    };
  }

  if (isProduction) {
    return {
      configurado: true,
      origem: 'production-fallback',
      url: PROD_SUPABASE_URL,
      publishableKey: PROD_PUBLISHABLE_KEY,
    };
  }

  return fail('unconfigured');
}

export const supabaseServidor = resolverSupabaseServidor();
export {
  PROD_SUPABASE_URL,
  PROD_PUBLISHABLE_KEY,
  STAGING_SUPABASE_URL,
  STAGING_PUBLISHABLE_KEY,
  STAGING_BRANCH,
  STAGING_BRANCHES,
};
