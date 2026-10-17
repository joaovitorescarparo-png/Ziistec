// Bloco 7 · rascunho mínimo para quando o sistema encerra a aba em segundo plano (iOS/Android) ou a
// página recarrega. NÃO é offline-first: nada é enviado ao banco sem o usuário salvar.
//
// Modelo de ameaça (docs/engineering/MOBILE_RESILIENCE.md):
// - sessionStorage (só esta aba; some ao fechar a aba), TTL de 2 h, formato versionado;
// - chave e conteúdo amarrados a empresa + usuário + tipo de formulário, validados antes de restaurar;
// - allowlist por formulário: só texto operacional. Fora: CPF/CNPJ, itens com preço/custo, margens,
//   coordenadas, arquivos/fotos/blobs, ids de registros existentes, tokens e qualquer outro campo;
// - apagado ao salvar, descartar, fechar o formulário, sair da conta e trocar de usuário/empresa.

export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const PREFIX = 'zt:draft:';
const MAX_TEXT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELDS = Object.freeze({
  'cliente-novo': ['tipo', 'nome', 'fantasia', 'responsavel', 'telefone', 'whatsapp', 'endereco', 'obs'],
  'os-nova': ['clienteId', 'orcamentoId', 'descricaoLivre', 'local', 'localServico', 'localId', 'data', 'hora',
    'responsavel', 'responsavelId', 'obs', 'requestId'],
});
const ID_FIELDS = new Set(['clienteId', 'orcamentoId', 'localId', 'responsavelId', 'requestId']);

let scope = null;

const storageOf = (storage) => {
  if (storage !== undefined) return storage;
  try { return globalThis.sessionStorage || null; } catch { return null; }
};
const scopeKey = (sc) => `${PREFIX}v${DRAFT_VERSION}:${sc.companyId}:${sc.userId}:`;
const keyFor = (formType, sc) => `${scopeKey(sc)}${formType}`;

function draftKeys(s) {
  const keys = [];
  try { for (let i = 0; i < s.length; i += 1) { const k = s.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); } } catch { /* storage bloqueado */ }
  return keys;
}

const remove = (s, key) => { try { s.removeItem(key); } catch { /* storage bloqueado */ } };

export function sanitizeDraft(formType, value) {
  const fields = FIELDS[formType];
  if (!fields || !value || typeof value !== 'object') return null;
  const out = {};
  for (const field of fields) {
    const v = value[field];
    if (typeof v !== 'string' || v === '') continue;
    if (ID_FIELDS.has(field)) { if (UUID.test(v)) out[field] = v; continue; }
    out[field] = v.slice(0, MAX_TEXT);
  }
  return out;
}

export function purgeDrafts(storage) {
  const s = storageOf(storage);
  if (!s) return;
  for (const key of draftKeys(s)) remove(s, key);
}

// Sessão atual. Entrar com outro usuário/empresa apaga rascunhos que não são deste escopo.
export function setDraftScope(next, storage) {
  const valid = next && UUID.test(String(next.userId || '')) && UUID.test(String(next.companyId || ''))
    ? { userId: String(next.userId), companyId: String(next.companyId) } : null;
  scope = valid;
  const s = storageOf(storage);
  if (!valid || !s) return;
  const own = scopeKey(valid);
  for (const key of draftKeys(s)) if (!key.startsWith(own)) remove(s, key);
}

export function getDraftScope() {
  return scope;
}

export function writeDraft(formType, value, { now = Date.now(), storage } = {}) {
  const s = storageOf(storage);
  const sc = scope;
  if (!s || !sc || !FIELDS[formType]) return false;
  const data = sanitizeDraft(formType, value);
  if (!data || !Object.keys(data).length) { remove(s, keyFor(formType, sc)); return false; }
  const payload = { v: DRAFT_VERSION, formType, userId: sc.userId, companyId: sc.companyId, savedAt: now, data };
  try { s.setItem(keyFor(formType, sc), JSON.stringify(payload)); return true; } catch { return false; }
}

export function readDraft(formType, { now = Date.now(), storage } = {}) {
  const s = storageOf(storage);
  const sc = scope;
  if (!s || !sc || !FIELDS[formType]) return null;
  const key = keyFor(formType, sc);
  let raw = null;
  try { raw = s.getItem(key); } catch { return null; }
  if (!raw) return null;
  let payload = null;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  const valid = payload && payload.v === DRAFT_VERSION && payload.formType === formType
    && payload.userId === sc.userId && payload.companyId === sc.companyId
    && Number.isFinite(payload.savedAt) && payload.savedAt <= now + 60_000 && now - payload.savedAt <= DRAFT_TTL_MS;
  const data = valid ? sanitizeDraft(formType, payload.data) : null;
  if (!data || !Object.keys(data).length) { remove(s, key); return null; }
  return { data, savedAt: payload.savedAt };
}

export function clearDraft(formType, { storage } = {}) {
  const s = storageOf(storage);
  const sc = scope;
  if (!s || !sc) return;
  remove(s, keyFor(formType, sc));
}
