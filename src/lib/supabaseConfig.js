export const PROD_SUPABASE_HOSTS = Object.freeze([
  "ziistec.vercel.app",
  "ziistec-js-connect.vercel.app",
  "ziistec-git-main-js-connect.vercel.app",
]);

export function resolverConfigSupabase({
  host = "",
  envUrl = "",
  envKey = "",
  prodUrl = "",
  prodKey = "",
} = {}) {
  const cleanHost = String(host || "").trim().toLowerCase();
  const cleanEnvUrl = String(envUrl || "").trim();
  const cleanEnvKey = String(envKey || "").trim();
  const cleanProdUrl = String(prodUrl || "").trim();
  const cleanProdKey = String(prodKey || "").trim();

  const temEnvUrl = Boolean(cleanEnvUrl);
  const temEnvKey = Boolean(cleanEnvKey);
  const envCompleto = temEnvUrl && temEnvKey;
  const envIncompleto = temEnvUrl !== temEnvKey;
  const hostProducao = PROD_SUPABASE_HOSTS.includes(cleanHost);
  const usarFallbackProducao = !temEnvUrl && !temEnvKey && hostProducao;

  const url = envCompleto ? cleanEnvUrl : usarFallbackProducao ? cleanProdUrl : "";
  const anonKey = envCompleto ? cleanEnvKey : usarFallbackProducao ? cleanProdKey : "";
  const configurado = Boolean(
    !envIncompleto && url && anonKey && !url.includes("SEU-PROJETO")
  );

  return {
    url,
    anonKey,
    configurado,
    hostProducao,
    envIncompleto,
    origem: envCompleto
      ? "env"
      : usarFallbackProducao
        ? "production-fallback"
        : envIncompleto
          ? "invalid-env"
          : "unconfigured",
  };
}
