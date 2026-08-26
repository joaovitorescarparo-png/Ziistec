import { createClient } from "@supabase/supabase-js";

/*
  Separação de ambientes:
  - Preview/staging deve receber VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY próprias.
  - Se uma delas vier sem a outra, falhamos fechado e NÃO misturamos credenciais.
  - O fallback público do projeto principal só é permitido nos hosts oficiais da main.
  - Localhost e qualquer *.vercel.app de PR ficam sem banco até receberem env própria.

  A service_role/secret key jamais entra no frontend. A autorização real continua
  sendo feita pela RLS do Supabase.
*/
const PROD_HOSTS = new Set([
  "ziistec.vercel.app",
  "ziistec-js-connect.vercel.app",
  "ziistec-git-main-js-connect.vercel.app",
]);

const PROD_URL = "https://diztevlpbcfqleizswxr.supabase.co";
const PROD_PUBLISHABLE_KEY = "sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw";

const host = typeof window !== "undefined" ? window.location.hostname : "";
const envUrl = String(import.meta.env.VITE_SUPABASE_URL || "").trim();
const envKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();
const temEnvUrl = Boolean(envUrl);
const temEnvKey = Boolean(envKey);
const envCompleto = temEnvUrl && temEnvKey;
const envIncompleto = temEnvUrl !== temEnvKey;
const usarFallbackProducao = !temEnvUrl && !temEnvKey && PROD_HOSTS.has(host);

const url = envCompleto ? envUrl : usarFallbackProducao ? PROD_URL : "";
const anonKey = envCompleto ? envKey : usarFallbackProducao ? PROD_PUBLISHABLE_KEY : "";

export const ambienteSupabase = envCompleto
  ? "env"
  : usarFallbackProducao
    ? "production-fallback"
    : envIncompleto
      ? "invalid-env"
      : "unconfigured";

export const configurado = Boolean(
  !envIncompleto && url && anonKey && !url.includes("SEU-PROJETO")
);

export const supabase = configurado
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/* Traduz erro do Postgres/PostgREST em algo que o prestador entenda.
   Nunca devolvemos "erro desconhecido" nem escondemos falha. */
export function mensagemErro(erro) {
  if (!erro) return null;
  const codigo = erro.code || "";
  const texto = String(erro.message || "");

  if (codigo === "42501" || texto.includes("row-level security")) {
    return "Você não tem permissão para esta ação nesta empresa.";
  }
  if (codigo === "23505") return "Esse registro já existe.";
  if (codigo === "23503") return "Há um vínculo pendente que impede esta operação.";
  if (codigo === "PGRST301" || texto.includes("JWT")) {
    return "Sua sessão expirou. Entre novamente.";
  }
  if (texto.includes("Invalid login credentials")) return "E-mail ou senha incorretos.";
  if (texto.includes("Email not confirmed")) return "Confirme seu e-mail antes de entrar.";
  if (texto.includes("User already registered")) return "Já existe uma conta com esse e-mail.";
  if (texto.includes("Password should be")) return "A senha precisa ter ao menos 6 caracteres.";
  if (texto.includes("Failed to fetch") || texto.includes("NetworkError")) {
    return "Sem conexão com o servidor. Verifique sua internet.";
  }
  return texto || "Não foi possível concluir a operação.";
}

export function sessaoExpirou(erro) {
  const texto = String(erro?.message || "");
  return erro?.code === "PGRST301" || texto.includes("JWT") || erro?.status === 401;
}
