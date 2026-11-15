import { supabase } from './supabase';
import { filtroIncluiConcluidas, janelaDoFiltro } from './operationsBoard';

/*
  Central de Operações — acesso a dados.

  Toda escrita passa pelas RPCs oficiais da migration 0116. Nada aqui faz UPDATE
  direto em work_orders: é o mesmo caminho que o futuro agente usará, com
  autorização, validação de tenant, executor ativo, assinatura, auditoria com
  origem e idempotência por pedido.
*/

const check = (r) => { if (r?.error) throw r.error; return r?.data; };

// Origens previstas pelo banco (constraint wo_dispatch_events_source_ck).
export const ORIGENS = ['web', 'mobile', 'assistant', 'whatsapp', 'system'];
export const origemValida = (origem) => ORIGENS.includes(origem);

const novoPedido = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function carregarQuadroOperacoes(companyId, { filtro = 'semana', hoje, limite = 400 } = {}) {
  const { de, ate } = janelaDoFiltro(filtro, hoje);
  const r = await supabase.rpc('zt_operations_board', {
    p_company: companyId,
    p_from: de,
    p_to: ate,
    p_limit: limite,
    p_include_done: filtroIncluiConcluidas(filtro),
  });
  const board = check(r) || {};
  return {
    companyId: board.company_id || companyId,
    de: board.from || de,
    ate: board.to || ate,
    members: board.members || [],
    cards: board.cards || [],
  };
}

export async function atribuirOSDB(workOrderId, assigneeId, { origem = 'web', pedido } = {}) {
  if (!origemValida(origem)) throw new Error('Origem da operação inválida.');
  const r = await supabase.rpc('zt_assign_work_order', {
    p_work_order: workOrderId,
    p_assignee: assigneeId || null,
    p_request: pedido || novoPedido(),
    p_source: origem,
  });
  return check(r);
}

export async function agendarOSOperacoesDB(workOrderId, { data, hora, origem = 'web', pedido } = {}) {
  if (!origemValida(origem)) throw new Error('Origem da operação inválida.');
  const r = await supabase.rpc('zt_schedule_work_order', {
    p_work_order: workOrderId,
    p_date: data || null,
    p_time: data ? (hora || null) : null,
    p_request: pedido || novoPedido(),
    p_source: origem,
  });
  return check(r);
}

export async function definirPrioridadeOSDB(workOrderId, prioridade, { origem = 'web', pedido } = {}) {
  if (!origemValida(origem)) throw new Error('Origem da operação inválida.');
  const r = await supabase.rpc('zt_set_work_order_priority', {
    p_work_order: workOrderId,
    p_priority: prioridade,
    p_request: pedido || novoPedido(),
    p_source: origem,
  });
  return check(r);
}

// Contagem autoritativa de conflito, para confirmar antes de concluir o arraste.
export async function conflitosAgendaDB(workOrderId, { assigneeId, data, hora } = {}) {
  const r = await supabase.rpc('zt_work_order_schedule_conflicts', {
    p_work_order: workOrderId,
    p_assignee: assigneeId || null,
    p_date: data || null,
    p_time: hora || null,
  });
  return Number(check(r) || 0);
}

export async function historicoDespachoDB(companyId, workOrderId = null, limite = 50) {
  let q = supabase.from('work_order_dispatch_events')
    .select('id, work_order_id, action, from_assignee, to_assignee, source, actor_id, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limite);
  if (workOrderId) q = q.eq('work_order_id', workOrderId);
  return check(await q) || [];
}
