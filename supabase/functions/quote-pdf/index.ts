// Edge Function `quote-pdf`: o PDF do orçamento para o site estático (Hostinger, ziistec.com).
// Toda a regra está em ./handler.js (o mesmo código roda nos testes em Node). Aqui só o Deno:
// pdf-lib na mesma versão do package-lock, e o endereço/chave publicável que o próprio Supabase injeta.
// Nenhuma service role, secret key ou anon key legada: as leituras usam o JWT do usuário, sob RLS.
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { chavePublicavel, criarHandlerPdfOrcamento } from "./handler.js";

const handler = criarHandlerPdfOrcamento({
  pdfLib: { PDFDocument, StandardFonts, rgb },
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  // Só a publishable key moderna (SUPABASE_PUBLISHABLE_KEYS["default"]), no cabeçalho `apikey`.
  apiKey: chavePublicavel(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")),
});

Deno.serve(handler);
