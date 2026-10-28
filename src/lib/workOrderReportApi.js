import { supabase } from './supabase';

// Cliente do endpoint /api/work-order-report. O navegador nunca fala com o provedor de IA: só envia o id da OS,
// o identificador do pedido e os produtos escolhidos na tela; o servidor busca os fatos no banco e chama a IA.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ReportApiError extends Error {
  constructor(message, { kind = 'server', status = 0, code = '' } = {}) {
    super(message);
    this.kind = kind; // session | network | unavailable | busy | server
    this.status = status;
    this.code = code;
  }
}

// Só produtos do catálogo com quantidade válida viram "materiais" do pedido; o banco valida de novo.
export function materiaisParaRelatorio(materiais) {
  return (materiais || [])
    .filter((item) => UUID_RE.test(String(item?.catalogoId || '')) && Number.isFinite(Number(item?.qtd)) && Number(item.qtd) > 0 && Number(item.qtd) <= 9999)
    .slice(0, 30)
    .map((item) => ({ productId: item.catalogoId, quantity: Number(item.qtd) }));
}

export async function gerarRelatorioIA({ workOrderId, requestId, materiais = [], fetchImpl = fetch, client = supabase }) {
  const { data } = await client.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new ReportApiError('Sua sessão expirou. Entre novamente.', { kind: 'session' });
  let response;
  try {
    response = await fetchImpl('/api/work-order-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ workOrderId, requestId, materials: materiaisParaRelatorio(materiais) }),
    });
  } catch {
    throw new ReportApiError('Sem conexão agora.', { kind: 'network' });
  }
  const payload = await response.json().catch(() => null);
  if (response.ok && payload && typeof payload.text === 'string' && (payload.source === 'ai' || payload.source === 'fallback')) return payload;
  const status = response.status;
  const code = payload?.code || '';
  if (status === 404 || status === 503 || code === 'REPORT_AI_UNAVAILABLE') {
    throw new ReportApiError('O relatório com IA ainda não está habilitado neste ambiente.', { kind: 'unavailable', status, code });
  }
  if (status === 409 || code === 'IN_PROGRESS') {
    throw new ReportApiError('Já existe uma geração em andamento. Aguarde alguns segundos e toque de novo.', { kind: 'busy', status, code });
  }
  throw new ReportApiError(payload?.error || 'Não foi possível gerar o relatório agora.', { kind: 'server', status, code });
}
