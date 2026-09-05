import { readFileSync, writeFileSync } from 'node:fs';

const replaceOnce = (src, needle, replacement, label) => {
  if (src.includes(replacement)) return src;
  const count = src.split(needle).length - 1;
  if (count !== 1) throw new Error(`Round 3.7 ${label}: expected 1 marker, got ${count}`);
  return src.replace(needle, replacement);
};

const patchSelectClientMapper = (src, startMarker, variable, condition, label) => {
  const startCount = src.split(startMarker).length - 1;
  if (startCount !== 1) throw new Error(`Round 3.7 ${label}: expected 1 select marker, got ${startCount}`);
  const start = src.indexOf(startMarker);
  const end = src.indexOf('</Select>', start);
  if (end < 0) throw new Error(`Round 3.7 ${label}: closing Select not found`);
  const block = src.slice(start, end);
  const already = new RegExp(`clientes\\.filter\\(\\(${variable}\\)\\s*=>`).test(block);
  if (already) return src;
  const mapper = new RegExp(`clientes\\.map\\(\\(${variable}\\)\\s*=>`);
  if (!mapper.test(block)) throw new Error(`Round 3.7 ${label}: client mapper not found inside Select`);
  const patched = block.replace(mapper, `clientes.filter((${variable}) => ${condition}).map((${variable}) =>`);
  return src.slice(0, start) + patched + src.slice(end);
};

// ---------------------------------------------------------------- legacy
{
  const file = 'src/legacy/ZiisTecApp.jsx';
  let src = readFileSync(file, 'utf8');

  src = replaceOnce(
    src,
    'CATÁLOGO DE CLIENTES: ${JSON.stringify(clientes.map((c) => ({ id: c.id, nome: c.fantasia || c.nome })))}',
    'CATÁLOGO DE CLIENTES: ${JSON.stringify(clientes.filter((c) => !c.excluidoEm).map((c) => ({ id: c.id, nome: c.fantasia || c.nome })))}',
    'AI client catalog excludes archived clients',
  );

  src = patchSelectClientMapper(
    src,
    '<Select value={d.clienteId}',
    'x',
    '!x.excluidoEm || x.id === d.clienteId',
    'quote client picker excludes archived clients except current historical value',
  );

  src = patchSelectClientMapper(
    src,
    '<Select value={f.clienteId}',
    'c',
    '!c.excluidoEm || c.id === f.clienteId',
    'work order client picker excludes archived clients except current historical value',
  );

  src = patchSelectClientMapper(
    src,
    '<Select value={form.clienteId || ""}',
    'c',
    '!c.excluidoEm || c.id === form.clienteId',
    'manual income client picker excludes archived clients except current historical value',
  );

  writeFileSync(file, src, 'utf8');
}

// --------------------------------------------------------- Quote AI V2 base
{
  const file = 'src/lib/quoteV2Api.js';
  let src = readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "supabase.from('clients').select('id,name,trade_name,phone,whatsapp,address').eq('company_id',companyId).order('name'),",
    "supabase.from('clients').select('id,name,trade_name,phone,whatsapp,address').eq('company_id',companyId).is('deleted_at',null).order('name'),",
    'Quote AI clients exclude archived rows',
  );
  src = replaceOnce(
    src,
    "supabase.from('services').select('id,name,category,unit,price,cost,active').eq('company_id',companyId).order('name'),",
    "supabase.from('services').select('id,name,category,unit,price,cost,active').eq('company_id',companyId).is('deleted_at',null).order('name'),",
    'Quote AI services exclude archived rows',
  );
  src = replaceOnce(
    src,
    "supabase.from('products').select('id,name,brand,model,unit,price,cost,active').eq('company_id',companyId).order('name'),",
    "supabase.from('products').select('id,name,brand,model,unit,price,cost,active').eq('company_id',companyId).is('deleted_at',null).order('name'),",
    'Quote AI products exclude archived rows',
  );
  writeFileSync(file, src, 'utf8');
}

// ----------------------------------------------- Manual warranty/new contract options
{
  const file = 'src/lib/v2Api.js';
  let src = readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    "supabase.from('clients').select('id,name,trade_name,address').eq('company_id',companyId).order('name',{ascending:true}),",
    "supabase.from('clients').select('id,name,trade_name,address').eq('company_id',companyId).is('deleted_at',null).order('name',{ascending:true}),",
    'manual warranty clients exclude archived rows',
  );
  src = replaceOnce(
    src,
    "supabase.from('services').select('id,name,category,warranty_days,active').eq('company_id',companyId).eq('active',true).order('name',{ascending:true}),",
    "supabase.from('services').select('id,name,category,warranty_days,active').eq('company_id',companyId).eq('active',true).is('deleted_at',null).order('name',{ascending:true}),",
    'manual warranty services exclude archived rows',
  );
  src = replaceOnce(
    src,
    "supabase.from('products').select('id,name,brand,model,warranty_months,active').eq('company_id',companyId).eq('active',true).order('name',{ascending:true}),",
    "supabase.from('products').select('id,name,brand,model,warranty_months,active').eq('company_id',companyId).eq('active',true).is('deleted_at',null).order('name',{ascending:true}),",
    'manual warranty products exclude archived rows',
  );
  writeFileSync(file, src, 'utf8');
}

// -------------------------------------------------------------- Purchases V2
{
  const file = 'src/lib/purchaseV2Api.js';
  let src = readFileSync(file, 'utf8');
  src = replaceOnce(
    src,
    ".select('id,name,brand,model,unit,cost,active,stock_qty,track_stock')\n      .eq('company_id',companyId)\n      .order('name',{ascending:true}),",
    ".select('id,name,brand,model,unit,cost,active,stock_qty,track_stock')\n      .eq('company_id',companyId)\n      .is('deleted_at',null)\n      .order('name',{ascending:true}),",
    'purchase product picker excludes archived rows',
  );
  writeFileSync(file, src, 'utf8');
}

console.log('Applied Round 3.7 archived-reference creation guards');
