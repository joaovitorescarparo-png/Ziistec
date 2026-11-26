// Edge Function `quote-pdf`: o PDF do orçamento para o site estático (Hostinger, ziistec.com).
// Toda a regra está em ./handler.js (o mesmo código roda nos testes em Node). Aqui só o Deno:
// pdf-lib na mesma versão do package-lock, e o endereço/chave pública que o próprio Supabase injeta.
// Nenhuma service role: as leituras usam o token do usuário, sob RLS.
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { criarHandlerPdfOrcamento } from "./handler.js";

// Chave pública (anon/publishable) para o cabeçalho `apikey` das chamadas ao próprio projeto.
// Projetos com as chaves novas recebem SUPABASE_PUBLISHABLE_KEYS (JSON); os antigos, SUPABASE_ANON_KEY.
function chavePublica(): string {
  const legado = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (legado) return legado;
  try {
    const chaves = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    const valor = chaves?.default ?? Object.values(chaves ?? {})[0];
    return typeof valor === "string" && valor.startsWith("sb_publishable_") ? valor : "";
  } catch {
    return "";
  }
}

const handler = criarHandlerPdfOrcamento({
  pdfLib: { PDFDocument, StandardFonts, rgb },
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  apiKey: chavePublica(),
});

Deno.serve(handler);
