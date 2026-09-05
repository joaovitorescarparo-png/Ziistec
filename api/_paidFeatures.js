export function paidAiEnabled(env = process.env) {
  return String(env?.ENABLE_PAID_AI || '').trim().toLowerCase() === 'true';
}

// Fail-closed por padrão: ter uma chave de provedor configurada não basta para gerar custo.
// A IA paga só é ativada quando o proprietário decidir liberar explicitamente o recurso.
export const paidAiAtivo = paidAiEnabled();
