import { toolsForRole } from '../src/lib/assistantTools.js';

export const saoPauloDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export function localReadIntent(text, role) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[?!.]+$/, '');
  if (/^e depois dess[ea]$/.test(normalized)) {
    return { question: 'Qual atendimento você quer usar como referência? Informe a OS e a data para eu conferir.' };
  }
  if (/^(agenda de hoje|minhas os de hoje|o que tenho hoje|quais (?:os|trabalhos|servicos) (?:eu )?tenho hoje)$/.test(normalized)) {
    return { action: role === 'owner' ? 'owner_today_schedule' : 'technician_today_orders', input: {} };
  }
  if (/^(qual (?:e )?(?:o )?meu proximo atendimento|proximo atendimento)$/.test(normalized)) {
    return { action: role === 'owner' ? 'owner_next_appointment' : 'technician_next_appointment', input: {} };
  }
  if (role === 'owner' && /^(quanto tenho (?:para|a) receber (?:esta|nessa|nesta) semana|a receber nesta semana)$/.test(normalized)) {
    return { question: 'A consulta de valores a receber nesta semana ainda não está disponível no Assistant.' };
  }
  const phone = text.trim().replace(/[?!.]+$/, '').match(/^(?:procura|procure|busca|busque|qual [ée])\s+(?:o\s+)?telefone\s+d[oa]\s+cliente\s+(.+)$/i);
  if (role === 'owner' && phone) return { action: 'owner_find_client', input: { query: phone[1].trim() } };
  return null;
}

// Provider output is an untrusted proposal; schemas and database enforce the authority.
export async function inferAssistantPlan({ text, role, currentWorkOrder, env = process.env, fetchImpl = fetch, now = new Date() }) {
  const tools = toolsForRole(role).map(({ name, label, inputSchema }) => ({ name, label, inputSchema }));
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514', max_tokens: 1800,
      system: `Você propõe UMA ação para o Assistente ZiisTec, sem executá-la. Retorne somente JSON {"action":"nome","input":{}} ou {"question":"pergunta curta"}. Não invente cliente, preço, telefone, pagamento ou conclusão. Se faltar dado obrigatório, pergunte somente pelo que falta. Responda à intenção diretamente: próximo atendimento usa next_appointment; valores a receber nesta semana ainda estão indisponíveis: explique isso sem propor ferramenta; telefone usa owner_find_client. Criar OS com data/hora usa create_work_order com date e time juntos e preserva o serviço solicitado, sem segunda confirmação de agenda. Agendar visita existente usa schedule_work_order: workOrder se há número de OS ou client se só há nome do cliente (exatamente um deles). O banco resolve somente uma OS aberta ou pede esclarecimento; nunca invente número ou escolha entre registros ambíguos. Não confunda criar OS com reagendar uma OS existente. Se pedir "e depois desse?" sem identificador anterior, peça a informação novamente; não invente contexto. Amanhã é o próximo dia civil; às duas da tarde é 14:00. Não invente valores ausentes. Datas em São Paulo, hoje ${saoPauloDate(now)}. OS atual: ${currentWorkOrder || 'nenhuma'}. Para recebido hoje, paid=true, paidAt=hoje; vencimento hoje se não informado. Orçamento apenas rascunho com um serviço livre; quantidade 1/unidade un se singular. Não use outras ferramentas. Ferramentas: ${JSON.stringify(tools)}`,
      messages: [{ role: 'user', content: text }],
    }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Não foi possível interpretar agora. Tente descrever o pedido novamente.');
  const data = await response.json();
  const output = (data.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('').trim();
  if (output.length > 16000) throw new Error('Resposta da IA excedeu o limite.');
  try { return JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new Error('A IA não retornou uma ação válida. Nada foi executado.'); }
}
