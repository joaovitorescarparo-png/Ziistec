import { createClient } from "@supabase/supabase-js";
import { resolverConfigSupabase } from "./supabaseConfig";

/*
  Separação de ambientes:
  - Produção usa somente o Supabase principal nos hosts oficiais da main.
  - A branch Product V2 usa somente o Supabase de homologação no alias fixo da PR.
  - Qualquer outro preview/localhost sem env própria falha fechado.
  - Se uma env parcial ou um preview tentar apontar para produção, a conexão é recusada.

  As chaves abaixo são publishable e podem existir no bundle. Service role/secret key
  jamais entra no frontend. A autorização real continua sendo feita pela RLS.
*/
const PROD_URL = "https://diztevlpbcfqleizswxr.supabase.co";
const PROD_PUBLISHABLE_KEY = "sb_publishable_SGA5FVYLYicO1piUDRb-Rw_wNSxgqyw";
const STAGING_URL = "https://xadoktssibuuebzzjrhv.supabase.co";
const STAGING_PUBLISHABLE_KEY = "sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e";

const runtimeConfig = resolverConfigSupabase({
  host: typeof window !== "undefined" ? window.location.hostname : "",
  envUrl: import.meta.env.VITE_SUPABASE_URL,
  envKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  prodUrl: PROD_URL,
  prodKey: PROD_PUBLISHABLE_KEY,
  stagingUrl: STAGING_URL,
  stagingKey: STAGING_PUBLISHABLE_KEY,
});

export const ambienteSupabase = runtimeConfig.origem;
export const configurado = runtimeConfig.configurado;

export const supabase = configurado
  ? createClient(runtimeConfig.url, runtimeConfig.anonKey, {
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

  /* Erros estruturais do PostgREST/Postgres não devem chegar ao prestador com
     texto técnico. Traduzimos os conhecidos e registramos o original só no
     console, para diagnóstico. */
  if (codigo === "PGRST201" || /more than one relationship|could not embed/i.test(texto)) {
    registrarTecnico(erro);
    return "Não foi possível recarregar os dados. Se você acabou de salvar, atualize a tela antes de tentar novamente.";
  }
  if (codigo === "PGRST200" || /schema cache/i.test(texto)) {
    registrarTecnico(erro);
    return "Não foi possível carregar os dados agora. Tente novamente.";
  }
  if (codigo === "PGRST116") return "Registro não encontrado ou já removido.";
  if (codigo === "PGRST204") { registrarTecnico(erro); return "Não foi possível salvar: um campo esperado não existe mais. Recarregue a página."; }
  if (codigo === "23502") return "Preencha os campos obrigatórios antes de salvar.";
  if (codigo === "22P02" || codigo === "22007") return "Há um valor ou data em formato inválido.";
  if (codigo === "40001" || codigo === "55P03") return "Outra operação está usando este registro. Tente de novo em instantes.";
  if (codigo === "57014" || /timeout/i.test(texto)) return "A operação demorou demais. Tente novamente.";
  if (codigo === "42P01" || codigo === "42703" || /relation .* does not exist|column .* does not exist/i.test(texto)) {
    registrarTecnico(erro);
    return "Esta função ainda não está disponível neste ambiente.";
  }
  if (/^PGRST/.test(codigo) || /^[0-9A-Z]{5}$/.test(codigo)) {
    registrarTecnico(erro);
    return "Não foi possível concluir a operação agora. Tente novamente.";
  }

  return texto || "Não foi possível concluir a operação.";
}

/* Detalhe técnico fica no console para diagnóstico; nunca na tela do usuário. */
function registrarTecnico(erro) {
  if (typeof console === "undefined") return;
  console.warn("[ZiisTec] erro técnico:", erro?.code || "sem código", erro?.message || erro);
}

export function sessaoExpirou(erro) {
  const texto = String(erro?.message || "");
  return erro?.code === "PGRST301" || texto.includes("JWT") || erro?.status === 401;
}
