import { supabase } from './supabase';

/*
  Central Técnica (migrations 0113-0115) — camada de dados.

  Dois conceitos distintos, como no banco:
    MODELO  = equipment_models, o conhecimento de mercado ("Intelbras FR 101"):
              ficha rápida, manual, esquema e casos.
    UNIDADE = installed_equipment (0083), a peça com serial instalada no cliente.
              Esta camada NÃO cria unidade; só lê a que já existe e, quando o
              usuário identifica, aponta a unidade para o modelo técnico.

  Escopos: company_id null = biblioteca global ZiisTec (somente leitura aqui);
  company_id preenchido = conteúdo privado da empresa. RLS é a autoridade.
  Casos vêm da Base Técnica (0111) já sanitizados pela RPC: sem dado do cliente
  e sem nada financeiro.
*/

const check = (r) => { if (r?.error) throw r.error; return r?.data; };
const safe = (name) => String(name || 'arquivo')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-120);

export const TIPOS_DOC = [
  { id: 'manual', label: 'Manual' }, { id: 'datasheet', label: 'Datasheet' },
  { id: 'diagram', label: 'Esquema' }, { id: 'guide', label: 'Guia' },
  { id: 'installation', label: 'Instalação' }, { id: 'programming', label: 'Programação' },
  { id: 'troubleshooting', label: 'Diagnóstico' }, { id: 'firmware', label: 'Firmware' },
  { id: 'other', label: 'Outro' },
];
export const TIPOS_SECAO = [
  { id: 'power', label: 'Alimentação' }, { id: 'wiring', label: 'Ligações e bornes' },
  { id: 'programming', label: 'Programação' }, { id: 'reset', label: 'Reset' },
  { id: 'parameters', label: 'Parâmetros' }, { id: 'diagnostics', label: 'Diagnóstico' },
  { id: 'codes', label: 'Códigos e LEDs' }, { id: 'alerts', label: 'Alertas' },
  { id: 'other', label: 'Outras informações' },
];
export const DIFICULDADE = { easy: 'Fácil', medium: 'Média', hard: 'Difícil' };

const fromCategoria = (x) => ({
  id: x.id, nome: x.name, slug: x.slug, icone: x.icon || null,
  global: !x.company_id, ativo: x.active,
});
const fromFabricante = (x) => ({
  id: x.id, nome: x.name, site: x.website || '', global: !x.company_id, ativo: x.active,
});
const fromModelo = (x) => ({
  id: x.id, nome: x.name, codigo: x.model_code || '', descricao: x.description || '',
  tags: x.tags || [], global: !x.company_id, status: x.status,
  fabricanteId: x.manufacturer_id, fabricante: x.equipment_manufacturers?.name || '',
  categoriaId: x.category_id, categoria: x.equipment_categories?.name || '',
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
const fromFicha = (x) => (x ? {
  id: x.id, modeloId: x.model_id, titulo: x.title, secoes: x.sections || [],
  versao: x.version, global: !x.company_id, atualizadoEm: (x.updated_at || '').slice(0, 10),
} : null);
const fromCaso = (x) => ({
  id: x.case_id, numero: x.wo_number, concluidoEm: x.completed_on,
  sintoma: x.symptom || '', causa: x.cause || '', solucao: x.solution || '',
  dificuldade: x.difficulty || '', aprendizado: x.learning || '',
  precisouRetorno: Boolean(x.needs_return), obsVinculo: x.linked_notes || '',
  unidadeIdentificada: Boolean(x.unit_identified),
});
const fromUnidade = (x) => ({
  id: x.id, nome: x.name, marca: x.brand || '', modelo: x.model || '',
  serie: x.serial_number || '', instaladoEm: (x.installed_at || '').slice(0, 10),
  local: x.client_locations?.name || '', modeloTecnicoId: x.equipment_model_id || null,
});

/* ----------------------------------------------------------- leitura */
export async function carregarHomeCT(companyId, userId) {
  const [cats, favs, recs, areas] = await Promise.all([
    supabase.from('equipment_categories').select('*')
      .or(`company_id.is.null,company_id.eq.${companyId}`).eq('active', true).order('name'),
    supabase.from('equipment_favorites')
      .select('model_id, equipment_models(*, equipment_manufacturers(name), equipment_categories(name))')
      .eq('company_id', companyId).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(20),
    supabase.from('equipment_recent_views')
      .select('model_id, viewed_at, equipment_models(*, equipment_manufacturers(name), equipment_categories(name))')
      .eq('company_id', companyId).eq('user_id', userId)
      .order('viewed_at', { ascending: false }).limit(10),
    supabase.from('company_technical_areas').select('category_id').eq('company_id', companyId),
  ]);
  return {
    categorias: (check(cats) || []).map(fromCategoria),
    areas: (check(areas) || []).map((a) => a.category_id),
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
  const [mod, guias, docs, fav, casos] = await Promise.all([
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
  // "recente" não bloqueia a abertura da ficha em campo
  supabase.from('equipment_recent_views')
    .upsert({ user_id: userId, company_id: companyId, model_id: modeloId, viewed_at: new Date().toISOString() })
    .then(() => {}, () => {});
  const fichas = (check(guias) || []).map(fromFicha);
  const fichaEmpresa = fichas.find((f) => f && !f.global) || null;
  const fichaGlobal = fichas.find((f) => f && f.global) || null;
  return {
    modelo: fromModelo(check(mod)),
    ficha: fichaEmpresa || fichaGlobal,
    fichaEmpresa,
    fichaGlobal,
    documentos: (check(docs) || []).map(fromDocumento),
    favorito: Boolean(fav.data),
    totalCasos: Number(casos.error ? 0 : casos.data || 0),
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

/* --------------------------------------- gestão do acervo (owner) */
export async function listarFabricantesCT(companyId) {
  const r = await supabase.from('equipment_manufacturers').select('*')
    .or(`company_id.is.null,company_id.eq.${companyId}`).eq('active', true).order('name');
  return (check(r) || []).map(fromFabricante);
}

export async function salvarFabricanteCT(companyId, f, userId) {
  const r = await supabase.from('equipment_manufacturers').insert({
    company_id: companyId, name: f.nome?.trim(),
    website: f.site?.trim() || null, created_by: userId || null,
  }).select().single();
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
  const r = await supabase.from('equipment_models').upsert(m.id ? { ...row, id: m.id } : row)
    .select('*, equipment_manufacturers(name), equipment_categories(name)').single();
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
const LIMITE_DOC = 52428800;
export async function enviarDocumentoArquivoCT(companyId, modeloId, file, d, userId) {
  if (!(file instanceof File)) throw new Error('Selecione um arquivo.');
  if (!MIMES_DOC.includes(file.type)) throw new Error('Formato não suportado. Use PDF, JPG, PNG ou WebP.');
  if (file.size > LIMITE_DOC) throw new Error('O arquivo passa de 50 MB.');
  const path = `${companyId}/equipment/${modeloId}/${crypto.randomUUID()}-${safe(file.name)}`;
  const up = await supabase.storage.from('zt-equipment-docs')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) throw up.error;
  const ins = await supabase.from('equipment_documents').insert({
    company_id: companyId, model_id: modeloId, title: d.titulo?.trim() || file.name,
    doc_type: d.tipo || 'manual', version: d.versao?.trim() || null,
    language: d.idioma || 'pt-BR', source_kind: 'company_upload',
    bucket: 'zt-equipment-docs', path, file_name: file.name,
    content_type: file.type, size_bytes: file.size, created_by: userId || null,
  }).select().single();
  if (ins.error) {
    await supabase.storage.from('zt-equipment-docs').remove([path]);
    throw ins.error;
  }
  return fromDocumento(ins.data);
}

// Só devolve destino https: link oficial do fabricante (já restrito a https por
// CHECK no banco) ou signed URL temporária do bucket privado. Qualquer outra coisa
// volta nula e a tela avisa, em vez de abrir destino não verificado.
const destinoHttps = (url) => (/^https:\/\//i.test(String(url || '')) ? String(url) : null);

export async function urlDocumentoCT(doc) {
  if (doc.url) return destinoHttps(doc.url);
  if (!doc.bucket || !doc.path) return null;
  const r = await supabase.storage.from(doc.bucket).createSignedUrl(doc.path, 3600);
  if (r.error) throw r.error;
  return destinoHttps(r.data?.signedUrl);
}

export async function arquivarDocumentoCT(id) {
  check(await supabase.from('equipment_documents').update({ status: 'archived' }).eq('id', id).select().single());
}

export async function salvarAreasCT(companyId, categoriaIds) {
  const atuais = check(await supabase.from('company_technical_areas')
    .select('category_id').eq('company_id', companyId)) || [];
  const alvo = new Set(categoriaIds);
  const remover = atuais.map((a) => a.category_id).filter((id) => !alvo.has(id));
  const incluir = [...alvo].filter((id) => !atuais.some((a) => a.category_id === id));
  if (remover.length) {
    check(await supabase.from('company_technical_areas').delete()
      .eq('company_id', companyId).in('category_id', remover));
  }
  if (incluir.length) {
    check(await supabase.from('company_technical_areas')
      .insert(incluir.map((id) => ({ company_id: companyId, category_id: id }))));
  }
  return [...alvo];
}

/* ------------------------------------------- OS: modelo e unidade física */
export async function listarEquipamentosOSCT(workOrderId, companyId) {
  const r = await supabase.from('work_order_equipment')
    .select(`id, model_id, notes, installed_equipment_id,
             equipment_models(*, equipment_manufacturers(name), equipment_categories(name)),
             installed_equipment(id, name, brand, model, serial_number, installed_at, equipment_model_id, client_locations(name))`)
    .eq('work_order_id', workOrderId).eq('company_id', companyId).order('created_at');
  return (check(r) || []).filter((x) => x.equipment_models).map((x) => ({
    vinculoId: x.id,
    obs: x.notes || '',
    unidade: x.installed_equipment ? fromUnidade(x.installed_equipment) : null,
    ...fromModelo(x.equipment_models),
  }));
}

// Unidades físicas já registradas para o cliente da OS (cenário de manutenção).
export async function listarUnidadesClienteCT(companyId, clientId) {
  const r = await supabase.from('installed_equipment')
    .select('id, name, brand, model, serial_number, installed_at, equipment_model_id, client_locations(name)')
    .eq('company_id', companyId).eq('client_id', clientId)
    .order('installed_at', { ascending: false }).limit(50);
  return (check(r) || []).map(fromUnidade);
}

export async function vincularEquipamentoOSCT(companyId, workOrderId, modeloId, opcoes = {}) {
  const r = await supabase.from('work_order_equipment').insert({
    company_id: companyId,
    work_order_id: workOrderId,
    model_id: modeloId,
    installed_equipment_id: opcoes.unidadeId || null,
    notes: opcoes.obs?.trim() || null,
    created_by: opcoes.userId || null,
  }).select().single();
  return check(r);
}

export async function desvincularEquipamentoOSCT(vinculoId) {
  check(await supabase.from('work_order_equipment').delete().eq('id', vinculoId).select());
}

// Identifica o modelo técnico de uma unidade física já instalada (RPC da 0115).
export async function identificarModeloUnidadeCT(unidadeId, modeloId) {
  const r = await supabase.rpc('zt_set_installed_equipment_model', {
    p_equipment: unidadeId, p_model: modeloId,
  });
  return check(r);
}

/* ------------------------------------------------ cache offline leve
   A ficha aberta fica disponível sem rede. É conveniência de campo, não
   fonte de verdade: a leitura sempre tenta a rede primeiro e só cai para o
   cache quando a rede falha. Tudo em try/catch: Storage pode estar bloqueado. */
const CACHE_IDX = 'ztct:fichas';
const cacheKey = (companyId, modeloId) => `ztct:ficha:${companyId}:${modeloId}`;

export function guardarFichaCache(companyId, modeloId, payload) {
  try {
    const key = cacheKey(companyId, modeloId);
    const idx = JSON.parse(localStorage.getItem(CACHE_IDX) || '[]').filter((k) => k !== key);
    idx.unshift(key);
    while (idx.length > 30) localStorage.removeItem(idx.pop());
    localStorage.setItem(CACHE_IDX, JSON.stringify(idx));
    localStorage.setItem(key, JSON.stringify({
      t: Date.now(),
      payload: {
        modelo: payload.modelo,
        ficha: payload.ficha,
        documentos: payload.documentos || [],
        favorito: payload.favorito,
        totalCasos: payload.totalCasos,
      },
    }));
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
