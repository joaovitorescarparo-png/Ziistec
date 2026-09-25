import { toolsForRole } from '../src/lib/assistantTools.js';

export const saoPauloDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export function localReadIntent(text, role) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[?!.]+$/, '');
  if (/^(o que tenho hoje|quais (?:os|trabalhos|servicos) (?:eu )?tenho hoje)$/.test(normalized)) {
    return { action: role === 'owner' ? 'owner_today_schedule' : 'technician_today_orders', input: {} };
  }
  return null;
}

// Provider output is an untrusted proposal; schemas and database enforce the authority.
export async function inferAssistantPlan({ text, role, currentWorkOrder, env = process.env, fetchImpl = fetch, now = new Date() }) {
  const tools = toolsForRole(role).map(({ name, label, inputSchema }) => ({ name, label, inputSchema }));
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514', max_tokens: 1800,
      system: `Você propõe UMA ação para o Assistente ZiisTec, sem executá-la. Retorne somente JSON {"action":"nome","input":{}} ou {"question":"pergunta curta"}. Não invente cliente, preço, telefone, pagamento ou conclusão. Se faltar dado obrigatório, pergunte. Datas em São Paulo, hoje ${saoPauloDate(now)}. OS atual: ${currentWorkOrder || 'nenhuma'}. Para recebido hoje, paid=true, paidAt=hoje; vencimento hoje se não informado. Orçamento apenas rascunho com um serviço livre; quantidade 1/unidade un se singular. Não use outras ferramentas. Ferramentas: ${JSON.stringify(tools)}`,
      messages: [{ role: 'user', content: text }],
    }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Não foi possível interpretar agora. Use os campos da ação ou tente novamente.');
  const data = await response.json();
  const output = (data.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('').trim();
  if (output.length > 16000) throw new Error('Resposta da IA excedeu o limite.');
  try { return JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new Error('A IA não retornou uma ação válida. Nada foi executado.'); }
}
