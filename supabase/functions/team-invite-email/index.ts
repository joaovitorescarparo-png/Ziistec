import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const STAGING_APP = "https://ziistec-git-hardening-v2-staging-js-connect.vercel.app";
const LOCAL_APPS = new Set(["http://localhost:5173", "http://127.0.0.1:5173"]);
const ALLOWED_ORIGINS = new Set([STAGING_APP, ...LOCAL_APPS]);

const json = (status: number, body: unknown, origin = "") => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
  },
});

const normalizeRedirect = (value: unknown) => {
  try {
    const url = new URL(String(value || ""));
    const origin = url.origin;
    if (!ALLOWED_ORIGINS.has(origin)) return "";
    if (origin === STAGING_APP && url.protocol !== "https:") return "";
    if (url.pathname !== "/" || url.search || url.hash) return "";
    return `${origin}/`;
  } catch {
    return "";
  }
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") {
    if (!ALLOWED_ORIGINS.has(origin)) return json(403, { error: "origin_not_allowed" }, origin);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
      },
    });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(403, { error: "origin_not_allowed" }, origin);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json(401, { error: "not_authenticated" }, origin);

  let body: { invite_id?: string; redirect_to?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }, origin); }
  const inviteId = String(body.invite_id || "").trim();
  const redirectTo = normalizeRedirect(body.redirect_to);
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return json(400, { error: "invalid_invite" }, origin);
  if (!redirectTo) return json(400, { error: "invalid_redirect" }, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { error: "server_not_configured" }, origin);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json(401, { error: "not_authenticated" }, origin);

  const { data: invite, error: inviteError } = await userClient
    .from("company_invites")
    .select("id,company_id,email,name,role,job_title,accepted_at,expires_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (inviteError || !invite) return json(404, { error: "invite_not_found" }, origin);
  if (invite.accepted_at) return json(409, { error: "invite_already_accepted" }, origin);
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
    return json(410, { error: "invite_expired" }, origin);
  }

  // A visibilidade RLS do convite não é suficiente: o disparo de e-mail exige owner ativo.
  const { data: ownerMembership, error: membershipError } = await userClient
    .from("company_members")
    .select("id")
    .eq("company_id", invite.company_id)
    .eq("user_id", user.id)
    .eq("role", "owner")
    .eq("status", "active")
    .maybeSingle();
  if (membershipError || !ownerMembership) return json(403, { error: "owner_required" }, origin);

  const { data: company, error: companyError } = await userClient
    .from("companies")
    .select("name,trade_name")
    .eq("id", invite.company_id)
    .single();
  if (companyError || !company) return json(404, { error: "company_not_found" }, origin);

  const companyName = String(company.trade_name || company.name || "Sua empresa").trim();
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: deliveryError } = await admin.auth.admin.inviteUserByEmail(invite.email, {
    redirectTo,
    data: {
      ziistec_invite_id: invite.id,
      invitee_name: invite.name || "",
      company_name: companyName,
      role_label: invite.role === "technician" ? "técnico/colaborador" : "colaborador",
    },
  });

  if (deliveryError) {
    const message = String(deliveryError.message || "").toLowerCase();
    const existing = message.includes("already") || message.includes("registered") || message.includes("exists");
    // O convite de banco permanece válido. Usuário já existente pode autenticar com o mesmo e-mail;
    // a F11 continua exigindo email_confirmed_at antes de criar/ativar membership.
    return json(existing ? 200 : 502, {
      ok: existing,
      sent: false,
      reason: existing ? "existing_user" : "delivery_failed",
    }, origin);
  }

  return json(200, { ok: true, sent: true, reason: "invite_email_sent" }, origin);
});
