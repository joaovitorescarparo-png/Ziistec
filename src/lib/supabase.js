import { createClient } from "@supabase/supabase-js";

/* Credenciais vêm do .env — nunca ficam no código.
   A chave anon é pública por design: quem protege os dados é a RLS.
   A service_role jamais entra no frontend. */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configurado = Boolean(url && anonKey && !url.includes("SEU-PROJETO"));

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
