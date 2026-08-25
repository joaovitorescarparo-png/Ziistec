import { supabase } from './supabase';
import { chamarIAReal } from './aiApi';
import { salvarClienteDB, salvarOrcamentoDB } from './dataApi';

const n = (v) => Number(v || 0);
const today = () => new Date().toISOString().slice(0,10);
const addDays = (base, days) => {
  const d = new Date(`${base}T12:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0,10);
};
const check = (r) => { if (r?.error) throw r.error; return r?.data || []; };

const mapClient = (x) => ({ id:x.id, nome:x.name, fantasia:x.trade_name || '', telefone:x.phone || '', whatsapp:x.whatsapp || '', endereco:x.address || '' });
const mapService = (x) => ({ id:x.id, tipo:'servico', nome:x.name, categoria:x.category || '', unidade:x.unit || 'unidade', preco:n(x.price), custo:n(x.cost), ativo:x.active !== false });
const mapProduct = (x) => ({ id:x.id, tipo:'produto', nome:x.name, marca:x.brand || '', modelo:x.model || '', unidade:x.unit || 'unidade', preco:n(x.price), custo:n(x.cost), ativo:x.active !== false, imagemPath:x.image_path || null });

export async function carregarBaseOrcamentoV2DB(companyId) {
  const [clients, services, products, company] = await Promise.all([
    supabase.from('clients').select('id,name,trade_name,phone,whatsapp,address').eq('company_id',companyId).order('name'),
    supabase.from('services').select('id,name,category,unit,price,cost,active').eq('company_id',companyId).order('name'),
    supabase.from('products').select('id,name,brand,model,unit,price,cost,active,image_path').eq('company_id',companyId).order('name'),
    supabase.from('companies').select('default_validity_days,default_payment_terms,default_notes').eq('id',companyId).single(),
  ]);
  const firstError = [clients,services,products,company].find(r=>r.error)?.error;
  if (firstError) throw firstError;
  return {
    clientes:check(clients).map(mapClient),
    servicos:check(services).map(mapService),
    produtos:check(products).map(mapProduct),
    padroes:{
      validadeDias:Number(company.data?.default_validity_days || 15),
      condicao:company.data?.default_payment_terms || '',
      observacoes:company.data?.default_notes || '',
    },
  };
}

const compactClient = (c) => ({ id:c.id, nome:c.fantasia || c.nome });
const compactService = (s) => ({ id:s.id, nome:s.nome, categoria:s.categoria, unidade:s.unidade, preco:s.preco });
const compactProduct = (p) => ({ id:p.id, nome:[p.nome,p.marca,p.modelo].filter(Boolean).join(' '), unidade:p.unidade, preco:p.preco });

export function montarPromptOrcamentoV2({ texto, clientes, servicos, produtos, correcao=null, previa=null }) {
  return `Você é um interpretador de orçamento para prestadores de serviços brasileiros. Sua única tarefa é transformar a fala/texto em JSON estruturado. Não escreva markdown, explicações ou texto fora do JSON.

REGRAS DE SEGURANÇA E PRECISÃO:
1. Nunca invente IDs. Use somente IDs presentes nos catálogos abaixo.
2. Se houver mais de uma correspondência plausível para cliente/item, NÃO escolha sozinho: use catalogoId/clienteId null e registre uma ambiguidade.
3. Preço explicitamente falado pelo usuário sempre vence o preço de catálogo e deve ter precoFoiInformado=true.
4. Para item conhecido sem preço falado, use o preço do catálogo e precoFoiInformado=false.
5. Item que não existe no catálogo pode ser tipo "livre" e catalogoId null. Se não houver preço claro para item livre, deixe preco null e crie ambiguidade.
6. Quantidade precisa ser número maior que zero. Se o texto claramente estiver no singular, quantidade 1 é aceitável. Se não estiver claro, registre ambiguidade.
7. Não use custos, margens ou informações que não aparecem neste prompt.
8. Não trate uma suposição como certeza. Dúvida deve aparecer em ambiguidades.
9. Valores monetários devem ser números, sem "R$" e sem texto.
10. desconto e acrescimo são valores absolutos em reais, não percentuais, a menos que o usuário tenha dito um valor final em reais. Percentual deve virar ambiguidade para confirmação.

FORMATO EXATO:
{
  "clienteId": "uuid ou null",
  "clienteFalado": "texto ou null",
  "itens": [
    {
      "tipo": "servico|produto|livre",
      "catalogoId": "uuid ou null",
      "nome": "texto",
      "quantidade": 1,
      "preco": 0,
      "precoFoiInformado": false,
      "observacao": "texto ou null"
    }
  ],
  "desconto": 0,
  "acrescimo": 0,
  "condicaoPagamento": "texto ou null",
  "observacoes": "texto ou null",
  "ambiguidades": [
    { "campo": "cliente|item|quantidade|preco|desconto|outro", "mensagem": "o que precisa ser confirmado", "opcoes": ["opção 1", "opção 2"] }
  ],
  "resumo": "resumo curto do entendimento"
}

CLIENTES: ${JSON.stringify((clientes||[]).map(compactClient))}
SERVIÇOS: ${JSON.stringify((servicos||[]).filter(s=>s.ativo).map(compactService))}
PRODUTOS: ${JSON.stringify((produtos||[]).filter(p=>p.ativo).map(compactProduct))}
${previa ? `PRÉVIA ANTERIOR: ${JSON.stringify(previa)}` : ''}
${correcao ? `CORREÇÃO DO USUÁRIO: ${String(correcao).slice(0,3000)}` : ''}
PEDIDO DO USUÁRIO: ${String(texto||'').slice(0,6000)}`;
}

const makeAmbiguity = (campo, mensagem, opcoes=[]) => ({ campo, mensagem, opcoes });

export function normalizarInterpretacaoOrcamentoV2(raw, base) {
  const clients = base.clientes || [];
  const services = base.servicos || [];
  const products = base.produtos || [];
  const clientMap = new Map(clients.map(c=>[c.id,c]));
  const serviceMap = new Map(services.map(s=>[s.id,s]));
  const productMap = new Map(products.map(p=>[p.id,p]));
  const ambiguidades = Array.isArray(raw?.ambiguidades) ? raw.ambiguidades.map(a=>({
    campo:String(a?.campo || 'outro').slice(0,40),
    mensagem:String(a?.mensagem || 'Confirme esta informação.').slice(0,500),
    opcoes:Array.isArray(a?.opcoes) ? a.opcoes.slice(0,8).map(x=>String(x).slice(0,200)) : [],
  })) : [];

  let clienteId = raw?.clienteId && clientMap.has(raw.clienteId) ? raw.clienteId : null;
  if (raw?.clienteId && !clienteId) ambiguidades.push(makeAmbiguity('cliente','A IA indicou um cliente que não existe mais no cadastro. Selecione o cliente correto.'));

  const itens = (Array.isArray(raw?.itens) ? raw.itens : []).slice(0,100).map((item,index) => {
    const tipo = ['servico','produto','livre'].includes(item?.tipo) ? item.tipo : 'livre';
    const catalog = tipo==='servico' ? serviceMap.get(item?.catalogoId) : tipo==='produto' ? productMap.get(item?.catalogoId) : null;
    let catalogoId = catalog?.id || null;
    if (item?.catalogoId && !catalog) {
      ambiguidades.push(makeAmbiguity('item',`O item ${index+1} não corresponde mais a um item válido do catálogo. Confirme ou deixe como item livre.`));
    }
    const quantidade = n(item?.quantidade);
    if (!(quantidade > 0)) ambiguidades.push(makeAmbiguity('quantidade',`Confirme a quantidade do item ${index+1}.`));
    const explicit = Boolean(item?.precoFoiInformado);
    let preco = item?.preco === null || item?.preco === undefined ? null : n(item.preco);
    if (!explicit && catalog) preco = catalog.preco;
    if (preco === null || preco < 0 || (!catalog && preco===0 && !explicit)) {
      ambiguidades.push(makeAmbiguity('preco',`Confirme o preço de ${item?.nome || catalog?.nome || `item ${index+1}`}.`));
    }
    return {
      id:`ai-${index}-${Date.now()}`,
      tipo,
      catalogoId,
      nome:String(item?.nome || catalog?.nome || 'Item livre').slice(0,500),
      unidade:catalog?.unidade || 'unidade',
      qtd:quantidade > 0 ? quantidade : 1,
      preco:preco == null ? 0 : Math.max(0,preco),
      custo:catalog?.custo || 0,
      precoFoiInformado:explicit,
      obs:String(item?.observacao || '').slice(0,1000),
    };
  });

  if (!clienteId && raw?.clienteFalado && !ambiguidades.some(a=>a.campo==='cliente')) {
    ambiguidades.push(makeAmbiguity('cliente',`Selecione o cliente correspondente a "${String(raw.clienteFalado).slice(0,120)}".`));
  }
  if (!itens.length) ambiguidades.push(makeAmbiguity('item','Nenhum item foi identificado. Adicione ao menos um serviço, produto ou item livre.'));

  return {
    clienteId,
    clienteFalado:String(raw?.clienteFalado || '').slice(0,200),
    itens,
    desconto:Math.max(0,n(raw?.desconto)),
    acrescimo:Math.max(0,n(raw?.acrescimo)),
    condicao:String(raw?.condicaoPagamento || '').slice(0,1000),
    obs:String(raw?.observacoes || '').slice(0,3000),
    ambiguidades,
    resumo:String(raw?.resumo || '').slice(0,500),
    bruto:raw,
  };
}

export async function interpretarOrcamentoV2DB({ texto, base, correcao=null, previa=null }) {
  const prompt = montarPromptOrcamentoV2({ texto, clientes:base.clientes, servicos:base.servicos, produtos:base.produtos, correcao, previa });
  const raw = await chamarIAReal(prompt);
  return normalizarInterpretacaoOrcamentoV2(raw, base);
}

export async function criarClienteRapidoOrcamentoV2DB({ nome, telefone='', whatsapp='', endereco='' }, companyId) {
  return salvarClienteDB({ tipo:'PF', nome:nome?.trim(), telefone, whatsapp, endereco, obs:'' }, companyId);
}

export async function salvarOrcamentoV2DB(preview, base, companyId, userId) {
  const data = today();
  const validade = addDays(data, base.padroes?.validadeDias || 15);
  return salvarOrcamentoDB({
    clienteId:preview.clienteId,
    status:'rascunho',
    data,
    validade,
    desconto:n(preview.desconto),
    acrescimo:n(preview.acrescimo),
    condicao:preview.condicao || base.padroes?.condicao || '',
    obs:preview.obs || base.padroes?.observacoes || '',
    local:'',
    localServico:'',
    itens:(preview.itens || []).map(i=>({
      tipo:i.tipo,
      catalogoId:i.catalogoId || null,
      nome:i.nome,
      unidade:i.unidade || 'unidade',
      qtd:n(i.qtd) || 1,
      preco:n(i.preco),
      custo:n(i.custo),
      obs:i.obs || '',
    })),
  }, companyId, userId);
}
