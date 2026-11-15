/*
  Operations Command Engine — regras puras.

  O agente (WhatsApp, voz, Assistant, app) nunca escreve em tabela. Ele produz um
  COMANDO PROPOSTO e o fluxo é sempre:

    INPUT -> PARSE -> RESOLVE -> PROPOSE -> CONFIRM -> EXECUTE

  Nada operacional acontece porque uma frase foi interpretada: a execução exige
  confirmação explícita e passa pelas MESMAS RPCs oficiais da Central de
  Operações (migration 0116) e do produto.

  Duas regras valem acima de tudo:
    1. company_id JAMAIS vem do payload. Vem da sessão autenticada. Isso impede
       cross-tenant por construção, não por validação.
    2. Ambiguidade nunca é resolvida em silêncio: dois "Plaza" ou dois "João"
       param em needs_clarification com as opções.

  Este arquivo não chama rede nem banco: decide e é testável direto.
*/

export const INTENTS = [
  'create_work_order',
  'schedule_work_order',
  'assign_work_order',
  'add_work_order_note',
  'get_schedule',
  'get_work_order',
];
export const intentSuportada = (intent) => INTENTS.includes(intent);

export const ORIGENS_COMANDO = ['text', 'voice_transcript', 'assistant', 'whatsapp', 'mobile'];
// A origem do comando é só rastreabilidade; a autoridade é sempre a sessão.
export const origemComandoValida = (origem) => ORIGENS_COMANDO.includes(origem);

// Origem do comando -> origem registrada na auditoria do despacho (0116).
export const origemAuditoria = (origem) => (
  origem === 'whatsapp' || origem === 'voice_transcript' ? 'whatsapp'
    : origem === 'assistant' ? 'assistant'
    : origem === 'mobile' ? 'mobile'
    : 'web'
);

export const STATUS = {
  PROPOSTA: 'requires_confirmation',
  AMBIGUO: 'needs_clarification',
  INVALIDO: 'invalid',
  NEGADO: 'forbidden',
  PRONTO: 'ready',
  EXECUTADO: 'executed',
  CANCELADO: 'canceled',
};

const TZ = 'America/Sao_Paulo';
export const FUSO = TZ;

const dois = (n) => String(n).padStart(2, '0');
const normalizar = (v) => String(v || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/* ---------------------------------------------------------------- datas
   O comando pode chegar com "amanhã às 9". A proposta SEMPRE mostra data e hora
   absolutas no fuso de São Paulo: quem confirma vê o dia exato, não um advérbio. */

export function hojeEmSaoPaulo(agora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(agora);
  const get = (t) => partes.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function somarDiasISO(iso, dias) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(dias || 0));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

const DIAS_SEMANA = {
  domingo: 0, segunda: 1, 'segunda-feira': 1, terca: 2, 'terca-feira': 2,
  quarta: 3, 'quarta-feira': 3, quinta: 4, 'quinta-feira': 4,
  sexta: 5, 'sexta-feira': 5, sabado: 6,
};

const diaDaSemanaISO = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/* Resolve expressão relativa para data absoluta. Devolve '' quando não entende —
   nunca adivinha. */
export function resolverDataRelativa(expressao, { hoje } = {}) {
  const base = hoje || hojeEmSaoPaulo();
  const texto = normalizar(expressao);
  if (!texto) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  // dd/mm ou dd/mm/aaaa
  const br = texto.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (br) {
    const ano = br[3] ? (br[3].length === 2 ? `20${br[3]}` : br[3]) : base.slice(0, 4);
    return `${ano}-${dois(br[2])}-${dois(br[1])}`;
  }
  if (texto === 'hoje') return base;
  if (texto === 'amanha') return somarDiasISO(base, 1);
  if (texto === 'depois de amanha') return somarDiasISO(base, 2);
  const semana = texto.replace(/^(na |proxima |proximo |essa |esta )+/, '');
  if (Object.prototype.hasOwnProperty.call(DIAS_SEMANA, semana)) {
    const alvo = DIAS_SEMANA[semana];
    const atual = diaDaSemanaISO(base);
    let delta = (alvo - atual + 7) % 7;
    if (delta === 0) delta = 7; // "segunda" dita na segunda é a próxima
    return somarDiasISO(base, delta);
  }
  return '';
}

/* Período do dia vira hora concreta só quando o usuário não deu hora.
   A proposta mostra a hora resultante, para poder ser corrigida. */
const PERIODOS = { manha: '09:00', tarde: '14:00', noite: '18:00' };

export function resolverHora(expressao) {
  const texto = normalizar(expressao);
  if (!texto) return '';
  const hm = texto.match(/^(\d{1,2})[:h]?(\d{2})?$/);
  if (hm) {
    const h = Number(hm[1]);
    const m = hm[2] ? Number(hm[2]) : 0;
    if (h > 23 || m > 59) return '';
    return `${dois(h)}:${dois(m)}`;
  }
  const periodo = texto.replace(/^(de |da |a |as |à |pela )+/, '');
  if (Object.prototype.hasOwnProperty.call(PERIODOS, periodo)) return PERIODOS[periodo];
  return '';
}

/* ------------------------------------------------------------- resolução
   Casa o texto do usuário com os candidatos que a SESSÃO pode ver. Exato vence
   parcial; empate em parcial é ambiguidade, não escolha. */
export function resolverCandidato(consulta, candidatos = [], { campos = ['nome'] } = {}) {
  const alvo = normalizar(consulta);
  if (!alvo) return { status: 'vazio', escolhido: null, opcoes: [] };
  const comTexto = (c) => campos.map((f) => normalizar(c?.[f])).filter(Boolean);

  const exatos = candidatos.filter((c) => comTexto(c).includes(alvo));
  if (exatos.length === 1) return { status: 'unico', escolhido: exatos[0], opcoes: [] };
  if (exatos.length > 1) return { status: 'ambiguo', escolhido: null, opcoes: exatos };

  const parciais = candidatos.filter((c) => comTexto(c).some((t) => t.includes(alvo) || alvo.includes(t)));
  if (parciais.length === 1) return { status: 'unico', escolhido: parciais[0], opcoes: [] };
  if (parciais.length > 1) return { status: 'ambiguo', escolhido: null, opcoes: parciais };
  return { status: 'inexistente', escolhido: null, opcoes: [] };
}

const faltando = (campo, mensagem) => ({ campo, mensagem });

/* -------------------------------------------------------------- proposta
   Monta a proposta a partir do comando e do contexto que a sessão enxerga.
   `contexto.companyId` vem da sessão; se o payload trouxer company, é ignorado
   e registrado como recusa. */
export function montarProposta(comando = {}, contexto = {}) {
  const { companyId, clientes = [], locais = [], membros = [], ordens = [], usuarioAtual = null, hoje } = contexto;
  const intent = comando.intent;

  if (!companyId) {
    return { status: STATUS.NEGADO, intent, motivo: 'Sem empresa na sessão.' };
  }
  if (!intentSuportada(intent)) {
    return { status: STATUS.INVALIDO, intent, motivo: 'Comando não reconhecido nesta versão.' };
  }
  // O payload não decide a empresa. Nem quando insiste.
  if (comando.company_id && comando.company_id !== companyId) {
    return { status: STATUS.NEGADO, intent, motivo: 'A empresa vem da sessão, não do comando.' };
  }

  const base = { intent, companyId, origem: comando.source || 'text' };
  const pendencias = [];

  /* ---- alvo: OS existente (para agendar/atribuir/anotar/consultar) ---- */
  let ordem = null;
  if (intent !== 'create_work_order' && intent !== 'get_schedule') {
    const consulta = comando.work_order_query || comando.work_order_number || comando.work_order_id || '';
    const r = resolverCandidato(consulta, ordens, { campos: ['numero', 'id'] });
    if (r.status === 'vazio') pendencias.push(faltando('work_order', 'Informe a ordem de serviço.'));
    else if (r.status === 'inexistente') {
      return { ...base, status: STATUS.INVALIDO, motivo: `Não encontrei a ordem de serviço "${consulta}".` };
    } else if (r.status === 'ambiguo') {
      return {
        ...base,
        status: STATUS.AMBIGUO,
        campo: 'work_order',
        pergunta: 'Qual ordem de serviço?',
        opcoes: r.opcoes.map((o) => ({ id: o.id, label: o.numero || o.id })),
      };
    } else ordem = r.escolhido;
  }

  /* ---- cliente (criação) ---- */
  let cliente = null;
  if (intent === 'create_work_order') {
    const consulta = comando.client_query || '';
    const r = resolverCandidato(consulta, clientes, { campos: ['nome', 'fantasia'] });
    if (r.status === 'vazio') pendencias.push(faltando('client', 'Para qual cliente?'));
    else if (r.status === 'inexistente') {
      return { ...base, status: STATUS.INVALIDO, motivo: `Não encontrei o cliente "${consulta}". Cadastre antes de criar a OS.` };
    } else if (r.status === 'ambiguo') {
      return {
        ...base,
        status: STATUS.AMBIGUO,
        campo: 'client',
        pergunta: 'Qual cliente?',
        opcoes: r.opcoes.map((c) => ({ id: c.id, label: c.fantasia || c.nome })),
      };
    } else cliente = r.escolhido;
  }

  /* ---- local (opcional, dentro do cliente escolhido) ---- */
  let local = null;
  if (intent === 'create_work_order' && comando.location_query) {
    const doCliente = locais.filter((l) => !cliente || l.clienteId === cliente.id);
    const r = resolverCandidato(comando.location_query, doCliente, { campos: ['nome'] });
    if (r.status === 'ambiguo') {
      return {
        ...base,
        status: STATUS.AMBIGUO,
        campo: 'location',
        pergunta: 'Qual local?',
        opcoes: r.opcoes.map((l) => ({ id: l.id, label: l.nome })),
      };
    }
    if (r.status === 'unico') local = r.escolhido;
    // Local não encontrado não trava: vira texto livre no campo de local.
  }

  /* ---- responsável (opcional; "eu" é o usuário da sessão) ---- */
  let responsavel = null;
  let removerResponsavel = false;
  if (comando.assignee_query !== undefined && comando.assignee_query !== null) {
    const consulta = String(comando.assignee_query || '');
    const texto = normalizar(consulta);
    if (!texto || texto === 'ninguem' || texto === 'sem responsavel') {
      removerResponsavel = intent === 'assign_work_order';
    } else if (texto === 'eu' || texto === 'mim' || texto === 'para mim') {
      if (!usuarioAtual?.id) pendencias.push(faltando('assignee', 'Não identifiquei quem é "eu".'));
      else responsavel = membros.find((m) => m.id === usuarioAtual.id) || { id: usuarioAtual.id, nome: 'Eu' };
    } else {
      const r = resolverCandidato(consulta, membros, { campos: ['nome', 'email'] });
      if (r.status === 'inexistente') {
        return { ...base, status: STATUS.INVALIDO, motivo: `Não encontrei "${consulta}" na equipe ativa.` };
      }
      if (r.status === 'ambiguo') {
        return {
          ...base,
          status: STATUS.AMBIGUO,
          campo: 'assignee',
          pergunta: `Qual ${consulta}?`,
          opcoes: r.opcoes.map((m) => ({ id: m.id, label: m.nome + (m.funcao ? ` · ${m.funcao}` : '') })),
        };
      }
      if (r.status === 'unico') responsavel = r.escolhido;
    }
  }
  if (intent === 'assign_work_order' && !responsavel && !removerResponsavel) {
    pendencias.push(faltando('assignee', 'Para quem devo atribuir?'));
  }

  /* ---- data e hora: sempre absolutas na proposta ---- */
  let data = '';
  let horario = '';
  if (intent === 'create_work_order' || intent === 'schedule_work_order' || intent === 'get_schedule') {
    const pedida = comando.scheduled_date || comando.date_query || '';
    data = /^\d{4}-\d{2}-\d{2}$/.test(String(pedida)) ? String(pedida) : resolverDataRelativa(pedida, { hoje });
    horario = comando.scheduled_time ? resolverHora(comando.scheduled_time) : resolverHora(comando.time_query || '');
    if (pedida && !data) {
      return { ...base, status: STATUS.INVALIDO, motivo: `Não entendi a data "${pedida}".` };
    }
    if ((comando.scheduled_time || comando.time_query) && !horario) {
      return { ...base, status: STATUS.INVALIDO, motivo: `Não entendi o horário "${comando.scheduled_time || comando.time_query}".` };
    }
    if (intent === 'schedule_work_order' && !data && !comando.unschedule) {
      pendencias.push(faltando('scheduled_date', 'Para que dia?'));
    }
    if (intent === 'get_schedule' && !data) data = hoje || hojeEmSaoPaulo();
  }

  /* ---- descrição / nota ---- */
  const descricao = String(comando.description || '').trim();
  if (intent === 'create_work_order' && !descricao) {
    pendencias.push(faltando('description', 'O que precisa ser feito?'));
  }
  const nota = String(comando.note || comando.description || '').trim();
  if (intent === 'add_work_order_note' && !nota) {
    pendencias.push(faltando('note', 'Qual observação devo registrar?'));
  }

  if (pendencias.length) {
    return {
      ...base,
      status: STATUS.AMBIGUO,
      campo: pendencias[0].campo,
      pergunta: pendencias[0].mensagem,
      opcoes: [],
      pendencias,
    };
  }

  // Leitura não muda nada: já sai pronta para executar.
  const somenteLeitura = intent === 'get_schedule' || intent === 'get_work_order';

  return {
    ...base,
    status: somenteLeitura ? STATUS.PRONTO : STATUS.PROPOSTA,
    resumo: resumoProposta({ intent, cliente, local, data, horario, descricao, nota, responsavel, removerResponsavel, ordem }),
    alvo: {
      workOrderId: ordem?.id || null,
      workOrderNumber: ordem?.numero || null,
      clienteId: cliente?.id || null,
      clienteNome: cliente ? (cliente.fantasia || cliente.nome) : null,
      localId: local?.id || null,
      localNome: local?.nome || (comando.location_query ? String(comando.location_query).trim() : null),
      responsavelId: responsavel?.id || null,
      responsavelNome: responsavel?.nome || null,
      removerResponsavel,
      data,
      horario,
      descricao,
      nota,
    },
  };
}

/* Texto da proposta: data absoluta, nunca "amanhã". */
export function resumoProposta({ intent, cliente, local, data, horario, descricao, nota, responsavel, removerResponsavel, ordem }) {
  const dataBR = data ? data.split('-').reverse().join('/') : null;
  const linhas = [];
  if (intent === 'create_work_order') {
    linhas.push(['Ação', 'Criar ordem de serviço']);
    linhas.push(['Cliente', cliente ? (cliente.fantasia || cliente.nome) : '—']);
    if (local?.nome) linhas.push(['Local', local.nome]);
    linhas.push(['Data', dataBR ? `${dataBR}${horario ? ` às ${horario}` : ''}` : 'Sem agendamento']);
    linhas.push(['Descrição', descricao || '—']);
    // "Sem responsável" é o destino real: a OS nasce no quadro para distribuição.
    linhas.push(['Responsável', responsavel?.nome || 'Sem responsável (vai para o quadro)']);
  } else if (intent === 'schedule_work_order') {
    linhas.push(['Ação', data ? 'Agendar ordem de serviço' : 'Remover agendamento']);
    linhas.push(['OS', ordem?.numero || '—']);
    if (data) linhas.push(['Data', `${dataBR}${horario ? ` às ${horario}` : ''}`]);
  } else if (intent === 'assign_work_order') {
    linhas.push(['Ação', removerResponsavel ? 'Remover responsável' : 'Atribuir ordem de serviço']);
    linhas.push(['OS', ordem?.numero || '—']);
    linhas.push(['Responsável', removerResponsavel ? 'Sem responsável' : (responsavel?.nome || '—')]);
  } else if (intent === 'add_work_order_note') {
    linhas.push(['Ação', 'Registrar observação']);
    linhas.push(['OS', ordem?.numero || '—']);
    linhas.push(['Observação', nota]);
  } else if (intent === 'get_schedule') {
    linhas.push(['Ação', 'Consultar agenda']);
    linhas.push(['Data', dataBR || '—']);
  } else if (intent === 'get_work_order') {
    linhas.push(['Ação', 'Consultar ordem de serviço']);
    linhas.push(['OS', ordem?.numero || '—']);
  }
  return linhas.map(([rotulo, valor]) => ({ rotulo, valor }));
}

/* Confirmação: só uma proposta íntegra pode ser executada. */
export function podeExecutar(proposta, { confirmado }) {
  if (!proposta) return { ok: false, motivo: 'Nada para executar.' };
  if (proposta.status === STATUS.PRONTO) return { ok: true };
  if (proposta.status !== STATUS.PROPOSTA) return { ok: false, motivo: 'A proposta não está pronta para execução.' };
  if (!confirmado) return { ok: false, motivo: 'Confirmação obrigatória antes de executar.' };
  return { ok: true };
}
