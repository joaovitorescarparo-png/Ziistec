import { readFileSync } from 'node:fs';

const failures = [];
const ok = (message) => console.log(`✓ ${message}`);
const fail = (message) => failures.push(message);
const read = (file) => readFileSync(file, 'utf8');

const migration = read('supabase/0066_owner_soft_delete_core_records.sql');
for (const marker of [
  'add column if not exists deleted_at timestamptz',
  'zt_guard_owner_soft_delete',
  'if not public.zt_is_owner(old.company_id)',
  "'clients','services','products','quotes','work_orders','purchases','financial_entries','warranties'",
]) {
  if (!migration.includes(marker)) fail(`0066 perdeu marcador de soft delete seguro: ${marker}`);
}
if (/\bdelete\s+from\b/i.test(migration)) fail('0066 não deve apagar fisicamente registros operacionais');
else ok('0066 implementa soft delete owner-only sem DELETE físico');

const dataApi = read('src/lib/dataApi.js');
for (const marker of [
  'SOFT_DELETE_TABLES',
  'excluirRegistroDB',
  ".update({ deleted_at: new Date().toISOString() })",
  ".eq('company_id', companyId)",
  "servico: 'services'",
  "produto: 'products'",
  "orcamento: 'quotes'",
  "os: 'work_orders'",
  "garantia: 'warranties'",
]) {
  if (!dataApi.includes(marker)) fail(`dataApi soft delete incompleto: ${marker}`);
}
if (/\.from\([^\n]+\)\s*\.delete\s*\(/m.test(dataApi)) fail('dataApi reintroduziu DELETE físico em registros operacionais');
else ok('dataApi usa atualização de deleted_at e mantém escopo por empresa');

const app = read('src/legacy/ZiisTecApp.jsx');
for (const marker of [
  'menuExpandido',
  'Mostrar nomes das funções',
  'excluirRegistroDB',
  'Somente o proprietário pode excluir registros.',
  'papel === "proprietario"',
  'Remover da agenda?',
  'desagendarOS(os.id)',
]) {
  if (!app.includes(marker)) fail(`UI Round 3.1 perdeu marcador: ${marker}`);
}
if (!app.includes('excluidoEm')) fail('UI não diferencia clientes arquivados para preservar histórico');
else ok('UI oculta/identifica arquivados sem destruir histórico');

const pdf = read('api/quote-pdf.js');
for (const marker of [
  'logo_path',
  'zt-branding',
  'ORÇAMENTO',
  'CONDIÇÕES DE PAGAMENTO',
  'const sigW = 190',
  "company.owner_name || 'Responsável'",
  'ZiisTec ·',
]) {
  if (!pdf.includes(marker)) fail(`PDF premium perdeu marcador: ${marker}`);
}
if ((pdf.match(/page\.drawLine\(\{ start:/g) || []).length < 2) fail('PDF premium perdeu as linhas de assinatura/estrutura visual');
else ok('PDF premium mantém áreas de assinatura para responsável e cliente');
const quoteItemsLine = pdf.split('\n').find((line) => line.includes('/rest/v1/quote_items?')) || '';
if (/unit_cost|\bcost\b|margin|margem/i.test(quoteItemsLine)) fail('PDF premium expõe custo/margem na consulta pública');
else ok('PDF premium mantém custos internos fora do documento do cliente');

if (failures.length) {
  console.error('\nROUND 3.1 SECURITY/UX CHECK: FAIL\n');
  failures.forEach((message, index) => console.error(`${index + 1}. ${message}`));
  process.exit(1);
}

console.log('\nROUND 3.1 SECURITY/UX CHECK: OK');