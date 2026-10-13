import { resolverSupabaseServidor } from './_supabaseServerConfig.js';
import { externalAiReady } from './_aiGateway.js';
import { findAssistantTool, validateAssistantInput } from '../src/lib/assistantTools.js';
import { CLIENT_AMBIGUITY_QUESTION, CURRENT_WORK_ORDER_TOKEN, foldText, inferAssistantPlan, localReadIntent, missingFieldQuestion, sanitizeProposal } from './_assistantPlanner.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const anyUuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// Entidades que podem virar "referência ativa" da conversa ("esse orçamento", "essa OS").
export const REFERENCE_TYPES = Object.freeze(['quote', 'work_order', 'client', 'product', 'service']);
export const FREE_INTERPRETATION_DISABLED_MESSAGE = 'A interpretação livre ainda não está habilitada neste ambiente. Consultas simples continuam disponíveis.';
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

// Mais de um cliente compatível: pergunta em vez de escolher. Nome idêntico ao pedido resolve sozinho.
function clientLookupOutcome(data, query) {
  const items = Array.isArray(data?.result?.items) ? data.result.items : [];
  if (items.length < 2) return data;
  const wanted = foldText(query).replace(/\s+/g, ' ').trim();
  const exact = items.filter(item => foldText(item?.title).replace(/\s+/g, ' ').trim() === wanted);
  if (exact.length === 1) return { ...data, result: { ...data.result, items: exact, message: 'Consulta concluída.' } };
  const names = [...new Set(items.map(item => String(item?.title || '').trim()).filter(Boolean))];
  const listed = names.slice(0, 5).join('; ') + (names.length > 5 ? '; …' : '');
  return { question: `${CLIENT_AMBIGUITY_QUESTION} "${String(query).slice(0, 80)}": ${listed}. Qual deles? Informe o nome completo.`.slice(0, 500) };
}

// Pergunta do banco (homônimos, item fora do catálogo): opções do próprio tenant + rascunho a completar.
function questionOutcome(data) {
  const options = (Array.isArray(data.options) ? data.options : [])
    .filter(option => typeof option?.label === 'string' && /^(client|item:\d{1,2})$/.test(option?.slot || '') && uuid.test(option?.ref || ''))
    .slice(0, 6).map(({ label, slot, ref }) => ({ label: label.slice(0, 200), slot, ref }));
  const resumable = options.length && typeof data.action === 'string' && data.draft && typeof data.draft === 'object';
  return { question: String(data.question).slice(0, 500), ...(resumable ? { options, action: data.action, draft: data.draft } : {}) };
}

// Contexto da prévia para o provedor: sem IDs. A OS aberta na tela vira o marcador do prompt.
function providerContext(context, currentWorkOrder) {
  if (!context || typeof context.action !== 'string') return null;
  const input = { ...(context.input || {}) };
  if (currentWorkOrder && input.workOrder === currentWorkOrder) input.workOrder = CURRENT_WORK_ORDER_TOKEN;
  return anyUuid.test(JSON.stringify(input)) ? null : { action: context.action, input };
}

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
      const allowed = ['operation', 'companyId', 'requestId', 'text', 'currentWorkOrder', 'action', 'input', 'previewHash', 'contextRequestId', 'activeReference'];
      if (Object.keys(body).some((key) => !allowed.includes(key))) throw new HttpError(400, 'Campo não permitido.');
      if (!uuid.test(body.companyId || '') || !uuid.test(body.requestId || '')) throw new HttpError(400, 'Empresa ou pedido inválido.');
      if (!['plan', 'preview', 'execute'].includes(body.operation)) throw new HttpError(400, 'Operação inválida.');
      // Ajuste de prévia sempre gera outra solicitação; a anterior só é referência.
      if (body.contextRequestId !== undefined && (body.operation === 'execute' || !uuid.test(body.contextRequestId) || body.contextRequestId === body.requestId)) throw new HttpError(400, 'Prévia de referência inválida.');
      // Referência ativa vinda do navegador é só dica (tipo + id): o banco revalida tudo antes de usar.
      const reference = body.activeReference;
      if (reference !== undefined && (body.operation !== 'plan' || !reference || typeof reference !== 'object' || Array.isArray(reference)
        || Object.keys(reference).some((key) => !['type', 'id'].includes(key)) || !REFERENCE_TYPES.includes(reference.type) || !uuid.test(reference.id || ''))) {
        throw new HttpError(400, 'Referência inválida.');
      }
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
        if (data?.error) throw new HttpError(data.code === 'ACCESS_DENIED' ? 403 : data.code === 'REQUEST_CONFLICT' ? 409 : 422, String(data.error).slice(0, 500), typeof data.code === 'string' ? data.code : undefined);
        return data;
      };
      // Referência revalidada (empresa, papel, assinatura, existência, estado) e devolvida sem IDs nem custo.
      // Indisponível: é descartada e o navegador é avisado para esquecê-la; o pedido segue sem ela.
      let referenceCleared = false;
      const activeReference = async () => {
        try {
          const data = await rpc('zt_assistant_reference', { p_company: body.companyId, p_type: reference.type, p_id: reference.id });
          if (data?.context && typeof data.context === 'object' && !anyUuid.test(JSON.stringify(data.context))) return data.context;
        } catch { /* referência indisponível para este usuário/empresa */ }
        referenceCleared = true;
        return null;
      };
      const reply = (payload) => res.status(200).json(referenceCleared ? { ...payload, referenceCleared: true } : payload);
      // Interpretação livre: IA externa configurada (fail-closed), contexto mínimo da prévia e da referência, quota e só então o gateway.
      const interpret = async () => {
        if (!externalAiReady(env)) throw new HttpError(503, FREE_INTERPRETATION_DISABLED_MESSAGE, 'FREE_INTERPRETATION_DISABLED');
        const context = body.contextRequestId ? providerContext(await rpc('zt_assistant_plan_context', { p_company: body.companyId, p_request_id: body.contextRequestId }), body.currentWorkOrder) : null;
        const referenceContext = reference ? await activeReference() : null;
        await rpc('zt_assistant_consume_ai_quota', { p_company: body.companyId });
        const proposal = await infer({ text: body.text, role, currentWorkOrder: body.currentWorkOrder, context, reference: referenceContext, env, fetchImpl });
        return sanitizeProposal(proposal, { currentWorkOrder: body.currentWorkOrder, text: body.text, context, reference: referenceContext });
      };
      if (body.operation === 'execute') {
        if (body.action !== undefined || body.input !== undefined || body.text !== undefined || body.currentWorkOrder !== undefined) throw new HttpError(400, 'Confirme somente o pedido revisado.');
        if (typeof body.previewHash !== 'string' || !/^[0-9a-f]{64}$/.test(body.previewHash)) throw new HttpError(400, 'Confirme a versão da prévia recebida.');
        const data = await rpc('zt_assistant_execute', { p_company: body.companyId, p_request_id: body.requestId, p_preview_hash: body.previewHash });
        return res.status(200).json(data);
      }
      if (body.previewHash !== undefined) throw new HttpError(400, 'Confirmação permitida somente na execução.');
      let action = body.action, input = body.input, local = false;
      if (body.operation === 'plan') {
        if (body.action !== undefined || body.input !== undefined || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10000) throw new HttpError(400, 'Descreva o que precisa em até 10.000 caracteres.');
        if (body.currentWorkOrder !== undefined && body.currentWorkOrder !== null && !uuid.test(body.currentWorkOrder)) throw new HttpError(400, 'OS atual inválida.');
        // Fast path local só para consultas triviais; o resto é proposta do provedor.
        let plan = localReadIntent(body.text, role);
        local = Boolean(plan);
        if (!plan) plan = await interpret();
        if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new HttpError(422, 'Não reconheci uma ação. Nada foi executado.');
        if (typeof plan.question === 'string' && !plan.action) return reply({ question: plan.question.slice(0, 500) });
        ({ action, input } = plan);
      } else if (body.text !== undefined || body.currentWorkOrder !== undefined) throw new HttpError(400, 'Envie somente os campos da ação.');
      const definition = findAssistantTool(action);
      if (!definition || !definition.roles.includes(role)) throw new HttpError(403, 'Ação não permitida para este acesso.');
      // Linguagem natural sem um dado que pode ser perguntado: conversa, não faixa de erro.
      if (body.operation === 'plan' && !local) {
        const missing = missingFieldQuestion(action, input);
        if (missing) return reply({ question: missing });
      }
      let normalized;
      try { normalized = validateAssistantInput(action, input, role); }
      catch (error) { throw new HttpError(422, error.message); }
      // Ajuste de uma escrita pendente: nova prévia/novo hash; o banco expira a anterior na mesma transação.
      const revise = Boolean(body.contextRequestId) && !local && definition.confirmationRequired;
      const data = revise
        ? await rpc('zt_assistant_revise', { p_company: body.companyId, p_previous: body.contextRequestId, p_action: action, p_input: normalized, p_request_id: body.requestId })
        : await rpc('zt_assistant_plan', { p_company: body.companyId, p_action: action, p_input: normalized, p_request_id: body.requestId });
      if (typeof data?.question === 'string') return reply(questionOutcome(data));
      // Só a linguagem natural pergunta; a busca manual (preview) mostra a lista que o usuário pediu.
      return reply(body.operation === 'plan' && action === 'owner_find_client' ? clientLookupOutcome(data, normalized.query) : data);
    } catch (error) {
      return res.status(error.status || 502).json({ error: error.status ? error.message : 'Não foi possível concluir a comunicação. Tente novamente com o mesmo pedido.', ...(error.status && error.code ? { code: error.code } : {}) });
    }
  };
}
export default createAssistantHandler();
