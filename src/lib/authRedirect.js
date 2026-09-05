import { PROD_SUPABASE_HOSTS, STAGING_SUPABASE_HOSTS } from "./supabaseConfig.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function resolverRedirectAuth({ origin = "", hostname = "", isDev = false } = {}) {
  let url;
  try { url = new URL(String(origin || "")); } catch { return ""; }

  const host = String(hostname || url.hostname || "").trim().toLowerCase();
  if (!host || url.hostname.toLowerCase() !== host) return "";

  const hosted = PROD_SUPABASE_HOSTS.includes(host) || STAGING_SUPABASE_HOSTS.includes(host);
  if (hosted) return url.protocol === "https:" ? `${url.origin}/` : "";

  if (isDev && LOCAL_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:")) {
    return `${url.origin}/`;
  }

  return "";
}

export function redirectAuthAtual() {
  if (typeof window === "undefined") return "";
  return resolverRedirectAuth({
    origin: window.location.origin,
    hostname: window.location.hostname,
    isDev: Boolean(import.meta.env.DEV),
  });
}
