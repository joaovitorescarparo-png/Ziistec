// Shared descriptions are UX/planning contracts. The database independently authorizes every call.
const text = (title, maxLength = 200, minLength = 1) => ({ type: 'string', title, minLength, maxLength });
const query = (title) => text(title, 120);
const date = (title) => ({ type: 'string', title, format: 'date' });
const money = (title, minimum = 0, maximum = 999999.99) => ({ type: 'number', title, minimum, maximum });
const tool = (name, label, role, properties = {}, required = [], mutation = false) => Object.freeze({
  name, label, roles: [role], inputSchema: { type: 'object', additionalProperties: false, properties, required },
  confirmationRequired: mutation,
  idempotencyPolicy: mutation ? 'actor-company-request; persisted preview; atomic once' : 'read-only',
  executor: mutation ? 'zt_assistant_plan -> zt_assistant_execute' : 'zt_assistant_plan',
});
const read = (name, label, properties, required) => Object.freeze({ ...tool(name, label, 'owner', properties, required), executor: 'zt_assistant_read' });
const count = (title, maximum) => ({ type: 'integer', title, minimum: 1, maximum });
const month = (title) => ({ type: 'string', title, format: 'month' });
// Escolha feita pelo usuário numa pergunta do banco (opção tocada); nunca preenchida pelo provedor.
const clientRef = Object.freeze({ type: 'string', title: 'Cliente escolhido', format: 'uuid', hidden: true });
export const ASSISTANT_TOOLS = Object.freeze([
  tool('owner_today_schedule', 'O que tenho hoje?', 'owner'),
  tool('owner_next_appointment', 'Próximo atendimento', 'owner'),
  tool('owner_find_client', 'Buscar cliente', 'owner', { query: query('Nome do cliente') }, ['query']),
  tool('owner_find_quote', 'Buscar orçamento', 'owner', { query: query('Número do orçamento') }, ['query']),
  tool('owner_find_work_order', 'Buscar OS', 'owner', { query: query('Número da OS') }, ['query']),
  tool('owner_find_product', 'Buscar produto', 'owner', { query: query('Nome do produto') }, ['query']),
  tool('owner_find_service', 'Buscar serviço', 'owner', { query: query('Nome do serviço') }, ['query']),
  tool('create_client', 'Cadastre um cliente', 'owner', { name: text('Nome'), phone: text('Telefone', 40, 0), address: text('Endereço', 500, 0) }, ['name'], true),
  tool('create_quote_draft', 'Crie um orçamento', 'owner', {
    client: query('Cliente'), description: text('Serviço', 500), quantity: { type: 'number', title: 'Quantidade', exclusiveMinimum: 0, maximum: 10000 },
    unit: text('Unidade', 50), unitPrice: money('Preço unitário (R$)'),
  }, ['client', 'description', 'quantity', 'unitPrice'], true),
  tool('create_work_order', 'Crie uma OS', 'owner', { client: query('Cliente'), description: text('Serviço', 2000), address: text('Endereço', 500, 0), date: date('Data'), time: { type: 'string', title: 'Horário', format: 'time' } }, ['client', 'description'], true),
  tool('schedule_work_order', 'Agende uma visita', 'owner', { workOrder: query('Número da OS'), client: query('Cliente'), date: date('Data'), time: { type: 'string', title: 'Horário', format: 'time' } }, ['date', 'time'], true),
  tool('create_product', 'Cadastre um produto', 'owner', { name: text('Nome'), unit: text('Unidade', 50), price: money('Preço de venda (R$)') }, ['name', 'price'], true),
  tool('create_service', 'Cadastre um serviço', 'owner', { name: text('Nome'), unit: text('Unidade', 50), price: money('Preço de venda (R$)') }, ['name', 'price'], true),
  // Wave 2: documento citado pelo número; o banco revalida empresa, estado e vínculos.
  tool('owner_update_quote', 'Altere um orçamento', 'owner', { quote: query('Número do orçamento'), discount: money('Desconto (R$)'), surcharge: money('Acréscimo (R$)'), notes: text('Observações', 2000, 0) }, ['quote'], true),
  tool('owner_duplicate_quote', 'Duplique um orçamento', 'owner', { quote: query('Número do orçamento de origem'), client: query('Outro cliente (opcional)'),
    prices: { type: 'string', title: 'Valores', enum: ['same', 'current'] }, discount: money('Desconto (R$)'), surcharge: money('Acréscimo (R$)'), notes: text('Observações', 2000, 0) }, ['quote'], true),
  tool('owner_archive_quote', 'Arquive um orçamento', 'owner', { quote: query('Número do orçamento') }, ['quote'], true),
  tool('owner_unschedule_work_order', 'Tire uma OS da agenda', 'owner', { workOrder: query('Número da OS'), client: query('Cliente'), date: date('Data agendada') }, [], true),
  tool('owner_cancel_work_order', 'Cancele uma OS', 'owner', { workOrder: query('Número da OS'), client: query('Cliente'), date: date('Data agendada') }, [], true),
  tool('create_financial_entry', 'Lance uma receita', 'owner', {
    description: text('Descrição', 500), amount: money('Valor (R$)', 0.01, 999999999.99), dueDate: date('Vencimento'),
    paid: { type: 'boolean', title: 'Recebida' }, paidAt: date('Data do recebimento'),
    paymentMethod: { type: 'string', title: 'Forma de recebimento', enum: ['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer'] },
    client: query('Cliente'), category: text('Categoria', 120),
  }, ['description', 'amount', 'dueDate', 'paid'], true),
  tool('technician_today_orders', 'Quais OS tenho hoje?', 'technician'),
  tool('technician_next_appointment', 'Meu próximo atendimento', 'technician'),
  tool('technician_open_assigned_order', 'Abrir OS atribuída', 'technician', { workOrder: query('Número da OS') }, ['workOrder']),
  tool('add_assigned_work_report', 'Registrar o que foi feito', 'technician', { workOrder: query('Número da OS'), report: text('Relato', 10000) }, ['workOrder', 'report'], true),
  tool('mark_assigned_order_pending', 'Registrar pendência', 'technician', { workOrder: query('Número da OS'), note: text('Pendência', 3000) }, ['workOrder', 'note'], true),
  tool('mark_assigned_order_return', 'Marcar retorno', 'technician', { workOrder: query('Número da OS'), reason: text('Motivo do retorno', 3000) }, ['workOrder', 'reason'], true),
  tool('finalize_assigned_work_order', 'Finalizar esta OS', 'technician', { workOrder: query('Número da OS'), report: text('Relato final', 10000, 0) }, ['workOrder'], true),
  // Universal Owner V1: consultas do proprietário em public.zt_assistant_read (0096). Somente leitura;
  // o resultado vai só para a tela, nunca para o provedor de IA.
  ...[
    ['owner_client_history', 'Histórico do cliente', { client: query('Cliente'), clientRef, limit: count('Quantos atendimentos (1 a 10)', 10), query: query('Assunto, ex.: portão') }, ['client']],
    ['owner_work_order_details', 'Detalhes de uma OS', { workOrder: query('Número da OS') }, ['workOrder']],
    ['owner_client_equipment', 'Equipamentos instalados do cliente', { client: query('Cliente'), clientRef }, ['client']],
    ['owner_client_warranties', 'Garantias do cliente', { client: query('Cliente'), clientRef, active: { type: 'boolean', title: 'Somente garantias ativas' } }, ['client']],
    ['owner_expiring_warranties', 'Garantias vencendo', { days: count('Próximos dias', 365) }],
    ['owner_week_schedule', 'Agenda da semana'],
    ['owner_day_schedule', 'Agenda de um dia', { date: date('Data') }, ['date']],
    ['owner_unscheduled_work_orders', 'OS sem agenda'],
    ['owner_stock_level', 'Estoque de um produto', { query: query('Produto') }, ['query']],
    ['owner_low_stock', 'Produtos com estoque baixo'],
    ['owner_stock_movements', 'Movimentações de estoque', { query: query('Produto'), limit: count('Quantas movimentações (1 a 10)', 10) }, ['query']],
    ['owner_recent_purchases', 'Últimas compras', { limit: count('Quantas compras (1 a 10)', 10) }],
    ['owner_purchases_due', 'Compras a pagar', { days: count('Próximos dias', 365) }],
    ['owner_product_purchases', 'Compras de um produto no mês', { query: query('Produto'), month: month('Mês') }, ['query']],
    ['owner_maintenance_contracts', 'Contratos de manutenção', { client: query('Cliente (opcional)'), clientRef }],
    ['owner_contracts_due', 'Contratos com visita ou cobrança', { period: { type: 'string', title: 'month = este mês; overdue = visitas atrasadas', enum: ['month', 'overdue'] } }],
    ['owner_post_sale_due', 'Pós-venda pendente', { days: count('Próximos dias', 365) }],
    ['owner_inactive_clients', 'Clientes sem atendimento', { months: count('Meses sem atendimento', 36) }],
    ['owner_finance_summary', 'Resumo financeiro do mês', { month: month('Mês') }],
    ['owner_receivables', 'Contas a receber', { client: query('Cliente (opcional)'), clientRef, overdue: { type: 'boolean', title: 'Somente em atraso' } }],
    ['owner_overdue_clients', 'Clientes em atraso'],
    ['owner_operational_report', 'Relatório operacional do mês', { month: month('Mês') }],
  ].map(([name, label, properties = {}, required = []]) => read(name, label, properties, required)),
  // Universal Owner V1 · escritas que já têm RPC canônica (0097): prévia, confirmação e gravação única.
  tool('owner_convert_quote_to_work_order', 'Gerar OS do orçamento aprovado', 'owner', { quote: query('Número do orçamento'), date: date('Data do atendimento'),
    time: { type: 'string', title: 'Horário', format: 'time' } }, ['quote'], true),
  tool('owner_adjust_stock', 'Ajustar estoque', 'owner', { product: query('Produto'), quantity: { type: 'number', title: 'Quantidade', exclusiveMinimum: 0, maximum: 100000 },
    direction: { type: 'string', title: 'in = entrada; out = saída', enum: ['in', 'out'] }, notes: text('Observação', 1000, 0) }, ['product', 'quantity', 'direction'], true),
  tool('owner_create_warranty', 'Registrar garantia manual', 'owner', { client: query('Cliente'), clientRef,
    kind: { type: 'string', title: 'product = produto; service = serviço', enum: ['product', 'service'] }, description: text('Descrição', 500),
    startsOn: date('Início (padrão: hoje)'), months: count('Prazo em meses', 120), endsOn: date('Fim'), servicePlace: text('Local', 500, 0), serial: text('Número de série', 200, 0) },
    ['client', 'kind', 'description'], true),
  tool('owner_update_post_sale', 'Concluir ou dispensar pós-venda', 'owner', { client: query('Cliente'), clientRef,
    status: { type: 'string', title: 'done = concluído; dismissed = dispensado', enum: ['done', 'dismissed'] }, date: date('Data prevista'), note: text('Observação', 1000, 0) },
    ['client', 'status'], true),
]);
export const OWNER_WRITES = Object.freeze(['owner_convert_quote_to_work_order', 'owner_adjust_stock', 'owner_create_warranty', 'owner_update_post_sale']);
export const toolsForRole = (role) => ASSISTANT_TOOLS.filter((item) => item.roles.includes(role));
export const findAssistantTool = (name) => ASSISTANT_TOOLS.find((item) => item.name === name);

// Orçamento em linguagem natural: o provedor só repete nomes, quantidades e preços ditos pelo usuário.
// IDs, preços do catálogo e escolha entre homônimos são resolvidos pelo banco (zt_assistant_plan).
// O formulário manual continua com o formato simples de um item (inputSchema acima).
export const QUOTE_ITEM_KINDS = Object.freeze(['product', 'service', 'free']);
const quantity = { type: 'number', title: 'Quantidade', exclusiveMinimum: 0, maximum: 10000 };
export const QUOTE_DRAFT_NATURAL_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['client', 'items'], properties: {
    client: query('Cliente, como o usuário disse'),
    items: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['name', 'quantity'], properties: {
      kind: { type: 'string', title: 'product (produto), service (serviço) ou free (item livre com preço dito)', enum: QUOTE_ITEM_KINDS },
      name: text('Produto ou serviço como o usuário disse, no singular'), quantity, unit: text('Unidade', 50),
      unitPrice: money('Preço unitário (R$) somente se o usuário disse o valor'),
    } } },
    discount: money('Desconto (R$)'), surcharge: money('Acréscimo (R$)'), notes: text('Observações', 2000, 0), servicePlace: text('Local do serviço', 500, 0),
  },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decimals = (value, places) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;
const exactKeys = (value, keys) => { for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error('Campo não permitido.'); };
function quoteText(value, title, max, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new Error(`Verifique: ${title}.`);
  return value.trim();
}
function quoteNumber(value, title, { min = 0, max = 999999.99, places = 2, positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (positive && value <= 0) || !decimals(value, places)) throw new Error(`Valor fora do limite: ${title}.`);
  return value;
}
// Alterar/duplicar orçamento: o provedor recebe a lista final de itens; o banco casa cada item com a
// linha do documento (mesmo valor) ou resolve no catálogo. Valores só quando ditos pelo usuário.
const quoteItemsSchema = (title) => ({ type: 'array', minItems: 1, maxItems: 30, title, items: QUOTE_DRAFT_NATURAL_SCHEMA.properties.items.items });
export const QUOTE_UPDATE_NATURAL_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['quote'], properties: {
    quote: query('Número do orçamento (ex.: ORC-0003)'), items: quoteItemsSchema('Lista final completa de itens; omita se os itens não mudam'),
    discount: money('Desconto (R$)'), surcharge: money('Acréscimo (R$)'), notes: text('Observações', 2000, 0),
  },
});
export const QUOTE_DUPLICATE_NATURAL_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['quote'], properties: {
    quote: query('Número do orçamento de origem'), client: query('Outro cliente, só se o usuário disser'),
    prices: { type: 'string', title: 'same = mesmos valores do documento; current = preço atual do catálogo', enum: ['same', 'current'] },
    items: quoteItemsSchema('Lista final de itens; omita para copiar todos'), discount: money('Desconto (R$)'), surcharge: money('Acréscimo (R$)'), notes: text('Observações', 2000, 0),
  },
});
export const NATURAL_SCHEMAS = Object.freeze({ create_quote_draft: QUOTE_DRAFT_NATURAL_SCHEMA, owner_update_quote: QUOTE_UPDATE_NATURAL_SCHEMA, owner_duplicate_quote: QUOTE_DUPLICATE_NATURAL_SCHEMA });

function validateQuoteItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new Error('Informe de 1 a 30 itens.');
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Item inválido.');
    exactKeys(item, ['kind', 'name', 'quantity', 'unit', 'unitPrice', 'ref']);
    const clean = { name: quoteText(item.name, 'Item', 200), quantity: quoteNumber(item.quantity, 'Quantidade', { max: 10000, places: 3, positive: true }) };
    if (item.kind !== undefined) { if (!QUOTE_ITEM_KINDS.includes(item.kind)) throw new Error('Tipo de item inválido.'); clean.kind = item.kind; }
    if (item.unit !== undefined) clean.unit = quoteText(item.unit, 'Unidade', 50);
    if (item.unitPrice !== undefined) clean.unitPrice = quoteNumber(item.unitPrice, 'Preço unitário (R$)');
    if (item.ref !== undefined) { if (typeof item.ref !== 'string' || !UUID.test(item.ref)) throw new Error('Escolha inválida.'); clean.ref = item.ref; }
    return clean;
  });
}
const validateRef = (value) => { if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Escolha inválida.'); return value; };

// Espelha zt_private.assistant_validate_quote; refs só chegam de uma opção escolhida pelo usuário.
function validateQuoteDraft(input) {
  exactKeys(input, ['client', 'clientRef', 'items', 'discount', 'surcharge', 'notes', 'servicePlace']);
  const out = { client: quoteText(input.client, 'Cliente', 120) };
  if (input.clientRef !== undefined) out.clientRef = validateRef(input.clientRef);
  out.items = validateQuoteItems(input.items);
  for (const key of ['discount', 'surcharge']) if (input[key] !== undefined) out[key] = quoteNumber(input[key], key === 'discount' ? 'Desconto' : 'Acréscimo');
  for (const [key, max] of [['notes', 2000], ['servicePlace', 500]]) {
    if (input[key] !== undefined) { const value = quoteText(input[key], key === 'notes' ? 'Observações' : 'Local do serviço', max, 0); if (value) out[key] = value; }
  }
  return out;
}

// Espelha zt_private.assistant_validate_quote_change.
function validateQuoteChange(action, input) {
  const duplicate = action === 'owner_duplicate_quote';
  exactKeys(input, duplicate ? ['quote', 'client', 'clientRef', 'items', 'prices', 'discount', 'surcharge', 'notes'] : ['quote', 'items', 'discount', 'surcharge', 'notes']);
  const out = { quote: quoteText(input.quote, 'Orçamento', 120) };
  if (input.items !== undefined) out.items = validateQuoteItems(input.items);
  for (const key of ['discount', 'surcharge']) if (input[key] !== undefined) out[key] = quoteNumber(input[key], key === 'discount' ? 'Desconto' : 'Acréscimo');
  if (input.notes !== undefined) out.notes = quoteText(input.notes, 'Observações', 2000);
  if (duplicate) {
    if (input.client !== undefined) out.client = quoteText(input.client, 'Cliente', 120);
    if (input.clientRef !== undefined) out.clientRef = validateRef(input.clientRef);
    if (input.prices !== undefined) { if (!['same', 'current'].includes(input.prices)) throw new Error('Opção inválida: Valores.'); out.prices = input.prices; }
  } else if (!['items', 'discount', 'surcharge', 'notes'].some((key) => key in out)) throw new Error('Diga o que deve mudar no orçamento.');
  return out;
}

export function validateAssistantInput(action, input, role) {
  const item = findAssistantTool(action);
  if (!item || !item.roles.includes(role)) throw new Error('Ação não permitida para este acesso.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informe os dados da ação.');
  if (action === 'create_quote_draft' && Object.hasOwn(input, 'items')) return validateQuoteDraft(input);
  if (action === 'owner_update_quote' || action === 'owner_duplicate_quote') return validateQuoteChange(action, input);
  const { properties, required } = item.inputSchema;
  for (const key of Object.keys(input)) if (!Object.hasOwn(properties, key)) throw new Error('Campo não permitido.');
  for (const key of required) if (!Object.hasOwn(input, key)) throw new Error(`Informe: ${properties[key].title}.`);
  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    const jsType = rule.type === 'integer' ? 'number' : rule.type;
    if (typeof value !== jsType || (jsType === 'number' && !Number.isFinite(value)) || (rule.type === 'integer' && !Number.isInteger(value))) throw new Error(`Valor inválido: ${rule.title}.`);
    const clean = typeof value === 'string' ? value.trim() : value;
    if (rule.type === 'string') {
      if (clean.length < (rule.minLength ?? 0) || clean.length > (rule.maxLength ?? 10000)) throw new Error(`Verifique: ${rule.title}.`);
      if (rule.enum && !rule.enum.includes(clean)) throw new Error(`Opção inválida: ${rule.title}.`);
      if (rule.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || !Number.isFinite(Date.parse(`${clean}T12:00:00Z`)) || new Date(`${clean}T12:00:00Z`).toISOString().slice(0, 10) !== clean)) throw new Error('Data inválida.');
      if (rule.format === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean)) throw new Error('Horário inválido.');
      if (rule.format === 'month' && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(clean)) throw new Error('Mês inválido.');
      if (rule.format === 'uuid' && !UUID.test(clean)) throw new Error('Escolha inválida.');
    }
    if (jsType === 'number' && (clean < (rule.minimum ?? -Infinity) || clean > (rule.maximum ?? Infinity) || (rule.exclusiveMinimum !== undefined && clean <= rule.exclusiveMinimum))) throw new Error(`Valor fora do limite: ${rule.title}.`);
    normalized[key] = clean;
  }
  if (action === 'create_financial_entry') {
    if (normalized.paid && (!normalized.paidAt || !normalized.paymentMethod)) throw new Error('Informe data e forma do recebimento.');
    if (!normalized.paid && (normalized.paidAt || normalized.paymentMethod)) throw new Error('Uma receita pendente não pode ter recebimento informado.');
  }
  if (action === 'create_work_order' && Boolean(normalized.date) !== Boolean(normalized.time)) throw new Error('Informe data e horário juntos para agendar a OS.');
  if (['schedule_work_order', 'owner_unschedule_work_order', 'owner_cancel_work_order'].includes(action) && Boolean(normalized.workOrder) === Boolean(normalized.client)) throw new Error('Informe o cliente ou o número da OS, somente um deles.');
  if (OWNER_WRITES.includes(action)) {
    for (const [key, value] of Object.entries(normalized)) if (value === '') delete normalized[key];
    if (action === 'owner_convert_quote_to_work_order' && normalized.time && !normalized.date) throw new Error('Informe a data junto com o horário.');
    if (action === 'owner_create_warranty' && normalized.months === undefined && !normalized.endsOn) throw new Error('Informe o prazo em meses ou a data final da garantia.');
    if (action === 'owner_adjust_stock' && !decimals(normalized.quantity, 3)) throw new Error('Valor fora do limite: Quantidade.');
  }
  return normalized;
}
