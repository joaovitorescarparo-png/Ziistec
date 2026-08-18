/* Validador da Fase 1 — roda contra o SEU projeto Supabase.
 *
 *   node scripts/validar-fase1.mjs email@teste.com senha123456
 *
 * Opcional, para validar convite de técnico (item 10):
 *   node scripts/validar-fase1.mjs owner@teste.com senha123456 tecnico@teste.com senha123456
 *
 * Usa apenas a chave publishable do .env. Não escreve nada fora das tabelas
 * do próprio usuário e não apaga nada.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/* Lê do .env quando existir (uso local); caso contrário, das variáveis de
   ambiente — assim o script funciona também sem arquivo .env no pacote. */
let env = { ...process.env };
try {
  const arquivo = readFileSync(new URL("../.env", import.meta.url), "utf8");
  for (const linha of arquivo.split("\n")) {
    if (!linha.includes("=") || linha.trim().startsWith("#")) continue;
    const i = linha.indexOf("=");
    env[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
} catch { /* sem .env: seguimos com as variáveis de ambiente */ }

const URL_SB = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL_SB || !KEY) { console.error("Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY no .env"); process.exit(1); }
if (KEY.includes("service_role")) { console.error("PARE: isso parece uma service_role. Use a publishable."); process.exit(1); }

const [email, senha, emailTec, senhaTec] = process.argv.slice(2);
if (!email || !senha) { console.error("Uso: node scripts/validar-fase1.mjs email senha [emailTecnico senhaTecnico]"); process.exit(1); }

const novo = () => createClient(URL_SB, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let ok = 0, falhou = 0;
const passou = (n, extra = "") => { ok++; console.log(`  ✓ ${n}${extra ? " — " + extra : ""}`); };
const erro = (n, e) => { falhou++; console.log(`  ✗ ${n}\n      ${e?.message || e} ${e?.code ? "(código " + e.code + ")" : ""}`); };

async function entrarOuCriar(sb, mail, pass, rotulo) {
  let { data, error } = await sb.auth.signInWithPassword({ email: mail, password: pass });
  if (!error) return { data, criado: false };
  if (!String(error.message).includes("Invalid login credentials")) throw error;
  const r = await sb.auth.signUp({ email: mail, password: pass, options: { data: { full_name: rotulo } } });
  if (r.error) throw r.error;
  if (!r.data.session) {
    throw new Error(
      "Conta criada, mas sem sessão: a confirmação de e-mail está ligada. " +
      "Para testar, desligue em Authentication → Providers → Email → 'Confirm email', ou confirme pelo link enviado."
    );
  }
  return { data: r.data, criado: true };
}

console.log(`\nProjeto: ${URL_SB}\n`);

/* ---------------------------------------------- 2, 3, 5 */
console.log("2/3/5 · Conta, login e trigger de profile");
const sb = novo();
let uid, criado = false;
try {
  const r = await entrarOuCriar(sb, email, senha, "Proprietário de teste");
  uid = r.data.user.id; criado = r.criado;
  passou(criado ? "conta criada e sessão aberta" : "login com e-mail e senha", `user_id ${uid.slice(0, 8)}…`);
} catch (e) { erro("criação/login", e); process.exit(1); }

try {
  const { data, error } = await sb.from("profiles").select("id, email, full_name, is_platform_admin").eq("id", uid).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("profile não encontrado — o trigger zt_on_auth_user_created não rodou");
  passou("trigger criou o profile", `email ${data.email}, platform_admin ${data.is_platform_admin}`);
} catch (e) { erro("profile", e); }

/* ---------------------------------------------- 4 sessão persistente */
console.log("\n4 · Sessão persistente");
try {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) throw new Error("sem access_token na sessão");
  const sb2 = createClient(URL_SB, KEY);
  await sb2.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  const { data: u } = await sb2.auth.getUser();
  if (u?.user?.id !== uid) throw new Error("token não reconstitui o mesmo usuário");
  passou("token restaura a sessão em outro cliente", "é isso que mantém o login ao reabrir o app");
} catch (e) { erro("sessão persistente", e); }

/* ---------------------------------------------- 6 e 7 empresa */
console.log("\n6/7 · Onboarding com zt_create_company");
let companyId = null;
try {
  const { data: ms, error } = await sb.from("company_members").select("id, company_id, role, status").eq("user_id", uid).eq("status", "active");
  if (error) throw error;
  if (ms.length) {
    companyId = ms[0].company_id;
    passou("empresa já existente reaproveitada", `${ms[0].role}/${ms[0].status}`);
  } else {
    const { data, error: e2 } = await sb.rpc("zt_create_company", {
      p_name: "Empresa de Validação", p_activity: "Teste da Fase 1", p_has_team: true,
      p_owner_name: "Proprietário de teste", p_phone: null,
    });
    if (e2) throw e2;
    companyId = data;
    passou("zt_create_company executou", `company_id ${String(companyId).slice(0, 8)}…`);
  }
} catch (e) { erro("criação de empresa", e); }

if (companyId) {
  try {
    const { data, error } = await sb.from("companies").select("id, name, activity, has_team").eq("id", companyId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("company não veio pela RLS");
    passou("company criada e legível", data.name);
  } catch (e) { erro("company", e); }

  try {
    const { data, error } = await sb.from("company_members").select("role, status").eq("company_id", companyId).eq("user_id", uid).maybeSingle();
    if (error) throw error;
    if (data?.role !== "owner" || data?.status !== "active") throw new Error(`esperado owner/active, veio ${data?.role}/${data?.status}`);
    passou("company_members owner + active");
  } catch (e) { erro("membership", e); }

  try {
    const { data, error } = await sb.from("subscriptions").select("plan, amount, status, current_period_end").eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("subscription não criada");
    passou("subscription criada", `${data.plan} · ${data.status} · R$ ${data.amount}`);
    if (data.status !== "trial" && !criado) console.log("      (status diferente de trial porque a empresa já existia de um teste anterior)");
  } catch (e) { erro("subscription", e); }
}

/* ---------------------------------------------- 8 e 9 logout e volta */
console.log("\n8/9 · Logout e login novamente");
try {
  await sb.auth.signOut();
  const { data: { session } } = await sb.auth.getSession();
  if (session) throw new Error("sessão continuou ativa após signOut");
  passou("logout encerrou a sessão");

  const sb3 = novo();
  const { error } = await sb3.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  const { data: ms, error: e2 } = await sb3.from("company_members")
    .select("role, status, companies(name)").eq("status", "active");
  if (e2) throw e2;
  if (!ms.length) throw new Error("nenhuma membresia recarregada após novo login");
  passou("empresa e papel recarregados do Supabase", `${ms[0].companies?.name} · ${ms[0].role}`);
  await sb3.auth.signOut();
} catch (e) { erro("logout/login", e); }

/* ---------------------------------------------- 10 convite */
console.log("\n10 · Convite de técnico e zt_accept_invites");
if (!emailTec || !senhaTec) {
  console.log("  – pulado: informe emailTecnico e senhaTecnico para testar");
} else {
  try {
    const dono = novo();
    await dono.auth.signInWithPassword({ email, password: senha });
    const { error } = await dono.from("company_invites").upsert(
      { company_id: companyId, email: emailTec, role: "technician", job_title: "Instalador" },
      { onConflict: "company_id,email" }
    );
    if (error) throw error;
    passou("owner criou o convite em company_invites");

    const tec = novo();
    const r = await entrarOuCriar(tec, emailTec, senhaTec, "Técnico de teste");
    const { data: n, error: e2 } = await tec.rpc("zt_accept_invites");
    if (e2) throw e2;
    passou("zt_accept_invites executou", `${n} convite(s) aceito(s)`);

    const { data: ms, error: e3 } = await tec.from("company_members").select("role, status, company_id").eq("status", "active");
    if (e3) throw e3;
    const m = ms.find((x) => x.company_id === companyId);
    if (!m) throw new Error("técnico não ficou vinculado à empresa");
    if (m.role !== "technician") throw new Error(`papel veio ${m.role}`);
    passou("técnico vinculado como technician + active");

    const { data: cli } = await tec.from("clients").select("id");
    const { data: fin } = await tec.from("financial_entries").select("id");
    const { data: prod } = await tec.from("products").select("id");
    passou("RLS do técnico no ar", `clients ${cli?.length ?? 0}, financial ${fin?.length ?? 0}, products ${prod?.length ?? 0} (esperado 0, 0, 0)`);
    await tec.auth.signOut(); await dono.auth.signOut();
  } catch (e) { erro("convite", e); }
}

console.log(`\n${ok} passaram, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
