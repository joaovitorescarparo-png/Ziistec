export const PROD_SUPABASE_HOSTS = Object.freeze([
  "ziistec.vercel.app",
  "ziistec-js-connect.vercel.app",
  "ziistec-git-main-js-connect.vercel.app",
]);

export const STAGING_SUPABASE_HOSTS = Object.freeze([
  "ziistec-git-product-v2-review-js-connect.vercel.app",
  "ziistec-git-ui-v1-v2-merge-js-connect.vercel.app",
]);

export function resolverConfigSupabase({
  host = "",
  envUrl = "",
  envKey = "",
  prodUrl = "",
  prodKey = "",
  stagingUrl = "",
  stagingKey = "",
} = {}) {
  const cleanHost = String(host || "").trim().toLowerCase();
  const cleanEnvUrl = String(envUrl || "").trim().replace(/\/+$/, "");
  const cleanEnvKey = String(envKey || "").trim();
  const cleanProdUrl = String(prodUrl || "").trim().replace(/\/+$/, "");
  const cleanProdKey = String(prodKey || "").trim();
  const cleanStagingUrl = String(stagingUrl || "").trim().replace(/\/+$/, "");
  const cleanStagingKey = String(stagingKey || "").trim();

  const temEnvUrl = Boolean(cleanEnvUrl);
  const temEnvKey = Boolean(cleanEnvKey);
  const envCompleto = temEnvUrl && temEnvKey;
  const envIncompleto = temEnvUrl !== temEnvKey;
  const hostProducao = PROD_SUPABASE_HOSTS.includes(cleanHost);
  const hostStaging = STAGING_SUPABASE_HOSTS.includes(cleanHost);
  const envApontaProducaoEmPreview = envCompleto && !hostProducao && cleanEnvUrl === cleanProdUrl;
  const usarFallbackProducao = !temEnvUrl && !temEnvKey && hostProducao;
  const usarFallbackStaging = !temEnvUrl && !temEnvKey && hostStaging && cleanStagingUrl && cleanStagingKey;

  if (envIncompleto) {
    return {
      url: "",
      anonKey: "",
      configurado: false,
      hostProducao,
      hostStaging,
      envIncompleto: true,
      origem: "invalid-env",
    };
  }

  if (envApontaProducaoEmPreview) {
    return {
      url: "",
      anonKey: "",
      configurado: false,
      hostProducao,
      hostStaging,
      envIncompleto: false,
      origem: "production-blocked-in-preview",
    };
  }

  const url = envCompleto
    ? cleanEnvUrl
    : usarFallbackProducao
      ? cleanProdUrl
      : usarFallbackStaging
        ? cleanStagingUrl
        : "";
  const anonKey = envCompleto
    ? cleanEnvKey
    : usarFallbackProducao
      ? cleanProdKey
      : usarFallbackStaging
        ? cleanStagingKey
        : "";
  const configurado = Boolean(url && anonKey && !url.includes("SEU-PROJETO"));

  return {
    url,
    anonKey,
    configurado,
    hostProducao,
    hostStaging,
    envIncompleto: false,
    origem: envCompleto
      ? "env"
      : usarFallbackProducao
        ? "production-fallback"
        : usarFallbackStaging
          ? "staging-fallback"
          : "unconfigured",
  };
}
