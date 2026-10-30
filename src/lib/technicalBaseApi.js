import { supabase } from './supabase';
import {
  confirmationFromRow, isFeatureUnavailable, normalizeConfirmation, normalizeTechnicalBase, technicalBaseFromRow,
} from './fieldExecution.js';

// Base Técnica, confirmação de recebimento e uso do relatório com IA (migration 0111).
// O banco é a autoridade: cada gravação passa por RPC que confere empresa, papel e OS aberta.
// O frontend novo sai antes da migration: se a 0111 ainda não existe, `available` é false e o fechamento
// continua exatamente como antes (nada aqui bloqueia a conclusão da OS).

const rpcFailure = (response) => (response?.error ? Object.assign(new Error(response.error.message || 'Falha ao salvar'), { code: response.error.code, status: response.status, cause: response.error }) : null);

const ignoreMissing = (response) => {
  if (!response?.error) return { ok: true, data: response?.data ?? null };
  if (isFeatureUnavailable({ ...response.error, status: response.status })) return { ok: false, unavailable: true, data: null };
  throw rpcFailure(response);
};

// Leitura tolerante: tabela ausente = recurso indisponível; qualquer outro erro sobe para a tela mostrar.
export async function carregarFechamentoTecnico(workOrderId, client = supabase) {
  const [base, confirmation] = await Promise.all([
    client.from('work_order_technical_base').select('cause,solution,difficulty,learning,revision,updated_at').eq('work_order_id', workOrderId).maybeSingle(),
    client.from('work_order_attendance_confirmations').select('received_by_name,receiver_absent,confirmed_at').eq('work_order_id', workOrderId).maybeSingle(),
  ]);
  const baseResult = ignoreMissing(base);
  const confirmationResult = ignoreMissing(confirmation);
  const available = baseResult.ok || confirmationResult.ok;
  return {
    available,
    base: baseResult.ok && baseResult.data ? technicalBaseFromRow(baseResult.data) : technicalBaseFromRow(null),
    baseSaved: Boolean(baseResult.ok && baseResult.data),
    baseUpdatedAt: baseResult.ok && baseResult.data ? baseResult.data.updated_at || null : null,
    confirmation: confirmationResult.ok && confirmationResult.data ? confirmationFromRow(confirmationResult.data) : confirmationFromRow(null),
    confirmationSaved: Boolean(confirmationResult.ok && confirmationResult.data),
  };
}

export async function salvarBaseTecnicaDB({ workOrderId, base, requestId }, client = supabase) {
  const clean = normalizeTechnicalBase(base);
  const response = await client.rpc('zt_save_work_order_technical_base', {
    p_wo: workOrderId,
    p_cause: clean.cause || null,
    p_solution: clean.solution || null,
    p_difficulty: clean.difficulty || null,
    p_learning: clean.learning || null,
    p_request: requestId,
  });
  const result = ignoreMissing(response);
  return result.ok ? { saved: true, row: result.data } : { saved: false, unavailable: true };
}

export async function salvarConfirmacaoDB({ workOrderId, name, absent, requestId }, client = supabase) {
  const checked = normalizeConfirmation({ name, absent });
  if (!checked.ok) throw new Error(checked.error);
  const response = await client.rpc('zt_save_attendance_confirmation', {
    p_wo: workOrderId,
    p_name: checked.absent ? null : checked.name,
    p_absent: checked.absent,
    p_request: requestId,
  });
  const result = ignoreMissing(response);
  return result.ok ? { saved: true, row: result.data } : { saved: false, unavailable: true };
}

// Quantas gerações com IA a OS ainda tem (o limite é contado no banco, não aqui).
export async function carregarUsoRelatorioIADB(workOrderId, client = supabase) {
  const response = await client.rpc('zt_work_order_ai_report_usage', { p_wo: workOrderId });
  const result = ignoreMissing(response);
  return result.ok && result.data ? result.data : null;
}

// Marca qual geração virou o relato salvo e se o técnico a editou depois. Auditoria: nunca bloqueia a conclusão.
export async function marcarRelatorioIAUsadoDB({ workOrderId, requestId, finalText }, client = supabase) {
  try {
    const response = await client.rpc('zt_mark_work_order_ai_report_used', { p_wo: workOrderId, p_request: requestId, p_final_text: String(finalText || '') });
    return !response.error && response.data === true;
  } catch {
    return false;
  }
}
