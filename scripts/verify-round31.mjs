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
  'menuTouchX',
  'style={{ touchAction: "pan-y" }}',
  'onTouchStart=',
  'onTouchMove=',
  'Menu lateral: arraste para abrir ou recolher',
  'excluirRegistroDB',
  'Somente o proprietário pode excluir registros.',
  'papel === "proprietario"',
  'Remover da agenda?',
  'desagendarOS(os.id)',
]) {
  if (!app.includes(marker)) fail(`UI Round 3.2 perdeu marcador: ${marker}`);
}
if (app.includes('Mostrar nomes das funções')) fail('UI Round 3.2 reintroduziu a setinha/botão lateral que deve ser substituída pelo gesto');
else ok('Barra lateral usa a faixa azul inteira como gaveta por gesto, sem setinha dedicada');
if (!app.includes('excluidoEm')) fail('UI não diferencia clientes arquivados para preservar histórico');
else ok('UI oculta/identifica arquivados sem destruir histórico');

const logoImage = read('src/lib/logoImage.js');
const logoFailureCount = failures.length;
for (const marker of [
  'removerFundoBrancoConectado',
  'caixaConteudo',
  'prepararLogoTransparente',
  "'logo-limpa.png'",
  "'image/png'",
]) {
  if (!logoImage.includes(marker)) fail(`Tratamento da logo perdeu marcador: ${marker}`);
}
if (failures.length === logoFailureCount) ok('Logo é recortada no navegador e o fundo branco conectado às bordas vira transparência');

const storageExtras = read('src/lib/storageExtras.js');
const storageFailureCount = failures.length;
for (const marker of [
  "import { prepararLogoTransparente } from './logoImage';",
  'logo-clean-',
  'prepararLogoTransparente(source)',
  ".eq('logo_path',path)",
  "contentType:'image/png'",
]) {
  if (!storageExtras.includes(marker)) fail(`Migração automática da logo perdeu marcador: ${marker}`);
}
if (failures.length === storageFailureCount) ok('Logos antigas são migradas para PNG limpa de forma idempotente');

const pdf = read('api/quote-pdf.js');
for (const marker of [
  'logo_path',
  'zt-branding',
  'ORÇAMENTO',
  'CONDIÇÕES DE PAGAMENTO',
  'const sigW = 190',
  'company.owner_name',
  'ZiisTec ·',
  'const txtRight =',
  'Tabela com grade visual consistente e números alinhados pela direita.',
  'qtyRight',
  'unitRight',
  'totalRight',
  'const minVisibleRows = 6',
  'Card inferior com altura dinâmica e sem cruzar a área de assinatura.',
  "Marca-d'água ampla e suave por trás do conteúdo.",
  'drawPageWatermark();',
  'const wmW = 285',
  'drawLogoFit(page, logo, margin, A4[1] - 100, 128, 68, 1)',
]) {
  if (!pdf.includes(marker)) fail(`PDF premium perdeu marcador: ${marker}`);
}
if (!/const\s+SAFE_BOTTOM\s*=\s*66\s*;?/.test(pdf)) fail('PDF perdeu a zona segura inferior de 66 pt');
else ok('PDF mantém zona segura inferior de 66 pt');
if (!/company\.owner_name\s*\|\|\s*['"]Responsável['"]/.test(pdf) && !pdf.includes("Responsável")) fail('PDF perdeu o responsável da assinatura');
else ok('PDF mantém responsável na área de assinatura');
if (pdf.includes('const watermarkBandH =')) fail('PDF voltou a limitar a marca-d’água apenas às linhas vazias');
else ok('PDF usa marca-d’água ampla por trás do conteúdo, desenhada antes dos textos');
if (!pdf.includes('while (fillerRows > 0 && y - 32 > 300)')) fail('PDF perdeu o preenchimento estrutural seguro para orçamentos com poucos itens');
else ok('PDF usa linhas vazias estruturadas para reduzir espaço solto sem inventar itens');
if (!pdf.includes('if (y - signatureH < SAFE_BOTTOM) newPage(true);')) fail('PDF perdeu a proteção das assinaturas contra o rodapé');
else ok('Assinaturas respeitam zona segura e não podem invadir o rodapé');
if ((pdf.match(/page\.drawLine\(\{ start:/g) || []).length < 2) fail('PDF premium perdeu as linhas de assinatura/estrutura visual');
else ok('PDF premium mantém áreas de assinatura para responsável e cliente');
const quoteItemsLine = pdf.split('\n').find((line) => line.includes('/rest/v1/quote_items?')) || '';
if (/unit_cost|\bcost\b|margin|margem/i.test(quoteItemsLine)) fail('PDF premium expõe custo/margem na consulta pública');
else ok('PDF premium mantém custos internos fora do documento do cliente');

if (failures.length) {
  console.error('\nROUND 3.4 SECURITY/UX CHECK: FAIL\n');
  failures.forEach((message, index) => console.error(`${index + 1}. ${message}`));
  process.exit(1);
}

console.log('\nROUND 3.4 SECURITY/UX CHECK: OK');
