import { supabase } from './supabase';
import {
  STATUS, montarProposta, origemAuditoria, origemComandoValida, podeExecutar,
} from './operationsCommands';
import { agendarOSOperacoesDB, atribuirOSDB } from './operationsApi';

/*
  Operations Command Engine — orquestração.

  Junta o contexto que a SESSÃO pode ver, monta a proposta pelas regras puras de
  operationsCommands.js e, só depois de confirmada, executa pelas RPCs oficiais
  — as mesmas da Central de Operações. Não existe caminho privilegiado: o agente
  não ganha nada que a tela não tenha.

  A empresa vem sempre do argumento companyId, derivado da sessão autenticada.
  Se o comando trouxer company_id diferente, a proposta sai como 'forbidden'.
*/

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const novoPedido = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/* Candidatos que a sessão enxerga. A RLS é a autoridade: se o usuário não pode
   ver um cliente, ele não chega aqui e portanto não pode ser alvo de comando. */
export async function carregarContextoComandos(companyId, usuarioAtual, { hoje } = {}) {
  const [clientes, locais, membros, ordens] = await Promise.all([
    supabase.from('clients').select('id,name,trade_name').eq('company_id', companyId)
      .is('deleted_at', null).order('name').limit(500),
    supabase.from('client_locations').select('id,name,client_id').eq('company_id', companyId)
      .order('name').limit(500),
    supabase.from('company_members').select('user_id,role,job_title,status,profiles(full_name,email)')
      .eq('company_id', companyId).eq('status', 'active'),
    supabase.from('work_orders').select('id,number,status,scheduled_date')
      .eq('company_id', companyId).is('deleted_at', null)
      .not('status', 'in', '("canceled")')
      .order('created_at', { ascending: false }).limit(300),
  ]);
  return {
    companyId,
    usuarioAtual,
    hoje,
    clientes: (check(clientes) || []).map((c) => ({ id: c.id, nome: c.name, fantasia: c.trade_name || '' })),
    locais: (check(locais) || []).map((l) => ({ id: l.id, nome: l.name, clienteId: l.client_id })),
    membros: (check(membros) || []).map((m) => ({
      id: m.user_id,
      nome: m.profiles?.full_name || m.profiles?.email || 'Colaborador',
      email: m.profiles?.email || '',
      funcao: m.job_title || '',
      papel: m.role,
    })),
    ordens: (check(ordens) || []).map((o) => ({ id: o.id, numero: o.number, status: o.status, data: o.scheduled_date })),
  };
}

/* PARSE + RESOLVE + PROPOSE. Não escreve nada. */
export async function proporComando(comando, { companyId, usuarioAtual, hoje } = {}) {
  if (comando?.source && !origemComandoValida(comando.source)) {
    return { status: STATUS.INVALIDO, intent: comando?.intent, motivo: 'Origem do comando inválida.' };
  }
  const contexto = await carregarContextoComandos(companyId, usuarioAtual, { hoje });
  return montarProposta(comando, contexto);
}

/* EXECUTE. Só com proposta íntegra e confirmação explícita, pelas RPCs oficiais. */
export async function executarComando(proposta, { confirmado = false, pedido } = {}) {
  const permitido = podeExecutar(proposta, { confirmado });
  if (!permitido.ok) return { status: STATUS.INVALIDO, motivo: permitido.motivo };

  const origem = origemAuditoria(proposta.origem);
  const alvo = proposta.alvo || {};
  const requestId = pedido || novoPedido();

  if (proposta.intent === 'create_work_order') {
    // Criação segue o caminho oficial do produto (idempotente por pedido).
    const row = {
      company_id: proposta.companyId,
      client_id: alvo.clienteId,
      client_location_id: alvo.localId || null,
      assigned_to: alvo.responsavelId || null,
      status: alvo.data ? 'scheduled' : 'unscheduled',
      scheduled_date: alvo.data || null,
      scheduled_time: alvo.data ? (alvo.horario || null) : null,
      service_place: alvo.localNome || null,
      request: alvo.descricao || null,
    };
    const id = check(await supabase.rpc('zt_save_work_order_idempotent', {
      p_company: proposta.companyId,
      p_wo: null,
      p_request: requestId,
      p_row: row,
      p_items: [],
    }));
    return { status: STATUS.EXECUTADO, intent: proposta.intent, workOrderId: id, requestId };
  }

  if (proposta.intent === 'schedule_work_order') {
    const r = await agendarOSOperacoesDB(alvo.workOrderId, {
      data: alvo.data || null, hora: alvo.horario || null, origem, pedido: requestId,
    });
    return { status: STATUS.EXECUTADO, intent: proposta.intent, resultado: r, requestId };
  }

  if (proposta.intent === 'assign_work_order') {
    const r = await atribuirOSDB(alvo.workOrderId, alvo.removerResponsavel ? null : alvo.responsavelId, {
      origem, pedido: requestId,
    });
    return { status: STATUS.EXECUTADO, intent: proposta.intent, resultado: r, requestId };
  }

  if (proposta.intent === 'add_work_order_note') {
    const r = check(await supabase.rpc('zt_save_work_order_report', {
      p_wo: alvo.workOrderId, p_body: alvo.nota, p_request: requestId,
    }));
    return { status: STATUS.EXECUTADO, intent: proposta.intent, resultado: r, requestId };
  }

  if (proposta.intent === 'get_schedule') {
    const r = check(await supabase.rpc('zt_operations_board', {
      p_company: proposta.companyId,
      p_from: alvo.data, p_to: alvo.data, p_limit: 200, p_include_done: false,
    }));
    return { status: STATUS.EXECUTADO, intent: proposta.intent, resultado: r };
  }

  if (proposta.intent === 'get_work_order') {
    const r = check(await supabase.rpc('zt_work_order_history_detail', { p_wo: alvo.workOrderId }));
    return { status: STATUS.EXECUTADO, intent: proposta.intent, resultado: r };
  }

  return { status: STATUS.INVALIDO, motivo: 'Comando não reconhecido nesta versão.' };
}

export const cancelarComando = (proposta) => ({
  status: STATUS.CANCELADO, intent: proposta?.intent || null,
});
