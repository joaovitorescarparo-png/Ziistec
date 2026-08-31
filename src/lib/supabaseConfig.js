export const PROD_SUPABASE_HOSTS = Object.freeze([
  "ziistec.vercel.app",
  "ziistec-js-connect.vercel.app",
  "ziistec-git-main-js-connect.vercel.app",
]);

export const STAGING_SUPABASE_HOSTS = Object.freeze([
  "ziistec-git-product-v2-review-js-connect.vercel.app",
  "ziistec-git-ui-v1-v2-merge-js-connect.vercel.app",
  "ziistec-git-hardening-v2-staging-js-connect.vercel.app",
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
} = {}) {
  const cleanEnv = String(deploymentEnv || "").trim().toLowerCase();
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
  const inferredEnv = hostProducao ? "production" : hostStaging ? "preview" : "development";
  const effectiveEnv = cleanEnv || inferredEnv;
  const productionContext = effectiveEnv === "production" && hostProducao;
  const previewContext = effectiveEnv === "preview" && hostStaging;
  const developmentContext = effectiveEnv === "development" && !hostProducao && !hostStaging;
  const exactProdPair = cleanEnvUrl === cleanProdUrl && cleanEnvKey === cleanProdKey;
  const exactStagingPair = cleanEnvUrl === cleanStagingUrl && cleanEnvKey === cleanStagingKey;

  const fail = (origem, incomplete = false) => ({
    url: "",
    anonKey: "",
    configurado: false,
    hostProducao,
    hostStaging,
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
  if (previewContext && cleanStagingUrl && cleanStagingKey) {
    return { url: cleanStagingUrl, anonKey: cleanStagingKey, configurado: true, hostProducao, hostStaging, envIncompleto: false, origem: "staging-fallback" };
  }

  return fail("unconfigured");
}
