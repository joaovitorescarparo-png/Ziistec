/* Registrar serviço realizado — contrato do fluxo retroativo.
 *
 * O botão novo vive ao lado de "+ Nova OS", é do proprietário e depende do banco.
 * O resultado é uma OS normal: nenhuma aba, menu, módulo, tabela paralela nem
 * coluna de marcação nasce para isso. A data do serviço é histórica, a data do
 * registro é o created_at que o banco preenche, e a baixa de estoque passa pelo
 * fluxo oficial — sem criar um segundo recebível. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const app = read('src/legacy/ZiisTecApp.jsx');
const dataApi = read('src/lib/dataApi.js');
const migration = read('supabase/0117_retroactive_service_registration.sql');
const semComentariosSql = (sql) => sql.replace(/--.*$/gm, '');

test('o botão fica na tela de ordens, ao lado de Nova OS, só para o proprietário com banco', () => {
  const cabecalho = app.slice(app.indexOf('title={soMinhas ? "Minhas ordens de serviço"'));
  const acao = cabecalho.slice(0, cabecalho.indexOf('<Tabs'));
  assert.match(acao, /<Btn icon=\{Plus\} onClick=\{\(\) => setCriando\(true\)\}>Nova OS<\/Btn>/,
    'o botão de Nova OS continua onde estava');
  assert.match(acao, /podeRegistrarRealizado && \([\s\S]*Registrar serviço realizado/,
    'o segundo botão fica no mesmo cabeçalho, atrás da permissão');
  assert.match(app, /const podeRegistrarRealizado = real && papel === "proprietario";/,
    'proprietário e sessão real: o técnico não vê o botão e o simulador não registra');
  assert.match(app, /\{registrando && podeRegistrarRealizado && <RegistrarServicoRealizado \{\.\.\.p\} onClose=/,
    'o formulário também é fechado pela mesma permissão, não só o botão');
});

test('nada novo aparece no menu, nas abas ou como módulo', () => {
  // O menu e as abas da tela de ordens seguem exatamente os mesmos.
  const abas = app.slice(app.indexOf('opcoes={[{ id: "dia", label: "Meu dia" }'));
  assert.match(abas.slice(0, 200), /\{ id: "concluidas", label: "Concluídas" \}\]\}/);
  assert.equal(/id: "retroativo"|label: "Serviços realizados"|label: "Registros"/.test(app), false,
    'nenhuma aba nova na tela de ordens');
  const nav = app.slice(app.indexOf('const NAV ='), app.indexOf('const NAV =') + 2000);
  assert.equal(/Registrar serviço realizado/.test(nav), false, 'o menu não ganha entrada nova');
  // Fora dos comentários, o rótulo aparece só duas vezes: o botão e o título do
  // formulário. Nada de entrada extra escondida em outra tela.
  const semComentarios = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((semComentarios.match(/Registrar serviço realizado/g) || []).length, 2,
    'o rótulo aparece no botão e no título do formulário, e em nenhum outro lugar');
  assert.ok(semComentarios.includes('>Registrar serviço realizado</Btn>')
    && semComentarios.includes('title="Registrar serviço realizado"'));
});

test('o formulário pede o que aconteceu e recusa data futura antes de salvar', () => {
  const inicio = app.indexOf('function RegistrarServicoRealizado(');
  assert.ok(inicio > 0, 'o formulário existe');
  const form = app.slice(inicio, app.indexOf('function OSDetalhe(p) {'));
  for (const campo of ['Cliente', 'Data do serviço', 'Horário (opcional)', 'O que foi feito?',
    'Endereço do atendimento', 'Local do serviço', 'Materiais utilizados (opcional)', 'Situação do pagamento']) {
    assert.ok(form.includes(campo), `o formulário tem o campo ${campo}`);
  }
  assert.match(form, /<Btn variant="soft" icon=\{Plus\} onClick=\{\(\) => setNovoCliente\(true\)\}/,
    'cadastro rápido de cliente é reaproveitado, não reescrito');
  assert.ok(form.includes('<ClienteRapido aberto={novoCliente}'), 'reusa o ClienteRapido existente');
  assert.ok(form.includes('<QuoteClientLocationField clientId={f.clienteId}'), 'reusa o local cadastrado do cliente');
  assert.ok(form.includes('itemServico(x, 1)') && form.includes('itemProduto(x, 1)'), 'reusa o catálogo existente');
  // data futura: barrada na interface e sinalizada ao proprietário
  assert.match(form, /const dataFutura = Boolean\(f\.data\) && f\.data > hoje;/);
  assert.match(form, /<Input type="date" max=\{hoje\} value=\{f\.data\}/, 'o seletor não oferece data futura');
  assert.ok(form.includes('A data do serviço não pode ser futura.'));
  assert.match(form, /const pronto = [^;]*!dataFutura/s, 'sem data válida o botão não salva');
  // orçamento não é exigido
  assert.equal(/orcamentoId/.test(form), false, 'serviço já realizado não depende de orçamento');
  // mesmo pedido em toda tentativa
  assert.match(form, /requestIdRef\.current = globalThis\.crypto\.randomUUID\(\);/);
  assert.match(form, /\.\.\.f, requestId: requestIdRef\.current,/, 'o retry reaproveita o mesmo pedido');
  assert.equal(/custo|margem|fornecedor/i.test(form.replace(/custo: pr\.custo|custo: m\.custo/g, '')), false,
    'o formulário não expõe custo, margem nem fornecedor fora do material do proprietário');
});

test('"Registrado posteriormente" é derivado, sem coluna nova', () => {
  assert.match(app, /\{os\.registradoEm && os\.data && os\.registradoEm > os\.data && \(/,
    'a marca sai da comparação entre a data do serviço e a do registro');
  assert.ok(app.includes('Registrado posteriormente · '));
  assert.match(dataApi, /registradoEm:x\.created_at\?dataLocalISO\(x\.created_at\):''/,
    'a data do registro é o created_at, lido no dia local');
  assert.equal(/registered_later|is_retroactive|retroactive_at/.test(dataApi + app + migration), false,
    'nenhuma coluna de marcação em lugar nenhum');
});

test('a camada de dados chama a RPC oficial e nunca manda a empresa no corpo', () => {
  const inicio = dataApi.indexOf('export async function registrarServicoRealizadoDB(');
  assert.ok(inicio > 0);
  const fn = dataApi.slice(inicio, dataApi.indexOf('export async function atualizarOSDB('));
  assert.match(fn, /supabase\.rpc\('zt_register_completed_work_order',\{/);
  assert.match(fn, /p_company:companyId, p_request:req/, 'a empresa vai no argumento validado pela RPC');
  const row = fn.slice(fn.indexOf('const row={'), fn.indexOf('const items='));
  assert.equal(/company_id/.test(row), false, 'o corpo enviado pelo navegador não carrega company_id');
  assert.equal(/created_at|completed_at|number/.test(row), false,
    'o navegador não escolhe data de registro, conclusão nem número');
  assert.match(fn, /service_date:x\.data\|\|null/);
  assert.match(fn, /const req=ensureRequestId\(x\);/);
  assert.match(fn, /idempotentWrite\(/, 'usa o mesmo caminho idempotente dos outros salvamentos');
  assert.match(fn, /status:'paid', method:x\.forma\|\|null, paid_at:x\.pagoEm\|\|x\.data\|\|null/);
  assert.match(fn, /status:'pending', due_days:7/, 'pendente conta os mesmos 7 dias da finalização normal');
  // nenhuma escrita direta em tabela por este fluxo
  assert.equal(/from\('work_orders'\)\.insert|from\('financial_entries'\)\.insert|from\('inventory_movements'\)/.test(fn), false,
    'nada de INSERT bruto fora do fluxo oficial');
});

test('a 0117 é a última migration, acrescenta só a RPC e não redefine o fluxo normal', () => {
  const migrations = readdirSync(path.join(root, 'supabase')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  assert.equal(migrations.at(-1), '0117_retroactive_service_registration.sql');
  assert.equal(migrations.filter((f) => f.startsWith('0117')).length, 1, 'número não reaproveitado');
  const sql = semComentariosSql(migration);
  assert.equal((sql.match(/create or replace function/g) || []).length, 1,
    'a 0117 cria uma função e não redefine nenhuma existente');
  assert.match(sql, /create or replace function public\.zt_register_completed_work_order\(/);
  assert.equal(/\b(create|alter|drop)\s+table\b|create\s+policy|alter\s+policy|drop\s+policy|add\s+column/i.test(sql), false,
    'nenhuma tabela, coluna ou policy nova');
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /set search_path=''/);
  assert.match(sql, /revoke all on function public\.zt_register_completed_work_order\([^)]*\) from public,anon;/);
});

test('a RPC é do proprietário, idempotente, e respeita data real, estoque e financeiro', () => {
  const sql = semComentariosSql(migration);
  // autoridade
  assert.match(sql, /if not public\.zt_is_owner\(p_company\) then/);
  assert.match(sql, /errcode='42501'/);
  assert.match(sql, /perform zt_private\.assert_operational_write_allowed\(p_company\);/);
  assert.match(sql, /if p_request is null then[\s\S]{0,120}errcode='22023'/);
  // replay pelo mesmo pedido, antes de qualquer escrita
  const corpo = sql.slice(sql.indexOf('begin'));
  const posReplay = corpo.indexOf("where company_id=p_company and client_request_id=p_request");
  const posPrimeiraEscrita = corpo.indexOf('zt_private.zt_save_work_order_idempotent');
  assert.ok(posReplay > 0 && posReplay < posPrimeiraEscrita, 'o replay vem antes de criar qualquer coisa');
  assert.match(sql, /'replayed', true/);
  // data: futuro recusado, histórico preservado, created_at intocado
  assert.match(sql, /if v_service_date > \(now\(\) at time zone 'America\/Sao_Paulo'\)::date then/);
  assert.match(sql, /set completed_at = v_completed_at/);
  assert.equal(/set[\s\S]{0,200}created_at\s*=/.test(sql), false, 'created_at nunca é escrito');
  assert.equal(/toISOString|at time zone 'UTC'/.test(sql), false, 'o dia do produto é o de São Paulo');
  // garantia e vencimento contam da data real do serviço
  assert.match(sql, /set starts_on = v_service_date,\s*ends_on = v_service_date \+ \(ends_on - starts_on\)/);
  assert.match(sql, /set due_date = coalesce\(v_due_date, v_service_date \+ v_due_days\)/);
  // estoque: fluxo oficial, só para quem controla, com pedido derivado do registro
  assert.match(sql, /public\.zt_adjust_product_stock\(/);
  assert.equal(/zt_sell_product_on_work_order/.test(sql), false,
    'a venda em campo criaria um segundo recebível junto do faturamento da OS');
  assert.match(sql, /if not coalesce\(v_track,false\) then continue; end if;/);
  assert.match(sql, /v_stock_request := md5\(p_request::text\|\|':'\|\|v_product::text\)::uuid;/);
  // financeiro: marca o lançamento existente, nunca cria um segundo
  assert.match(sql, /update public\.financial_entries\s*set paid = true,/);
  assert.equal(/insert into public\.financial_entries/.test(sql), false,
    'a cobrança é a que a conclusão oficial criou');
  // conclusão pelo fluxo oficial, com o histórico distinguindo as duas datas
  assert.match(sql, /v_billing := zt_private\.zt_complete_work_order\(v_wo, v_report, null, v_extra_cost, v_due_days\);/);
  assert.match(sql, /insert into public\.work_order_reports\([^)]*\)/);
  assert.ok(sql.includes("'Serviço realizado em '") && sql.includes("' · registrado no sistema em '"));
});

test('a regressão SQL/RLS do fluxo entra no gate oficial', () => {
  const runner = read('scripts/run-sql-rls-ci.sh');
  assert.ok(runner.includes('supabase/tests/v2_retroactive_service_rollback.sql'));
  const teste = read('supabase/tests/v2_retroactive_service_rollback.sql');
  assert.match(teste, /rollback;\s*$/, 'o teste termina em rollback');
  for (const cenario of ['hoje_registra', 'passado_data_servico_historica', 'passado_created_at_nao_falsificado',
    'futuro_recusado', 'passado_em_concluidas', 'passado_cliente_correto', 'passado_responsavel_correto',
    'passado_servicos_persistem', 'passado_materiais_persistem', 'passado_estoque_um_movimento',
    'passado_financeiro_pendente', 'pago_marca_lancamento', 'retry_nao_duplica_os',
    'retry_nao_duplica_estoque', 'retry_nao_duplica_financeiro', 'tecnico_nao_registra',
    'owner_b_nao_alcanca_empresa_a', 'nova_os_normal_funciona', 'finalizacao_normal_funciona',
    'passado_garantia_na_data_do_servico', 'estoque_insuficiente_nao_deixa_os']) {
    assert.ok(teste.includes(`'${cenario}'`), `o cenário ${cenario} é verificado`);
  }
});
