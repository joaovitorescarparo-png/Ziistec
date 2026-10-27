import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';

// Segurança V1.1 — SEC-05 (limite de reenvio do convite) e SEC-06 (HTML no e-mail de convite).
// A função team-invite-email roda aqui com Auth, banco e e-mail simulados: nenhuma rede, nenhum e-mail real.

const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const ORIGIN = 'http://localhost:5173';
const USER = '20000000-0000-4000-8000-000000000001';
const SERVICE_KEY = 'service-key-placeholder';
const ENV = { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_ANON_KEY: 'anon-key-placeholder', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
const baseInvite = { id: '11111111-1111-4111-8111-111111111111', company_id: '22222222-2222-4222-8222-222222222222', email: 'ana@example.test',
  name: 'Ana', role: 'technician', accepted_at: null, expires_at: null };

function loadHandler(createClient) {
  const source = read('supabase/functions/team-invite-email/index.ts').replace(/^import .*;\n/m, '');
  const { code } = transformSync(source, { loader: 'ts' });
  let handler;
  runInNewContext(code, { URL, Response, Deno: { serve: (fn) => { handler = fn; }, env: { get: (name) => ENV[name] } }, createClient });
  return handler;
}

/** Função de ponta a ponta com um dono (ou técnico) simulado. `claim` responde a zt_claim_team_invite_email. */
function scenario({ role = 'owner', invite = baseInvite, company = { name: 'Empresa Ltda', trade_name: '' }, claim = () => ({ data: { allowed: true }, error: null }) } = {}) {
  const log = { rpc: [], mail: [], clients: [], tables: [] };
  const userClient = {
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    from(table) {
      log.tables.push(table);
      const answer = () => ({ error: null, data: table === 'company_invites' ? invite
        : table === 'company_members' ? (role === 'owner' ? { id: 'membership' } : null) : company });
      const query = { select: () => query, eq: () => query, maybeSingle: async () => answer(), single: async () => answer() };
      return query;
    },
    rpc: async (name, args) => { log.rpc.push({ name, args: JSON.parse(JSON.stringify(args)) }); return claim(args); },
  };
  const adminClient = { auth: { admin: { inviteUserByEmail: async (email, options) => { log.mail.push({ email, options: JSON.parse(JSON.stringify(options)) }); return { error: null }; } } } };
  const handler = loadHandler((url, key) => { log.clients.push(key); return key === SERVICE_KEY ? adminClient : userClient; });
  const send = async (body = {}) => handler(new Request('https://edge.example', { method: 'POST',
    headers: { Origin: ORIGIN, Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_id: invite.id, redirect_to: `${ORIGIN}/`, ...body }) }));
  return { send, log };
}

// ───────────────────────── SEC-05 ─────────────────────────

test('primeiro envio: o banco reserva o envio ANTES de a chave de serviço existir e o e-mail sai uma vez', async () => {
  const { send, log } = scenario();
  const response = await send();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sent: true, reason: 'invite_email_sent' });
  assert.deepEqual(log.rpc, [{ name: 'zt_claim_team_invite_email', args: { p_invite: baseInvite.id } }]);
  assert.equal(log.mail.length, 1);
  assert.equal(log.mail[0].email, 'ana@example.test');
  assert.deepEqual(log.clients, ['anon-key-placeholder', SERVICE_KEY], 'o cliente administrativo só é criado depois da reserva');
});

test('reenvio imediato: 429 amigável com o tempo de espera, sem e-mail e sem criar a chave de serviço', async () => {
  const { send, log } = scenario({ claim: () => ({ data: { allowed: false, reason: 'cooldown', retryAfterSeconds: 42.2 }, error: null }) });
  const response = await send();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '43');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'o navegador precisa conseguir ler a resposta 429');
  assert.deepEqual(await response.json(), { ok: false, sent: false, reason: 'rate_limited', retry_after_seconds: 43 });
  assert.equal(log.mail.length, 0);
  assert.deepEqual(log.clients, ['anon-key-placeholder']);
});

test('a resposta de limite só fala do próprio convite: nada de outra empresa, destinatário ou motivo interno', async () => {
  const { send } = scenario({ claim: () => ({ data: { allowed: false, reason: 'company_hourly', retryAfterSeconds: 90, company: 'OUTRA', email: 'x@y.test' }, error: null }) });
  const body = await (await send()).json();
  assert.deepEqual(Object.keys(body).sort(), ['ok', 'reason', 'retry_after_seconds', 'sent']);
  assert.equal(JSON.stringify(body).includes('OUTRA') || JSON.stringify(body).includes('x@y.test') || JSON.stringify(body).includes('company_hourly'), false);
});

test('tempo de espera inválido vira 60 s e fica dentro de 1..3600', async () => {
  for (const [value, expected] of [[undefined, 60], ['abc', 60], [0, 1], [-5, 1], [999999, 3600], [59.01, 60]]) {
    const { send } = scenario({ claim: () => ({ data: { allowed: false, retryAfterSeconds: value }, error: null }) });
    assert.equal((await (await send()).json()).retry_after_seconds, expected, String(value));
  }
});

test('técnico: negado antes de qualquer reserva e sem e-mail', async () => {
  const { send, log } = scenario({ role: 'technician' });
  const response = await send();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'owner_required');
  assert.deepEqual(log.rpc, []);
  assert.equal(log.mail.length, 0);
  assert.deepEqual(log.clients, ['anon-key-placeholder']);
});

test('o banco nega a reserva (42501): 403 e nenhum e-mail', async () => {
  const { send, log } = scenario({ claim: () => ({ data: null, error: { code: '42501', message: 'Sem permissão' } }) });
  const response = await send();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'owner_required');
  assert.equal(log.mail.length, 0);
});

test('reserva indisponível (migration ausente, erro ou resposta inesperada) falha fechada: 503 e nenhum e-mail', async () => {
  for (const claim of [() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    () => ({ data: null, error: null }), () => ({ data: { allowed: 'sim' }, error: null }), () => ({ data: 'true', error: null })]) {
    const { send, log } = scenario({ claim });
    const response = await send();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, sent: false, reason: 'throttle_unavailable' });
    assert.equal(log.mail.length, 0);
    assert.deepEqual(log.clients, ['anon-key-placeholder']);
  }
});

test('o corpo da requisição não escolhe empresa, e-mail nem convite da reserva: só o id do convite lido com a sessão do dono', async () => {
  const { send, log } = scenario();
  await send({ company_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', email: 'outro@example.test', p_invite: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  assert.deepEqual(log.rpc, [{ name: 'zt_claim_team_invite_email', args: { p_invite: baseInvite.id } }]);
  assert.equal(log.mail[0].email, 'ana@example.test');
});

test('convite aceito ou expirado não gasta reserva', async () => {
  for (const [invite, status] of [[{ ...baseInvite, accepted_at: '2026-01-01T00:00:00Z' }, 409], [{ ...baseInvite, expires_at: '2020-01-01T00:00:00Z' }, 410]]) {
    const { send, log } = scenario({ invite });
    assert.equal((await send()).status, status);
    assert.deepEqual(log.rpc, []);
  }
});

// ───────────────────────── SEC-06 ─────────────────────────

const SAMPLES = ['<b>x</b>', '<img src=x onerror=alert(1)>', '"&<>\'"', '<script>alert(1)</script>', '" onmouseover="alert(1)', '</strong><a href="https://evil.example">clique</a>'];

async function metadataFor({ name, company }) {
  const { send, log } = scenario({ invite: { ...baseInvite, name }, company: { name: company, trade_name: '' } });
  assert.equal((await send()).status, 200);
  return log.mail[0].options.data;
}

test('company_name e invitee_name chegam sem & < > " \' e sem controles', async () => {
  for (const sample of SAMPLES) {
    const data = await metadataFor({ name: sample, company: sample });
    for (const field of ['company_name', 'invitee_name']) assert.equal(/[&<>"']/.test(data[field]), false, `${field}: ${data[field]}`);
  }
  const data = await metadataFor({ name: 'Ana\r\nBcc: x@y.test\u0000\u{202E}', company: 'Linha 1\nLinha 2\t\u{2028}fim' });
  assert.equal(/[\p{Cc}\u{2028}\u{2029}\u{202A}-\u{202E}]/u.test(data.invitee_name + data.company_name), false);
  assert.equal(data.invitee_name, 'Ana Bcc: x@y.test');
});

test('texto normal e Unicode passam intactos; só as cinco marcas viram caracteres inertes equivalentes', async () => {
  const data = await metadataFor({ name: 'José d\'Ávila', company: 'Açaí & Café — 日本語 😀 ñ' });
  assert.equal(data.invitee_name, 'José d\u{2019}Ávila');
  assert.equal(data.company_name, 'Açaí \u{FF06} Café — 日本語 😀 ñ');
  const plain = await metadataFor({ name: 'Maria da Silva', company: 'Elétrica Silva Ltda' });
  assert.deepEqual([plain.invitee_name, plain.company_name], ['Maria da Silva', 'Elétrica Silva Ltda']);
  assert.equal(plain.role_label, 'técnico/colaborador');
});

test('limites de tamanho e valores vazios', async () => {
  const data = await metadataFor({ name: 'N'.repeat(500), company: 'C'.repeat(500) });
  assert.equal(Array.from(data.invitee_name).length, 120);
  assert.equal(Array.from(data.company_name).length, 160);
  const empty = await metadataFor({ name: null, company: '   ' });
  assert.equal(empty.invitee_name, '');
  assert.equal(empty.company_name, 'Sua empresa');
  // Emoji no limite não é cortado ao meio.
  const emoji = await metadataFor({ name: '😀'.repeat(200), company: 'x' });
  assert.equal(Array.from(emoji.invitee_name).length, 120);
  assert.equal(emoji.invitee_name.includes('�'), false);
});

test('o convite renderizado nunca ganha marcação: nem com o escape do Auth (html/template) nem sem ele', async () => {
  const template = read('supabase/templates/invite.html');
  const tags = (html) => [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[0].toLowerCase());
  const goEscape = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&#34;').replace(/'/g, '&#39;');
  const render = (data, escape) => template
    .replace(/\{\{ if \.Data\.invitee_name \}\}([\s\S]*?)\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/, (_, yes, no) => (data.invitee_name ? yes : no))
    .replace(/\{\{ \.Data\.(company_name|invitee_name|role_label) \}\}/g, (_, key) => escape(data[key] || ''))
    .replace(/\{\{ \.ConfirmationURL \}\}/g, 'https://auth.example.invalid/confirm');

  // Os valores só entram em nós de texto, nunca dentro de uma tag ou atributo.
  for (const match of template.matchAll(/\{\{ \.Data\.(company_name|invitee_name) \}\}/g)) {
    const before = template.slice(0, match.index);
    assert.ok(before.lastIndexOf('<') < before.lastIndexOf('>'), `${match[1]} fora de nó de texto`);
  }

  const baseline = tags(render({ company_name: 'Empresa', invitee_name: 'Ana', role_label: 'técnico/colaborador' }, (v) => v));
  for (const sample of SAMPLES) {
    const data = await metadataFor({ name: sample, company: sample });
    for (const escape of [(v) => v, goEscape]) {
      const html = render(data, escape);
      assert.deepEqual(tags(html), baseline, `marcação injetada com ${JSON.stringify(sample)}`);
      assert.equal(/<[^>]*\bon\w+\s*=/i.test(html.replace(/<(?:table|tr|td|a|p|h1|strong|div|span|body|html|img)\b[^>]*>/gi, '')), false);
    }
  }
  // Com o escape do Auth, um nome legítimo com "&" não aparece com entidade dupla (&amp;amp;).
  const legit = await metadataFor({ name: 'Ana', company: 'Silva & Filhos' });
  assert.equal(render(legit, goEscape).includes('&amp;'), false);
  assert.ok(render(legit, goEscape).includes('Silva ＆ Filhos'));
});

test('a função ainda aceita só o contrato antigo: origem, redirect e papel do dono continuam valendo', async () => {
  const { send, log } = scenario();
  assert.equal((await send({ redirect_to: 'https://evil.example/' })).status, 400);
  assert.deepEqual(log.rpc, []);
  assert.equal(log.mail.length, 0);
});
