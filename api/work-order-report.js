import { resolverSupabaseServidor } from './_supabaseServerConfig.js';
import { externalAiEnabled, externalAiReady, requestAiText } from './_aiGateway.js';
import { buildDeterministicReport, buildReportPrompt, reviewAiReport, sanitizeReportFacts } from '../src/lib/workOrderReport.js';

// Relatório do cliente gerado com IA a partir dos fatos confirmados da OS (owner e técnico atribuído).
// Ordem: pedido válido -> sessão -> fatos pelo banco (permissão, empresa, o que a IA pode ver) -> IA externa fail-closed
// -> reserva no banco (limite de 3 por OS + quota) -> gateway neutro -> conferência da saída -> registro.
// Qualquer falha depois dos fatos devolve o texto determinístico: a OS nunca depende da IA para ser finalizada.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_MATERIALS = 30;
const PROVIDER_TIMEOUT_MS = 25000;

class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

function parseMaterials(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MATERIALS) throw new HttpError(400, 'Materiais inválidos.');
  return value.map((item) => {
    const keys = item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : [];
    const quantity = Number(item?.quantity);
    if (keys.length !== 2 || !keys.includes('productId') || !keys.includes('quantity')
      || !UUID_RE.test(item.productId || '') || typeof item.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > 9999) {
      throw new HttpError(400, 'Materiais inválidos.');
    }
    return { productId: item.productId, quantity };
  });
}

export function createWorkOrderReportHandler({ env = process.env, fetchImpl = fetch, resolveConfig = resolverSupabaseServidor } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'Método não permitido.'); }
      if (!String(req.headers?.['content-type'] || '').toLowerCase().includes('application/json')) throw new HttpError(415, 'Envie JSON.');
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Pedido inválido.');
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) throw new HttpError(413, 'Pedido muito longo.');
      if (Object.keys(body).some((key) => !['workOrderId', 'requestId', 'materials'].includes(key))) throw new HttpError(400, 'Campo não permitido.');
      if (!UUID_RE.test(body.workOrderId || '') || !UUID_RE.test(body.requestId || '')) throw new HttpError(400, 'OS ou pedido inválido.');
      const materials = parseMaterials(body.materials);

      const config = resolveConfig(env);
      if (!config.configurado) throw new HttpError(503, 'Relatório com IA indisponível neste ambiente.', 'REPORT_AI_UNAVAILABLE');
      const authorization = String(req.headers?.authorization || '');
      if (!/^Bearer \S+$/i.test(authorization)) throw new HttpError(401, 'Entre novamente para continuar.');
      const headers = { apikey: config.publishableKey, Authorization: authorization, 'Content-Type': 'application/json' };
      const call = (path, options = {}) => fetchImpl(`${config.url}${path}`, { ...options, headers, signal: AbortSignal.timeout(15000) });
      const auth = await call('/auth/v1/user').catch(() => null);
      if (!auth?.ok) throw new HttpError(auth ? 401 : 502, auth ? 'Sessão inválida ou expirada.' : 'Não foi possível validar a sessão agora.');
      const rpc = async (name, args) => {
        const response = await call(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const status = response.status === 401 ? 401 : data?.code === '42501' ? 403 : data?.code === 'P0001' ? 429 : response.status === 404 ? 503 : 400;
          throw new HttpError(status,
            status === 503 ? 'Relatório com IA ainda não habilitado neste ambiente.'
              : status === 403 ? 'Acesso não permitido.'
                : status === 429 ? 'Limite de uso de IA atingido. Tente mais tarde.'
                  : 'Não foi possível preparar o relatório. Verifique os dados e tente novamente.',
            status === 503 ? 'REPORT_AI_UNAVAILABLE' : undefined);
        }
        return data;
      };

      // Fatos: o banco decide quem pode e o que a IA vê. Nada vindo do navegador além do id da OS e dos produtos extras.
      const facts = sanitizeReportFacts(await rpc('zt_work_order_report_facts', { p_wo: body.workOrderId, p_materials: materials }));
      const fallbackText = buildDeterministicReport(facts);
      const fallback = (reason, usage) => res.status(200).json({ source: 'fallback', reason, text: fallbackText, ...(usage ? { usage } : {}) });

      // IA externa fail-closed: antes de qualquer reserva ou quota, e sem custo se estiver desligada.
      if (!externalAiEnabled(env)) return fallback('ai_disabled');
      if (!externalAiReady(env)) return fallback('ai_not_configured');

      // Limite de 3 gerações por OS e quota de IA da empresa: decididos no banco, na mesma reserva.
      let claim;
      try { claim = await rpc('zt_claim_work_order_ai_report', { p_wo: body.workOrderId, p_request: body.requestId }); }
      catch (error) { if (error.status === 429) return fallback('quota'); throw error; }
      const usage = (source) => ({ used: Number(source?.used) || 0, limit: Number(source?.limit) || 3, remaining: Math.max(Number(source?.remaining) || 0, 0) });
      if (claim?.replay === true && typeof claim.text === 'string') return res.status(200).json({ source: 'ai', replay: true, text: claim.text, usage: usage(claim) });
      if (claim?.allowed !== true) {
        if (claim?.reason === 'in_progress') throw new HttpError(409, 'Já existe uma geração em andamento para este pedido.', 'IN_PROGRESS');
        return fallback('limit_reached', usage(claim));
      }

      let generated;
      try {
        const prompt = buildReportPrompt(facts);
        generated = await requestAiText({ env, fetchImpl, system: prompt.system, messages: prompt.messages, maxTokens: 700, timeoutMs: PROVIDER_TIMEOUT_MS, label: 'Work order report AI' });
      } catch (error) {
        console.error('Work order report AI failed', error?.code || 'unknown');
        return fallback('provider_error');
      }
      const review = reviewAiReport(generated, facts);
      if (!review.ok) {
        console.error('Work order report AI rejected', review.reason);
        return fallback('unsafe_output');
      }
      const done = await rpc('zt_complete_work_order_ai_report', { p_wo: body.workOrderId, p_request: body.requestId, p_text: review.text });
      return res.status(200).json({ source: 'ai', text: review.text, usage: usage(done) });
    } catch (error) {
      return res.status(error.status || 502).json({
        error: error.status ? error.message : 'Não foi possível concluir a comunicação. Tente novamente.',
        ...(error.status && error.code ? { code: error.code } : {}),
      });
    }
  };
}

export default createWorkOrderReportHandler();
