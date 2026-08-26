const PROD_SUPABASE_URL = 'https://diztevlpbcfqleizswxr.supabase.co';
const PROD_PUBLISHABLE_KEY = 'sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw';

const clean = (value) => String(value || '').trim();
const normalizeUrl = (value) => clean(value).replace(/\/+$/, '');

export function resolverSupabaseServidor(env = process.env) {
  const vercelEnv = clean(env?.VERCEL_ENV).toLowerCase();
  const isProduction = vercelEnv === 'production';
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

  // Somente um deployment Vercel marcado como production recebe o fallback público.
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
export { PROD_SUPABASE_URL };
