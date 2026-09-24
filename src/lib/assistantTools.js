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
export const ASSISTANT_TOOLS = Object.freeze([
  tool('owner_today_schedule', 'O que tenho hoje?', 'owner'),
  tool('owner_find_client', 'Buscar cliente', 'owner', { query: query('Nome do cliente') }, ['query']),
  tool('owner_find_quote', 'Buscar orçamento', 'owner', { query: query('Número do orçamento') }, ['query']),
  tool('owner_find_work_order', 'Buscar OS', 'owner', { query: query('Número da OS') }, ['query']),
  tool('create_client', 'Cadastre um cliente', 'owner', { name: text('Nome'), phone: text('Telefone', 40, 0), address: text('Endereço', 500, 0) }, ['name'], true),
  tool('create_quote_draft', 'Crie um orçamento', 'owner', {
    client: query('Cliente'), description: text('Serviço', 500), quantity: { type: 'number', title: 'Quantidade', exclusiveMinimum: 0, maximum: 10000 },
    unit: text('Unidade', 50), unitPrice: money('Preço unitário (R$)'),
  }, ['client', 'description', 'quantity', 'unitPrice'], true),
  tool('create_work_order', 'Crie uma OS', 'owner', { client: query('Cliente'), description: text('Serviço', 2000), address: text('Endereço', 500, 0) }, ['client', 'description'], true),
  tool('schedule_work_order', 'Agende uma visita', 'owner', { workOrder: query('Número da OS'), date: date('Data'), time: { type: 'string', title: 'Horário', format: 'time' } }, ['workOrder', 'date', 'time'], true),
  tool('create_product', 'Cadastre um produto', 'owner', { name: text('Nome'), unit: text('Unidade', 50), price: money('Preço de venda (R$)') }, ['name', 'price'], true),
  tool('create_financial_entry', 'Lance uma receita', 'owner', {
    description: text('Descrição', 500), amount: money('Valor (R$)', 0.01, 999999999.99), dueDate: date('Vencimento'),
    paid: { type: 'boolean', title: 'Recebida' }, paidAt: date('Data do recebimento'),
    paymentMethod: { type: 'string', title: 'Forma de recebimento', enum: ['pix', 'cash', 'credit_card', 'debit_card', 'bank_transfer'] },
    client: query('Cliente'), category: text('Categoria', 120),
  }, ['description', 'amount', 'dueDate', 'paid'], true),
  tool('technician_today_orders', 'Quais OS tenho hoje?', 'technician'),
  tool('technician_open_assigned_order', 'Abrir OS atribuída', 'technician', { workOrder: query('Número da OS') }, ['workOrder']),
  tool('add_assigned_work_report', 'Registrar o que foi feito', 'technician', { workOrder: query('Número da OS'), report: text('Relato', 10000) }, ['workOrder', 'report'], true),
  tool('mark_assigned_order_pending', 'Registrar pendência', 'technician', { workOrder: query('Número da OS'), note: text('Pendência', 3000) }, ['workOrder', 'note'], true),
  tool('mark_assigned_order_return', 'Marcar retorno', 'technician', { workOrder: query('Número da OS'), reason: text('Motivo do retorno', 3000) }, ['workOrder', 'reason'], true),
  tool('finalize_assigned_work_order', 'Finalizar esta OS', 'technician', { workOrder: query('Número da OS'), report: text('Relato final', 10000, 0) }, ['workOrder'], true),
]);
export const toolsForRole = (role) => ASSISTANT_TOOLS.filter((item) => item.roles.includes(role));
export const findAssistantTool = (name) => ASSISTANT_TOOLS.find((item) => item.name === name);

export function validateAssistantInput(action, input, role) {
  const item = findAssistantTool(action);
  if (!item || !item.roles.includes(role)) throw new Error('Ação não permitida para este acesso.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Informe os dados da ação.');
  const { properties, required } = item.inputSchema;
  for (const key of Object.keys(input)) if (!Object.hasOwn(properties, key)) throw new Error('Campo não permitido.');
  for (const key of required) if (!Object.hasOwn(input, key)) throw new Error(`Informe: ${properties[key].title}.`);
  const normalized = {};
  for (const [key, value] of Object.entries(input)) {
    const rule = properties[key];
    if (typeof value !== rule.type || (rule.type === 'number' && !Number.isFinite(value))) throw new Error(`Valor inválido: ${rule.title}.`);
    const clean = typeof value === 'string' ? value.trim() : value;
    if (rule.type === 'string') {
      if (clean.length < (rule.minLength ?? 0) || clean.length > (rule.maxLength ?? 10000)) throw new Error(`Verifique: ${rule.title}.`);
      if (rule.enum && !rule.enum.includes(clean)) throw new Error(`Opção inválida: ${rule.title}.`);
      if (rule.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || !Number.isFinite(Date.parse(`${clean}T12:00:00Z`)) || new Date(`${clean}T12:00:00Z`).toISOString().slice(0, 10) !== clean)) throw new Error('Data inválida.');
      if (rule.format === 'time' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean)) throw new Error('Horário inválido.');
    }
    if (rule.type === 'number' && (clean < (rule.minimum ?? -Infinity) || clean > (rule.maximum ?? Infinity) || (rule.exclusiveMinimum !== undefined && clean <= rule.exclusiveMinimum))) throw new Error(`Valor fora do limite: ${rule.title}.`);
    normalized[key] = clean;
  }
  if (action === 'create_financial_entry') {
    if (normalized.paid && (!normalized.paidAt || !normalized.paymentMethod)) throw new Error('Informe data e forma do recebimento.');
    if (!normalized.paid && (normalized.paidAt || normalized.paymentMethod)) throw new Error('Uma receita pendente não pode ter recebimento informado.');
  }
  return normalized;
}
