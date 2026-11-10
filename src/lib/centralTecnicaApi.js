import { supabase } from './supabase';

/*
  Central Técnica — camada de dados.
  Escopos: company_id null = biblioteca global ZiisTec (somente leitura no
  cliente); company_id preenchido = conteúdo privado da empresa (RLS).
  Buscas passam pela RPC zt_equipment_search; casos reais pela RPC
  zt_equipment_cases (sanitizada no banco: nunca devolve cliente/financeiro).
*/

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const safe = (name) => String(name || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-120);

export const TIPOS_DOC = [
  { id: 'manual', label: 'Manual' }, { id: 'datasheet', label: 'Datasheet' },
  { id: 'diagram', label: 'Esquema' }, { id: 'guide', label: 'Guia' },
  { id: 'installation', label: 'Instalação' }, { id: 'programming', label: 'Programação' },
  { id: 'troubleshooting', label: 'Troubleshooting' }, { id: 'firmware', label: 'Firmware' },
  { id: 'other', label: 'Outro' },
];
export const TIPOS_SECAO = [
  { id: 'power', label: 'Alimentação' }, { id: 'wiring', label: 'Ligações e bornes' },
  { id: 'programming', label: 'Programação' }, { id: 'reset', label: 'Reset' },
  { id: 'parameters', label: 'Parâmetros' }, { id: 'diagnostics', label: 'Diagnóstico' },
  { id: 'codes', label: 'Códigos e LEDs' }, { id: 'alerts', label: 'Alertas' },
  { id: 'other', label: 'Outras informações' },
];

const fromCategoria = (x) => ({ id: x.id, nome: x.name, slug: x.slug, icone: x.icon || null, global: !x.company_id, ativo: x.active });
const fromFabricante = (x) => ({ id: x.id, nome: x.name, site: x.website || '', global: !x.company_id, ativo: x.active });
const fromModelo = (x) => ({
  id: x.id, nome: x.name, codigo: x.model_code || '', descricao: x.description || '',
  tags: x.tags || [], global: !x.company_id, status: x.status,
  fabricanteId: x.manufacturer_id, fabricante: x.equipment_manufacturers?.name || x.manufacturer_name || '',
  categoriaId: x.category_id, categoria: x.equipment_categories?.name || x.category_name || '',
});
const fromBusca = (x) => ({
  id: x.model_id, nome: x.name, codigo: x.model_code || '', descricao: x.description || '',
  fabricanteId: x.manufacturer_id, fabricante: x.manufacturer_name || '',
  categoriaId: x.category_id, categoria: x.category_name || '',
  global: x.scope === 'global', onde: x.matched_in || [],
});
const fromDocumento = (x) => ({
  id: x.id, modeloId: x.model_id, titulo: x.title, tipo: x.doc_type, versao: x.version || '',
  idioma: x.language || 'pt-BR', origem: x.source_kind, url: x.official_url || null,
  bucket: x.bucket || null, path: x.path || null, arquivo: x.file_name || '',
  oficial: Boolean(x.is_official), status: x.status, global: !x.company_id,
  criadoEm: (x.created_at || '').slice(0, 10),
});
const fromFicha = (x) => x ? ({
  id: x.id, modeloId: x.model_id, titulo: x.title, secoes: x.sections || [],
  versao: x.version, global: !x.company_id, atualizadoEm: (x.updated_at || '').slice(0, 10),
}) : null;
const fromCaso = (x) => ({
  id: x.case_id, numero: x.wo_number, concluidoEm: x.completed_on,
  sintoma: x.symptom || '', relato: x.report || '', pendencia: x.pending_note || '',
  precisouRetorno: Boolean(x.needs_return), obsVinculo: x.linked_notes || '',
});

/* ------------------------------------------------------------- leitura */
export async function carregarHomeCT(companyId, userId) {
  const [cats, favs, recs, areas] = await Promise.all([
    supabase.from('equipment_categories').select('*')
      .or(`company_id.is.null,company_id.eq.${companyId}`).eq('active', true).order('name'),
    supabase.from('equipment_favorites')
      .select('model_id, equipment_models(*, equipment_manufacturers(name), equipment_categories(name))')
      .eq('company_id', companyId).eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    supabase.from('equipment_recent_views')
      .select('model_id, viewed_at, equipment_models(*, equipment_manufacturers(name), equipment_categories(name))')
      .eq('company_id', companyId).eq('user_id', userId).order('viewed_at', { ascending: false }).limit(10),
    supabase.from('company_technical_areas').select('category_id').eq('company_id', companyId),
  ]);
  const areaIds = new Set((check(areas) || []).map((a) => a.category_id));
  const categorias = (check(cats) || []).map(fromCategoria);
  return {
    categorias,
    areas: [...areaIds],
    favoritos: (check(favs) || []).filter((f) => f.equipment_models).map((f) => fromModelo(f.equipment_models)),
    recentes: (check(recs) || []).filter((r) => r.equipment_models).map((r) => fromModelo(r.equipment_models)),
  };
}

export async function buscarEquipamentosCT(companyId, texto, categoriaId = null) {
  const r = await supabase.rpc('zt_equipment_search', {
    p_company: companyId, p_query: texto, p_category: categoriaId, p_limit: 30, p_offset: 0,
  });
  return (check(r) || []).map(fromBusca);
}

export async function listarModelosCategoriaCT(companyId, categoriaId, offset = 0) {
  const r = await supabase.from('equipment_models')
    .select('*, equipment_manufacturers(name), equipment_categories(name)')
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .eq('category_id', categoriaId).eq('status', 'active')
    .order('name').range(offset, offset + 29);
  return (check(r) || []).map(fromModelo);
}

export async function abrirEquipamentoCT(companyId, userId, modeloId) {
  const [mod, guias, docs, fav, casosN] = await Promise.all([
    supabase.from('equipment_models')
      .select('*, equipment_manufacturers(name, website), equipment_categories(name)')
      .eq('id', modeloId).single(),
    supabase.from('equipment_quick_guides').select('*')
      .eq('model_id', modeloId).eq('status', 'active')
      .or(`company_id.is.null,company_id.eq.${companyId}`),
    supabase.from('equipment_documents').select('*')
      .eq('model_id', modeloId).eq('status', 'active')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .order('created_at', { ascending: false }).limit(100),
    supabase.from('equipment_favorites').select('model_id')
      .eq('company_id', companyId).eq('user_id', userId).eq('model_id', modeloId).maybeSingle(),
    supabase.rpc('zt_equipment_cases_count', { p_company: companyId, p_model: modeloId }),
  ]);
  // registra "recente" sem bloquear a abertura
  supabase.from('equipment_recent_views')
    .upsert({ user_id: userId, company_id: companyId, model_id: modeloId, viewed_at: new Date().toISOString() })
    .then(() => {}, () => {});
  const fichas = (check(guias) || []).map(fromFicha);
  const fichaEmpresa = fichas.find((f) => !f.global) || null;
  const fichaGlobal = fichas.find((f) => f.global) || null;
  return {
    modelo: fromModelo(check(mod)),
    ficha: fichaEmpresa || fichaGlobal,
    fichaEmpresa, fichaGlobal,
    documentos: (check(docs) || []).map(fromDocumento),
    favorito: Boolean(fav.data),
    totalCasos: Number(casosN.error ? 0 : casosN.data || 0),
  };
}

export async function casosEquipamentoCT(companyId, modeloId, offset = 0) {
  const r = await supabase.rpc('zt_equipment_cases', {
    p_company: companyId, p_model: modeloId, p_limit: 10, p_offset: offset,
  });
  return (check(r) || []).map(fromCaso);
}

export async function alternarFavoritoCT(userId, companyId, modeloId, favoritar) {
  if (favoritar) {
    check(await supabase.from('equipment_favorites')
      .upsert({ user_id: userId, company_id: companyId, model_id: modeloId }));
  } else {
    check(await supabase.from('equipment_favorites').delete()
      .eq('user_id', userId).eq('company_id', companyId).eq('model_id', modeloId));
  }
  return favoritar;
}

/* --------------------------------------------- gestão (owner da empresa) */
export async function listarFabricantesCT(companyId) {
  const r = await supabase.from('equipment_manufacturers').select('*')
    .or(`company_id.is.null,company_id.eq.${companyId}`).eq('active', true).order('name');
  return (check(r) || []).map(fromFabricante);
}

export async function salvarFabricanteCT(companyId, f) {
  const row = { company_id: companyId, name: f.nome?.trim(), website: f.site?.trim() || null };
  const r = await supabase.from('equipment_manufacturers').insert(row).select().single();
  return fromFabricante(check(r));
}

export async function salvarModeloCT(companyId, m, userId) {
  const row = {
    company_id: companyId, manufacturer_id: m.fabricanteId, category_id: m.categoriaId,
    name: m.nome?.trim(), model_code: m.codigo?.trim() || null,
    description: m.descricao?.trim() || null,
    tags: (m.tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 20),
    created_by: userId || null,
  };
  const payload = m.id ? { ...row, id: m.id } : row;
  const r = await supabase.from('equipment_models').upsert(payload).select('*, equipment_manufacturers(name), equipment_categories(name)').single();
  return fromModelo(check(r));
}

export async function salvarFichaCT(companyId, modeloId, fichaId, secoes, userId) {
  if (fichaId) {
    const r = await supabase.from('equipment_quick_guides')
      .update({ sections: secoes }).eq('id', fichaId).select().single();
    return fromFicha(check(r));
  }
  const r = await supabase.from('equipment_quick_guides')
    .insert({ company_id: companyId, model_id: modeloId, sections: secoes, created_by: userId || null })
    .select().single();
  return fromFicha(check(r));
}

export async function salvarDocumentoUrlCT(companyId, modeloId, d, userId) {
  const r = await supabase.from('equipment_documents').insert({
    company_id: companyId, model_id: modeloId, title: d.titulo?.trim(),
    doc_type: d.tipo || 'manual', version: d.versao?.trim() || null,
    language: d.idioma || 'pt-BR', source_kind: 'official_url',
    official_url: d.url?.trim(), created_by: userId || null,
  }).select().single();
  return fromDocumento(check(r));
}

const MIMES_DOC = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export async function enviarDocumentoArquivoCT(companyId, modeloId, file, d, userId) {
  if (!(file instanceof File)) throw new Error('Selecione um arquivo.');
  if (!MIMES_DOC.includes(file.type)) throw new Error('Formato não suportado. Use PDF ou imagem (JPG, PNG, WebP).');
  if (file.size > 52428800) throw new Error('O arquivo excede o limite de 50MB.');
  const path = `${companyId}/equipment/${modeloId}/${crypto.randomUUID()}-${safe(file.name)}`;
  const up = await supabase.storage.from('zt-equipment-docs').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const ins = await supabase.from('equipment_documents').insert({
    company_id: companyId, model_id: modeloId, title: d.titulo?.trim() || file.name,
    doc_type: d.tipo || 'manual', version: d.versao?.trim() || null,
    language: d.idioma || 'pt-BR', source_kind: 'company_upload',
    bucket: 'zt-equipment-docs', path, file_name: file.name,
    content_type: file.type, size_bytes: file.size, created_by: userId || null,
  }).select().single();
  if (ins.error) { await supabase.storage.from('zt-equipment-docs').remove([path]); throw ins.error; }
  return fromDocumento(ins.data);
}

export async function urlDocumentoCT(doc) {
  if (doc.url) return doc.url;
  if (!doc.bucket || !doc.path) return null;
  const r = await supabase.storage.from(doc.bucket).createSignedUrl(doc.path, 3600);
  if (r.error) throw r.error;
  return r.data?.signedUrl || null;
}

export async function arquivarDocumentoCT(id) {
  check(await supabase.from('equipment_documents').update({ status: 'archived' }).eq('id', id).select().single());
}

export async function salvarAreasCT(companyId, categoriaIds) {
  const atuais = check(await supabase.from('company_technical_areas').select('category_id').eq('company_id', companyId)) || [];
  const alvo = new Set(categoriaIds);
  const remover = atuais.map((a) => a.category_id).filter((id) => !alvo.has(id));
  const incluir = [...alvo].filter((id) => !atuais.some((a) => a.category_id === id));
  if (remover.length) check(await supabase.from('company_technical_areas').delete().eq('company_id', companyId).in('category_id', remover));
  if (incluir.length) check(await supabase.from('company_technical_areas').insert(incluir.map((id) => ({ company_id: companyId, category_id: id }))));
  return [...alvo];
}

/* ------------------------------------------------------- vínculo com OS */
export async function listarEquipamentosOSCT(workOrderId, companyId) {
  const r = await supabase.from('work_order_equipment')
    .select('id, model_id, notes, equipment_models(*, equipment_manufacturers(name), equipment_categories(name))')
    .eq('work_order_id', workOrderId).eq('company_id', companyId).order('created_at');
  return (check(r) || []).filter((x) => x.equipment_models)
    .map((x) => ({ vinculoId: x.id, obs: x.notes || '', ...fromModelo(x.equipment_models) }));
}

export async function vincularEquipamentoOSCT(companyId, workOrderId, modeloId, obs) {
  const r = await supabase.from('work_order_equipment')
    .insert({ company_id: companyId, work_order_id: workOrderId, model_id: modeloId, notes: obs?.trim() || null })
    .select().single();
  return check(r);
}

export async function desvincularEquipamentoOSCT(vinculoId) {
  check(await supabase.from('work_order_equipment').delete().eq('id', vinculoId).select());
}

/* --------------------------------------------------- cache offline leve
   A ficha rápida aberta fica disponível sem rede (localStorage, LRU).
   É conveniência de campo, não fonte de verdade — leitura sempre tenta a
   rede primeiro e cai para o cache apenas em falha. */
const CACHE_IDX = 'ztct:fichas';
const cacheKey = (companyId, modeloId) => `ztct:ficha:${companyId}:${modeloId}`;

export function guardarFichaCache(companyId, modeloId, payload) {
  try {
    const idx = JSON.parse(localStorage.getItem(CACHE_IDX) || '[]').filter((k) => k !== cacheKey(companyId, modeloId));
    idx.unshift(cacheKey(companyId, modeloId));
    while (idx.length > 30) localStorage.removeItem(idx.pop());
    localStorage.setItem(CACHE_IDX, JSON.stringify(idx));
    localStorage.setItem(cacheKey(companyId, modeloId), JSON.stringify({ t: Date.now(), payload: {
      modelo: payload.modelo, ficha: payload.ficha, documentos: (payload.documentos || []).map((d) => ({ ...d })),
      favorito: payload.favorito, totalCasos: payload.totalCasos,
    } }));
  } catch { /* storage cheio ou bloqueado: segue sem cache */ }
}

export function lerFichaCache(companyId, modeloId) {
  try {
    const raw = localStorage.getItem(cacheKey(companyId, modeloId));
    if (!raw) return null;
    const { t, payload } = JSON.parse(raw);
    return { ...payload, offlineDesde: t };
  } catch { return null; }
}
