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

const pdf = read('api/quote-pdf.js');
for (const marker of [
  'logo_path',
  'zt-branding',
  'ORÇAMENTO',
  'CONDIÇÕES DE PAGAMENTO',
  'const sigW = 190',
  'ZiisTec ·',
  'const txtRight =',
  'Tabela com grade visual consistente e números alinhados pela direita.',
  'qtyRight',
  'unitRight',
  'totalRight',
  'const SAFE_BOTTOM = 72',
  'const minVisibleRows = 6',
  "const companyTextX = logo ? margin + 116 : margin",
  'Grade vazia estruturada; a marca-d\'água só ocupa essa área sem texto.',
  'const watermarkBandH = fillerTop - fillerBottom',
  'drawLogoFit(page, logo, tableRight - wmW - 14, wmY, wmW, wmH, 0.055)',
  'Calcula o bloco inferior antes de desenhar: total, informações e assinaturas ficam juntos.',
  'Assinaturas com rótulo e nome em área própria; nunca invadem rodapé ou card.',
]) {
  if (!pdf.includes(marker)) fail(`PDF premium perdeu marcador: ${marker}`);
}
if (pdf.includes("page.drawRectangle({ x: margin, y: A4[1] - 101, width: 132, height: 70, color: white })")) {
  fail('PDF reintroduziu a caixa branca rígida atrás da logo do cabeçalho');
} else ok('Logo do cabeçalho é renderizada diretamente, sem quadrado branco extra');
if (pdf.includes('drawWatermark(page)')) fail('PDF reintroduziu a marca-d’água de página inteira que podia cruzar textos');
else ok('Marca-d’água não é desenhada sobre a página inteira');
if (!pdf.includes('while (fillerRows > 0 && y - 32 > 300)')) fail('PDF perdeu o preenchimento estrutural seguro para orçamentos com poucos itens');
else ok('PDF usa linhas vazias estruturadas para reduzir espaço solto sem inventar itens');
if (!pdf.includes('if (y - signatureH < SAFE_BOTTOM) newPage(true);')) fail('PDF perdeu a proteção das assinaturas contra o rodapé');
else ok('Assinaturas respeitam zona segura e não podem invadir o rodapé');
if (!pdf.includes('if (y - lowerBlockH < SAFE_BOTTOM) newPage(true);')) fail('PDF perdeu a reserva conjunta do bloco inferior');
else ok('Total, card inferior e assinaturas são reservados antes do desenho');
if ((pdf.match(/page\.drawLine\(\{ start:/g) || []).length < 2) fail('PDF premium perdeu as linhas de assinatura/estrutura visual');
else ok('PDF premium mantém áreas de assinatura para responsável e cliente');
const quoteItemsLine = pdf.split('\n').find((line) => line.includes('/rest/v1/quote_items?')) || '';
if (/unit_cost|\bcost\b|margin|margem/i.test(quoteItemsLine)) fail('PDF premium expõe custo/margem na consulta pública');
else ok('PDF premium mantém custos internos fora do documento do cliente');

if (failures.length) {
  console.error('\nROUND 3.3 SECURITY/UX CHECK: FAIL\n');
  failures.forEach((message, index) => console.error(`${index + 1}. ${message}`));
  process.exit(1);
}

console.log('\nROUND 3.3 SECURITY/UX CHECK: OK');