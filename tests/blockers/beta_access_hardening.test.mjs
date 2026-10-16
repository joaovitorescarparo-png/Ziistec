import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import * as display from '../../src/lib/subscriptionDisplay.js';
import { googleAuthHabilitado, seloBetaAtivo } from '../../src/lib/betaFlags.js';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tick = () => new Promise(resolve => setImmediate(resolve));
const addDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

// Executa o componente/hook real com hooks determinísticos: efeitos rodam uma vez, na montagem.
function harness(path, mocks = {}, globals = {}) {
  const slots = []; let cursor = 0; let effects = []; let mounted = false;
  const hookReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useCallback(fn) { return fn; }, useMemo(fn) { return fn(); },
    useEffect(fn) { if (!mounted) effects.push(fn); }, lazy() { return () => null; },
  };
  const module = { exports: {} };
  const code = transformSync(read(path), { loader: 'jsx', format: 'cjs', logLevel: 'silent' }).code;
  vm.runInNewContext(code, { module, exports: module.exports, console, URL, URLSearchParams, Date, Intl, ...globals,
    require(name) { if (name === 'react') return hookReact; if (name in mocks) return mocks[name]; return { __esModule: true, default: () => null }; },
  });
  return { exports: module.exports, render(fn, props) {
    cursor = 0; const out = fn(props);
    if (!mounted) { mounted = true; const pending = effects; effects = []; pending.forEach(effect => effect()); }
    return out;
  } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function content(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (typeof tree !== 'object') return String(tree);
  if (Array.isArray(tree)) return tree.map(content).join('');
  return content(tree.props?.children);
}
const find = (tree, type, text) => nodes(tree).find(n => n.type === type && (text === undefined || content(n).includes(text)));
const browser = () => {
  const removed = [];
  return { removed, localStorage: { getItem: () => null, setItem() {}, removeItem: key => removed.push(key) },
    window: { addEventListener() {}, removeEventListener() {}, history: { replaceState() {} } },
    document: { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' }, navigator: { onLine: true } };
};

// ------------------------------------------------------------------ LOGOUT
function authStore(session) {
  let stored = session; let listener = null; const signOutCalls = [];
  const empty = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }) };
  const supabase = { auth: {
    getSession: async () => ({ data: { session: stored } }),
    onAuthStateChange(cb) { listener = cb; return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut(...args) { signOutCalls.push(args); stored = null; listener?.('SIGNED_OUT', null); return { error: null }; },
  }, rpc: async () => ({ data: null, error: null }), from: () => empty };
  return { supabase, signOutCalls, get stored() { return stored; } };
}
function sessao(store, env) {
  const h = harness('src/lib/useSessao.js', { './supabase': { supabase: store.supabase, mensagemErro: e => String(e?.message || e) } }, env);
  return () => h.render(h.exports.useSessao);
}

test('Sair da conta usa o sair() real: signOut global, tenant local limpo e refresh não restaura a sessão', async () => {
  const store = authStore({ user: { id: 'owner-1' } });
  const env = browser();
  const render = sessao(store, env);
  render(); await tick();
  let s = render();
  assert.equal(s.sessaoAuth?.user?.id, 'owner-1');
  await s.sair();
  s = render();
  assert.equal(store.signOutCalls.length, 1);
  assert.deepEqual(store.signOutCalls[0], [], 'signOut sem scope local: o refresh token é revogado e o storage limpo');
  assert.deepEqual(env.removed, ['ziistec_empresa_id']);
  assert.equal(s.sessaoAuth, null);
  assert.equal(s.perfil, null); assert.equal(s.empresaId, null); assert.equal(s.assinatura, null);
  // "Refresh": nova montagem lê o storage do Auth, que ficou vazio.
  const fresh = sessao(store, browser());
  fresh(); await tick();
  assert.equal(fresh().sessaoAuth, null);
});

test('sem sessão o App mostra o Login e nenhum Assistente (contexto descartado)', () => {
  const LoginMock = function LoginMock() { return null; };
  const AssistantMock = function AssistantMock() { return null; };
  const h = harness('src/App.jsx', {
    './lib/useSessao': { useSessao: () => ({ sessaoAuth: null, carregando: false, membresias: [], recarregar() {}, sair() {} }) },
    './lib/supabase': { configurado: true }, './screens/Login': { __esModule: true, default: LoginMock },
    './components/AssistantPanel': { __esModule: true, default: AssistantMock },
  }, { window: { location: { search: '', href: 'https://beta.ziistec.com/' }, addEventListener() {}, removeEventListener() {} } });
  const tree = h.render(h.exports.default);
  assert.ok(find(tree, LoginMock));
  assert.equal(find(tree, AssistantMock), undefined);
});

test('shell legado: Sair da conta e Minha conta visíveis em desktop, trilho do tablet e mobile, com toque >= 44px', () => {
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /const sair = \(\) => \{\n\s*if \(real\) \{ contexto\.sair\(\); return; \}/);
  const empresa = legacy.slice(legacy.indexOf('const Empresa = ({ rail }) => {'), legacy.indexOf('const estiloGlobal'));
  assert.match(empresa, /<div className=\{cx\("px-3 pb-4 space-y-1", compacto && "md:px-2 lg:px-3"\)\}>/, 'o bloco não some no trilho recolhido');
  assert.doesNotMatch(empresa, /"hidden lg:block"\)\}>/);
  assert.match(empresa, /<button onClick=\{sair\} aria-label="Sair da conta" title="Sair da conta"\n\s*className=\{cx\("w-full min-h-11/);
  assert.match(empresa, />Sair da conta<\/span>/);
  assert.match(empresa, /aria-label="Minha conta"[\s\S]*min-h-11/);
  assert.match(legacy, /<Marca rail \/><Nav rail \/><Empresa rail \/>/);
  assert.match(legacy, /<Nav \/><Empresa \/>/, 'menu mobile mantém a área da conta');
  const header = legacy.slice(legacy.indexOf('<header className="zt-nao-imprime md:hidden'), legacy.indexOf('</header>', legacy.indexOf('<header className="zt-nao-imprime md:hidden')));
  assert.match(header, /<SeloBeta \/>/);
  assert.match(header, /onClick=\{\(\) => setMinhaConta\(true\)\} aria-label="Minha conta" className="min-h-11 min-w-11/);
  assert.match(legacy, /<MinhaConta nome=\{usuarioAtual\?\.nome\} email=\{usuarioAtual\?\.email\}[\s\S]*mostrarAssinatura=\{pode\(papel, "assinatura"\)\} sair=\{sair\}/);
});

// ------------------------------------------------------------------ PREÇO / TRIAL / UX
test('resumo da assinatura: trial com dias restantes, R$ 79,90 depois do teste e sem cobrança sugerida', () => {
  const trial = { status: 'trial', plano: 'Profissional', valor: 79.9, fim: '2026-10-30' };
  const r = display.resumoAssinatura(trial, '2026-10-16');
  assert.equal(r.titulo, 'Teste grátis'); assert.equal(r.destaque, '14 dias restantes'); assert.equal(r.bloqueado, false);
  assert.deepEqual(r.linhas, [['Depois do teste', 'R$ 79,90/mês'], ['Data de término', '30/10/2026']]);
  assert.match(r.aviso, /Nenhuma cobrança/);
  assert.equal(display.resumoAssinatura({ ...trial, fim: '2026-10-17' }, '2026-10-16').destaque, '1 dia restante');
  assert.equal(display.resumoAssinatura({ ...trial, fim: '2026-10-16' }, '2026-10-16').destaque, 'Último dia de teste');
  const ativa = display.resumoAssinatura({ status: 'ativa', plano: 'Profissional', valor: 79.9, proximaCobranca: '2026-11-16' }, '2026-10-16');
  assert.equal(ativa.titulo, 'Assinatura ativa'); assert.equal(ativa.destaque, 'R$ 79,90/mês'); assert.equal(ativa.plano, 'Profissional');
  assert.equal(display.precoMensal(69.9), 'R$ 69,90/mês', 'valor antigo gravado no banco continua sendo exibido como está');
});

test('resumo da assinatura: trial vencido e status bloqueados mostram o status real, sem reativação', () => {
  for (const status of ['trial', 'suspended', 'suspensa']) {
    const r = display.resumoAssinatura({ status, plano: 'Profissional', valor: 79.9, fim: '2026-10-15' }, '2026-10-16');
    assert.equal(r.titulo, 'Seu período de teste terminou.', status);
    assert.equal(r.mensagem, 'Seus dados permanecem armazenados.');
    assert.equal(r.contato, 'Entre em contato com a ZiisTec para continuar.');
    assert.equal(r.bloqueado, true);
  }
  const casos = { past_due: 'Pagamento pendente', pendente: 'Pagamento pendente', suspended: 'Acesso suspenso', canceled: 'Assinatura cancelada', cancelada: 'Assinatura cancelada' };
  for (const [status, titulo] of Object.entries(casos)) {
    const r = display.resumoAssinatura({ status, plano: 'Profissional', valor: 79.9, fim: '2026-11-30' }, '2026-10-16');
    assert.equal(r.titulo, titulo); assert.equal(r.bloqueado, true);
    assert.match(r.mensagem, /Seus dados permanecem armazenados\./);
    assert.equal(r.contato, 'Entre em contato com a ZiisTec para renovar o acesso.');
  }
  assert.equal(display.resumoAssinatura({ status: 'active', plano: 'Profissional', valor: 79.9, fim: '2026-10-15' }, '2026-10-16').bloqueado, true);
  assert.equal(display.resumoAssinatura({ status: 'desconhecido', valor: 1, fim: '2026-11-30' }, '2026-10-16').bloqueado, true);
});

test('Minha conta mostra identidade, empresa, papel, trial e Sair da conta; técnico não vê preço', () => {
  const sair = () => {};
  const mocks = { 'lucide-react': { LogOut: 'span', X: 'span' }, '../lib/subscriptionDisplay': display };
  const globals = { window: { addEventListener() {}, removeEventListener() {} } };
  const fim = addDias(display.hojeISO(), 14);
  const owner = harness('src/components/MinhaConta.jsx', mocks, globals);
  const tree = owner.render(owner.exports.default, { nome: 'Ana Dona', email: 'ana@empresa.com', empresa: 'Ana Climatização', papel: 'proprietario',
    assinatura: { status: 'trial', plano: 'Profissional', valor: 79.9, proximaCobranca: fim }, mostrarAssinatura: true, sair, onFechar() {} });
  const text = content(tree);
  for (const s of ['Minha conta', 'Ana Dona', 'ana@empresa.com', 'Empresa ativa', 'Ana Climatização', 'Proprietário', 'Profissional', 'Teste grátis', '14 dias restantes', 'Depois do teste', 'R$ 79,90/mês', 'Sair da conta']) {
    assert.ok(text.includes(s), s);
  }
  const botao = find(tree, 'button', 'Sair da conta');
  assert.equal(botao.props.onClick, sair);
  assert.match(botao.props.className, /min-h-11/);
  const tech = harness('src/components/MinhaConta.jsx', mocks, globals);
  const techText = content(tech.render(tech.exports.default, { nome: 'Téc', email: 't@e.com', empresa: 'Ana Climatização', papel: 'tecnico',
    assinatura: { status: 'trial', plano: 'Profissional', valor: 79.9, proximaCobranca: fim }, mostrarAssinatura: false, sair, onFechar() {} }));
  assert.ok(techText.includes('Técnico') && techText.includes('Sair da conta'));
  assert.ok(!techText.includes('R$') && !techText.includes('Teste grátis'));
});

test('Configurações e tela bloqueada: sem Reativar/Cancelar para o proprietário e com contato da ZiisTec', () => {
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  const bloqueada = legacy.slice(legacy.indexOf('function AssinaturaBloqueada('), legacy.indexOf('function Equipe('));
  assert.doesNotMatch(bloqueada, /Reativar assinatura|reativar/);
  assert.match(bloqueada, /resumoAssinatura\(assinatura\)/);
  assert.match(bloqueada, /onClick=\{sair\}>Sair da conta<\/Btn>/);
  assert.match(legacy, /if \(assinatura && \(!ST_ASSINATURA\[assinatura\.status\]\?\.libera \|\| resumoAssinatura\(assinatura\)\?\.bloqueado\)\) return \(/);
  assert.doesNotMatch(legacy, /reativar=\{\(\) => mudarAssinatura/);
  const config = legacy.slice(legacy.indexOf('function Config('), legacy.indexOf('function AssinaturaBloqueada('));
  assert.doesNotMatch(config, /Cancelar assinatura|próxima cobrança|Forma de pagamento/);
  assert.match(config, /Entre em contato com a ZiisTec para renovar o acesso\./);
  assert.match(legacy, /const PLANO = \{ nome: "Profissional", valor: 79\.9 \};/);
  assert.doesNotMatch(legacy, /69[.,]9|ZiisTec Mensal/);
  const settings = read('src/screens/v2/SettingsV2.jsx');
  assert.doesNotMatch(settings, /Reativar assinatura|Cancelar assinatura|reativarAssinaturaSettingsV2DB|cancelarAssinaturaSettingsV2DB|Valor cadastrado/);
  assert.match(settings, /resumoAssinatura\(subscription\)/);
  assert.match(settings, /Entre em contato com a ZiisTec para renovar o acesso\./);
});

test('selo BETA no shell (marca, trilho recolhido, cabeçalho mobile) e flag para desligar', () => {
  const legacy = read('src/legacy/ZiisTecApp.jsx');
  assert.match(legacy, /const SeloBeta = \(\{ className \}\) => \(seloBetaAtivo\(\) \?/);
  assert.match(legacy, />BETA<\/span>/);
  const marca = legacy.slice(legacy.indexOf('const Marca = ({ rail }) => ('), legacy.indexOf('const Nav = ({ rail }) => ('));
  assert.match(marca, /rail && !menuExpandido && <SeloBeta className="absolute[^"]*lg:hidden" \/>/);
  assert.match(marca, /<SeloBeta className=\{rail && !menuExpandido \? "hidden lg:inline-flex" : ""\} \/>/);
  assert.equal(seloBetaAtivo({}), true);
  assert.equal(seloBetaAtivo({ VITE_ZIISTEC_BETA: 'false' }), false);
});

// ------------------------------------------------------------------ LOGIN / GOOGLE
function login(flag, signUpCalls = []) {
  const supabase = { auth: { signUp: async (args) => { signUpCalls.push(args); return { data: { session: null }, error: null }; },
    signInWithPassword: async () => ({ error: null }), signInWithOAuth: async () => ({ error: null }) } };
  return harness('src/screens/Login.jsx', {
    '../lib/supabase': { supabase, mensagemErro: e => String(e?.message || e), configurado: true },
    '../lib/authRedirect': { redirectAuthAtual: () => 'https://beta.ziistec.com/' },
    '../components/ZiisTecBrand': { ZiisTecAppMark: () => null },
    '../lib/betaFlags': { googleAuthHabilitado: () => flag },
  });
}

test('Google oculto por padrão (flag), com "Acesso beta por convite"; cadastro por e-mail continua', async () => {
  assert.equal(googleAuthHabilitado({}), false);
  assert.equal(googleAuthHabilitado({ VITE_ENABLE_GOOGLE_AUTH: 'false' }), false);
  assert.equal(googleAuthHabilitado({ VITE_ENABLE_GOOGLE_AUTH: 'true' }), true);
  const signUpCalls = [];
  const h = login(false, signUpCalls);
  let tree = h.render(h.exports.default);
  assert.ok(content(tree).includes('Acesso beta por convite'));
  assert.ok(!content(tree).includes('Entrar com Google'));
  find(tree, 'button', 'Criar conta').props.onClick();
  tree = h.render(h.exports.default);
  find(tree, 'input', undefined).props.onChange({ target: { value: 'Dona Beta' } });
  tree = h.render(h.exports.default);
  nodes(tree).find(n => n.type === 'input' && n.props.type === 'email').props.onChange({ target: { value: 'dona@beta.com' } });
  tree = h.render(h.exports.default);
  nodes(tree).find(n => n.type === 'input' && n.props.type === 'password').props.onChange({ target: { value: 'senha-forte-123' } });
  tree = h.render(h.exports.default);
  assert.ok(content(tree).includes('só e-mails convidados criam uma empresa'));
  const botao = nodes(tree).find(n => typeof n.type === 'function' && n.type.name === 'Botao' && content(n).includes('Criar conta'));
  await botao.props.onClick();
  assert.equal(signUpCalls.length, 1);
  assert.equal(signUpCalls[0].email, 'dona@beta.com');
  assert.equal(signUpCalls[0].options.data.ziistec_account_flow, 'owner_signup');
  const comGoogle = login(true);
  assert.ok(content(comGoogle.render(comGoogle.exports.default)).includes('Entrar com Google'));
  const src = read('src/screens/Login.jsx');
  assert.equal((src.match(/Entrar com Google/g) || []).length, 1);
  assert.match(src, /\{googleAtivo && \(\n\s*<>[\s\S]*Entrar com Google[\s\S]*<\/>\n\s*\)\}/);
});

// ------------------------------------------------------------------ ONBOARDING / BETA FECHADO
function onboarding(rpc, sair = () => {}) {
  const h = harness('src/screens/Onboarding.jsx', {
    '../lib/supabase': { supabase: { rpc }, mensagemErro: e => String(e?.message || e) },
    '../components/ZiisTecBrand': { ZiisTecAppMark: () => null },
  });
  return () => h.render(h.exports.default, { perfil: { email: 'sem.convite@beta.com', full_name: 'Sem Convite' }, sair, aoCriar: async () => {} });
}

test('usuário sem convite vê "Beta fechado", sem formulário de empresa e com Sair da conta', async () => {
  const calls = [];
  const sair = () => {};
  const render = onboarding(async (name) => { calls.push(name); return { data: { invited: false, email_confirmed: true }, error: null }; }, sair);
  render(); await tick();
  const tree = render();
  const text = content(tree);
  assert.deepEqual(calls, ['zt_beta_invite_status']);
  assert.ok(text.includes('Beta fechado'));
  assert.ok(text.includes('Seu e-mail ainda não possui acesso ao beta da ZiisTec.'));
  assert.ok(text.includes('Se você recebeu um convite, confirme que está usando o mesmo e-mail.'));
  assert.equal(find(tree, 'input'), undefined, 'sem formulário de criação');
  assert.equal(find(tree, 'button', 'Entrar na ZiisTec'), undefined);
  assert.equal(find(tree, 'button', 'Sair da conta').props.onClick, sair);
});

test('convidado vê o formulário; recusa do servidor por convite volta para "Beta fechado"', async () => {
  const calls = [];
  const render = onboarding(async (name, args) => {
    calls.push([name, args]);
    if (name === 'zt_beta_invite_status') return { data: { invited: true }, error: null };
    return { data: null, error: { code: '42501', hint: 'beta_invite_required', message: 'O ZiisTec está em beta fechado. Este e-mail ainda não possui um convite.' } };
  });
  render(); await tick();
  let tree = render();
  assert.ok(content(tree).includes('Qual é o nome do seu negócio?'));
  find(tree, 'input').props.onChange({ target: { value: 'Beta Serviços' } }); tree = render();
  find(tree, 'button', 'Continuar').props.onClick(); tree = render();
  find(tree, 'input').props.onChange({ target: { value: 'Climatização' } }); tree = render();
  find(tree, 'button', 'Continuar').props.onClick(); tree = render();
  await find(tree, 'button', 'Entrar na ZiisTec').props.onClick();
  tree = render();
  assert.equal(calls[1][0], 'zt_create_company');
  assert.equal(calls[1][1].p_name, 'Beta Serviços');
  assert.ok(content(tree).includes('Beta fechado'));
});

// ------------------------------------------------------------------ ADMIN
test('área Beta do Platform Admin lista, cria (e-mail normalizado, 7 dias) e só revoga pendentes', async () => {
  const created = [];
  const rows = [
    { id: 'i1', email: 'dono@a.com', status: 'used', created_at: '2026-10-16T10:00:00Z', expires_at: '2026-10-23T10:00:00Z', used_at: '2026-10-16T12:00:00Z',
      company_id: 'c1', company_name: 'Empresa A', subscription_status: 'trial', period_start: '2026-10-16', period_end: '2026-10-30' },
    { id: 'i2', email: 'novo@b.com', status: 'pending', created_at: '2026-10-16T10:00:00Z', expires_at: '2026-10-23T10:00:00Z' },
    { id: 'i3', email: 'velho@c.com', status: 'expired', created_at: '2026-10-01T10:00:00Z', expires_at: '2026-10-08T10:00:00Z' },
  ];
  const h = harness('src/screens/PlatformBetaInvites.jsx', {
    '../lib/platformApi': { listarConvitesBetaDB: async () => rows, revogarConviteBetaDB: async () => ({ changed: true }),
      criarConviteBetaDB: async (email, dias) => { created.push([email, dias]); return { created: true, email, expires_at: '2026-10-23T10:00:00Z' }; } },
    '../lib/supabase': { mensagemErro: e => String(e?.message || e) }, '../lib/subscriptionDisplay': display,
  });
  h.render(h.exports.default); await tick();
  let tree = h.render(h.exports.default);
  const text = content(tree);
  for (const s of ['dono@a.com', 'Utilizado', 'Empresa A', 'Teste grátis', '16/10/2026', '30/10/2026', 'novo@b.com', 'Pendente', 'velho@c.com', 'Expirado']) assert.ok(text.includes(s), s);
  assert.equal(nodes(tree).filter(n => n.type === 'button' && content(n) === 'Revogar').length, 1);
  find(tree, 'input').props.onChange({ target: { value: '  Cliente@Beta.COM ' } });
  tree = h.render(h.exports.default);
  await find(tree, 'form').props.onSubmit({ preventDefault() {} });
  assert.deepEqual(created, [['cliente@beta.com', 7]]);
  const admin = read('src/screens/PlatformAdmin.jsx');
  assert.match(admin, /\[\['empresas','Empresas'\],\['beta','Beta'\]\]/);
  assert.match(admin, /aba==='beta'\?<PlatformBetaInvites \/>/);
  const api = read('src/lib/platformApi.js');
  for (const rpc of ['zt_platform_list_beta_invites', 'zt_platform_create_beta_invite', 'zt_platform_revoke_beta_invite']) assert.match(api, new RegExp(`supabase\\.rpc\\('${rpc}'`));
  const gate = read('src/screens/PlatformAdminGate.jsx');
  assert.match(gate, /if \(aal\.currentLevel === "aal2"\) \{\n\s*setEstado\("liberado"\);/);
  assert.match(gate, /if \(estado === "liberado"\) \{[\s\S]*<PlatformAdmin perfil=\{perfil\} sair=\{sair\} \/>/);
  const app = read('src/App.jsx');
  assert.ok(app.indexOf('if (s.ehPlataforma && s.perfil)') < app.indexOf('if (s.precisaEmpresa)'), 'admin da plataforma nunca cai no onboarding');
});

// ------------------------------------------------------------------ MIGRATION 0099 / CI
test('0099: defaults Profissional 79.90, beta_invites fechada, RPCs admin com MFA e trava atômica no zt_create_company', () => {
  const sql = read('supabase/0099_beta_invites_professional_plan.sql').replace(/--[^\n]*/g, '');
  assert.match(sql, /alter column plan set default 'Profissional';/);
  assert.match(sql, /alter column amount set default 79\.90;/);
  assert.doesNotMatch(sql, /69[.,]9|update public\.subscriptions/i, 'nenhum UPDATE de assinatura existente');
  assert.match(sql, /alter table public\.beta_invites enable row level security;\nrevoke all on table public\.beta_invites from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy|grant [^;]* on table public\.beta_invites/i);
  assert.match(sql, /create unique index if not exists uq_beta_invites_pending_email on public\.beta_invites\(email\) where status = 'pending';/);
  assert.match(sql, /email = lower\(btrim\(email\)\)/);
  assert.doesNotMatch(sql, /grant [^;]* to (anon|public)\b/i);
  for (const fn of ['zt_platform_list_beta_invites', 'zt_platform_create_beta_invite', 'zt_platform_revoke_beta_invite']) {
    const body = sql.slice(sql.indexOf(`create or replace function public.${fn}(`), sql.indexOf('$$;', sql.indexOf(`create or replace function public.${fn}(`)));
    assert.match(body, /security definer\nset search_path=''/, fn);
    assert.match(body, /if not public\.zt_is_platform_admin\(\) then\n\s*raise exception 'Acesso administrativo necessário' using errcode='42501';/, fn);
  }
  const create = sql.slice(sql.indexOf('create or replace function zt_private.zt_create_company('), sql.indexOf('$$;', sql.indexOf('create or replace function zt_private.zt_create_company(')));
  assert.match(create, /security definer\nset search_path=''/);
  // create or replace não pode remover defaults existentes (42P13): a assinatura viva tem defaults.
  assert.match(create, /p_name text, p_activity text default null, p_has_team boolean default false,\n\s*p_owner_name text default null, p_phone text default null\n\)/);
  assert.match(create, /u\.email_confirmed_at is not null/);
  const order = ['pg_advisory_xact_lock(hashtext(v_uid::text))', 'return v_existing;', "i.email = v_email and i.status = 'pending' and i.expires_at > now()", 'for update;',
    "hint = 'beta_invite_required'", 'onboarding_company_created_at is not null', 'insert into public.companies', 'insert into public.company_members',
    "values (v_company, 'trial', current_date, current_date + 14)", "set status = 'used', used_at = now(), used_by = v_uid, company_id = v_company", 'return v_company;'];
  let at = -1;
  for (const step of order) { const i = create.indexOf(step); assert.ok(i > at, `ordem: ${step}`); at = i; }
  assert.doesNotMatch(create, /\bexecute\b/i, 'sem SQL dinâmico em definer (RC1B)');
  assert.match(sql, /revoke all on function zt_private\.zt_create_company\(text,text,boolean,text,text\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /zt_accept_invites|company_invites/, 'convite de equipe não é tocado');
  const ci = read('scripts/run-sql-rls-ci.sh');
  assert.match(ci, /supabase\/tests\/v2_beta_invites_rollback\.sql/);
  assert.match(ci, /bash scripts\/test-beta-invite-concurrency\.sh/);
  assert.match(read('supabase/tests/v2_rc1b_security_definer_audit_rollback.sql'), /if v_total<>134 then/);
  const smoke = read('supabase/tests/v2_beta_invites_rollback.sql');
  assert.match(smoke, /^begin;$/m); assert.match(smoke, /^rollback;$/m);
  assert.match(smoke, /20_convite_de_equipe_intacto/);
  const race = read('scripts/test-beta-invite-concurrency.sh');
  assert.match(race, /call_create "\$OUT1" & p1=\$!\ncall_create "\$OUT2" & p2=\$!/);
});
