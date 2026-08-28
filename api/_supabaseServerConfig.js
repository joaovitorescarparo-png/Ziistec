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

export function resolverSupabaseServidor(env = process.env) {
  const vercelEnv = clean(env?.VERCEL_ENV).toLowerCase();
  const gitBranch = clean(env?.VERCEL_GIT_COMMIT_REF);
  const isProduction = vercelEnv === 'production';
  const isStagingPreview = vercelEnv === 'preview' && STAGING_BRANCHES.includes(gitBranch);
  const envUrl = normalizeUrl(env?.SUPABASE_URL);
  const envKey = clean(env?.SUPABASE_PUBLISHABLE_KEY);
  const hasUrl = Boolean(envUrl);
  const hasKey = Boolean(envKey);

  // Um par incompleto nunca pode misturar fallback e variável de outro ambiente.
  if (hasUrl !== hasKey) {
    return { configurado: false, origem: 'invalid-env', url: '', publishableKey: '' };
  }

  if (hasUrl && hasKey) {
    // Preview/dev jamais pode apontar, nem explicitamente, para o banco real.
    if (!isProduction && envUrl === PROD_SUPABASE_URL) {
      return { configurado: false, origem: 'production-blocked-in-preview', url: '', publishableKey: '' };
    }
    return { configurado: true, origem: 'env', url: envUrl, publishableKey: envKey };
  }

  // Somente previews explicitamente allowlisted recebem o Supabase isolado/gratuito.
  if (isStagingPreview) {
    return {
      configurado: true,
      origem: 'staging-fallback',
      url: STAGING_SUPABASE_URL,
      publishableKey: STAGING_PUBLISHABLE_KEY,
    };
  }

  // Somente um deployment Vercel marcado como production recebe o fallback principal.
  if (isProduction) {
    return {
      configurado: true,
      origem: 'production-fallback',
      url: PROD_SUPABASE_URL,
      publishableKey: PROD_PUBLISHABLE_KEY,
    };
  }

  return { configurado: false, origem: 'unconfigured', url: '', publishableKey: '' };
}

export const supabaseServidor = resolverSupabaseServidor();
export { PROD_SUPABASE_URL, STAGING_SUPABASE_URL, STAGING_BRANCH, STAGING_BRANCHES };
