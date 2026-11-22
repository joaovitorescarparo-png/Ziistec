/* Incoerências encontradas na homologação humana do Preview H0.
 *
 * Todas vinham da mesma família de defeito: dois lugares da interface contando
 * histórias diferentes sobre os mesmos dados. O topo dizia "1 Atrasados" e a
 * lista aparecia vazia; a tela Serviços dizia "1 Atrasados" e o Início dizia
 * "Tudo em dia"; a faixa da Agenda mostrava 30/11–06/12 e listava 23/11.
 *
 * O teste reproduz o roteiro do vídeo: dia 22/11/2026, uma OS atrasada, nada
 * hoje, nada à frente; depois um serviço novo para amanhã às 07:20.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  avisosDePendencia, contarPendencias, pendenciasDoInicio,
  servicoAtrasado, servicoSemResponsavel,
} from '../../src/lib/pendenciasOperacionais.js';
import {
  filterOwnerAgenda, filterOwnerDia, filterOwnerRange, groupAgendaOrders,
  inicioDaSemana, semanaDe,
} from '../../src/lib/agendaMobile.js';
import { resumoDoDia } from '../../src/lib/operationsBoard.js';
import { resolverDestinoRota } from '../../src/lib/routeApps.js';

const read = (p) => readFileSync(p, 'utf8');
const tela = read('src/components/OperationsBoard.jsx');
const legado = read('src/legacy/ZiisTecApp.jsx');
const pkg = JSON.parse(read('package.json'));

const HOJE = '2026-11-22';
const AMANHA = '2026-11-23';
const OWNER = 'u-owner';
const TEC = 'u-tec';

/* Estado inicial do vídeo: uma OS atrasada, nada hoje, nada à frente. */
const atrasada = {
  id: 'os-atrasada', numero: 'OS-0001', data: '2026-11-20', hora: '09:00',
  status: 'agendada', responsavelId: TEC, clienteId: 'c1',
};
/* O serviço criado durante o vídeo. */
const novoServico = {
  id: 'os-nova', numero: 'OS-0002', data: AMANHA, hora: '07:20',
  status: 'agendada', responsavelId: null, clienteId: 'c-maria',
};

const cartao = (o) => ({
  work_order_id: o.id, number: o.numero, client_name: 'x',
  scheduled_date: o.data, scheduled_time: o.hora,
  status: { agendada: 'scheduled', andamento: 'in_progress', aguardando: 'unscheduled', concluida: 'done' }[o.status] || o.status,
  assignee_id: o.responsavelId, priority: 'normal',
});

// ─────────────── 1 a 4. Atrasados × lista vazia

test('1: a visão padrão não marca atalho nenhum como escolha do usuário', () => {
  assert.match(tela, /const \[escolha, setEscolha\] = useState\(''\);/,
    'nada escolhido ao abrir');
  assert.match(tela, /const filtro = escolha \|\| 'semana';/,
    'a semana é só o conteúdo padrão, não uma escolha');
  assert.match(tela, /const ativo = escolha === a\.id;/,
    'o atalho acende só com toque explícito');
  assert.equal(/useState\('semana'\)/.test(tela), false,
    '"Próximos" não pode nascer marcado — era isso que fazia a tela parecer filtrada');
  // tocar de novo desmarca e volta ao padrão
  assert.match(tela, /setEscolha\(ativo \? '' : a\.id\)/);
});

test('2 e 3: Atrasados e Sem responsável contam o que prometem', () => {
  const cards = [cartao(atrasada), cartao(novoServico), cartao({ ...novoServico, id: 'feita', status: 'concluida' })];
  const r = resumoDoDia({ cards }, HOJE);
  assert.equal(r.atrasados, 1, 'a OS de 20/11 ainda em rota está atrasada');
  assert.equal(r.semResponsavel, 1, 'o serviço novo nasceu sem responsável');
  assert.equal(r.hoje, 0, 'nada hoje');
  assert.equal(r.proximos, 1, 'o de amanhã conta como próximo');
  // a mesma função serve ao Início, no formato dele
  const n = contarPendencias([atrasada, novoServico], HOJE);
  assert.deepEqual(n, { atrasados: 1, semResponsavel: 1 }, 'mesma conta nos dois formatos');
});

test('4: pendência que o filtro esconde gera aviso com ação, nunca silêncio', () => {
  // o caso do vídeo: existe 1 atrasado, mas a seleção atual não mostra nenhum
  const avisos = avisosDePendencia({
    atrasados: 1, semResponsavel: 2, atrasadosVisiveis: 0, semResponsavelVisiveis: 0,
  });
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0].texto, '1 serviço atrasado precisa de atenção');
  assert.equal(avisos[0].acao, 'Ver agora');
  assert.equal(avisos[0].filtro, 'atrasadas');
  assert.equal(avisos[1].texto, '2 serviços sem responsável');
  assert.equal(avisos[1].acao, 'Organizar');
  assert.equal(avisos[1].filtro, 'semresponsavel');
  // com a pendência à vista, não há aviso: nada de repetir informação
  assert.deepEqual(avisosDePendencia({ atrasados: 1, atrasadosVisiveis: 1 }), []);
  assert.deepEqual(avisosDePendencia({}), []);
  // e a tela desenha o aviso com o toque que muda o próprio filtro
  assert.ok(tela.includes('avisosDePendencia'));
  assert.match(tela, /onClick=\{\(\) => setEscolha\(aviso_\.filtro\)\}/);
  assert.ok(tela.includes('role="status"'));
});

// ─────────────── 5 e 6. Início × Serviços

test('5 e 6: com OS atrasada o Início mostra a pendência e não diz "Tudo em dia"', () => {
  const itens = pendenciasDoInicio([atrasada, novoServico], HOJE);
  assert.equal(itens.length, 2);
  assert.equal(itens[0].titulo, '1 serviço atrasado');
  assert.equal(itens[0].tom, 'erro');
  assert.equal(itens[0].acao, 'Ver serviços');
  assert.equal(itens[1].titulo, '1 serviço sem responsável');
  // sem pendência, a lista é vazia — e só então o Início pode dizer que está em dia
  assert.deepEqual(pendenciasDoInicio([{ ...atrasada, status: 'concluida' }], HOJE), []);
  // o Início empurra essas pendências antes de qualquer outra, e leva para Serviços
  assert.match(legado, /for \(const item of pendenciasDoInicio\(ordens, hojeISO\(\)\)\) \{/);
  assert.match(legado, /pend\.push\(\{ \.\.\.item, ir: \(\) => irPara\("operacoes"\) \}\);/);
  // "Tudo em dia" continua existindo, mas só quando pend está vazio
  assert.match(legado, /pend\.length === 0 \? <Panel><Empty icon=\{CheckCircle2\} title="Tudo em dia"/);
  const inicio = legado.slice(legado.indexOf('const pend = [];'));
  assert.ok(inicio.indexOf('pendenciasDoInicio') < inicio.indexOf('papel === "proprietario"'),
    'a pendência operacional é avaliada antes das demais');
  // quem não tem a tela Serviços não recebe uma ação que não pode cumprir
  assert.match(legado, /if \(permitido\("operacoes"\)\) \{/);
});

test('6b: a regra de atraso é uma só, e serviço sem data não é atraso', () => {
  assert.equal(servicoAtrasado(atrasada, HOJE), true);
  assert.equal(servicoAtrasado({ ...atrasada, status: 'concluida' }, HOJE), false);
  assert.equal(servicoAtrasado({ ...atrasada, status: 'cancelada' }, HOJE), false);
  assert.equal(servicoAtrasado({ ...atrasada, data: HOJE }, HOJE), false);
  assert.equal(servicoAtrasado({ ...atrasada, data: '', status: 'aguardando' }, HOJE), false,
    'sem data é aguardando agendamento, não atraso');
  // e vale igual para o formato do banco
  assert.equal(servicoAtrasado(cartao(atrasada), HOJE), true);
  assert.equal(servicoAtrasado({ scheduled_date: '2026-11-20', status: 'done' }, HOJE), false);
  assert.equal(servicoSemResponsavel(novoServico), true);
  assert.equal(servicoSemResponsavel(cartao(novoServico)), true);
  assert.equal(servicoSemResponsavel(atrasada), false);
});

// ─────────────── 7, 8, 9. Agenda

test('7: a Agenda do proprietário abre em Lista', () => {
  assert.match(legado, /const \[visao, setVisao\] = useState\("lista"\);/);
  assert.equal(/innerWidth < 768 \? "lista" : "semana"/.test(legado), false,
    'abrir em Semana no computador era o que criava a divergência');
  assert.match(legado, /const \[filtro, setFiltro\] = useState\("proximos"\);/);
});

test('8: na visão Semana, faixa de datas, lista e dia selecionado são o mesmo período', () => {
  // a semana de 22/11/2026 (domingo) começa na segunda, 16/11
  const semana = semanaDe(HOJE);
  assert.equal(semana.from, '2026-11-16');
  assert.equal(semana.to, '2026-11-22');
  assert.equal(semana.days.length, 7);
  assert.equal(inicioDaSemana('2026-11-16'), '2026-11-16', 'a própria segunda é o início');

  // o serviço de 23/11 NÃO entra na semana de 16–22: era exatamente o sintoma
  const dentro = filterOwnerRange([atrasada, novoServico], { from: semana.from, to: semana.to });
  assert.deepEqual(dentro.map((o) => o.id), ['os-atrasada']);

  // e a semana seguinte lista o de 23/11
  const proxima = semanaDe('2026-11-23');
  assert.equal(proxima.from, '2026-11-23');
  assert.deepEqual(
    filterOwnerRange([atrasada, novoServico], { from: proxima.from, to: proxima.to }).map((o) => o.id),
    ['os-nova'],
  );
  // filtro por técnico continua valendo no período
  assert.deepEqual(
    filterOwnerRange([atrasada, novoServico], { from: semana.from, to: semana.to, technicianId: 'outro' }),
    [],
  );
  // a tela lista o período quando está na visão Semana
  assert.match(legado, /const porPeriodo = visao === "semana";/);
  assert.match(legado, /\? filterOwnerRange\(baseBusca, \{ from: inicio, to: fimSemana, technicianId: tecnicoId \}\)/);
  // e escreve o período que está desenhando
  assert.match(legado, /\{dataBR\(inicio\)\} a \{dataBR\(fimSemana\)\}/);
});

test('9: "Hoje" realinha dia, lista e período; o calendário do mês mostra o dia escolhido', () => {
  assert.match(legado, /const abrirHoje = \(\) => \{ setDia\(hojeISO\(\)\); setVisao\("lista"\); if \(!tecnico\) setFiltro\("hoje"\); \};/);
  // antes, clicar num dia do mês selecionava o dia e listava os de hoje
  assert.match(legado, /onClick=\{\(\) => \{ setDia\(d\); setFiltro\("dia"\); setVisao\("lista"\); \}\}/);
  assert.deepEqual(filterOwnerDia([atrasada, novoServico], { day: AMANHA }).map((o) => o.id), ['os-nova']);
  assert.deepEqual(filterOwnerDia([atrasada, novoServico], { day: HOJE }), []);
  assert.deepEqual(filterOwnerDia([atrasada], { day: '' }), [], 'sem dia não lista nada');
  // escolher um filtro sai da visão Semana, então as duas nunca brigam
  assert.match(legado, /const selecionarFiltro = \(id\) => \{ setFiltro\(id\); setVisao\("lista"\);/);
});

// ─────────────── 10, 11, 12. Endereço × complemento

test('10 e 11: endereço e complemento são campos separados, e o cliente pré-preenche o endereço', () => {
  assert.match(tela, /label="Endereço" dica="É por aqui que o aplicativo de mapas traça a rota\."/);
  assert.match(tela, /label="Complemento \(opcional\)"/);
  assert.ok(tela.includes('Ex.: Rua 406 A, 524'), 'o exemplo do endereço é um endereço');
  assert.ok(tela.includes('Ex.: Portaria, Apto 304, Loja 4, Portão da garagem'),
    'o exemplo do complemento é um complemento');
  // pré-preenchimento a partir do cadastro, editável
  assert.match(tela, /clienteId: id, endereco: cl\?\.endereco \|\| s\.endereco/);
  assert.match(tela, /onChange=\{\(e\) => set\('endereco', e\.target\.value\)\}/, 'o endereço é editável');
  // cada um vai para o seu campo do banco
  assert.match(tela, /local: f\.endereco\.trim\(\),/);
  assert.match(tela, /localServico: f\.complemento\.trim\(\),/);
  // o campo único "Local" com exemplo de complemento não existe mais
  assert.equal(/label="Local"/.test(tela), false);
});

test('12: a rota usa o endereço; o complemento não entra', () => {
  const destino = resolverDestinoRota({
    endereco: 'Rua 406 A, 524', localServico: 'Portaria', cliente: null,
  });
  assert.equal(destino.endereco, 'Rua 406 A, 524', 'o Maps vai pelo endereço');
  assert.equal(destino.endereco.includes('Portaria'), false, 'o complemento não polui a rota');
  // sem endereço, o complemento ainda é melhor do que nada
  assert.equal(resolverDestinoRota({ endereco: '', localServico: 'Portaria' }).endereco, 'Portaria');
  assert.equal(resolverDestinoRota({}), null);
  // e a tela da OS continua montando o destino assim
  assert.match(legado, /resolverDestinoRota\(\{ endereco: os\.local, localServico: os\.localServico, cliente: c \}\)/);
});

// ─────────────── 13 a 16. responsável

test('13 e 14: com mais de uma pessoa o padrão é "Decidir depois"; com uma só, pré-seleciona', () => {
  assert.match(tela, /const responsavelInicial = pessoas\.length === 1 \? pessoas\[0\]\.user_id : '';/);
  assert.match(tela, /responsavelId: responsavelInicial,/);
  assert.equal(/responsavelId: usuarioAtualId \|\| ''/.test(tela), false,
    'começar no proprietário atribuía serviço sem intenção');
  assert.ok(tela.includes('<option value="">Decidir depois</option>'));
  // salvar assim deixa a OS sem responsável, pela operação oficial
  assert.match(tela, /if \(!f\.responsavelId\) \{[\s\S]{0,160}atribuirOSDB\(id, null, \{ origem: 'web' \}\)/);
});

test('15 e 16: sem responsável convida a escolher; com responsável, a trocar', () => {
  assert.ok(tela.includes('Escolher quem vai fazer'), 'sem ninguém: a ação de escolher');
  assert.ok(tela.includes('Trocar responsável'), 'com alguém: a ação de trocar');
  assert.equal(tela.includes('Escolher técnico'), false,
    'o texto antigo dava impressão de que o serviço estava sem responsável');
  // o nome de quem vai fazer aparece no cartão, então o botão não precisa dizê-lo
  assert.match(tela, /const quem = nomeDoResponsavel\(board, card\.assignee_id, usuarioAtualId\);/);
  assert.match(tela, /\{quem \? \([\s\S]{0,400}\) : \(/, 'nome quando tem, ação quando não tem');
  // vocabulário de ERP continua fora
  const visivel = tela.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const termo of ['Atribuir', 'dispatch', 'assignee', 'executor']) {
    const textos = [...visivel.matchAll(/>\s*([^<>\n]+?)\s*</g)].map((m) => m[1]).join(' | ');
    assert.equal(new RegExp(termo, 'i').test(textos), false, `"${termo}" não aparece na tela`);
  }
});

// ─────────────── 17. menu

test('17: o menu diz "Catálogo e preços", e não há mais dois nomes parecidos', () => {
  const nav = legado.slice(legado.indexOf('const NAV = ['), legado.indexOf('const NAV_MOBILE'));
  assert.match(nav, /\{ id: "catalogo", label: "Catálogo e preços", icon: \w+ \},/);
  assert.match(nav, /\{ id: "operacoes", label: "Serviços", icon: \w+ \},/);
  assert.equal(nav.includes('Serviços e produtos'), false);
  // o título da tela acompanha o menu: nome diferente nos dois lugares confunde
  assert.match(legado, /<PageHead title="Catálogo e preços"/);
  assert.equal(legado.includes('Serviços e produtos'), false,
    'nenhum texto da interface usa mais o nome antigo');
  // rota, componente e banco intactos
  assert.ok(legado.includes('{ id: "catalogo", label: "Catálogo e preços"'));
  assert.ok(legado.includes('tela === "catalogo"'), 'a rota continua "catalogo"');
});

// ─────────────── roteiro do vídeo, de ponta a ponta

test('roteiro do vídeo: 1 atrasado e lista vazia nunca ficam sem explicação', () => {
  // estado inicial: 1 atrasada, 0 hoje, 0 próximas
  const inicial = [atrasada];
  const r0 = resumoDoDia({ cards: inicial.map(cartao) }, HOJE);
  assert.deepEqual([r0.atrasados, r0.hoje, r0.proximos], [1, 0, 0]);
  // a seleção padrão (semana de 16 a 22) mostra a atrasada? ela é de 20/11, então sim.
  // o caso que importa é quando o filtro NÃO mostra: o aviso aparece
  assert.equal(avisosDePendencia({ atrasados: r0.atrasados, atrasadosVisiveis: 0 }).length, 1);

  // depois de criar o serviço de amanhã às 07:20, sem responsável
  const depois = [atrasada, novoServico];
  const r1 = resumoDoDia({ cards: depois.map(cartao) }, HOJE);
  assert.equal(r1.proximos, 1, 'Próximos = 1');
  assert.equal(r1.atrasados, 1, 'o atraso continua visível');
  assert.equal(r1.semResponsavel, 1, 'e ele aparece em Precisa organizar');

  // na Agenda, o de amanhã cai em "Amanhã" no filtro Próximos
  const grupos = groupAgendaOrders(
    filterOwnerAgenda(depois, { filter: 'proximos', today: HOJE }), 'proximos',
  );
  const amanha = grupos.find((g) => g.date === AMANHA);
  assert.ok(amanha, 'o serviço de amanhã é agrupado em 23/11');
  assert.equal(amanha.orders[0].hora, '07:20');
  // e a visão Semana de hoje não o lista, porque ele não está nessa semana —
  // agora a faixa e a lista concordam nisso
  const semana = semanaDe(HOJE);
  assert.equal(filterOwnerRange(depois, { from: semana.from, to: semana.to }).length, 1);

  // o Início não pode dizer que está tudo em dia
  assert.equal(pendenciasDoInicio(depois, HOJE).length, 2);
});

// ─────────────── 18, 19, 20. nada regrediu

test('18, 19 e 20: registro retroativo, hardening e V2 seguem no gate', () => {
  const v2 = pkg.scripts['verify:v2'];
  for (const t of ['retroactive_service_contract', 'final_ux_environment_hardening',
    'operations_simple_v2', 'operations_board_contract', 'operations_command_engine',
    'rc1c_agenda_mobile', 'real_world_ux_fixes']) {
    assert.ok(v2.includes(`tests/blockers/${t}.test.mjs`), `${t} roda no gate`);
  }
  // o registro retroativo não foi tocado
  assert.ok(read('supabase/0117_retroactive_service_registration.sql')
    .includes('create or replace function public.zt_register_completed_work_order('));
  assert.ok(legado.includes('>Registrar serviço realizado</Btn>'));
  // a CSP por ambiente e a trava do simulador continuam
  assert.ok(read('scripts/csp-environment.mjs').includes('politicaCspDoAmbiente'));
  assert.match(tela, /const SIMULADOR_INTERNO = import\.meta\.env\.DEV/);
  assert.match(tela, /\{OperationsCommandSimulator \? \(/);
  // e esta rodada não mexeu no banco
  assert.equal(read('src/lib/pendenciasOperacionais.js').includes('supabase'), false,
    'a regra compartilhada é pura: nenhuma consulta nova');
});
