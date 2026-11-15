/*
  Rascunho de comando a partir de frase — SOMENTE para o simulador.

  Isto NÃO é o interpretador de produção. É um extrator determinístico, sem IA e
  sem rede, que existe para exercitar o Command Engine com frases parecidas com
  as que chegarão pelo WhatsApp. Quando houver NLU/LLM de verdade, ele entra no
  lugar desta função e o resto do fluxo não muda: a saída é o MESMO payload
  estruturado que o engine já recebe.

  Nada aqui decide empresa, permissão ou execução.
*/

const normalizar = (v) => String(v || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const VERBOS = [
  { intent: 'create_work_order', padroes: ['cria uma os', 'criar uma os', 'cria os', 'criar os', 'abre uma os', 'abrir uma os', 'nova os', 'abre os'] },
  { intent: 'schedule_work_order', padroes: ['reagenda', 'reagendar', 'agenda a os', 'agendar a os', 'agenda os', 'agendar os', 'muda a data', 'mudar a data'] },
  { intent: 'assign_work_order', padroes: ['atribui', 'atribuir', 'passa para', 'passar para', 'manda pro', 'manda para', 'mandar para', 'designa', 'designar'] },
  { intent: 'add_work_order_note', padroes: ['anota', 'anotar', 'registra', 'registrar', 'observacao'] },
  { intent: 'get_schedule', padroes: ['agenda de', 'o que tem', 'quais servicos', 'minha agenda', 'agenda do dia'] },
  { intent: 'get_work_order', padroes: ['ver a os', 'mostra a os', 'detalhe da os', 'consulta a os'] },
];

const DATAS = ['depois de amanha', 'amanha', 'hoje', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'];
const PERIODOS = ['de manha', 'da manha', 'a tarde', 'de tarde', 'da tarde', 'de noite', 'a noite'];

/* Devolve o payload estruturado que o Command Engine espera. Campos que a frase
   não traz ficam ausentes — o engine então pergunta, em vez de adivinhar. */
export function rascunhoDeFrase(frase, { source = 'whatsapp' } = {}) {
  const texto = normalizar(frase);
  if (!texto) return { intent: null, source };

  let intent = null;
  for (const v of VERBOS) {
    if (v.padroes.some((p) => texto.includes(p))) { intent = v.intent; break; }
  }
  if (!intent) intent = 'create_work_order'; // o caso mais comum no campo

  const payload = { intent, source };

  // OS citada pelo número (OS-1042 / 1042)
  const os = texto.match(/\bos[-\s]?(\d{2,6})\b/);
  if (os) payload.work_order_query = `OS-${os[1].padStart(4, '0')}`;

  // Cliente: "para o X", "no X", "do cliente X" — até um marcador de data/motivo.
  const cliente = texto.match(/\b(?:para|pro|no|na|do cliente|cliente)\s+(?:o\s+|a\s+)?([a-z0-9 ]{3,60}?)(?=\s+(?:amanha|hoje|depois de amanha|segunda|terca|quarta|quinta|sexta|sabado|domingo|as |às |porque|pq|por que|porqu|$))/);
  if (cliente && intent === 'create_work_order') payload.client_query = cliente[1].trim();

  // Responsável: "manda pro João", "atribui para Carlos", "para mim"
  const resp = texto.match(/\b(?:manda pro|manda para|mandar para|passa para|passar para|atribui para|atribuir para|atribui pro|designa para|pro|para)\s+([a-z ]{2,40}?)(?=\s+(?:a os|os\b|amanha|hoje|$))/);
  if (intent === 'assign_work_order') {
    if (/\b(para mim|pra mim|comigo|eu mesmo)\b/.test(texto)) payload.assignee_query = 'eu';
    else if (resp) payload.assignee_query = resp[1].trim();
  }

  // Data relativa / dia da semana
  const data = DATAS.find((d) => texto.includes(d));
  if (data) payload.date_query = data;

  // Hora: "as 9", "às 9h", "9:30"
  const hora = texto.match(/\b(?:as|às)\s*(\d{1,2})(?:[:h](\d{2}))?\b/) || texto.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hora) payload.time_query = hora[2] ? `${hora[1]}:${hora[2]}` : hora[1];
  else {
    const periodo = PERIODOS.find((p) => texto.includes(p));
    if (periodo) payload.time_query = periodo.replace(/^(de |da |a )/, '');
  }

  // Motivo/descrição depois de "porque", ou a frase inteira como fallback.
  const motivo = String(frase || '').match(/\b(?:porque|pq|por que|motivo:)\s+(.{3,400})$/i);
  if (motivo) payload.description = motivo[1].trim();
  else if (intent === 'create_work_order') payload.description = String(frase || '').trim();
  if (intent === 'add_work_order_note') payload.note = motivo ? motivo[1].trim() : String(frase || '').trim();

  // Local citado ("portão da rampa" -> "rampa"): só quando a frase nomeia.
  const local = texto.match(/\b(?:da|do|no|na)\s+(rampa|garagem|portaria|recepcao|subsolo|cobertura|bloco [a-z0-9]+|torre [a-z0-9]+|apto \d+|apartamento \d+|loja \d+|sala \d+)\b/);
  if (local && intent === 'create_work_order') payload.location_query = local[1];

  return payload;
}
