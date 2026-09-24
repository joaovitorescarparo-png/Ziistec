import { resolverSupabaseServidor } from './_supabaseServerConfig.js';
import { paidAiEnabled } from './_paidFeatures.js';
import { findAssistantTool, validateAssistantInput } from '../src/lib/assistantTools.js';
import { inferAssistantPlan, localReadIntent } from './_assistantPlanner.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export function createAssistantHandler({ env = process.env, fetchImpl = fetch, resolveConfig = resolverSupabaseServidor, infer = inferAssistantPlan } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'Método não permitido.'); }
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Envie JSON.');
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Pedido inválido.');
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 32768) throw new HttpError(413, 'Pedido muito longo.');
      const allowed = ['operation', 'companyId', 'requestId', 'text', 'currentWorkOrder', 'action', 'input'];
      if (Object.keys(body).some((key) => !allowed.includes(key))) throw new HttpError(400, 'Campo não permitido.');
      if (!uuid.test(body.companyId || '') || !uuid.test(body.requestId || '')) throw new HttpError(400, 'Empresa ou pedido inválido.');
      if (!['plan', 'preview', 'execute'].includes(body.operation)) throw new HttpError(400, 'Operação inválida.');
      const config = resolveConfig(env);
      // This candidate is for homologation; even a configured Production deployment cannot run it.
      if (!config.configurado || env.VERCEL_ENV === 'production' || /production/.test(config.origem || '')) throw new HttpError(503, 'Assistente indisponível neste ambiente.');
      const authorization = String(req.headers?.authorization || '');
      if (!/^Bearer \S+$/i.test(authorization)) throw new HttpError(401, 'Entre novamente para continuar.');
      const headers = { apikey: config.publishableKey, Authorization: authorization, 'Content-Type': 'application/json' };
      const call = (path, options = {}) => fetchImpl(`${config.url}${path}`, { ...options, headers, signal: AbortSignal.timeout(15000) });
      const auth = await call('/auth/v1/user');
      if (!auth.ok) throw new HttpError(401, 'Sessão inválida ou expirada.');
      const user = await auth.json();
      if (!uuid.test(user?.id || '')) throw new HttpError(401, 'Sessão inválida.');
      const membership = await call(`/rest/v1/company_members?select=role&company_id=eq.${body.companyId}&user_id=eq.${user.id}&status=eq.active&limit=2`);
      if (!membership.ok) throw new HttpError(403, 'Não foi possível autorizar esta empresa.');
      const memberships = await membership.json();
      const role = memberships.length === 1 ? memberships[0].role : null;
      if (!['owner', 'technician'].includes(role)) throw new HttpError(403, 'Sem acesso ativo a esta empresa.');
      const rpc = async (name, args) => {
        const response = await call(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const status = response.status === 401 ? 401 : data?.code === '42501' ? 403 : data?.code === 'P0001' ? 429 : response.status === 404 ? 503 : 400;
          throw new HttpError(status, status === 503 ? 'Assistente ainda não habilitado neste ambiente.' : status === 403 ? 'Acesso não permitido.' : status === 429 ? 'Limite de IA atingido. Tente mais tarde.' : 'Não foi possível validar a ação. Verifique os dados e tente novamente.');
        }
        if (data?.error) throw new HttpError(422, String(data.error).slice(0, 500));
        return data;
      };
      if (body.operation === 'execute') {
        if (body.action !== undefined || body.input !== undefined || body.text !== undefined || body.currentWorkOrder !== undefined) throw new HttpError(400, 'Confirme somente o pedido revisado.');
        const data = await rpc('zt_assistant_execute', { p_company: body.companyId, p_request_id: body.requestId });
        return res.status(200).json(data);
      }
      let action = body.action, input = body.input;
      if (body.operation === 'plan') {
        if (body.action !== undefined || body.input !== undefined || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10000) throw new HttpError(400, 'Descreva o que precisa em até 10.000 caracteres.');
        if (body.currentWorkOrder !== undefined && body.currentWorkOrder !== null && !uuid.test(body.currentWorkOrder)) throw new HttpError(400, 'OS atual inválida.');
        let plan = localReadIntent(body.text, role);
        if (!plan) {
          if (!paidAiEnabled(env) || !env.ANTHROPIC_API_KEY) throw new HttpError(503, 'Interpretação por IA desativada. Escolha uma ação e preencha os campos para continuar.');
          await rpc('zt_assistant_consume_ai_quota', { p_company: body.companyId });
          plan = await infer({ text: body.text, role, currentWorkOrder: body.currentWorkOrder, env, fetchImpl });
        }
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new HttpError(422, 'Não reconheci uma ação. Nada foi executado.');
        if (typeof plan.question === 'string' && !plan.action) return res.status(200).json({ question: plan.question.slice(0, 500) });
        ({ action, input } = plan);
      } else if (body.text !== undefined || body.currentWorkOrder !== undefined) throw new HttpError(400, 'Envie somente os campos da ação.');
      const definition = findAssistantTool(action);
      if (!definition || !definition.roles.includes(role)) throw new HttpError(403, 'Ação não permitida para este acesso.');
      let normalized;
      try { normalized = validateAssistantInput(action, input, role); }
      catch (error) { throw new HttpError(422, error.message); }
      const data = await rpc('zt_assistant_plan', { p_company: body.companyId, p_action: action, p_input: normalized, p_request_id: body.requestId });
      return res.status(200).json(data);
    } catch (error) {
      return res.status(error.status || 502).json({ error: error.status ? error.message : 'Não foi possível concluir a comunicação. Tente novamente com o mesmo pedido.' });
    }
  };
}
export default createAssistantHandler();
