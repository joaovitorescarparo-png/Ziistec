// Substitui src/lib/supabase.js nos testes de integração: o MESMO código do app
// (dataApi, runtimeApi, paginação) conversa com a Data API real do Supabase local
// descartável da CI, autenticado como um usuário sintético.
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.ZT_TEST_SUPABASE_URL || 'http://127.0.0.1:54321';
const anon = process.env.ZT_TEST_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const secret = process.env.ZT_TEST_JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';

export function tokenDe(sub) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const agora = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, role: 'authenticated', aud: 'authenticated', iat: agora, exp: agora + 3600, aal: 'aal1', session_id: crypto.randomUUID() });
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}

const usuario = globalThis.__ZT_TEST_USER;
if (!usuario) throw new Error('Defina globalThis.__ZT_TEST_USER antes de importar o código do app.');

export const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { headers: { Authorization: `Bearer ${tokenDe(usuario)}` } },
});
export const configurado = true;
export const ambienteSupabase = 'test';
export function mensagemErro(e) { return e ? String(e.message || e) : null; }
export function sessaoExpirou() { return false; }
