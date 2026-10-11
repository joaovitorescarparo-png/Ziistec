import { toolsForRole } from '../src/lib/assistantTools.js';

export const saoPauloDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// Prefixo da pergunta de desambiguação de cliente; a resposta volta pelo fluxo de esclarecimento.
export const CLIENT_AMBIGUITY_QUESTION = 'Encontrei mais de um cliente compatível com';

// Sem acento e minúsculo, um caractere por caractere: os índices continuam valendo no texto original.
export function foldText(value) {
  return [...String(value ?? '')].map(ch => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().slice(0, 1) || ' ').join('');
}

const FILLER_START = /^(?:(?:oi|ola|ei|bom dia|boa tarde|boa noite|assistente|ziistec|por favor|entao|me diz|me diga|me fala|me informa|me informe) )+/;
const FILLER_END = / (?:por favor|pra mim|para mim)$/;
const ACTIVITY = '(?:atendimento|atendimentos|servico|servicos|os|ordens de servico|trabalho|trabalhos|visita|visitas|compromisso|compromissos)';
const TODAY = [
  /^(?:qual e |qual |como esta |como e )?(?:a )?(?:minha )?agenda (?:de |para |pra )?hoje$/,
  new RegExp(`^(?:qual e |quais sao |quais )?(?:a |as |os )?(?:minha |minhas |meus |meu )?${ACTIVITY} (?:de |para |pra )?hoje$`),
  new RegExp(`^(?:o que|quais (?:os |as )?${ACTIVITY}) (?:eu )?(?:tenho|tem|temos) (?:para |pra )?hoje$`),
  new RegExp(`^(?:eu )?(?:tenho|tem|temos) (?:algum |alguma |algo )?(?:${ACTIVITY} )?(?:marcad[oa]s? |agendad[oa]s? )?(?:para |pra )?hoje$`),
];
const NEXT = [
  /^(?:qual e |qual |quando e |quando sera |quando )?(?:o )?(?:meu )?proximo (?:atendimento|servico|compromisso|agendamento|trabalho)$/,
  /^(?:qual e |qual |quando e |quando )?(?:a )?(?:minha )?proxima (?:visita|os|ordem de servico)$/,
];
// Somente consulta: verbo de leitura opcional + telefone/contato + nome. Escritas seguem para a IA.
const PHONE = /^(?:(?:me )?(?:procura|procure|procurar|busca|busque|buscar|encontra|encontre|acha|ache|mostra|mostre|ve|veja|passa|passe|da|de|diga|fala|fale|informa|informe|consulta|consulte)(?: pra mim| para mim)? )?(?:qual (?:e )?)?(?:(?:o|pelo|por|um) )?(?:numero (?:de |do )?)?(?:telefone|fone|celular|contato|whatsapp|zap|numero)(?: de contato)? (?:do|da|de) (?:cliente )?(.+)$/d;
const NOT_A_NAME = /\b(?:para|pra|mude|muda|mudar|altera|altere|alterar|atualiza|atualize|atualizar|troca|troque|trocar|novo|nova|cadastra|cadastre|cadastrar|apaga|apague|apagar|exclui|exclua|excluir|agenda|agende|agendar|crie|cria|criar|orcamento)\b/;
const validName = folded => folded.length >= 2 && folded.length <= 80 && !/\d/.test(folded) && folded.split(' ').length <= 6 && !NOT_A_NAME.test(folded);

function prepare(text) {
  // Pontuação interna vira espaço e espaços colapsam antes da dobra para manter os índices alinhados.
  const original = [...String(text ?? '').replace(/[,;:]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[?!.\s]+$/, '')];
  const folded = original.map(ch => foldText(ch)).join('');
  const lead = folded.match(FILLER_START)?.[0].length || 0;
  const tail = folded.slice(lead).match(FILLER_END)?.[0].length || 0;
  return { original, offset: lead, core: folded.slice(lead, folded.length - tail) };
}

function phoneLookup(text) {
  const { original, offset, core } = prepare(text);
  const match = PHONE.exec(core);
  if (!match || !validName(match[1])) return null;
  const [from, to] = match.indices[1];
  return { action: 'owner_find_client', input: { query: original.slice(offset + from, offset + to).join('').trim() } };
}

// Resposta à pergunta de desambiguação gerada pela própria API (nunca a de um provedor).
function clarifiedClientLookup(text) {
  const lines = String(text).split('\n');
  const question = lines.filter(line => line.startsWith('Pergunta: ')).at(-1)?.slice('Pergunta: '.length) || '';
  if (!question.startsWith(CLIENT_AMBIGUITY_QUESTION) || !phoneLookup(lines[0])) return null;
  const answer = lines.filter(line => line.startsWith('Resposta: ')).at(-1)?.slice('Resposta: '.length) || '';
  const direct = phoneLookup(answer);
  if (direct) return direct;
  const { original, offset, core } = prepare(answer);
  const article = core.match(/^(?:(?:e|eh|seria|o|a|do|da|de|cliente) )+/)?.[0].length || 0;
  if (!validName(core.slice(article))) return { question: 'Informe o nome completo do cliente para eu buscar o telefone.' };
  return { action: 'owner_find_client', input: { query: original.slice(offset + article, offset + core.length).join('').trim() } };
}

export function localReadIntent(text, role) {
  const value = String(text ?? '');
  if (value.includes('\n')) return role === 'owner' ? clarifiedClientLookup(value) : null;
  const { core } = prepare(value);
  if (/^e depois dess[ea]$/.test(core)) {
    return { question: 'Qual atendimento você quer usar como referência? Informe a OS e a data para eu conferir.' };
  }
  if (TODAY.some(pattern => pattern.test(core))) {
    return { action: role === 'owner' ? 'owner_today_schedule' : 'technician_today_orders', input: {} };
  }
  if (NEXT.some(pattern => pattern.test(core))) {
    return { action: role === 'owner' ? 'owner_next_appointment' : 'technician_next_appointment', input: {} };
  }
  if (role === 'owner' && /^(quanto tenho (?:para|a) receber (?:esta|nessa|nesta) semana|a receber nesta semana)$/.test(core)) {
    return { question: 'A consulta de valores a receber nesta semana ainda não está disponível no Assistant.' };
  }
  return role === 'owner' ? phoneLookup(value) : null;
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
