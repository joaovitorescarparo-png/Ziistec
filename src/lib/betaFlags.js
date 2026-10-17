/* Flags do beta, lidas no build pelo Vite.
   Google só aparece com VITE_ENABLE_GOOGLE_AUTH=true (padrão: oculto, o provedor ainda não está
   habilitado no Auth). O selo BETA só some com VITE_ZIISTEC_BETA=false. */
const envAtual = () => import.meta.env || {};
const valor = (env, chave) => String(env?.[chave] ?? "").trim().toLowerCase();

export function googleAuthHabilitado(env = envAtual()) {
  return valor(env, "VITE_ENABLE_GOOGLE_AUTH") === "true";
}

export function seloBetaAtivo(env = envAtual()) {
  return valor(env, "VITE_ZIISTEC_BETA") !== "false";
}
