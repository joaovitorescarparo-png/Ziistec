// Edge Function `quote-pdf` contra o Supabase local REAL (RLS, zt_is_owner e a cota no banco).
//
// O handler da função (supabase/functions/quote-pdf/handler.js) roda em Node com fetch de
// verdade contra a Data API local, autenticado com JWTs sintéticos de três usuários. A rota da
// Vercel roda com o MESMO banco (só o endereço é trocado para o local) e as duas precisam
// devolver o mesmo PDF e as mesmas recusas. Os dados são criados e apagados por este teste.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as pdfLib from 'pdf-lib';

const DB_URL = process.env.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL = process.env.ZT_TEST_SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.ZT_TEST_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const A = 'd1a00000-0000-4000-8000-00000000000a';
const B = 'd1a00000-0000-4000-8000-00000000000b';
const DONO_A = 'd1a00000-0000-4000-8000-0000000000a1';
const TEC_A = 'd1a00000-0000-4000-8000-0000000000a2';
const DONO_B = 'd1a00000-0000-4000-8000-0000000000b1';
const CL_A = 'd1a00000-0000-4000-8000-0000000000c1';
const CL_B = 'd1a00000-0000-4000-8000-0000000000c2';
const Q_A = 'd1a00000-0000-4000-8000-0000000000f1';
const Q_B = 'd1a00000-0000-4000-8000-0000000000f2';
// O Auth só aceita token de sessão existente: cada usuário tem uma sessão real em auth.sessions.
const SESSAO = { [DONO_A]: 'd1a00000-0000-4000-8000-0000000005a1', [TEC_A]: 'd1a00000-0000-4000-8000-0000000005a2', [DONO_B]: 'd1a00000-0000-4000-8000-0000000005b1' };

globalThis.__ZT_TEST_USER = DONO_A; // o stub exige um usuário; aqui só o tokenDe é usado
const { tokenDe } = await import('./support/supabase-stub.mjs');
const { criarHandlerPdfOrcamento } = await import('../../supabase/functions/quote-pdf/handler.js');

// A rota da Vercel resolve o Supabase pelo ambiente na importação; o fetch abaixo troca o
// endereço do Beta pelo Supabase local e a chave pública pela local.
process.env.VERCEL_ENV = 'development';
process.env.SUPABASE_URL = 'https://xadoktssibuuebzzjrhv.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_AIJvagsmB3vknIW9ykFERQ_T7aCkl5e';
const { default: handlerVercel } = await import('../../api/quote-pdf.js');

const sql = (texto) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', texto], { encoding: 'utf8' }).trim();
const usosDaCota = () => Number(sql(`select count(*) from public.document_usage_events where company_id in ('${A}','${B}')`));

const limpar = () => sql(`
  set session_replication_role = replica;
  delete from public.document_usage_events where company_id in ('${A}','${B}');
  delete from public.quote_items where company_id in ('${A}','${B}');
  delete from public.quotes where company_id in ('${A}','${B}');
  delete from public.clients where company_id in ('${A}','${B}');
  delete from public.company_members where company_id in ('${A}','${B}');
  delete from public.subscriptions where company_id in ('${A}','${B}');
  delete from public.companies where id in ('${A}','${B}');
  delete from auth.sessions where user_id in ('${DONO_A}','${TEC_A}','${DONO_B}');
  delete from public.profiles where id in ('${DONO_A}','${TEC_A}','${DONO_B}');
  delete from auth.users where id in ('${DONO_A}','${TEC_A}','${DONO_B}');
  set session_replication_role = origin;`);

before(() => {
  limpar();
  // Colunas de token vazias (não NULL): o Auth lê o usuário em /auth/v1/user.
  const usuario = (id, email) => `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,
      confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,phone_change,phone_change_token,reauthentication_token)
      values ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated','${email}','',now(),'{}','{}',now(),now(),'','','','','','','','');
    insert into public.profiles(id,full_name,email) values ('${id}','${email}','${email}');
    insert into auth.sessions(id,user_id,created_at,updated_at,aal) values ('${SESSAO[id]}','${id}',now(),now(),'aal1');`;
  sql(`
    set session_replication_role = replica;
    ${usuario(DONO_A, 'pdf-dono-a@example.invalid')}
    ${usuario(TEC_A, 'pdf-tec-a@example.invalid')}
    ${usuario(DONO_B, 'pdf-dono-b@example.invalid')}
    insert into public.companies(id,name,has_team,tax_id,phone,owner_name) values
      ('${A}','PDF Empresa A',true,'12.345.678/0001-90','11 4000-0000','Dono A'),
      ('${B}','PDF Empresa B',true,null,null,'Dono B');
    insert into public.subscriptions(company_id,status,current_period_start,current_period_end) values
      ('${A}','active',current_date,current_date+30), ('${B}','active',current_date,current_date+30);
    insert into public.company_members(company_id,user_id,role,status) values
      ('${A}','${DONO_A}','owner','active'), ('${A}','${TEC_A}','technician','active'), ('${B}','${DONO_B}','owner','active');
    insert into public.clients(id,company_id,person_type,name,phone,address) values
      ('${CL_A}','${A}','PJ','Condomínio Aurora','11 3000-0000','Av. Brasil, 1000'),
      ('${CL_B}','${B}','PF','Cliente da B',null,null);
    insert into public.quotes(id,company_id,number,client_id,status,issue_date,valid_until,discount,surcharge,payment_terms,notes,created_by) values
      ('${Q_A}','${A}','ORC-7001','${CL_A}','sent','2026-11-20','2026-12-05',50,20,'Pix na aprovação','Material incluso','${DONO_A}'),
      ('${Q_B}','${B}','ORC-9001','${CL_B}','sent','2026-11-20',null,0,0,null,null,'${DONO_B}');
    insert into public.quote_items(quote_id,company_id,kind,name,unit,quantity,unit_price,unit_cost,position) values
      ('${Q_A}','${A}','free','Instalação de split','serviço',1,450.50,100,1),
      ('${Q_A}','${A}','free','Tubulação de cobre','m',2.5,89.90,30,2),
      ('${Q_B}','${B}','free','Item secreto da B','un',1,999,500,1);
    set session_replication_role = origin;`);
});
after(() => limpar());

// fetch da Edge Function: igual ao do Deno, apontado para o Supabase local.
const edge = criarHandlerPdfOrcamento({ pdfLib, supabaseUrl: LOCAL, apiKey: ANON, registrarErro: () => {} });
const pedirEdge = async ({ usuario = DONO_A, token, quoteId = Q_A, companyId = A, origin = 'https://ziistec.com' } = {}) => {
  const jwt = token ?? tokenDe(usuario, { sessionId: SESSAO[usuario] });
  const r = await edge(new Request('http://localhost/functions/v1/quote-pdf', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ quoteId, companyId }),
  }));
  const bytes = Buffer.from(await r.arrayBuffer());
  const tipo = r.headers.get('content-type') || '';
  return { status: r.status, tipo, bytes, corpo: tipo.includes('json') ? JSON.parse(bytes.toString('utf8')) : null };
};

const fetchReal = globalThis.fetch;
const pedirVercel = async ({ usuario = DONO_A, token, quoteId = Q_A, companyId = A } = {}) => {
  const jwt = token ?? tokenDe(usuario, { sessionId: SESSAO[usuario] });
  globalThis.fetch = (url, init = {}) => {
    const destino = String(url).replace('https://xadoktssibuuebzzjrhv.supabase.co', LOCAL);
    const headers = new Headers(init.headers || {});
    if (headers.has('apikey')) headers.set('apikey', ANON);
    return fetchReal(destino, { ...init, headers });
  };
  const res = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; } };
  try {
    await handlerVercel({ method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` }, body: { quoteId, companyId } }, res);
  } finally { globalThis.fetch = fetchReal; }
  return { status: res.statusCode, corpo: res.body };
};

const DataReal = Date;
const congelado = async (fn) => {
  const instante = DataReal.UTC(2026, 10, 25, 12, 0, 0);
  globalThis.Date = class extends DataReal { constructor(...a) { if (a.length) super(...a); else super(instante); } static now() { return instante; } };
  try { return await fn(); } finally { globalThis.Date = DataReal; }
};
const textos = [];
const drawText = pdfLib.PDFPage.prototype.drawText;
pdfLib.PDFPage.prototype.drawText = function (t, o) { textos.push(t); return drawText.call(this, t, o); };
after(() => { pdfLib.PDFPage.prototype.drawText = drawText; });

test('dono da empresa A gera o PDF do orçamento A, igual ao da Vercel, sem custo e sem dado de B', async () => {
  textos.length = 0;
  // Token criado antes de congelar o relógio (senão ele já nasceria vencido).
  const token = tokenDe(DONO_A, { sessionId: SESSAO[DONO_A] });
  const e = await congelado(() => pedirEdge({ token }));
  assert.equal(e.status, 200, JSON.stringify(e.corpo));
  assert.equal(e.tipo, 'application/pdf');
  assert.equal(e.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok((await pdfLib.PDFDocument.load(e.bytes)).getPageCount() >= 1);
  const t = textos.join('\n');
  // 450,50 + 2,5 × 89,90 = 675,25; − 50 + 20 = 645,25
  for (const esperado of ['ORC-7001', 'Condomínio Aurora', 'PDF Empresa A', 'R$ 675,25', '- R$ 50,00', '+ R$ 20,00', 'R$ 645,25', 'Pix na aprovação', 'Material incluso']) {
    assert.ok(t.includes(esperado), esperado);
  }
  for (const proibido of ['ORC-9001', 'Item secreto da B', 'PDF Empresa B', 'R$ 100,00']) assert.equal(t.includes(proibido), false, proibido);
  const v = await congelado(() => pedirVercel({ token }));
  assert.equal(v.status, 200);
  assert.equal(Buffer.compare(e.bytes, Buffer.from(v.corpo)), 0, 'mesmos bytes que a rota da Vercel, com o mesmo banco');
});

test('cross-tenant, técnico, JWT inválido e orçamento inexistente: recusa igual à da Vercel', async () => {
  const casos = [
    ['dono A pede orçamento B dizendo empresa A', { quoteId: Q_B, companyId: A }, 404, 'Orçamento não encontrado.'],
    ['dono A pede orçamento B dizendo empresa B', { quoteId: Q_B, companyId: B }, 403, 'Somente o proprietário pode gerar este PDF.'],
    ['técnico da empresa A', { usuario: TEC_A }, 403, 'Somente o proprietário pode gerar este PDF.'],
    ['dono B pede orçamento A', { usuario: DONO_B }, 403, 'Somente o proprietário pode gerar este PDF.'],
    ['orçamento inexistente', { quoteId: 'd1a00000-0000-4000-8000-0000000000ff' }, 404, 'Orçamento não encontrado.'],
  ];
  for (const [nome, opcoes, status, erro] of casos) {
    const e = await pedirEdge(opcoes);
    assert.equal(e.status, status, `${nome}: ${JSON.stringify(e.corpo)}`);
    assert.deepEqual(e.corpo, { error: erro }, nome);
    const v = await pedirVercel(opcoes);
    assert.deepEqual([v.status, v.corpo], [e.status, e.corpo], `${nome}: mesma resposta da Vercel`);
  }
  for (const token of ['nao-e-jwt', `${tokenDe(DONO_A, { sessionId: SESSAO[DONO_A] }).slice(0, -6)}abcdef`, tokenDe(DONO_A, { sessionId: 'd1a00000-0000-4000-8000-00000000dead' })]) {
    const e = await pedirEdge({ token });
    assert.equal(e.status, 401, token.slice(0, 12));
    assert.deepEqual(e.corpo, { error: 'Sessão inválida ou expirada.' });
    const v = await pedirVercel({ token });
    assert.ok([401, 403].includes(v.status), 'a Vercel também recusa (403 quando o Auth diz 403)');
  }
});

test('a geração não altera dado: só o evento de cota, e a cota do banco vale (30 por minuto)', async () => {
  const foto = () => sql(`select md5(string_agg(t, '|' order by t)) from (
    select q::text as t from public.quotes q where company_id in ('${A}','${B}')
    union all select i::text from public.quote_items i where company_id in ('${A}','${B}')
    union all select c::text from public.clients c where company_id in ('${A}','${B}')
    union all select s::text from public.subscriptions s where company_id in ('${A}','${B}')) x`);
  const antes = foto();
  const usos = usosDaCota();
  assert.equal((await pedirEdge()).status, 200);
  assert.equal((await pedirEdge()).status, 200, 'retry/segundo clique gera de novo, sem efeito colateral');
  assert.equal(foto(), antes, 'orçamento, itens, cliente e assinatura intactos');
  assert.equal(usosDaCota(), usos + 2, 'um evento de uso por geração, como na Vercel');
  assert.equal((await pedirEdge({ usuario: TEC_A })).status, 403);
  assert.equal(usosDaCota(), usos + 2, 'técnico recusado antes de consumir cota');

  sql(`insert into public.document_usage_events(user_id,company_id,kind) select '${DONO_A}','${A}','quote_pdf' from generate_series(1,30)`);
  const limite = await pedirEdge();
  assert.equal(limite.status, 429);
  assert.deepEqual(limite.corpo, { error: 'Muitos PDFs em pouco tempo. Aguarde um minuto' });
  sql(`delete from public.document_usage_events where company_id='${A}'`);

  sql(`update public.subscriptions set status='canceled' where company_id='${A}'`);
  try {
    const inativa = await pedirEdge();
    assert.equal(inativa.status, 403);
    assert.deepEqual(inativa.corpo, { error: 'Assinatura inativa' });
  } finally { sql(`update public.subscriptions set status='active' where company_id='${A}'`); }
});
