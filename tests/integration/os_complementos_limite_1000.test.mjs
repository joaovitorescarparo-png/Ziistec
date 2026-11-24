// Regressão REAL (não textual) do corte de 1000 linhas da Data API.
//
// Roda o código do app (src/lib/dataApi.js, runtimeApi.js, financeV2Api.js, paginacao.js)
// contra o Supabase local descartável da CI (scripts/run-sql-rls-ci.sh), autenticado como
// proprietário sintético. Os dados são criados e apagados por este teste.
//
// Antes da correção: com >1000 itens de checklist na empresa, cada OS chegava incompleta
// à tela e marcar um item apagava do banco os itens que não tinham chegado.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const DB_URL = process.env.DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const CO = 'c1a00000-0000-4000-8000-000000000001';
const OWNER = 'c1a00000-0000-4000-8000-0000000000aa';
const ALVO = 'c1a00000-0000-4000-8000-00000000a1f0';
const ANTIGA = 'c1a00000-0000-4000-8000-00000000a171';
const OUTRAS_OS = 300;      // 300 OS × 4 itens = 1.200 itens fora da OS-alvo
const CLIENTES = 1100;
const DESPESAS = 1100;

globalThis.__ZT_TEST_USER = OWNER;
await import('./support/hooks.mjs');
const { carregarDadosEmpresa } = await import('../../src/lib/dataApi.js');
const { hidratarComplementosDB, carregarComplementosOSDB, persistirEdicaoOSDB, mesclarComplementosOS } = await import('../../src/lib/runtimeApi.js');
const { carregarFinanceiroV2DB } = await import('../../src/lib/financeV2Api.js');

const sql = (texto) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL, '-c', texto], { encoding: 'utf8' }).trim();
const itensNoBanco = (os) => Number(sql(`select count(*) from public.work_order_checklists where work_order_id='${os}'`));

const limpar = () => sql(`
  set session_replication_role = replica;
  delete from public.work_order_checklists where company_id='${CO}';
  delete from public.work_order_reports where company_id='${CO}';
  delete from public.financial_entries where company_id='${CO}';
  delete from public.work_orders where company_id='${CO}';
  delete from public.clients where company_id='${CO}';
  delete from public.company_members where company_id='${CO}';
  delete from public.subscriptions where company_id='${CO}';
  delete from public.companies where id='${CO}';
  delete from public.profiles where id='${OWNER}';
  delete from auth.users where id='${OWNER}';
  set session_replication_role = origin;`);

before(() => {
  limpar();
  sql(`
    set session_replication_role = replica;
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ('00000000-0000-0000-0000-000000000000','${OWNER}','authenticated','authenticated','itg-owner@example.invalid','',now(),'{}','{}',now(),now());
    insert into public.profiles(id,full_name,email) values ('${OWNER}','ITG Owner','itg-owner@example.invalid');
    insert into public.companies(id,name,has_team) values ('${CO}','ITG Company',true);
    insert into public.subscriptions(company_id,status,current_period_start,current_period_end) values ('${CO}','active',current_date,current_date+30);
    insert into public.company_members(company_id,user_id,role,status) values ('${CO}','${OWNER}','owner','active');
    insert into public.clients(company_id,person_type,name,created_at)
      select '${CO}','PF','Cliente ITG '||g, now()-(g||' minutes')::interval from generate_series(1,${CLIENTES}) g;
    -- OS-alvo: 5 itens, criada por último (aparece no topo da lista).
    insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,created_by,created_at)
      select '${ALVO}','${CO}','ITG-ALVO',id,'${OWNER}','scheduled','${OWNER}',now() from public.clients where company_id='${CO}' order by created_at limit 1;
    insert into public.work_order_checklists(work_order_id,company_id,text,done,position,created_by)
      select '${ALVO}','${CO}','Item alvo '||g,false,g,'${OWNER}' from generate_series(0,4) g;
    -- 300 outras OS abertas com 4 itens cada.
    insert into public.work_orders(company_id,number,client_id,assigned_to,status,created_by,created_at)
      select '${CO}','ITG-'||g,(select id from public.clients where company_id='${CO}' order by created_at limit 1),'${OWNER}','unscheduled','${OWNER}',now()-(g||' minutes')::interval
      from generate_series(1,${OUTRAS_OS}) g;
    insert into public.work_order_checklists(work_order_id,company_id,text,done,position,created_by)
      select w.id,'${CO}','Item '||g,false,g,'${OWNER}' from public.work_orders w, generate_series(0,3) g
      where w.company_id='${CO}' and w.number like 'ITG-%' and w.id<>'${ALVO}';
    -- OS antiga concluída (fora da hidratação do login) com relato do técnico.
    insert into public.work_orders(id,company_id,number,client_id,assigned_to,status,created_by,created_at,completed_at)
      select '${ANTIGA}','${CO}','ITG-ANTIGA',id,'${OWNER}','done','${OWNER}',now()-interval '120 days',now()-interval '90 days' from public.clients where company_id='${CO}' order by created_at limit 1;
    insert into public.work_order_reports(work_order_id,company_id,entry_type,body,created_at)
      values ('${ANTIGA}','${CO}','report','Relato original do técnico',now()-interval '90 days');
    -- Financeiro: 1.100 despesas de R$ 1,00 e uma excluída (soft delete) de R$ 1.000,00.
    insert into public.financial_entries(company_id,kind,description,amount,due_date,paid,created_at)
      select '${CO}','expense','Despesa ITG '||g,1,current_date,false,now()-(g||' seconds')::interval from generate_series(1,${DESPESAS}) g;
    insert into public.financial_entries(company_id,kind,description,amount,due_date,paid,deleted_at)
      values ('${CO}','expense','Despesa excluída',1000,current_date,false,now());
    set session_replication_role = origin;`);
  assert.ok(Number(sql(`select count(*) from public.work_order_checklists where company_id='${CO}'`)) > 1000, 'cenário precisa de >1000 itens de checklist na empresa');
});

after(() => limpar());

let dados;
let hidratado;

test('carga da empresa traz todas as linhas, sem o corte de 1000', async () => {
  dados = await carregarDadosEmpresa(CO);
  assert.equal(dados.clientes.length, CLIENTES);
  assert.equal(dados.ordens.length, OUTRAS_OS + 2);
  assert.equal(dados.lancamentos.length, DESPESAS, 'lançamento excluído não entra e nenhum ativo fica de fora');
  assert.equal(dados.lancamentos.reduce((t, l) => t + l.valor, 0), DESPESAS);
});

test('OS com 5 itens continua com 5 itens mesmo quando existem >1000 itens em outras OS da mesma empresa', async () => {
  hidratado = await hidratarComplementosDB(dados, CO);
  const alvo = hidratado.ordens.find((o) => o.id === ALVO);
  assert.equal(alvo.complementosCarregados, true);
  assert.equal(alvo.checklist.length, 5, 'a tela recebe os 5 itens da OS');
  const outras = hidratado.ordens.filter((o) => o.id !== ALVO && o.id !== ANTIGA);
  assert.ok(outras.every((o) => o.checklist.length === 4), 'nenhuma outra OS chega incompleta');
  // Fluxo da tela: marcar o primeiro item.
  const checklist = alvo.checklist.map((k, i) => (i === 0 ? { ...k, feito: true } : k));
  const r = await persistirEdicaoOSDB({ ...alvo, checklist }, { checklist }, CO, OWNER, 'proprietario');
  assert.equal(r.checklist.length, 5);
  assert.equal(itensNoBanco(ALVO), 5);
  assert.equal(sql(`select count(*) from public.work_order_checklists where work_order_id='${ALVO}' and done`), '1');
});

test('atualizar 1 item não apaga os outros, mesmo com a tela mostrando a OS parcial', async () => {
  const completa = await carregarComplementosOSDB(dados.ordens.find((o) => o.id === ALVO), CO);
  assert.equal(completa.checklist.length, 5);
  // Simula a tela antiga/parcial: só 2 dos 5 itens chegaram.
  const parcial = completa.checklist.slice(0, 2).map((k, i) => (i === 1 ? { ...k, feito: true } : k));
  const r = await persistirEdicaoOSDB({ ...completa, checklist: parcial }, { checklist: parcial }, CO, OWNER, 'proprietario');
  assert.equal(itensNoBanco(ALVO), 5, 'ausência na tela não é exclusão');
  assert.equal(r.checklist.length, 5, 'a resposta devolve a OS completa');
  assert.equal(sql(`select count(*) from public.work_order_checklists where work_order_id='${ALVO}' and done`), '2');
  assert.equal(sql(`select string_agg(text, '|' order by position) from public.work_order_checklists where work_order_id='${ALVO}'`),
    'Item alvo 0|Item alvo 1|Item alvo 2|Item alvo 3|Item alvo 4', 'nenhum texto foi sobrescrito por posição');
});

test('item novo entra uma vez só, mesmo com reenvio, e não toma o lugar de item oculto', async () => {
  const completa = await carregarComplementosOSDB(dados.ordens.find((o) => o.id === ALVO), CO);
  const parcial = [completa.checklist[0], { id: 'local-novo-1', texto: 'Conferir dreno', feito: false }];
  await persistirEdicaoOSDB({ ...completa, checklist: parcial }, { checklist: parcial }, CO, OWNER, 'proprietario');
  await persistirEdicaoOSDB({ ...completa, checklist: parcial }, { checklist: parcial }, CO, OWNER, 'proprietario');
  assert.equal(itensNoBanco(ALVO), 6);
  assert.equal(sql(`select count(*) from public.work_order_checklists where work_order_id='${ALVO}' and text='Conferir dreno'`), '1');
  assert.equal(sql(`select count(*) from public.work_order_checklists where work_order_id='${ALVO}' and text like 'Item alvo %'`), '5');
});

test('relato que chegou depois do login (ou de outro autor) nunca é sobrescrito nem perde o texto digitado', async () => {
  const aberta = hidratado.ordens.find((o) => o.numero === 'ITG-1');
  assert.equal(aberta.complementosCarregados, true);
  assert.equal(aberta.relato, '');
  // O técnico escreve depois que o dono abriu o app (linha de outro autor).
  sql(`set session_replication_role = replica; insert into public.work_order_reports(work_order_id,company_id,entry_type,body) values ('${aberta.id}','${CO}','report','Relato do técnico, escrito depois'); set session_replication_role = origin;`);
  await persistirEdicaoOSDB({ ...aberta, relato: 'Texto do dono' }, { relato: 'Texto do dono' }, CO, OWNER, 'proprietario');
  assert.equal(sql(`select count(*) from public.work_order_reports where work_order_id='${aberta.id}' and body='Relato do técnico, escrito depois'`), '1', 'o texto do técnico continua no banco');
  await persistirEdicaoOSDB({ ...aberta, relato: 'Texto final do dono' }, { relato: 'Texto final do dono' }, CO, OWNER, 'proprietario');
  assert.equal(sql(`select count(*) from public.work_order_reports where work_order_id='${aberta.id}' and entry_type='report'`), '2', 'a segunda digitação atualiza o relato do dono, não cria outro');
  const relida = mesclarComplementosOS(aberta, await carregarComplementosOSDB(aberta, CO));
  assert.equal(relida.relato, 'Texto final do dono');
  // Relido, o relato do dono é o conhecido: a próxima edição atualiza a mesma linha.
  await persistirEdicaoOSDB({ ...relida, relato: 'Texto revisado' }, { relato: 'Texto revisado' }, CO, OWNER, 'proprietario');
  assert.equal(sql(`select count(*) from public.work_order_reports where work_order_id='${aberta.id}' and entry_type='report'`), '2');
});

test('OS encerrada: o relato não é alterado e o usuário recebe aviso (antes o texto sumia em silêncio)', async () => {
  const antiga = hidratado.ordens.find((o) => o.id === ANTIGA);
  assert.equal(antiga.complementosCarregados, false, 'OS concluída há 90 dias não entra na carga do login');
  await assert.rejects(
    persistirEdicaoOSDB({ ...antiga, relato: 'Tentativa' }, { relato: 'Tentativa' }, CO, OWNER, 'proprietario'),
    /encerrada/,
  );
  assert.equal(sql(`select string_agg(body,'|') from public.work_order_reports where work_order_id='${ANTIGA}'`), 'Relato original do técnico');
  // Ao abrir a OS antiga, os complementos chegam inteiros.
  const aberta = mesclarComplementosOS(antiga, await carregarComplementosOSDB(antiga, CO));
  assert.equal(aberta.relato, 'Relato original do técnico');
});

test('Financeiro V2 soma todos os lançamentos ativos e ignora excluídos', async () => {
  const fin = await carregarFinanceiroV2DB(CO);
  assert.equal(fin.lancamentos.length, DESPESAS);
  assert.equal(fin.lancamentos.reduce((t, l) => t + l.valor, 0), DESPESAS);
  assert.ok(fin.lancamentos.every((l) => l.descricao !== 'Despesa excluída'));
});
