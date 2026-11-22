/* Serviços (Operations Simple V2) — a tela tem de se explicar sozinha.
 *
 * O teste cobre duas coisas diferentes:
 *   1. as derivações, como funções puras: contagens do topo, estado da pessoa,
 *      próximo atendimento e as palavras do atraso;
 *   2. o contrato da tela: as ações aparecem com o nome do que fazem, nada de
 *      vocabulário de ERP, nenhuma tabela ou página nova, nada de financeiro.
 *
 * Cenário de referência: prestador de 27 anos, mais celular que computador, que
 * nunca usou sistema de gestão. Se a tela precisa de treinamento, falhou.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ATALHOS, FILTROS, PRIORIDADES, SEM_RESPONSAVEL,
  estadoDoTecnico, montarColunas, nomeDoResponsavel, pessoasParaEscolher,
  proximoAtendimento, resumoDoDia, somarDias, textoDoAtraso, textoDoQuando,
} from '../../src/lib/operationsBoard.js';

const read = (p) => readFileSync(p, 'utf8');
const semComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* O que o usuário realmente lê: texto do JSX, rótulos, avisos e mensagens.
   Nome de campo do banco (assignee_id vem do contrato de zt_operations_board)
   não é texto de tela, e comentário de código ninguém lê no celular. */
const textoVisivel = (src) => {
  const limpo = semComentarios(src);
  const partes = [];
  // Só nó de texto de uma linha: as setas `=>` do código também produzem ">",
  // e sem o corte por linha a varredura atravessaria o próprio código.
  for (const m of limpo.matchAll(/>\s*([^<>\n]+?)\s*</g)) partes.push(m[1]);
  for (const m of limpo.matchAll(/'([^'\n]{2,})'/g)) partes.push(m[1]);
  for (const m of limpo.matchAll(/`([^`\n]{2,})`/g)) partes.push(m[1]);
  for (const m of limpo.matchAll(/"([^"\n]{2,})"/g)) partes.push(m[1]);
  return partes.join(' | ');
};
const tela = read('src/components/OperationsBoard.jsx');
const regras = read('src/lib/operationsBoard.js');
const api = read('src/lib/operationsApi.js');
const pkg = JSON.parse(read('package.json'));

const HOJE = '2026-11-22';
const AMANHA = somarDias(HOJE, 1);
const ONTEM = somarDias(HOJE, -1);

const OWNER = '00000000-0000-0000-0000-00000000own1';
const TEC_A = '00000000-0000-0000-0000-00000000tec1';
const TEC_B = '00000000-0000-0000-0000-00000000tec2';

const card = (o = {}) => ({
  work_order_id: o.id || 'wo1',
  number: o.number || 'OS-0001',
  client_name: o.client_name || 'Condomínio Plaza',
  location_name: o.location_name || 'Garagem / Portão principal',
  summary: o.summary || 'Portão da garagem não fecha',
  scheduled_date: o.scheduled_date === undefined ? HOJE : o.scheduled_date,
  scheduled_time: o.scheduled_time === undefined ? '14:00' : o.scheduled_time,
  status: o.status || 'scheduled',
  priority: o.priority || 'normal',
  assignee_id: o.assignee_id === undefined ? TEC_A : o.assignee_id,
});

const boardDe = (cards) => ({
  members: [
    { user_id: OWNER, name: 'João', role: 'owner', job_title: '' },
    { user_id: TEC_A, name: 'Carlos', role: 'technician', job_title: 'Instalador' },
    { user_id: TEC_B, name: 'Mateus', role: 'technician', job_title: '' },
  ],
  cards,
});

// ─────────────────────────── 1. o gate oficial cobre a Operations

test('1: os testes da Operations V1 rodam no verify:v2', () => {
  const v2 = pkg.scripts['verify:v2'];
  assert.ok(v2.includes('tests/blockers/operations_board_contract.test.mjs'),
    'o contrato do quadro precisa rodar no gate');
  assert.ok(v2.includes('tests/blockers/operations_command_engine.test.mjs'),
    'o motor de comandos precisa rodar no gate');
  // 24: o registro retroativo continua no mesmo gate.
  assert.ok(v2.includes('tests/blockers/retroactive_service_contract.test.mjs'));
  assert.ok(v2.includes('tests/blockers/operations_simple_v2.test.mjs'),
    'esta rodada também entra no gate');
});

// ─────────────────────────── 2. topo

test('2: o topo conta Hoje, Sem responsável, Atrasados e Próximos', () => {
  const b = boardDe([
    card({ id: 'hoje1', scheduled_date: HOJE }),
    card({ id: 'hoje2', scheduled_date: HOJE, assignee_id: null }),
    card({ id: 'atrasado', scheduled_date: ONTEM }),
    card({ id: 'amanha', scheduled_date: AMANHA }),
    card({ id: 'semana', scheduled_date: somarDias(HOJE, 3) }),
    card({ id: 'semresp', scheduled_date: null, status: 'unscheduled', assignee_id: null }),
    card({ id: 'feita', scheduled_date: HOJE, status: 'done' }),
  ]);
  const r = resumoDoDia(b, HOJE);
  assert.equal(r.hoje, 2, 'hoje não conta a concluída');
  assert.equal(r.semResponsavel, 2);
  assert.equal(r.atrasados, 1);
  assert.equal(r.proximos, 2, 'próximos é o que vem depois de hoje');

  // Os quatro atalhos existem, nessa ordem, e cada um reaproveita um filtro
  // que já existia: tocar filtra a própria tela, não abre outra aba.
  assert.deepEqual(ATALHOS.map((a) => a.label), ['Hoje', 'Sem responsável', 'Atrasados', 'Próximos']);
  assert.deepEqual(ATALHOS.map((a) => a.id), ['hoje', 'semresponsavel', 'atrasadas', 'semana']);
  for (const a of ATALHOS) {
    assert.ok(FILTROS.some((f) => f.id === a.id), `${a.id} é um filtro que já existe`);
    assert.ok(a.contador in r, `${a.id} tem contador derivado`);
  }
  assert.ok(tela.includes('ATALHOS.map'), 'o topo desenha os atalhos');
  assert.match(tela, /setFiltro\(ativo \? 'semana' : a\.id\)/, 'o atalho só filtra esta tela');
});

test('2b: a contagem sai do que o banco já devolveu, sem consulta por cartão', () => {
  // resumoDoDia e estadoDoTecnico recebem o board inteiro: nenhuma chamada nova.
  assert.doesNotMatch(regras, /supabase|rpc\(|fetch\(/, 'as regras não falam com o banco');
  const chamadas = (tela.match(/carregarQuadroOperacoes\(/g) || []).length;
  assert.equal(chamadas, 1, 'o quadro é pedido num lugar só');
  assert.match(tela, /useMemo\(\s*\(\) => resumoDoDia\(board, hojeISO\)/, 'contagem derivada e memoizada');
});

// ─────────────────────────── 3 e 4. sem responsável

test('3: serviço sem responsável tem bloco próprio, não some em coluna', () => {
  const b = boardDe([
    card({ id: 'orfao', assignee_id: null }),
    card({ id: 'comdono', assignee_id: TEC_A }),
  ]);
  const colunas = montarColunas(b, { hoje: HOJE });
  assert.equal(colunas[0].id, SEM_RESPONSAVEL);
  assert.equal(colunas[0].carga, 1);
  assert.match(tela, /aria-label="Precisa organizar"/);
  assert.ok(tela.includes('Precisa organizar'));
  assert.ok(tela.includes('sem responsável'), 'o bloco diz quantos estão sem responsável');
  // o bloco é renderizado fora da grade de pessoas
  assert.ok(tela.indexOf('aria-label="Precisa organizar"') < tela.indexOf('pessoas.map'),
    'o que precisa organizar vem antes do dia de cada pessoa');
});

test('4: sem técnico, o cartão mostra uma ação — não um campo vazio', () => {
  assert.ok(tela.includes('Escolher quem vai fazer'), 'a falta de técnico é um botão');
  assert.ok(tela.includes('Escolher técnico'), 'quando já tem técnico, dá para trocar');
  assert.equal(nomeDoResponsavel(boardDe([]), null, OWNER), '', 'sem responsável não inventa nome');
  assert.equal(nomeDoResponsavel(boardDe([]), TEC_A, OWNER), 'Carlos');
  assert.equal(nomeDoResponsavel(boardDe([]), 'quem-saiu', OWNER), 'Colaborador inativo');
});

// ─────────────────────────── 5, 6, 7, 8, 9. quem vai fazer

test('5 e 6: "Quem vai fazer?" lista uma pessoa por linha e marca o proprietário como Você', () => {
  const b = boardDe([card({ id: 'x', assignee_id: TEC_A })]);
  const pessoas = pessoasParaEscolher(b, { hoje: HOJE, agora: '08:00', usuarioAtualId: OWNER, card: card({ id: 'novo', assignee_id: null }) });
  assert.equal(pessoas.length, 3);
  assert.equal(pessoas[0].nome, 'João — Você', 'o proprietário aparece como Você');
  assert.equal(pessoas[0].ehVoce, true);
  assert.equal(pessoas[1].nome, 'Carlos');
  assert.equal(pessoas[1].ehVoce, false);
  assert.ok(tela.includes('Quem vai fazer?'));
  // 6: o proprietário também é marcado no dia dele
  assert.match(tela, /ehVoce \? <Pill[\s\S]{0,120}Você<\/Pill>/);
});

test('7 e 8: cada pessoa mostra a quantidade de hoje e o próximo atendimento', () => {
  const cards = [
    card({ id: 'a', assignee_id: TEC_A, scheduled_time: '09:00' }),
    card({ id: 'b', assignee_id: TEC_A, scheduled_time: '15:00' }),
    card({ id: 'c', assignee_id: TEC_A, scheduled_date: AMANHA, scheduled_time: '08:00' }),
    card({ id: 'd', assignee_id: TEC_B, scheduled_date: null, scheduled_time: null, status: 'unscheduled' }),
  ];
  const a = estadoDoTecnico(cards, TEC_A, { hoje: HOJE, agora: '10:00' });
  assert.equal(a.servicosHoje, 2, 'conta só hoje');
  assert.equal(a.proximo.work_order_id, 'b', 'o próximo é o primeiro a partir de agora');
  assert.equal(a.texto, 'Próximo: 15:00');

  const b = estadoDoTecnico(cards, TEC_B, { hoje: HOJE, agora: '10:00' });
  assert.equal(b.servicosHoje, 0);
  assert.equal(b.texto, 'Sem serviço hoje');

  // depois do último horário do dia não há próximo, e aí sim pode dizer livre
  const depois = estadoDoTecnico(cards, TEC_A, { hoje: HOJE, agora: '18:00' });
  assert.equal(depois.proximo, null);
  assert.equal(depois.texto, 'Livre agora');

  // em atendimento vem antes de qualquer previsão
  const andando = estadoDoTecnico(
    [card({ id: 'e', assignee_id: TEC_A, status: 'in_progress' })], TEC_A, { hoje: HOJE, agora: '10:00' },
  );
  assert.equal(andando.texto, 'Em atendimento');

  // o sistema não afirma que alguém está livre quando não sabe o horário
  const semHora = estadoDoTecnico(
    [card({ id: 'f', assignee_id: TEC_A, scheduled_time: null })], TEC_A, { hoje: HOJE, agora: '10:00' },
  );
  assert.equal(semHora.texto, 'Hoje sem horário');
  assert.notEqual(semHora.texto, 'Livre agora');

  // nada de duração, trânsito ou estimativa
  assert.doesNotMatch(semComentarios(regras), /duracao|duração|transito|trânsito|estimativa/i,
    'nenhum cálculo de duração, trânsito ou estimativa nas regras');
  assert.ok(tela.includes('estadoDoTecnico'), 'a tela usa o estado derivado');
});

test('8b: próximo atendimento ignora serviço sem hora e serviço de outro dia', () => {
  const cards = [
    card({ id: 'semhora', assignee_id: TEC_A, scheduled_time: null }),
    card({ id: 'amanha', assignee_id: TEC_A, scheduled_date: AMANHA, scheduled_time: '07:00' }),
    card({ id: 'hoje', assignee_id: TEC_A, scheduled_time: '16:00' }),
    card({ id: 'feito', assignee_id: TEC_A, scheduled_time: '17:00', status: 'done' }),
  ];
  const p = proximoAtendimento(cards, TEC_A, { hoje: HOJE, agora: '10:00' });
  assert.equal(p.work_order_id, 'hoje');
});

test('9: choque de horário é aviso, nunca bloqueio', () => {
  const ocupado = card({ id: 'ja', assignee_id: TEC_A, scheduled_date: HOJE, scheduled_time: '14:00' });
  const novo = card({ id: 'novo', assignee_id: null, scheduled_date: HOJE, scheduled_time: '14:00' });
  const pessoas = pessoasParaEscolher(boardDe([ocupado, novo]), { hoje: HOJE, usuarioAtualId: OWNER, card: novo });
  const carlos = pessoas.find((p) => p.id === TEC_A);
  assert.equal(carlos.choque, 1, 'o choque é contado para quem já tem o horário');
  assert.equal(pessoas.find((p) => p.id === TEC_B).choque, 0);
  assert.ok(tela.includes('Já tem serviço neste horário'), 'o aviso é em português simples');
  // o botão da pessoa com choque continua clicável: quem decide é o proprietário
  assert.match(tela, /disabled=\{p\.atual\}/, 'só a pessoa que já é responsável fica desabilitada');
  assert.ok(tela.includes('Escolher mesmo assim'));
});

// ─────────────────────────── 10, 11, 12. as três operações

test('10, 11 e 12: atribuir, reagendar e mudar prioridade passam pelas RPCs oficiais', () => {
  assert.match(api, /rpc\('zt_assign_work_order'/);
  assert.match(api, /rpc\('zt_schedule_work_order'/);
  assert.match(api, /rpc\('zt_set_work_order_priority'/);
  // a tela usa as três — antes desta rodada o reagendamento existia na API e
  // não tinha caminho na tela: o proprietário só conseguia pela OS inteira.
  assert.ok(tela.includes('atribuirOSDB('), 'atribuição');
  assert.ok(tela.includes('agendarOSOperacoesDB('), 'reagendamento');
  assert.ok(tela.includes('definirPrioridadeOSDB('), 'prioridade');
  // nenhuma escrita direta em tabela a partir da tela
  assert.doesNotMatch(tela, /from\('work_orders'\)|\.update\(|\.insert\(/);
  // e só chama o que mudou
  assert.match(tela, /if \(mudouData\) await agendarOSOperacoesDB/);
  assert.match(tela, /if \(mudouResp\) await atribuirOSDB/);
  assert.match(tela, /if \(mudouPrio\) await definirPrioridadeOSDB/);
});

test('12b: prioridade tem três estados e Normal não precisa aparecer', () => {
  assert.deepEqual(PRIORIDADES.map((p) => p.id), ['normal', 'high', 'urgent']);
  assert.ok(tela.includes("ROTULO_PRIORIDADE = { urgent: 'URGENTE', high: 'ALTA' }"),
    'só alta e urgente ganham rótulo forte');
  assert.match(tela, /card\.priority !== 'normal' \? card\.priority : null/,
    'normal não desenha etiqueta');
});

// ─────────────────────────── 13. atraso óbvio

test('13: atraso aparece em palavras do dia a dia', () => {
  assert.equal(textoDoAtraso(card({ scheduled_date: ONTEM }), HOJE), 'Atrasado desde ontem');
  assert.equal(
    textoDoAtraso(card({ scheduled_date: somarDias(HOJE, -3), scheduled_time: '09:00' }), HOJE),
    'Era para 09:00 de 19/11',
  );
  assert.equal(
    textoDoAtraso(card({ scheduled_date: somarDias(HOJE, -3), scheduled_time: null }), HOJE),
    'Atrasado desde 19/11',
  );
  assert.equal(textoDoAtraso(card({ scheduled_date: HOJE }), HOJE), '', 'hoje não é atraso');
  assert.equal(textoDoAtraso(card({ scheduled_date: ONTEM, status: 'done' }), HOJE), '', 'concluída não atrasa');
  assert.ok(tela.includes('ATRASADO'), 'a etiqueta é direta');
  assert.ok(tela.includes('textoDoAtraso'), 'e vem acompanhada do motivo');
});

test('13b: "quando" é lido como as pessoas falam', () => {
  assert.equal(textoDoQuando(card({ scheduled_date: HOJE, scheduled_time: '14:00' }), HOJE), 'Hoje · 14:00');
  assert.equal(textoDoQuando(card({ scheduled_date: AMANHA, scheduled_time: '09:00' }), HOJE), 'Amanhã · 09:00');
  assert.equal(textoDoQuando(card({ scheduled_date: ONTEM, scheduled_time: null }), HOJE), 'Ontem');
  assert.equal(textoDoQuando(card({ scheduled_date: somarDias(HOJE, 5), scheduled_time: '08:30' }), HOJE), '27/11 · 08:30');
  assert.equal(textoDoQuando(card({ scheduled_date: null }), HOJE), 'Sem data');
});

// ─────────────────────────── 14, 15, 16, 17, 18. novo serviço

test('14: "Novo serviço" é o nome do botão, e o cadastro é curto', () => {
  assert.ok(tela.includes('Novo serviço'));
  for (const proibido of ['Quick Dispatch', 'Serviço Express', 'Dispatch rápido', 'Despacho rápido']) {
    assert.equal(tela.includes(proibido), false, `${proibido} não é linguagem do usuário`);
  }
  // os campos pedidos, e só eles
  for (const campo of ['Cliente', 'O que precisa ser feito?', 'Qual dia?', 'Que horas?',
    'Quem vai fazer?', 'Local', 'Prioridade', 'Criar serviço']) {
    assert.ok(tela.includes(campo), `o cadastro curto tem ${campo}`);
  }
});

test('15: cliente novo é cadastrado sem sair da tela', () => {
  assert.ok(tela.includes('Novo cliente'));
  assert.ok(tela.includes('Cadastrar cliente'));
  assert.match(tela, /salvarCliente\(\{/, 'usa o mesmo salvamento de cliente do produto');
  assert.match(tela, /if \(id\) \{ set\('clienteId', id\); setNovoCliente\(null\); \}/,
    'depois de salvar, o cliente novo já fica escolhido');
  // nada de mandar o usuário para outra página
  assert.doesNotMatch(tela, /setTela\(|irPara\(|window\.location/);
});

test('16 e 17: a descrição livre basta, e o resultado é uma OS normal', () => {
  // catálogo não é obrigatório para criar
  assert.match(tela, /const pronto = Boolean\(f\.clienteId\) && f\.descricao\.trim\(\)\.length > 0/,
    'cliente e descrição livre já bastam');
  assert.match(tela, /itens: \[\], checklist: \[\]/, 'sem item de catálogo obrigatório');
  assert.ok(tela.includes('Escolher serviço do catálogo é opcional'));
  // voz reaproveitada do produto, com texto digitado como alternativa
  assert.match(tela, /CampoVoz \?/, 'usa o campo de voz que já existe');
  assert.ok(tela.includes('<textarea'), 'e funciona sem voz também');
  // 17: cria pelo mesmo caminho da tela de ordens
  assert.match(tela, /await salvarOS\(\{/);
  assert.match(tela, /requestId: pedido\.current/, 'retry não cria duas OS');
});

test('18: nenhuma entidade, tabela ou página nova', () => {
  assert.doesNotMatch(tela, /dispatch_jobs|quick_services|service_queue|operations_items/);
  const legado = read('src/legacy/ZiisTecApp.jsx');
  // a Central continua sendo uma tela só na navegação
  const navOperacoes = (legado.match(/id: "operacoes"/g) || []).length;
  assert.equal(navOperacoes, 1, 'uma entrada de menu, não várias');
  const nav = legado.slice(legado.indexOf('const NAV = ['), legado.indexOf('const NAV_MOBILE'));
  for (const nova of ['despacho', 'tecnicos', 'servicos-rapidos', 'agenda2', 'operacoes2']) {
    assert.equal(nav.includes(`id: "${nova}"`), false, `o menu não ganhou a tela "${nova}"`);
  }
  assert.equal((nav.match(/id: "/g) || []).length, 14, 'o menu continua com as mesmas 14 entradas');
  // e o componente é o mesmo arquivo, não um segundo quadro
  assert.equal((legado.match(/<OperationsBoard/g) || []).length, 1);
});

// ─────────────────────────── 19, 20. toque primeiro

test('19: no celular tudo funciona sem arraste', () => {
  // toda ação tem botão: escolher técnico, alterar, abrir
  for (const acao of ['Escolher quem vai fazer', 'Escolher técnico', 'Alterar', 'Abrir serviço']) {
    assert.ok(tela.includes(acao), `${acao} é um botão`);
  }
  // o arraste continua, mas como atalho: o que decide é a mesma função
  assert.ok(tela.includes('draggable='), 'o arraste do computador foi preservado');
  assert.match(tela, /onEscolher: setEscolhendo,/, 'o caminho por toque existe em paralelo');
  assert.match(tela, /onClick=\{\(\) => onEscolher\(card\)\}/, 'e é um clique no próprio cartão');
  // nenhuma ação importante depende de hover
  assert.doesNotMatch(tela, /group-hover|hover:flex|hover:block|opacity-0/,
    'nada aparece só no hover');
  // nem de rolagem horizontal: a grade empilha no celular
  assert.doesNotMatch(tela, /overflow-x-auto/, 'sem rolagem lateral para entender o dia');
  assert.match(tela, /grid gap-3 lg:grid-cols-2 xl:grid-cols-3/, 'uma pessoa embaixo da outra no celular');
});

test('20: alvo de toque confortável e nada escondido em três pontinhos', () => {
  // os botões de ação têm altura mínima de toque
  assert.match(tela, /min-h-11 items-center justify-center gap-1\.5 rounded-xl/);
  const campos = tela.match(/min-h-12 w-full rounded-xl/g) || [];
  assert.ok(campos.length >= 1, 'campos de formulário também são grandes');
  assert.equal(/⋮|MoreHorizontal|MoreVertical/.test(tela), false, 'nenhuma ação atrás de três pontinhos');
});

// ─────────────────────────── 21, 22, 23. segurança

test('21: técnico não tem a Central, e a tela nem renderiza sem sessão real', () => {
  const legado = read('src/legacy/ZiisTecApp.jsx');
  const permissoes = legado.slice(legado.indexOf('const PERMISSOES = {'), legado.indexOf('const pode = (papel'));
  const tecnico = permissoes.slice(permissoes.indexOf('tecnico:'));
  assert.equal(tecnico.includes('"operacoes"'), false, 'técnico não recebe a Central');
  assert.match(permissoes, /proprietario: \[[^\]]*"operacoes"/, 'o proprietário recebe');
  assert.match(tela, /if \(!real\) \{/, 'sem sessão real a tela não opera');
});

test('22: a autoridade é a RPC do proprietário, e a tela nunca manda a empresa no corpo', () => {
  const migration = read('supabase/0116_operations_dispatch.sql');
  const board = migration.slice(migration.indexOf('function public.zt_operations_board'));
  assert.match(board.slice(0, board.indexOf('$$;')), /if not public\.zt_is_owner\(p_company\) then/,
    'o quadro é do proprietário da empresa');
  // a empresa vem do argumento que a RPC valida; a tela só repassa o id da sessão
  assert.match(tela, /carregarQuadroOperacoes\(empresaId, \{ filtro, hoje: hojeISO \}\)/);
  assert.doesNotMatch(tela, /company_id/);
  assert.doesNotMatch(tela, /service_role|SERVICE_ROLE/);
});

test('23: nada de financeiro nesta tela', () => {
  assert.doesNotMatch(tela, /approved_|extra_cost|billing_entry|\bbrl\b/);
  assert.doesNotMatch(textoVisivel(tela), /lucro|margem|custo|cobran[çc]a|faturamento|R\$/i,
    'nada de dinheiro no texto da tela');
  assert.doesNotMatch(regras, /approved_|extra_cost|preco|valor|margem/i);
});

// ─────────────────────────── 25. sem regressão na Operations V1

test('25: a Operations V1 continua inteira — regras, filtros e simulador', () => {
  // nenhuma função da V1 foi removida: a V2 só acrescentou derivações
  for (const fn of ['filtrarCartoes', 'ordenarCartoes', 'montarColunas', 'conflitosLocais',
    'movimentoValido', 'destinoParaAssignee', 'aplicarMovimentoLocal', 'janelaDoFiltro',
    'cartaoAtrasado', 'somarDias', 'filtroIncluiConcluidas']) {
    assert.match(regras, new RegExp(`export (function|const) ${fn}\\b`), `${fn} continua exportada`);
  }
  // os oito filtros da V1 seguem disponíveis, agora atrás de "Mais filtros"
  assert.deepEqual(FILTROS.map((f) => f.id),
    ['hoje', 'amanha', 'semana', 'atrasadas', 'semresponsavel', 'aguardando', 'andamento', 'concluidas']);
  assert.ok(tela.includes('Mais filtros'));
  assert.ok(tela.includes('FILTROS.map'), 'todos continuam alcançáveis');
  // o simulador de comandos segue na mesma tela e recarrega o quadro
  assert.ok(tela.includes('<OperationsCommandSimulator'));
  assert.match(tela, /onExecutado=\{\(\) => carregar\(true\)\}/);
  // 18: a atualização é local e imediata, sem recarregar o produto inteiro
  assert.match(tela, /setBoard\(\(b\) => \(b \? \{ \.\.\.b, cards: aplicarMovimentoLocal/);
  assert.match(tela, /if \(vivo\.current\) setBoard\(anterior\)/, 'e volta atrás se o banco recusar');
  assert.doesNotMatch(tela, /location\.reload/);
});

// ─────────────────────────── linguagem

test('linguagem: a tela fala português de prestador, não de ERP', () => {
  const visivel = textoVisivel(tela);
  for (const termo of ['dispatch', 'pipeline', 'workflow', 'backlog', 'assignee', 'payload',
    'tenant', 'executor', 'resource', 'board operacional', 'alocação', 'recurso']) {
    assert.equal(new RegExp(termo, 'i').test(visivel), false, `"${termo}" não pode aparecer na tela`);
  }
  // os rótulos vagos que o brief proíbe
  for (const vago of ['>Gerenciar<', '>Ações<', '>Opções<', '>Atribuir<']) {
    assert.equal(visivel.includes(vago), false, `botão "${vago}" não diz o que faz`);
  }
  // e o que o usuário espera ler
  for (const bom of ['Serviços', 'Hoje,', 'Quem vai fazer?', 'Escolher técnico', 'Alterar',
    'Abrir serviço', 'Criar serviço', 'Precisa organizar', 'Sem responsável']) {
    assert.ok(visivel.includes(bom), `a tela diz "${bom}"`);
  }
});

test('o topo responde em segundos: título, dia e os quatro números', () => {
  assert.match(tela, /<h1[^>]*>Serviços<\/h1>/);
  assert.match(tela, /Hoje, \{dataLonga\(hojeISO\)\}/, 'o dia aparece escrito');
  // os números vêm antes de qualquer filtro avançado na ordem da tela
  assert.ok(tela.indexOf('ATALHOS.map') < tela.indexOf('Mais filtros'));
  // e o dia de cada pessoa vem antes do simulador
  assert.ok(tela.indexOf('pessoas.map') < tela.indexOf('<OperationsCommandSimulator'));
});
