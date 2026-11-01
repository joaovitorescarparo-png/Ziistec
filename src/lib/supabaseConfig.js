export const PROD_SUPABASE_HOSTS = Object.freeze([
  "ziistec.vercel.app",
  "ziistec-js-connect.vercel.app",
  "ziistec-git-main-js-connect.vercel.app",
]);

export const STAGING_SUPABASE_HOSTS = Object.freeze([
  "ziistec-git-product-v2-review-js-connect.vercel.app",
  "ziistec-git-ui-v1-v2-merge-js-connect.vercel.app",
  "ziistec-git-hardening-v2-staging-js-connect.vercel.app",
  "ziistec-git-field-workflow-v1-js-connect.vercel.app",
  "ziistec-git-rc1c-mobile-ux-stabilization-js-connect.vercel.app",
  "ziistec-git-codex-ziistec-assistant-mvp-v1-js-connect.vercel.app",
  "ziistec-git-codex-ziistec-assistant-wave2-js-connect.vercel.app",
  "ziistec-git-claude-assistant-universal-owner-v1-js-connect.vercel.app",
  // Domínio próprio do beta (somente proprietário): ligado na Vercel à branch do Assistant Universal; usa só Staging.
  "beta.ziistec.com",
]);

// H0 (homologação isolada, projeto próprio e descartável): um único host de Preview, nunca compartilhado com Production ou Beta.
// Só vale na branch de trabalho do H0; não pode seguir para a main (ver docs/engineering/H0_ENVIRONMENT_REQUIRED.md).
export const H0_SUPABASE_HOSTS = Object.freeze([
  "ziistec-git-claude-blocks34-port-beta-v1-js-connect.vercel.app",
]);

export function resolverConfigSupabase({
  deploymentEnv = "",
  host = "",
  envUrl = "",
  envKey = "",
  prodUrl = "",
  prodKey = "",
  stagingUrl = "",
  stagingKey = "",
  h0Url = "",
  h0Key = "",
} = {}) {
  const cleanEnv = String(deploymentEnv || "").trim().toLowerCase();
  const cleanHost = String(host || "").trim().toLowerCase();
  const cleanEnvUrl = String(envUrl || "").trim().replace(/\/+$/, "");
  const cleanEnvKey = String(envKey || "").trim();
  const cleanProdUrl = String(prodUrl || "").trim().replace(/\/+$/, "");
  const cleanProdKey = String(prodKey || "").trim();
  const cleanStagingUrl = String(stagingUrl || "").trim().replace(/\/+$/, "");
  const cleanStagingKey = String(stagingKey || "").trim();
  const cleanH0Url = String(h0Url || "").trim().replace(/\/+$/, "");
  const cleanH0Key = String(h0Key || "").trim();

  const temEnvUrl = Boolean(cleanEnvUrl);
  const temEnvKey = Boolean(cleanEnvKey);
  const envCompleto = temEnvUrl && temEnvKey;
  const envIncompleto = temEnvUrl !== temEnvKey;
  const hostProducao = PROD_SUPABASE_HOSTS.includes(cleanHost);
  const hostStaging = STAGING_SUPABASE_HOSTS.includes(cleanHost);
  const hostH0 = H0_SUPABASE_HOSTS.includes(cleanHost);
  const inferredEnv = hostProducao ? "production" : hostStaging || hostH0 ? "preview" : "development";
  const effectiveEnv = cleanEnv || inferredEnv;
  const productionContext = effectiveEnv === "production" && hostProducao;
  const previewContext = effectiveEnv === "preview" && hostStaging;
  const h0Context = effectiveEnv === "preview" && hostH0;
  const developmentContext = effectiveEnv === "development" && !hostProducao && !hostStaging && !hostH0;
  const exactProdPair = cleanEnvUrl === cleanProdUrl && cleanEnvKey === cleanProdKey;
  const exactStagingPair = cleanEnvUrl === cleanStagingUrl && cleanEnvKey === cleanStagingKey;
  const exactH0Pair = Boolean(cleanH0Url && cleanH0Key) && cleanEnvUrl === cleanH0Url && cleanEnvKey === cleanH0Key;

  const fail = (origem, incomplete = false) => ({
    url: "",
    anonKey: "",
    configurado: false,
    hostProducao,
    hostStaging,
    hostH0,
    envIncompleto: incomplete,
    origem,
  });

  if (envIncompleto) return fail("invalid-env", true);

  if (envCompleto) {
    if (productionContext) {
      return exactProdPair
        ? { url: cleanProdUrl, anonKey: cleanProdKey, configurado: true, hostProducao, hostStaging, envIncompleto: false, origem: "env-production" }
        : fail("environment-project-mismatch");
    }
    if (h0Context) {
      return exactH0Pair
        ? { url: cleanH0Url, anonKey: cleanH0Key, configurado: true, hostProducao, hostStaging, hostH0, envIncompleto: false, origem: "env-h0" }
        : fail("environment-project-mismatch");
    }
    if (previewContext || developmentContext) {
      return exactStagingPair
        ? { url: cleanStagingUrl, anonKey: cleanStagingKey, configurado: true, hostProducao, hostStaging, envIncompleto: false, origem: developmentContext ? "env-development-staging" : "env-staging" }
        : fail("environment-project-mismatch");
    }
    return fail("environment-project-mismatch");
  }

  if (productionContext && cleanProdUrl && cleanProdKey) {
    return { url: cleanProdUrl, anonKey: cleanProdKey, configurado: true, hostProducao, hostStaging, envIncompleto: false, origem: "production-fallback" };
  }
  if (h0Context && cleanH0Url && cleanH0Key) {
    return { url: cleanH0Url, anonKey: cleanH0Key, configurado: true, hostProducao, hostStaging, hostH0, envIncompleto: false, origem: "h0-fallback" };
  }
  if (previewContext && cleanStagingUrl && cleanStagingKey) {
    return { url: cleanStagingUrl, anonKey: cleanStagingKey, configurado: true, hostProducao, hostStaging, envIncompleto: false, origem: "staging-fallback" };
  }

  return fail("unconfigured");
}
