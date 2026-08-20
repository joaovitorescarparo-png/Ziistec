import React, { useState, useRef, useEffect } from "react";
import { baixarOrcamentoPDF, compartilharOrcamentoPDF, suportaCompartilharArquivo } from "../lib/quotePdf";
import { carregarRevisoesDB, atualizarRevisaoDB } from "../lib/followupApi";
import {
  LayoutDashboard, CalendarDays, Users, Wrench, FileText, ClipboardList,
  Wallet, Settings, Plus, Search, ArrowLeft, ArrowRight, Check, X, Menu,
  Phone, MapPin, Trash2, Send, Share2, Pencil, ChevronRight, Clock,
  CircleCheck, Building2, User, CheckCircle2, Circle, AlertTriangle,
  Printer, MoreHorizontal, CalendarClock, Receipt, Banknote, Mic, MicOff,
  Package, ShoppingCart, ShieldCheck, Camera, Paperclip, Sparkles, Navigation,
  TrendingUp, RotateCcw, Loader2, Copy, Users2, LogOut, Lock, CreditCard, Building,
} from "lucide-react";
import { mensagemErro } from "../lib/supabase";
import {
  recarregarSeguro, salvarClienteDB, salvarServicoDB, salvarProdutoDB, salvarOrcamentoDB,
  salvarOSDB, atualizarOSDB, finalizarOSDB, resolverPrecificacaoOSDB, baixarLancamentoDB, salvarLancamentoDB, atualizarStatusOrcamentoDB,
} from "../lib/dataApi";
import {
  salvarCompraDB, duplicarOrcamentoDB, criarOSDeOrcamentoDB, abrirAtendimentoGarantiaDB,
  carregarEquipeDB, convidarColaboradorDB, alternarColaboradorDB,
} from "../lib/dataApiExtras";
import { atualizarColaboradorDB } from "../lib/teamApi";
import {
  hidratarComplementosDB, persistirEdicaoOSDB, prepararFinalizacaoOSDB,
  uploadDocumentosCompraDB, uploadLogoEmpresaDB,
} from "../lib/runtimeApi";
import { cancelarAssinaturaDB, reativarAssinaturaDB } from "../lib/subscriptionApi";
import { chamarIAReal } from "../lib/aiApi";
import { resolverLogoEmpresaDB, persistirFotosOSDB } from "../lib/storageExtras";

/* ================================================================ helpers */
const brl = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlCurto = (n) => (Number(n) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const HOJE = iso(new Date());
const addDays = (base, n) => { const d = new Date(base + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const addMeses = (base, n) => { const d = new Date(base + "T12:00:00"); d.setMonth(d.getMonth() + n); return iso(d); };
const dataBR = (s) => (s ? s.split("-").reverse().join("/") : "—");
const dataCurta = (s) => (s ? s.slice(8) + "/" + s.slice(5, 7) : "—");
const DIAS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const diaSemana = (s) => DIAS[new Date(s + "T12:00:00").getDay()];
const diaCurto = (s) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(s + "T12:00:00").getDay()];
const mesRef = (s) => (s || "").slice(0, 7);
const nomeMes = (m) => {
  const [a, mm] = m.split("-");
  return ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"][Number(mm) - 1] + " de " + a;
};
let seq = 100;
const uid = () => `id${++seq}`;
const somaItens = (itens = []) => itens.reduce((t, i) => t + i.qtd * i.preco, 0);
const somaCustos = (itens = []) => itens.reduce((t, i) => t + i.qtd * (i.custo || 0), 0);
const totalDoc = (d) => Math.max(0, somaItens(d.itens) - (d.desconto || 0) + (d.acrescimo || 0));
const somaAdicionais = (os) => (os.adicionais || []).reduce((t, a) => t + (Number(a.qtd) || 0) * (Number(a.preco) || 0), 0);
const totalOS = (os) => somaItens(os.itens) + somaAdicionais(os) + (os.valorAdicional || 0);
const resumoOS = (os) => os.itens.map((i) => i.nome).join(" · ")
  || (os.descricaoLivre || "").trim()
  || (os.emGarantia ? "atendimento em garantia" : "sem descrição");
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const soDigitos = (s) => (s || "").replace(/\D/g, "");
const iniciais = (s = "") => s.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const mapsUrl = (end) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(end || "")}`;
const semAcento = (s = "") => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const UNIDADES = [
  { id: "unidade", label: "unidade", sufixo: "un" },
  { id: "ponto", label: "ponto", sufixo: "ponto" },
  { id: "hora", label: "hora", sufixo: "h" },
  { id: "diaria", label: "diária", sufixo: "diária" },
  { id: "visita", label: "visita", sufixo: "visita" },
  { id: "metro", label: "metro linear", sufixo: "m" },
  { id: "m2", label: "metro quadrado", sufixo: "m²" },
  { id: "fechado", label: "serviço fechado", sufixo: "serviço" },
];
const unidadeLabel = (id) => UNIDADES.find((u) => u.id === id)?.sufixo || "un";
const PRAZOS_GARANTIA = [
  { dias: 30, label: "30 dias" }, { dias: 60, label: "60 dias" }, { dias: 90, label: "90 dias" },
  { dias: 180, label: "6 meses" }, { dias: 365, label: "12 meses" },
];
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000);
const statusGarantia = (g) => {
  const d = diasEntre(HOJE, g.ate);
  return d >= 0
    ? { ativa: true, label: "Ativa", tone: "sucesso", detalhe: d === 0 ? "vence hoje" : `${d} dia${d > 1 ? "s" : ""} restante${d > 1 ? "s" : ""}` }
    : { ativa: false, label: "Expirada", tone: "neutro", detalhe: `expirada há ${Math.abs(d)} dia${Math.abs(d) > 1 ? "s" : ""}` };
};
const PRAZOS_RETORNO = [0, 30, 90, 180, 365];
const FORMAS = ["Pix", "Dinheiro", "Cartão", "Transferência", "Boleto", "Outro"];

/* ============================================================= dados demo */
const EMPRESA_SEED = {
  nome: "JR Serviços Técnicos", documento: "42.118.309/0001-77",
  atividade: "Controle de acesso, CFTV e automação",
  telefone: "(11) 3255-0140", whatsapp: "(11) 98842-6710",
  email: "contato@jrservicostecnicos.com.br",
  endereco: "Rua das Palmeiras, 480 — Vila Mariana, São Paulo/SP",
  responsavel: "Jonas Ribeiro", temEquipe: true, validadePadrao: 15,
  condicaoPadrao: "50% na aprovação e 50% na entrega do serviço.",
  observacaoPadrao: "Materiais inclusos salvo indicação em contrário.",
};

const CLIENTES_SEED = [
  { id: "c1", tipo: "PJ", nome: "Condomínio Residencial Jardins", fantasia: "Cond. Jardins", documento: "18.442.771/0001-05", responsavel: "Sandra Menezes (síndica)", telefone: "(11) 3771-2280", whatsapp: "(11) 99614-3320", endereco: "Av. Bandeirantes, 1250 — Moema, São Paulo/SP", obs: "Portaria libera acesso técnico das 8h às 18h. Falar com a síndica." },
  { id: "c2", tipo: "PF", nome: "Marina Alves", documento: "327.884.110-42", telefone: "(11) 5522-8140", whatsapp: "(11) 98123-7745", endereco: "Rua Groenlândia, 92 — Jardim Paulista, São Paulo/SP", obs: "Prefere atendimento pela manhã." },
  { id: "c3", tipo: "PJ", nome: "Prime Administradora de Imóveis Ltda", fantasia: "Prime Imóveis", documento: "31.209.556/0001-19", responsavel: "Carlos Tanaka", telefone: "(11) 3018-7700", whatsapp: "(11) 97455-1180", endereco: "Rua Pamplona, 1004 — Jardins, São Paulo/SP", obs: "Administra 6 prédios. Pagamento sempre por boleto em 15 dias." },
  { id: "c4", tipo: "PJ", nome: "Padaria Pão Nosso Ltda", fantasia: "Padaria Pão Nosso", documento: "27.660.412/0001-88", responsavel: "Eliane Costa", telefone: "(11) 2871-4409", whatsapp: "(11) 96622-0781", endereco: "Rua Vergueiro, 3320 — Vila Mariana, São Paulo/SP", obs: "" },
];

const SERVICOS_SEED = [
  { id: "s1", nome: "Instalação de fechadura digital", categoria: "Controle de acesso", unidade: "unidade", preco: 450, custo: 190, descricao: "Instalação, cadastro de usuários e teste completo.", ativo: true, garantiaDias: 90, retornoDias: 0 },
  { id: "s2", nome: "Configuração de controle de acesso", categoria: "Controle de acesso", unidade: "ponto", preco: 320, custo: 110, descricao: "Configuração de leitor, cadastro de tags e integração com portaria.", ativo: true, garantiaDias: 90, retornoDias: 0 },
  { id: "s3", nome: "Visita técnica", categoria: "Atendimento", unidade: "visita", preco: 120, custo: 35, descricao: "Diagnóstico no local com relatório do que precisa ser feito.", ativo: true, garantiaDias: 0, retornoDias: 0 },
  { id: "s4", nome: "Instalação de câmera CFTV", categoria: "CFTV", unidade: "ponto", preco: 250, custo: 95, descricao: "Instalação de câmera, passagem de cabo e ajuste de imagem.", ativo: true, garantiaDias: 90, retornoDias: 365 },
  { id: "s5", nome: "Manutenção de interfone", categoria: "Manutenção", unidade: "unidade", preco: 180, custo: 60, descricao: "Revisão, limpeza de contatos e substituição de peças simples.", ativo: true, garantiaDias: 30, retornoDias: 180 },
  { id: "s6", nome: "Manutenção preventiva mensal", categoria: "Manutenção", unidade: "fechado", preco: 890, custo: 300, descricao: "Contrato mensal de vistoria de todos os equipamentos.", ativo: true, garantiaDias: 0, retornoDias: 30 },
  { id: "s7", nome: "Instalação de porteiro eletrônico antigo", categoria: "Manutenção", unidade: "unidade", preco: 260, custo: 90, descricao: "Modelo descontinuado, mantido apenas para histórico.", ativo: false, garantiaDias: 0, retornoDias: 0 },
];

const PRODUTOS_SEED = [
  { id: "p1", nome: "Fechadura digital biométrica", marca: "Intelbras", modelo: "FR 320", unidade: "unidade", custo: 620, preco: 890, fornecedor: "Distribuidora Eletro Sul", garantiaMeses: 12, ativo: true, descricao: "" },
  { id: "p2", nome: "Câmera bullet Full HD", marca: "Intelbras", modelo: "VHD 1220 B", unidade: "unidade", custo: 210, preco: 340, fornecedor: "Distribuidora Eletro Sul", garantiaMeses: 12, ativo: true, descricao: "" },
  { id: "p3", nome: "Fonte colmeia 12V 10A", marca: "Vetti", modelo: "VT-1210", unidade: "unidade", custo: 95, preco: 160, fornecedor: "Casa das Fontes", garantiaMeses: 6, ativo: true, descricao: "" },
  { id: "p4", nome: "Cabo coaxial bipolar", marca: "Cabletech", modelo: "4mm", unidade: "metro", custo: 3.2, preco: 6.5, fornecedor: "Casa das Fontes", garantiaMeses: 0, ativo: true, descricao: "" },
  { id: "p5", nome: "Tag de proximidade RFID", marca: "Intelbras", modelo: "TH 2000", unidade: "unidade", custo: 4.5, preco: 12, fornecedor: "Distribuidora Eletro Sul", garantiaMeses: 3, ativo: true, descricao: "" },
];

const itemServico = (s, qtd, preco) => ({ id: uid(), tipo: "servico", catalogoId: s.id, nome: s.nome, unidade: s.unidade, qtd, preco: preco ?? s.preco, custo: s.custo });
const itemProduto = (p, qtd, preco) => ({ id: uid(), tipo: "produto", catalogoId: p.id, nome: `${p.nome}${p.marca ? " · " + p.marca : ""}${p.modelo ? " " + p.modelo : ""}`, unidade: p.unidade, qtd, preco: preco ?? p.preco, custo: p.custo });
const itemLivre = ({ nome = "", qtd = 1, unidade = "unidade", preco = 0, obs = "" } = {}) =>
  ({ id: uid(), tipo: "livre", catalogoId: null, nome, unidade, qtd, preco, custo: 0, obs });
const S = (id) => SERVICOS_SEED.find((s) => s.id === id);
const P = (id) => PRODUTOS_SEED.find((p) => p.id === id);

const ORCAMENTOS_SEED = [
  { id: "o1", numero: "ORC-0007", clienteId: "c1", status: "enviado", data: addDays(HOJE, -3), validade: addDays(HOJE, 12), itens: [itemServico(S("s1"), 4), itemProduto(P("p1"), 4), itemServico(S("s3"), 1)], desconto: 150, acrescimo: 0, condicao: "50% na aprovação e 50% na entrega do serviço.", obs: "Instalação nas portarias social e de serviço.", local: "Av. Bandeirantes, 1250 — Moema, São Paulo/SP", localServico: "Portarias social e de serviço", osId: null },
  { id: "o2", numero: "ORC-0006", clienteId: "c2", status: "aprovado", data: addDays(HOJE, -6), validade: addDays(HOJE, 9), itens: [itemServico(S("s1"), 1), itemServico(S("s3"), 1)], desconto: 0, acrescimo: 0, condicao: "Pagamento à vista via Pix na conclusão.", obs: "Porta de madeira maciça.", local: "Rua Groenlândia, 92 — Jardim Paulista, São Paulo/SP", localServico: "Apto 71", osId: "os3" },
  { id: "o3", numero: "ORC-0005", clienteId: "c4", status: "rascunho", data: addDays(HOJE, -1), validade: addDays(HOJE, 14), itens: [itemServico(S("s4"), 4), itemProduto(P("p2"), 4)], desconto: 0, acrescimo: 0, condicao: "50% na aprovação e 50% na entrega do serviço.", obs: "Prioridade nas câmeras do estoque.", local: "Rua Vergueiro, 3320 — Vila Mariana, São Paulo/SP", localServico: "Estoque e área de produção", osId: null },
  { id: "o4", numero: "ORC-0004", clienteId: "c3", status: "aprovado", data: addDays(HOJE, -14), validade: addDays(HOJE, 1), itens: [itemServico(S("s5"), 3), itemServico(S("s2"), 2)], desconto: 0, acrescimo: 0, condicao: "Boleto em 15 dias.", obs: "", local: "Rua Pamplona, 1004 — Jardins, São Paulo/SP", localServico: "Bloco B", osId: "os2" },
];

const osBase = {
  descricaoLivre: "", relato: "", fotos: [], adicionais: [], valorAdicional: 0, descricaoAdicional: "",
  custosExtras: 0, pendencia: "", cobrancaId: null, garantiaId: null, osOrigemId: null,
  relatoProblema: "", emGarantia: false,
};

const ORDENS_SEED = [
  { ...osBase, id: "os1", numero: "OS-0001", clienteId: "c1", orcamentoId: null, status: "andamento", data: HOJE, hora: "14:00", responsavel: "Jonas Ribeiro", local: "Av. Bandeirantes, 1250 — Moema, São Paulo/SP", localServico: "Garagem — subsolo 1", itens: [itemServico(S("s4"), 3), itemProduto(P("p2"), 3)], obs: "Substituir 3 câmeras da garagem. Elevador de serviço até 17h.", checklist: [{ id: "k1", texto: "Conferir cabeamento existente", feito: true }, { id: "k2", texto: "Instalar câmeras", feito: false }, { id: "k3", texto: "Ajustar ângulo e gravação", feito: false }], historico: [{ id: uid(), quando: addDays(HOJE, -1), texto: "Ordem de serviço criada" }] },
  { ...osBase, id: "os2", numero: "OS-0002", clienteId: "c3", orcamentoId: "o4", status: "concluida", data: addDays(HOJE, -4), hora: "09:00", responsavel: "Diego Farias", local: "Rua Pamplona, 1004 — Jardins, São Paulo/SP", localServico: "Bloco B", itens: [itemServico(S("s5"), 3), itemServico(S("s2"), 2)], obs: "", relato: "Diagnóstico\nTrês interfones do bloco B sem áudio de retorno.\n\nServiço executado\nLimpeza de contatos, troca de dois cabos e recadastramento de tags.\n\nResultado\nTestado em todos os apartamentos e funcionando.", checklist: [{ id: "k4", texto: "Testar interfones", feito: true }, { id: "k5", texto: "Cadastrar tags novas", feito: true }], custosExtras: 40, cobrancaId: "l1", historico: [{ id: uid(), quando: addDays(HOJE, -8), texto: "Gerada a partir do ORC-0004" }, { id: uid(), quando: addDays(HOJE, -4), texto: "Serviço concluído" }] },
  { ...osBase, id: "os3", numero: "OS-0003", clienteId: "c2", orcamentoId: "o2", status: "agendada", data: HOJE, hora: "09:00", responsavel: "Jonas Ribeiro", local: "Rua Groenlândia, 92 — Jardim Paulista, São Paulo/SP", localServico: "Apto 71", itens: [itemServico(S("s1"), 1), itemServico(S("s3"), 1)], obs: "Porta de madeira maciça. Cliente prefere manhã.", checklist: [{ id: "k6", texto: "Levar furadeira e brocas", feito: false }, { id: "k7", texto: "Cadastrar digitais da família", feito: false }], historico: [{ id: uid(), quando: addDays(HOJE, -5), texto: "Gerada a partir do ORC-0006" }] },
  { ...osBase, id: "os4", numero: "OS-0004", clienteId: "c1", orcamentoId: null, status: "agendada", data: addDays(HOJE, 1), hora: "10:30", responsavel: "Diego Farias", local: "Av. Bandeirantes, 1250 — Moema, São Paulo/SP", localServico: "Portaria social", itens: [itemServico(S("s6"), 1)], obs: "Vistoria mensal do contrato.", checklist: [], historico: [{ id: uid(), quando: HOJE, texto: "Ordem de serviço criada" }] },
  { ...osBase, id: "os5", numero: "OS-0005", clienteId: "c4", orcamentoId: null, status: "aguardando", data: "", hora: "", responsavel: "Jonas Ribeiro", local: "Rua Vergueiro, 3320 — Vila Mariana, São Paulo/SP", localServico: "Entrada de serviço", itens: [itemServico(S("s5"), 1)], obs: "Interfone com ruído.", checklist: [], historico: [{ id: uid(), quando: addDays(HOJE, -2), texto: "Ordem de serviço criada" }] },
];

const LANCAMENTOS_SEED = [
  { id: "l1", tipo: "receita", descricao: "OS-0002 · Prime Imóveis", clienteId: "c3", valor: 1180, vencimento: addDays(HOJE, 11), pago: false, origemTipo: "os", origemId: "os2", categoria: "Serviços" },
  { id: "l2", tipo: "receita", descricao: "Manutenção interfone · Cond. Jardins", clienteId: "c1", valor: 540, vencimento: addDays(HOJE, -9), pago: true, pagoEm: addDays(HOJE, -9), forma: "Pix", origemTipo: "manual", categoria: "Serviços" },
  { id: "l3", tipo: "receita", descricao: "Instalação CFTV · Padaria Pão Nosso", clienteId: "c4", valor: 750, vencimento: addDays(HOJE, -2), pago: true, pagoEm: addDays(HOJE, -2), forma: "Transferência", origemTipo: "manual", categoria: "Serviços" },
  { id: "l7", tipo: "receita", descricao: "Configuração de tags · Cond. Jardins", clienteId: "c1", valor: 640, vencimento: addDays(HOJE, -6), pago: false, origemTipo: "manual", categoria: "Serviços" },
  { id: "l4", tipo: "despesa", descricao: "Compra CMP-0002 · Casa das Fontes", valor: 760, vencimento: addDays(HOJE, -7), pago: true, pagoEm: addDays(HOJE, -7), forma: "Pix", origemTipo: "compra", origemId: "cp2", categoria: "Materiais" },
  { id: "l5", tipo: "despesa", descricao: "Combustível", valor: 320, vencimento: addDays(HOJE, -5), pago: true, pagoEm: addDays(HOJE, -5), forma: "Dinheiro", origemTipo: "manual", categoria: "Deslocamento" },
  { id: "l6", tipo: "despesa", descricao: "Plano de celular e internet", valor: 189, vencimento: addDays(HOJE, 4), pago: false, origemTipo: "manual", categoria: "Fixas" },
  { id: "l8", tipo: "despesa", descricao: "Compra CMP-0001 · Distribuidora Eletro Sul", valor: 1842.5, vencimento: addDays(HOJE, 9), pago: false, origemTipo: "compra", origemId: "cp1", categoria: "Materiais" },
];

const COMPRAS_SEED = [
  { id: "cp1", numero: "CMP-0001", fornecedor: "Distribuidora Eletro Sul", data: addDays(HOJE, -6), itens: [{ id: uid(), nome: "Fechadura digital biométrica · Intelbras FR 320", qtd: 2, custo: 620 }, { id: uid(), nome: "Câmera bullet Full HD · Intelbras VHD 1220 B", qtd: 2, custo: 210 }, { id: uid(), nome: "Tag de proximidade RFID · Intelbras TH 2000", qtd: 40, custo: 4.5 }], forma: "Boleto", vencimento: addDays(HOJE, 9), anexos: [{ id: uid(), nome: "boleto-eletro-sul-08.pdf" }], lancamentoId: "l8", obs: "Pedido 88412." },
  { id: "cp2", numero: "CMP-0002", fornecedor: "Casa das Fontes", data: addDays(HOJE, -7), itens: [{ id: uid(), nome: "Fonte colmeia 12V 10A · Vetti VT-1210", qtd: 8, custo: 95 }], forma: "Pix", vencimento: addDays(HOJE, -7), anexos: [], lancamentoId: "l4", obs: "" },
];

const GARANTIAS_SEED = [
  { id: "g1", clienteId: "c3", osId: "os2", tipo: "servico", servicoId: "s5", descricao: "Manutenção de interfone", local: "Bloco B", inicio: addDays(HOJE, -4), dias: 30, ate: addDays(HOJE, 26), serie: "" },
  { id: "g2", clienteId: "c3", osId: "os2", tipo: "servico", servicoId: "s2", descricao: "Configuração de controle de acesso", local: "Bloco B", inicio: addDays(HOJE, -4), dias: 90, ate: addDays(HOJE, 86), serie: "" },
  { id: "g3", clienteId: "c4", osId: null, tipo: "servico", servicoId: "s4", descricao: "Instalação de câmera CFTV", local: "Área de produção", inicio: addDays(HOJE, -120), dias: 90, ate: addDays(HOJE, -30), serie: "" },
];

/* ============================================ empresa · usuários · acesso
   Os dados pertencem à EMPRESA, nunca ao e-mail. O usuário é identificado
   pelo e-mail e se liga à empresa por uma MEMBRESIA, que carrega o papel.
   Trocar o e-mail de um usuário não move nem perde dado empresarial.      */

/* papel de plataforma vive fora dos papéis de empresa: um proprietário jamais o herda.
   Declarado antes dos seeds porque USUARIOS_SEED depende dele. */
const PLATFORM_ADMIN = "platform_admin";
const ehPlataforma = (u) => u?.papelPlataforma === PLATFORM_ADMIN;

const EMPRESAS_SEED = [
  { ...EMPRESA_SEED, id: "e1", criadaEm: addDays(HOJE, -240) },
  {
    id: "e2", nome: "Carlos Elétrica", documento: "29.110.884/0001-30",
    atividade: "Instalações elétricas prediais", telefone: "(11) 3411-9080",
    whatsapp: "(11) 98330-1177", email: "contato@carloseletrica.com.br",
    endereco: "Rua Tuiuti, 210 — Tatuapé, São Paulo/SP", responsavel: "Carlos Prado",
    temEquipe: false, validadePadrao: 10, criadaEm: addDays(HOJE, -35),
    condicaoPadrao: "Pagamento à vista na conclusão.", observacaoPadrao: "",
  },
];

const USUARIOS_SEED = [
  { id: "u1", nome: "Jonas Ribeiro", email: "jonas@jrservicostecnicos.com.br", ultimoAcesso: HOJE },
  { id: "u2", nome: "Diego Farias", email: "diego@jrservicostecnicos.com.br", telefone: "(11) 97744-2019", funcao: "Técnico instalador", ultimoAcesso: addDays(HOJE, -1) },
  { id: "u3", nome: "Carlos Prado", email: "carlos@carloseletrica.com.br", ultimoAcesso: addDays(HOJE, -4) },
  { id: "u0", nome: "João — ZiisTec", email: "joao@ziistec.com.br", papelPlataforma: PLATFORM_ADMIN, ultimoAcesso: HOJE },
];

/* vínculo usuário ⇄ empresa: é aqui que mora o papel */
const MEMBRESIAS_SEED = [
  { id: "m1", usuarioId: "u1", empresaId: "e1", papel: "proprietario", ativo: true, desde: addDays(HOJE, -240) },
  { id: "m2", usuarioId: "u2", empresaId: "e1", papel: "tecnico", ativo: true, desde: addDays(HOJE, -90) },
  { id: "m3", usuarioId: "u3", empresaId: "e2", papel: "proprietario", ativo: true, desde: addDays(HOJE, -35) },
];

const PLANO = { nome: "ZiisTec Mensal", valor: 69.9 };
const ASSINATURAS_SEED = [
  { id: "a1", empresaId: "e1", plano: PLANO.nome, valor: PLANO.valor, status: "ativa", inicio: addDays(HOJE, -240), proximaCobranca: addDays(HOJE, 12) },
  { id: "a2", empresaId: "e2", plano: PLANO.nome, valor: PLANO.valor, status: "pendente", inicio: addDays(HOJE, -35), proximaCobranca: addDays(HOJE, -3) },
];
const ST_ASSINATURA = {
  trial: { label: "Avaliação", tone: "marca", libera: true },
  ativa: { label: "Ativa", tone: "sucesso", libera: true },
  pendente: { label: "Pagamento pendente", tone: "atencao", libera: true },
  suspensa: { label: "Suspensa", tone: "erro", libera: false },
  cancelada: { label: "Cancelada", tone: "neutro", libera: false },
};

/* permissões por papel. A lista é curta de propósito: dois papéis, regras claras. */
const PERMISSOES = {
  proprietario: ["inicio", "agenda", "clientes", "catalogo", "orcamentos", "ordens", "compras", "financeiro", "garantias", "equipe", "config", "assinatura", "verValores", "todasOS"],
  tecnico: ["inicio", "agenda", "ordens", "registrarMateriais"],
};
const pode = (papel, chave) => (PERMISSOES[papel] || []).includes(chave);

/* papel de plataforma vive fora dos papéis de empresa: um proprietário jamais o herda */
const senhaTemporaria = () => {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ", nums = "23456789";
  const sorteia = (s2, n) => Array.from({ length: n }, () => s2[Math.floor(Math.random() * s2.length)]).join("");
  return `${sorteia(letras, 4)}-${sorteia(nums, 4)}`;
};

/* segundo conjunto de dados, de outra empresa — existe para o teste de isolamento */
const DADOS_E2 = {
  clientes: [{ id: "c9", empresaId: "e2", tipo: "PF", nome: "Ricardo Menezes", documento: "512.900.331-07", telefone: "(11) 4002-8922", whatsapp: "(11) 99120-4455", endereco: "Rua Serra de Bragança, 88 — Tatuapé, São Paulo/SP", obs: "" }],
  servicos: [{ id: "s9", empresaId: "e2", nome: "Troca de disjuntor", categoria: "Elétrica", unidade: "unidade", preco: 150, custo: 45, descricao: "Substituição com teste de carga.", ativo: true, garantiaDias: 90, retornoDias: 0 }],
  ordens: [{ ...osBase, id: "os9", empresaId: "e2", numero: "OS-0001", clienteId: "c9", orcamentoId: null, status: "agendada", data: HOJE, hora: "15:00", responsavelId: "u3", responsavel: "Carlos Prado", local: "Rua Serra de Bragança, 88 — Tatuapé, São Paulo/SP", localServico: "Quadro geral", itens: [], descricaoLivre: "Quadro desarmando ao ligar o chuveiro. Verificar disjuntor e fiação.", obs: "", checklist: [], historico: [{ id: uid(), quando: HOJE, texto: "Ordem de serviço criada" }] }],
};

/* toda entidade empresarial carrega empresaId desde a origem */
const daEmpresa = (arr, empresaId) => arr.map((x) => ({ ...x, empresaId }));
const RESPONSAVEIS = { "Jonas Ribeiro": "u1", "Diego Farias": "u2" };

/* ========================================================== UI primitives */
const cx = (...c) => c.filter(Boolean).join(" ");
const ring = "focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50";

function Btn({ children, onClick, variant = "primary", size = "md", icon: Icon, className, type = "button", disabled, title, ariaLabel }) {
  const base = `inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors duration-150 active:scale-[0.99] select-none disabled:opacity-40 disabled:pointer-events-none ${ring}`;
  const variants = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    dark: "bg-slate-900 text-white hover:bg-slate-800",
    soft: "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
    quiet: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "text-rose-700 hover:bg-rose-50",
  };
  const sizes = { sm: "text-sm px-3 py-2", md: "text-sm px-4 py-3", lg: "text-base px-5 py-3.5" };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel || title}
      className={cx(base, variants[variant], sizes[size], className)}>
      {Icon && <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />}
      {children}
    </button>
  );
}

const TONE = {
  neutro: "bg-slate-100 text-slate-600",
  atencao: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/70",
  marca: "bg-teal-50 text-teal-800 ring-1 ring-teal-200/70",
  sucesso: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/70",
  erro: "bg-rose-50 text-rose-800 ring-1 ring-rose-200/70",
};
const Pill = ({ tone = "neutro", children, className }) => (
  <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", TONE[tone], className)}>{children}</span>
);

const ST_ORC = {
  rascunho: { label: "Rascunho", tone: "neutro" },
  enviado: { label: "Aguardando resposta", tone: "atencao" },
  aprovado: { label: "Aprovado", tone: "marca" },
  recusado: { label: "Recusado", tone: "erro" },
  expirado: { label: "Expirado", tone: "neutro" },
};
const ST_OS = {
  aguardando: { label: "Sem agendamento", tone: "neutro" },
  agendada: { label: "Agendada", tone: "marca" },
  andamento: { label: "Em andamento", tone: "atencao" },
  concluida: { label: "Concluída", tone: "sucesso" },
  cancelada: { label: "Cancelada", tone: "erro" },
};
const statusLanc = (l) => (l.pago ? { label: l.tipo === "receita" ? "Recebido" : "Pago", tone: "sucesso" } : l.vencimento < HOJE ? { label: "Vencido", tone: "erro" } : { label: l.tipo === "receita" ? "A receber" : "A pagar", tone: "atencao" });

const Panel = ({ children, className }) => <div className={cx("bg-white rounded-2xl ring-1 ring-slate-200/70", className)}>{children}</div>;

const Rotulo = ({ children, acao }) => (
  <div className="flex items-end justify-between gap-4 mb-3">
    <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em]">{children}</h2>
    {acao}
  </div>
);

const Field = ({ label, children, hint, className }) => (
  <label className={cx("block", className)}>
    <span className="block text-[13px] font-medium text-slate-600 mb-1.5">{label}</span>
    {children}
    {hint && <span className="block text-xs text-slate-400 mt-1.5 leading-relaxed">{hint}</span>}
  </label>
);

const inputCls = "w-full rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-3 text-[15px] text-slate-900 placeholder:text-slate-300 transition focus:outline-none focus:ring-2 focus:ring-teal-600";
const Input = (p) => <input {...p} className={cx(inputCls, p.className)} />;
const Textarea = (p) => <textarea {...p} className={cx(inputCls, "resize-none leading-relaxed", p.className)} />;
const Select = ({ children, ...p }) => <select {...p} className={cx(inputCls, "appearance-none", p.className)}>{children}</select>;

function Modal({ open, onClose, title, sub, children, footer, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={cx("relative bg-white w-full rounded-t-3xl sm:rounded-3xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[88vh]", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <div className="flex items-start justify-between gap-4 px-5 sm:px-7 pt-6 pb-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 tracking-tight">{title}</h3>
            {sub && <p className="text-sm text-slate-500 mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" className={cx("p-2 -mr-1 rounded-lg text-slate-400 hover:bg-slate-100", ring)}><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 sm:px-7 pb-6 space-y-5">{children}</div>
        {footer && <div className="px-5 sm:px-7 py-4 border-t border-slate-100 flex gap-3 justify-end">{footer}</div>}
      </div>
    </div>
  );
}

function Confirm({ estado, onClose }) {
  if (!estado) return null;
  return (
    <Modal open onClose={onClose} title={estado.titulo}
      footer={<><Btn variant="ghost" onClick={onClose}>Voltar</Btn>
        <Btn variant="dark" onClick={() => { estado.acao(); onClose(); }}>{estado.confirmar}</Btn></>}>
      <p className="text-[15px] text-slate-600 leading-relaxed">{estado.texto}</p>
    </Modal>
  );
}

const PageHead = ({ title, sub, action }) => (
  <div className="flex items-start justify-between gap-4 mb-7">
    <div>
      <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em]">{title}</h1>
      {sub && <p className="text-slate-500 mt-1.5 text-[15px]">{sub}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

const Empty = ({ icon: Icon, title, sub, action }) => (
  <div className="text-center py-12 px-6">
    <div className="w-12 h-12 rounded-2xl bg-white ring-1 ring-slate-200/70 mx-auto flex items-center justify-center text-slate-300"><Icon className="w-5 h-5" /></div>
    <p className="mt-4 font-medium text-slate-800">{title}</p>
    {sub && <p className="text-sm text-slate-500 mt-1.5 max-w-sm mx-auto leading-relaxed">{sub}</p>}
    {action && <div className="mt-5 flex justify-center">{action}</div>}
  </div>
);

const SearchBox = ({ value, onChange, placeholder, autoFocus }) => (
  <div className="relative">
    <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} className={cx(inputCls, "pl-11")} />
  </div>
);

const Avatar = ({ nome, tipo, size = "md" }) => (
  <div className={cx("rounded-xl flex items-center justify-center shrink-0 font-semibold",
    size === "lg" ? "w-14 h-14 text-base" : "w-11 h-11 text-sm",
    tipo === "PJ" ? "bg-slate-900 text-white" : "bg-teal-50 text-teal-800 ring-1 ring-teal-200/70")}>
    {tipo === "PJ" ? <Building2 className={size === "lg" ? "w-6 h-6" : "w-5 h-5"} /> : iniciais(nome)}
  </div>
);

const Tabs = ({ valor, onChange, opcoes, className }) => (
  <div className={cx("flex gap-2 overflow-x-auto pb-1 -mx-1 px-1", className)}>
    {opcoes.map((o) => (
      <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={valor === o.id}
        className={cx("px-4 py-2.5 rounded-xl text-[13px] font-medium whitespace-nowrap transition-colors", ring,
          valor === o.id ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50")}>
        {o.label}
      </button>
    ))}
  </div>
);

function Trilha({ etapas }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {etapas.map((e, i) => (
        <React.Fragment key={e.label + i}>
          <span className={cx("inline-flex items-center gap-1.5 text-[11px] font-medium",
            e.feito ? "text-teal-800" : e.alerta ? "text-amber-700" : "text-slate-400")}>
            {e.feito ? <CheckCircle2 className="w-3.5 h-3.5" /> : e.alerta ? <Clock className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
            {e.label}
          </span>
          {i < etapas.length - 1 && <span className={cx("w-4 h-px", e.feito ? "bg-teal-300" : "bg-slate-200")} />}
        </React.Fragment>
      ))}
    </div>
  );
}

const Linha = ({ children, onClick, className }) => {
  const cls = cx("w-full text-left px-4 sm:px-5 py-4 transition-colors", onClick && "hover:bg-slate-50/80", className);
  return onClick ? <button onClick={onClick} className={cx(cls, ring, "block")}>{children}</button> : <div className={cls}>{children}</div>;
};

/* endereço que abre rota no mapa */
const Endereco = ({ valor, local, className, compacto }) => {
  if (!valor) return null;
  const destino = [local, valor].filter(Boolean).join(", ");
  return (
    <a href={mapsUrl(destino)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
      className={cx("inline-flex items-start gap-1.5 text-teal-800 hover:underline", ring, className)}>
      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
      <span className={compacto ? "truncate" : ""}>{local ? `${local} · ${valor}` : valor}</span>
    </a>
  );
};

/* =============================================== voz + interpretação por IA */
function usarReconhecimento() {
  const [suportado] = useState(() => typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState(null);
  const rec = useRef(null);

  const iniciar = (aoTexto) => {
    if (!suportado) return;
    setErro(null);
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new Rec();
    r.lang = "pt-BR"; r.continuous = true; r.interimResults = true;
    let finalizado = "";
    r.onresult = (ev) => {
      let parcial = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalizado += t + " "; else parcial += t;
      }
      aoTexto((finalizado + parcial).trim());
    };
    r.onerror = (ev) => {
      const msgs = {
        "not-allowed": "Permissão de microfone negada. Libere o microfone nas configurações do navegador.",
        "service-not-allowed": "O navegador bloqueou o reconhecimento de voz neste site.",
        "no-speech": "Não ouvi nada. Toque no microfone e fale mais perto do aparelho.",
        "audio-capture": "Nenhum microfone disponível neste aparelho.",
        network: "Sem conexão para transcrever agora.",
        aborted: null,
      };
      const m = msgs[ev.error];
      if (m !== null) setErro(m || "Não consegui capturar o áudio.");
      setOuvindo(false);
    };
    r.onend = () => setOuvindo(false);
    rec.current = r;
    try { r.start(); setOuvindo(true); } catch { setErro("Microfone indisponível."); }
  };
  const parar = () => { rec.current?.stop(); setOuvindo(false); };
  return { suportado, ouvindo, erro, iniciar, parar };
}

/* Componente único de ditado. Usado em TODO campo de texto livre do ZiisTec.
   A voz complementa o campo: o texto ditado é acrescentado ao que já existe,
   nunca substitui, e continua editável à mão. */
function CampoVoz({ valor = "", onChange, placeholder, rows = 4, destaque, dica }) {
  const { suportado, ouvindo, erro, iniciar, parar } = usarReconhecimento();
  const baseRef = useRef("");
  const comecar = () => {
    baseRef.current = valor.trim() ? valor.trimEnd() + " " : "";
    iniciar((t) => onChange(baseRef.current + t));
  };
  const alternar = () => (ouvindo ? parar() : comecar());

  return (
    <div>
      <div className="relative">
        <Textarea rows={rows} value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className={cx(suportado && !destaque && "pr-14", ouvindo && "ring-2 ring-teal-600")} />
        {suportado && !destaque && (
          <button onClick={alternar} aria-label={ouvindo ? "Parar de gravar" : "Ditar por voz"} title={ouvindo ? "Parar de gravar" : "Ditar por voz"}
            className={cx("absolute right-2.5 bottom-2.5 p-2.5 rounded-lg transition-colors", ring,
              ouvindo ? "bg-slate-900 text-white" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}>
            {ouvindo ? <MicOff className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
          </button>
        )}
      </div>

      {suportado && destaque && (
        <Btn className="w-full mt-3" size="lg" variant={ouvindo ? "dark" : "primary"} icon={ouvindo ? MicOff : Mic} onClick={alternar}>
          {ouvindo ? "Parar de gravar" : valor.trim() ? "Continuar falando" : "Falar o que foi feito"}
        </Btn>
      )}

      <div className="flex items-center gap-3 mt-2 flex-wrap min-h-[18px]">
        {ouvindo ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-teal-800">
            <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
            Ouvindo… pode falar. O texto entra depois do que já está escrito.
          </span>
        ) : (
          <>
            {!suportado && <span className="text-[12px] text-slate-400">Ditado indisponível neste navegador — funciona no Chrome. Pode digitar normalmente.</span>}
            {suportado && dica && <span className="text-[12px] text-slate-400">{dica}</span>}
          </>
        )}
      </div>
      {erro && <p className="text-[12.5px] text-rose-700 mt-1">{erro} Você pode continuar digitando.</p>}
    </div>
  );
}

async function chamarIA(prompt) {
  return chamarIAReal(prompt);
}

const promptOrcamento = ({ fala, clientes, servicos, produtos, rascunho, comando }) => `Você interpreta pedidos de orçamento de um prestador de serviços brasileiro e devolve APENAS JSON, sem markdown e sem comentários.

CATÁLOGO DE CLIENTES: ${JSON.stringify(clientes.map((c) => ({ id: c.id, nome: c.fantasia || c.nome })))}
CATÁLOGO DE SERVIÇOS: ${JSON.stringify(servicos.filter((s) => s.ativo).map((s) => ({ id: s.id, nome: s.nome, preco: s.preco, unidade: s.unidade })))}
CATÁLOGO DE PRODUTOS: ${JSON.stringify(produtos.filter((p) => p.ativo).map((p) => ({ id: p.id, nome: `${p.nome} ${p.marca || ""} ${p.modelo || ""}`.trim(), preco: p.preco, unidade: p.unidade })))}

${rascunho ? `RASCUNHO ATUAL: ${JSON.stringify(rascunho)}\nCOMANDO DE CORREÇÃO DO USUÁRIO: "${comando}"\nAplique somente a correção pedida e devolva o rascunho completo atualizado.` : `FALA DO USUÁRIO: "${fala}"`}

Regras:
- Use itens do catálogo sempre que o nome corresponder; nesse caso preencha catalogoId e tipo ("servico" ou "produto").
- Se o usuário não disser preço, deixe preco como null (o sistema usará o preço do catálogo).
- Se disser um preço, use exatamente esse valor.
- Se um item não existir no catálogo, use catalogoId null e preencha nome; se não houver preço dito, deixe preco null.
- Nunca invente cliente. Se não houver correspondência clara, deixe clienteId null e preencha clienteSugerido com o nome dito.
- Liste em "avisos" tudo que ficou incerto, em português simples.

Formato exato:
{"clienteId":string|null,"clienteSugerido":string|null,"itens":[{"tipo":"servico"|"produto","catalogoId":string|null,"nome":string,"qtd":number,"unidade":string|null,"preco":number|null}],"desconto":number,"acrescimo":number,"validadeDias":number|null,"condicao":string|null,"obs":string|null,"localServico":string|null,"avisos":[string]}`;

const promptRelato = (fala) => `Organize o relato de atendimento abaixo em seções, em português. Devolva APENAS JSON.
RELATO FALADO: "${fala}"

Regras rígidas:
- Não invente diagnóstico, material, medida, marca, preço, teste ou resultado.
- Não acrescente conclusões técnicas que não foram ditas.
- Se algo não foi dito, simplesmente não crie a seção.
- Mantenha as palavras do profissional sempre que possível; corrija apenas pontuação e concordância.

Formato: {"texto":"DIAGNÓSTICO\\n...\\n\\nSERVIÇO EXECUTADO\\n...\\n\\nTESTES\\n...\\n\\nRESULTADO\\n..."}`;

/* ================================================================== App */
export default function ZiisTec({ contexto }) {
  /* contexto vem do Supabase (Fase 1). Quando presente, substitui a
     autenticação simulada e os dados de demonstração de empresa/usuário. */
  const real = Boolean(contexto);
  const [tela, setTela] = useState("inicio");
  const [drawer, setDrawer] = useState(false);
  const [busca, setBusca] = useState(false);
  /* --- identidade e acesso --- */
  const [empresas, setEmpresas] = useState(() => (real ? [contexto.empresa] : EMPRESAS_SEED));
  const [usuarios, setUsuarios] = useState(() => (real ? contexto.usuarios : USUARIOS_SEED));
  const [membresias, setMembresias] = useState(() => (real ? contexto.membresias : MEMBRESIAS_SEED));
  const [assinaturas, setAssinaturas] = useState(() => (real ? [contexto.assinatura] : ASSINATURAS_SEED));
  const [sessao, setSessao] = useState(() => (real ? contexto.sessao : null));

  /* mudou empresa, papel ou usuário no Supabase: o app acompanha */
  useEffect(() => {
    if (!real) return;
    setEmpresas([contexto.empresa]);
    setUsuarios(contexto.usuarios);
    setMembresias(contexto.membresias);
    setAssinaturas([contexto.assinatura]);
    setSessao(contexto.sessao);
  }, [real, contexto?.chave]);

  /* --- dados empresariais: guardados juntos, sempre com empresaId --- */
  const [clientes, setClientes] = useState(() => real ? [] : ([...daEmpresa(CLIENTES_SEED, "e1"), ...DADOS_E2.clientes]));
  const [servicos, setServicos] = useState(() => real ? [] : ([...daEmpresa(SERVICOS_SEED, "e1"), ...DADOS_E2.servicos]));
  const [produtos, setProdutos] = useState(() => real ? [] : (daEmpresa(PRODUTOS_SEED, "e1")));
  const [orcamentos, setOrcamentos] = useState(() => real ? [] : (daEmpresa(ORCAMENTOS_SEED, "e1")));
  const [ordens, setOrdens] = useState(() => (real ? [] : [
    ...daEmpresa(ORDENS_SEED, "e1").map((o) => ({ ...o, responsavelId: RESPONSAVEIS[o.responsavel] || "u1" })),
    ...DADOS_E2.ordens,
  ]));
  const [lancamentos, setLancamentos] = useState(() => real ? [] : (daEmpresa(LANCAMENTOS_SEED, "e1")));
  const [compras, setCompras] = useState(() => real ? [] : (daEmpresa(COMPRAS_SEED, "e1")));
  const [garantias, setGarantias] = useState(() => real ? [] : (daEmpresa(GARANTIAS_SEED, "e1")));
  const [toast, setToast] = useState(null);
  const [confirmar, setConfirmar] = useState(null);

  const [clienteAberto, setClienteAberto] = useState(null);
  const [orcamentoAberto, setOrcamentoAberto] = useState(null);
  const [osAberta, setOsAberta] = useState(null);
  const [compraAberta, setCompraAberta] = useState(null);
  const [garantiaAberta, setGarantiaAberta] = useState(null);

  const aviso = (t) => { setToast(t); setTimeout(() => setToast(null), 3000); };

  /* ---- contexto de acesso: usuário → membresia → empresa ---- */
  const usuarioAtual = usuarios.find((u) => u.id === sessao?.usuarioId) || null;
  const membresia = membresias.find((m) => m.id === sessao?.membresiaId) || null;
  const papel = membresia?.papel || null;
  const empresaId = membresia?.empresaId || null;
  const empresa = empresas.find((e) => e.id === empresaId) || EMPRESA_SEED;
  const assinatura = assinaturas.find((a) => a.empresaId === empresaId) || null;
  const permitido = (chave) => pode(papel, chave);

  /* Fase 2: quando há sessão real, os módulos operacionais vêm do Supabase.
     RLS continua sendo a autoridade: o técnico recebe apenas o que pode ler. */
  useEffect(() => {
    if (!real || !empresaId) return;
    let ativo = true;
    recarregarSeguro(empresaId).then(async ({ data, error }) => {
      if (!ativo) return;
      if (error) { aviso(error); return; }
      try { data = await hidratarComplementosDB(data, empresaId); } catch (e) { aviso(mensagemErro(e)); }
      if (!ativo) return;
      setClientes(data.clientes); setServicos(data.servicos); setProdutos(data.produtos);
      setOrcamentos(data.orcamentos); setOrdens(data.ordens); setLancamentos(data.lancamentos);
      setCompras(data.compras); setGarantias(data.garantias);
    });
    return () => { ativo = false; };
  }, [real, empresaId, contexto?.chave]);

  const recarregarDados = async () => {
    if (!real || !empresaId) return;
    let { data, error } = await recarregarSeguro(empresaId);
    if (error) { aviso(error); return; }
    try { data = await hidratarComplementosDB(data, empresaId); } catch (e) { aviso(mensagemErro(e)); }
    setClientes(data.clientes); setServicos(data.servicos); setProdutos(data.produtos);
    setOrcamentos(data.orcamentos); setOrdens(data.ordens); setLancamentos(data.lancamentos);
    setCompras(data.compras); setGarantias(data.garantias);
  };

  const recarregarEquipe = async () => {
    if (!real || !empresaId || papel !== "proprietario") return;
    try { const eq = await carregarEquipeDB(empresaId); setUsuarios(eq.usuarios); setMembresias(eq.membresias); }
    catch (e) { aviso(mensagemErro(e)); }
  };
  useEffect(() => { if (real && empresaId && papel === "proprietario") recarregarEquipe(); }, [real, empresaId, papel, contexto?.chave]);

  /* ---- escopo: nada é lido sem passar pelo filtro da empresa da sessão ---- */
  const doTenant = (arr) => (empresaId ? arr.filter((x) => x.empresaId === empresaId) : []);
  const servicosEmp = permitido("catalogo") ? doTenant(servicos) : [];
  const produtosEmp = (permitido("catalogo") || permitido("registrarMateriais")) ? doTenant(produtos) : [];
  const ordensEmp = doTenant(ordens).filter((o) => permitido("todasOS") || o.responsavelId === usuarioAtual?.id);
  /* sem a permissão de carteira, o técnico só alcança os clientes das ordens dele —
     vale também para busca global, e não só para a aba Clientes */
  const clientesEmp = permitido("clientes")
    ? doTenant(clientes)
    : doTenant(clientes).filter((c) => ordensEmp.some((o) => o.clienteId === c.id));
  const orcamentosEmp = permitido("orcamentos") ? doTenant(orcamentos) : [];
  const lancamentosEmp = permitido("financeiro") ? doTenant(lancamentos) : [];
  const comprasEmp = permitido("compras") ? doTenant(compras) : [];
  const garantiasEmp = permitido("garantias")
    ? doTenant(garantias)
    : doTenant(garantias).filter((g) => ordensEmp.some((o) => o.id === g.osId || o.garantiaId === g.id));
  const equipe = membresias.filter((m) => m.empresaId === empresaId)
    .map((m) => ({ ...m, usuario: usuarios.find((u) => u.id === m.usuarioId) }));

  const cliente = (id) => clientesEmp.find((c) => c.id === id);
  const nomeCliente = (id) => { const c = cliente(id); return c?.fantasia || c?.nome || "Cliente"; };

  const irPara = (t) => {
    setTela(t); setClienteAberto(null); setOrcamentoAberto(null); setOsAberta(null); setCompraAberta(null);
    setGarantiaAberta(null); setDrawer(false); setBusca(false); window.scrollTo?.({ top: 0 });
  };
  const abrirOS = (id) => { setTela("ordens"); setOsAberta(id); setBusca(false); setDrawer(false); };
  const abrirOrc = (id) => { setTela("orcamentos"); setOrcamentoAberto(id); setBusca(false); setDrawer(false); };
  const abrirCliente = (id) => { setTela("clientes"); setClienteAberto(id); setBusca(false); setDrawer(false); };
  const abrirCompra = (id) => { setTela("compras"); setCompraAberta(id); setBusca(false); setDrawer(false); };
  const abrirGarantia = (id) => { setTela("garantias"); setGarantiaAberta(id); setBusca(false); setDrawer(false); };

  const proxNumero = (lista, prefixo) => {
    const n = lista.reduce((m, x) => Math.max(m, Number(x.numero?.split("-")[1] || 0)), 0) + 1;
    return `${prefixo}-${String(n).padStart(4, "0")}`;
  };

  /* --------- cadastros --------- */
  const salvarEmpresa = async (dados) => {
    setEmpresas((l) => l.map((e) => (e.id === empresaId ? { ...e, ...dados, id: e.id } : e)));
    if (real) {
      const erro = await contexto.salvarEmpresa(dados);
      if (erro) { aviso(erro); contexto.recarregar(); }
    }
  };

  /* equipe: usuário é criado uma vez e vinculado à empresa por membresia */
  /* Convite: o colaborador nunca cria a própria conta nem uma segunda empresa.
     A senha temporária é exibida uma única vez ao proprietário e NÃO é guardada —
     guardar senha exige hash no servidor, que ainda não existe. */
  const salvarColaborador = async ({ nome, email, telefone, funcao, papel: pp }) => {
    if (real) {
      try { const eq = await convidarColaboradorDB({ nome, email, telefone, funcao, papel: pp }, empresaId, usuarioAtual?.id); setUsuarios(eq.usuarios); setMembresias(eq.membresias); aviso(`${nome} foi convidado para a equipe.`); return { convite: true }; }
      catch (e) { aviso(mensagemErro(e)); return null; }
    }
    const limpo = email.trim().toLowerCase();
    const existente = usuarios.find((u) => u.email.toLowerCase() === limpo);
    if (existente && membresias.some((m) => m.usuarioId === existente.id && m.empresaId === empresaId)) { aviso("Esta pessoa já faz parte da sua equipe."); return null; }
    const usuarioId = existente?.id || uid();
    if (!existente) setUsuarios((l) => [...l, { id: usuarioId, nome, email: limpo, telefone: telefone || "", funcao: funcao || "", ultimoAcesso: null, precisaTrocarSenha: true }]);
    setMembresias((l) => [...l, { id: uid(), usuarioId, empresaId, papel: pp, ativo: true, desde: HOJE, convite: "pendente" }]);
    aviso(`${nome} foi convidado para a equipe.`); return { usuarioId, senhaTemporaria: senhaTemporaria() };
  };
  const atualizarColaborador = async (usuarioId, dados) => {
    if (real) {
      try { await atualizarColaboradorDB(empresaId, usuarioId, dados); await recarregarEquipe(); aviso("Colaborador atualizado"); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    setUsuarios((l) => l.map((u) => (u.id === usuarioId ? { ...u, ...dados } : u)));
  };
  const reenviarAcesso = (usuarioId) => {
    if (real) { aviso("O colaborador entra com o próprio e-mail. Se esqueceu a senha, use 'Esqueci minha senha' na tela de login."); return null; }
    setUsuarios((l) => l.map((u) => (u.id === usuarioId ? { ...u, precisaTrocarSenha: true } : u)));
    setMembresias((l) => l.map((m) => (m.usuarioId === usuarioId && m.empresaId === empresaId ? { ...m, convite: "pendente" } : m)));
    return senhaTemporaria();
  };
  const concluirPrimeiroAcesso = (usuarioId) => {
    setUsuarios((l) => l.map((u) => (u.id === usuarioId ? { ...u, precisaTrocarSenha: false, ultimoAcesso: HOJE } : u)));
    setMembresias((l) => l.map((m) => (m.usuarioId === usuarioId ? { ...m, convite: "aceito" } : m)));
  };
  const alternarColaborador = async (m) => {
    if (real) {
      try { await alternarColaboradorDB(m); await recarregarEquipe(); aviso(m.ativo ? "Colaborador desativado" : "Colaborador reativado"); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    setMembresias((l) => l.map((x) => (x.id === m.id ? { ...x, ativo: !x.ativo } : x)));
    aviso(m.ativo ? "Colaborador desativado" : "Colaborador reativado");
  };
  const mudarAssinatura = async (empresaAlvo, status) => {
    if (real) {
      try {
        let novoStatus = status;
        if (status === "cancelada") novoStatus = await cancelarAssinaturaDB(empresaAlvo);
        else if (status === "ativa") novoStatus = await reativarAssinaturaDB(empresaAlvo);
        setAssinaturas((l) => l.map((a) => (a.empresaId === empresaAlvo ? { ...a, status: novoStatus } : a)));
        await contexto.recarregar();
        aviso(`Assinatura marcada como ${ST_ASSINATURA[novoStatus]?.label?.toLowerCase() || novoStatus}`);
      } catch (e) { aviso(mensagemErro(e)); }
      return;
    }
    setAssinaturas((l) => l.map((a) => (a.empresaId === empresaAlvo ? { ...a, status } : a)));
    aviso(`Assinatura marcada como ${ST_ASSINATURA[status].label.toLowerCase()}`);
  };
  const sair = () => {
    if (real) { contexto.sair(); return; }
    setSessao(null); setTela("inicio");
  };

  const salvarCliente = async (c) => {
    if (real) {
      try {
        const salvo = await salvarClienteDB(c, empresaId);
        setClientes((l) => c.id ? l.map((x) => x.id === salvo.id ? salvo : x) : [salvo, ...l]);
        aviso(c.id ? "Cliente atualizado" : "Cliente cadastrado");
        return salvo.id;
      } catch (e) { aviso(mensagemErro(e)); return null; }
    }
    let id = c.id;
    if (c.id) setClientes((l) => l.map((x) => (x.id === c.id ? c : x)));
    else { id = uid(); setClientes((l) => [...l, { ...c, id, empresaId }]); }
    aviso(c.id ? "Cliente atualizado" : "Cliente cadastrado");
    return id;
  };
  const salvarServico = async (s) => {
    if (real) {
      try { const salvo = await salvarServicoDB(s, empresaId); setServicos((l) => s.id ? l.map((x)=>x.id===salvo.id?salvo:x) : [salvo,...l]); aviso(s.id ? "Serviço atualizado" : "Serviço cadastrado"); return salvo.id; }
      catch (e) { aviso(mensagemErro(e)); return null; }
    }
    setServicos((l) => (s.id ? l.map((x) => (x.id === s.id ? s : x)) : [...l, { ...s, id: uid(), empresaId }]));
    aviso(s.id ? "Serviço atualizado" : "Serviço cadastrado");
  };
  const salvarProduto = async (p) => {
    if (real) {
      try { const salvo = await salvarProdutoDB(p, empresaId); setProdutos((l) => p.id ? l.map((x)=>x.id===salvo.id?salvo:x) : [salvo,...l]); aviso(p.id ? "Produto atualizado" : "Produto cadastrado"); return salvo.id; }
      catch (e) { aviso(mensagemErro(e)); return null; }
    }
    setProdutos((l) => (p.id ? l.map((x) => (x.id === p.id ? p : x)) : [...l, { ...p, id: uid(), empresaId }]));
    aviso(p.id ? "Produto atualizado" : "Produto cadastrado");
  };

  /* --------- orçamento --------- */
  const salvarOrcamento = async (o) => {
    if (real) {
      try {
        const salvo = await salvarOrcamentoDB(o, empresaId, usuarioAtual?.id);
        setOrcamentos((l) => o.id ? l.map((x)=>x.id===salvo.id?{...salvo,osId:x.osId}:x) : [salvo,...l]);
        aviso(o.id ? "Orçamento salvo" : `${salvo.numero} criado`); setOrcamentoAberto(salvo.id); return salvo.id;
      } catch (e) { aviso(mensagemErro(e)); return null; }
    }
    if (o.id) { setOrcamentos((l) => l.map((x) => (x.id === o.id ? o : x))); aviso("Orçamento salvo"); setOrcamentoAberto(o.id); }
    else { const novo = { ...o, id: uid(), numero: proxNumero(orcamentosEmp, "ORC"), empresaId, osId: null }; setOrcamentos((l) => [novo, ...l]); aviso(`${novo.numero} criado`); setOrcamentoAberto(novo.id); }
  };
  /* duplicar: copia cliente, itens e condições; não leva aprovação, OS nem número */
  const duplicarOrcamento = async (o) => {
    if (real) {
      try { const novo=await duplicarOrcamentoDB(o,empresaId,usuarioAtual?.id,addDays(HOJE,empresa.validadePadrao)); setOrcamentos((l)=>[novo,...l]); aviso(`${novo.numero} criado como cópia do ${o.numero}`); setOrcamentoAberto(novo.id); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    const novo = { ...o, id: uid(), numero: proxNumero(orcamentosEmp, "ORC"), empresaId, status: "rascunho", data: HOJE, validade: addDays(HOJE, empresa.validadePadrao), osId: null, itens: o.itens.map((i) => ({ ...i, id: uid() })) };
    setOrcamentos((l) => [novo, ...l]); aviso(`${novo.numero} criado como cópia do ${o.numero}`); setOrcamentoAberto(novo.id);
  };
  const mudarStatusOrc = async (id, status) => {
    if (real) {
      try { const salvo = await atualizarStatusOrcamentoDB(id,status); setOrcamentos((l)=>l.map((o)=>o.id===id?{...o,...salvo,osId:o.osId}:o)); }
      catch(e){ aviso(mensagemErro(e)); return; }
    } else setOrcamentos((l) => l.map((o) => (o.id === id ? { ...o, status } : o)));
    aviso(status === "aprovado" ? "Orçamento aprovado" : `Orçamento marcado como ${ST_ORC[status].label.toLowerCase()}`);
  };

  const gerarOS = async (orc) => {
    if (orc.osId) { setTela("ordens"); setOsAberta(orc.osId); return; }
    const c = cliente(orc.clienteId);
    if (real) {
      try { const nova=await criarOSDeOrcamentoDB(orc,empresaId,usuarioAtual?.id,{endereco:c?.endereco||""}); setOrdens((l)=>[nova,...l]); setOrcamentos((l)=>l.map((o)=>o.id===orc.id?{...o,osId:nova.id}:o)); aviso(`${nova.numero} criada. Falta definir a data.`); setTela("ordens"); setOrcamentoAberto(null); setOsAberta(nova.id); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    const nova = { ...osBase, id: uid(), empresaId, numero: proxNumero(doTenant(ordens), "OS"), responsavelId: usuarioAtual?.id, clienteId: orc.clienteId, orcamentoId: orc.id, status: "aguardando", data: "", hora: "", responsavel: empresa.responsavel, local: orc.local || c?.endereco || "", localServico: orc.localServico || "", itens: orc.itens.map((i) => ({ ...i, id: uid() })), obs: orc.obs, checklist: [], historico: [{ id: uid(), quando: HOJE, texto: `Gerada a partir do ${orc.numero}` }] };
    setOrdens((l) => [nova, ...l]); setOrcamentos((l) => l.map((o) => (o.id === orc.id ? { ...o, osId: nova.id } : o))); aviso(`${nova.numero} criada. Falta definir a data.`); setTela("ordens"); setOrcamentoAberto(null); setOsAberta(nova.id);
  };

  /* --------- ordem de serviço --------- */
  const salvarOS = async (os) => {
    if (real) {
      try { const salvo = await salvarOSDB(os,empresaId,usuarioAtual?.id); setOrdens((l)=>os.id?l.map((x)=>x.id===salvo.id?salvo:x):[salvo,...l]); setOsAberta(salvo.id); aviso("Ordem de serviço salva"); return salvo.id; }
      catch(e){ aviso(mensagemErro(e)); return null; }
    }
    if (os.id) setOrdens((l) => l.map((x) => (x.id === os.id ? os : x)));
    else { const nova = { ...osBase, ...os, id: uid(), empresaId, numero: proxNumero(doTenant(ordens), "OS"), responsavelId: os.responsavelId || usuarioAtual?.id, historico: [{ id: uid(), quando: HOJE, texto: "Ordem de serviço criada" }] }; setOrdens((l) => [nova, ...l]); setOsAberta(nova.id); }
    aviso("Ordem de serviço salva");
  };
  const agendarOS = async (osId, { data, hora, responsavel, responsavelId }) => {
    if (!data) return;
    if (real) {
      try { const salvo=await atualizarOSDB(osId,{scheduled_date:data,scheduled_time:hora||null,assigned_to:responsavelId||null,status:'scheduled'}); setOrdens((l)=>l.map((x)=>x.id===osId?{...salvo,responsavel}:x)); }
      catch(e){ aviso(mensagemErro(e)); return; }
    } else setOrdens((l) => l.map((x) => x.id === osId ? { ...x, data, hora, responsavel, responsavelId: responsavelId || x.responsavelId, status: x.status === "aguardando" || x.status === "agendada" ? "agendada" : x.status, historico: [...x.historico, { id: uid(), quando: HOJE, texto: `Agendada para ${dataBR(data)}${hora ? ` às ${hora}` : ""} · ${responsavel}` }] } : x));
    aviso(`Agendada para ${dataBR(data)}${hora ? ` às ${hora}` : ""}`);
  };
  const desagendarOS = async (osId) => {
    if (real) {
      try { const salvo=await atualizarOSDB(osId,{scheduled_date:null,scheduled_time:null,status:'unscheduled'}); setOrdens((l)=>l.map((x)=>x.id===osId?salvo:x)); }
      catch(e){ aviso(mensagemErro(e)); return; }
    } else setOrdens((l) => l.map((x) => x.id === osId ? { ...x, data: "", hora: "", status: "aguardando", historico: [...x.historico, { id: uid(), quando: HOJE, texto: "Agendamento removido" }] } : x));
    aviso("Agendamento removido");
  };
  const mudarStatusOS = async (os, status) => {
    if (real) {
      const mapa={aguardando:'unscheduled',agendada:'scheduled',andamento:'in_progress',concluida:'done',cancelada:'canceled'};
      try { const salvo=await atualizarOSDB(os.id,{status:mapa[status]||'unscheduled'}); setOrdens((l)=>l.map((x)=>x.id===os.id?salvo:x)); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, status, historico: [...x.historico, { id: uid(), quando: HOJE, texto: `Status alterado para ${ST_OS[status].label}` }] } : x));
  };

  /* finalizar atendimento — protegido contra duplicação de cobrança/garantia */
  const finalizarOS = async (osId, extras) => {
    if (real) {
      try {
        const alvo = ordens.find((o) => o.id === osId);
        if (!alvo) throw new Error("Ordem de serviço não encontrada");
        const preparado = await prepararFinalizacaoOSDB(alvo, extras, empresaId, usuarioAtual?.id, papel);
        extras = { ...extras, ...preparado };
        await finalizarOSDB(osId,extras);
        await recarregarDados();
        aviso("Atendimento finalizado e sincronizado com financeiro/garantias.");
      } catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    const atual = ordens.find((o) => o.id === osId);
    if (!atual || atual.status === "concluida" || atual.cobrancaId) { aviso("Esta ordem já foi finalizada."); return; }
    const os = { ...atual, ...extras };
    const total = totalOS(os);
    const execucao = os.data || HOJE;
    const cobrancaId = total > 0 ? uid() : null;

    /* uma OS gera no máximo uma conta a receber; atendimento em garantia sem valor não gera nenhuma */
    if (cobrancaId) {
      setLancamentos((l) => l.some((x) => x.origemTipo === "os" && x.origemId === osId) ? l : [{
        id: cobrancaId, empresaId, tipo: "receita", descricao: `${os.numero} · ${nomeCliente(os.clienteId)}`, clienteId: os.clienteId,
        valor: total, vencimento: addDays(HOJE, 7), pago: false, origemTipo: "os", origemId: osId, categoria: "Serviços",
      }, ...l]);
    }

    /* garantias nascem do serviço executado; serviço e produto são registros separados */
    const novasGarantias = [];
    if (!os.emGarantia) {
      os.itens.forEach((i) => {
        if (i.tipo === "servico") {
          const s = servicos.find((x) => x.id === i.catalogoId);
          if (s?.garantiaDias > 0) novasGarantias.push({
            id: uid(), empresaId, clienteId: os.clienteId, osId, tipo: "servico", descricao: s.nome, servicoId: s.id,
            local: os.localServico, inicio: execucao, dias: s.garantiaDias, ate: addDays(execucao, s.garantiaDias), serie: "",
          });
        } else {
          const pr = produtos.find((x) => x.id === i.catalogoId);
          if (pr?.garantiaMeses > 0) novasGarantias.push({
            id: uid(), empresaId, clienteId: os.clienteId, osId, tipo: "produto", descricao: i.nome, produtoId: pr.id,
            local: os.localServico, inicio: execucao, meses: pr.garantiaMeses, ate: addMeses(execucao, pr.garantiaMeses),
            serie: extras.series?.[i.id] || "",
          });
        }
      });
    }
    if (novasGarantias.length) setGarantias((g) => [...novasGarantias, ...g.filter((x) => x.osId !== osId)]);

    /* recomendação de retorno (pós-venda), apenas registrada */
    let retorno = null;
    os.itens.forEach((i) => {
      const s = servicos.find((x) => x.id === i.catalogoId);
      if (s?.retornoDias > 0) { const d = addDays(HOJE, s.retornoDias); if (!retorno || d < retorno.data) retorno = { data: d, servico: s.nome }; }
    });

    setOrdens((l) => l.map((x) => x.id === osId ? {
      ...x, ...extras, status: "concluida", cobrancaId, retorno,
      historico: [...x.historico,
        { id: uid(), quando: HOJE, texto: "Serviço concluído" },
        ...(cobrancaId ? [{ id: uid(), quando: HOJE, texto: `Cobrança de ${brl(total)} gerada em contas a receber` }]
          : [{ id: uid(), quando: HOJE, texto: "Atendimento sem cobrança" }]),
        ...(novasGarantias.length ? [{ id: uid(), quando: HOJE, texto: `${novasGarantias.length} garantia(s) registrada(s) a partir dos serviços executados` }] : []),
      ],
    } : x));
    aviso(cobrancaId
      ? `Atendimento finalizado. Cobrança de ${brl(total)} aguardando pagamento.`
      : "Atendimento em garantia finalizado. Nenhuma cobrança gerada.");
  };

  const resolverPrecificacao = async (osId, itens) => {
    if (!real) return;
    try {
      await resolverPrecificacaoOSDB(osId, itens, 7);
      await recarregarDados();
      aviso("Valores definidos e cobrança liberada no financeiro.");
      return true;
    } catch (e) {
      aviso(mensagemErro(e));
      return false;
    }
  };

  /* acionamento de garantia: nova OS ligada à garantia e à OS de origem */
  const abrirAtendimentoGarantia = async (g, relatoProblema) => {
    const origem = ordens.find((o) => o.id === g.osId);
    if (real) {
      try { const nova=await abrirAtendimentoGarantiaDB(g,empresaId,usuarioAtual?.id,{local:origem?.local||cliente(g.clienteId)?.endereco||"",localServico:origem?.localServico||"",relatoProblema}); setOrdens((l)=>[nova,...l]); aviso(`${nova.numero} aberta em garantia. Falta definir a data.`); setTela("ordens"); setOsAberta(nova.id); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    const nova = { ...osBase, id: uid(), empresaId, numero: proxNumero(doTenant(ordens), "OS"), responsavelId: usuarioAtual?.id, clienteId: g.clienteId, orcamentoId: null, status: "aguardando", data: "", hora: "", responsavel: empresa.responsavel, local: origem?.local || cliente(g.clienteId)?.endereco || "", localServico: g.local || origem?.localServico || "", itens: [], obs: `Atendimento em garantia de "${g.descricao}", executado em ${dataBR(g.inicio)}.`, checklist: [], emGarantia: true, garantiaId: g.id, osOrigemId: g.osId, relatoProblema: relatoProblema || "", historico: [{ id: uid(), quando: HOJE, texto: `Aberta em garantia de ${g.descricao}${origem ? ` (${origem.numero})` : ""}` }] };
    setOrdens((l) => [nova, ...l]); aviso(`${nova.numero} aberta em garantia. Falta definir a data.`); setTela("ordens"); setOsAberta(nova.id);
  };

  /* --------- financeiro --------- */
  const baixar = async (l, forma) => {
    if (real) {
      try { const salvo=await baixarLancamentoDB(l,forma); setLancamentos((ls)=>ls.map((x)=>x.id===salvo.id?salvo:x)); aviso(!l.pago ? `${brl(l.valor)} ${l.tipo === "receita" ? "recebido" : "pago"} via ${forma}` : "Baixa desfeita"); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    setLancamentos((ls) => ls.map((x) => (x.id === l.id ? { ...x, pago: !x.pago, pagoEm: x.pago ? null : HOJE, forma: x.pago ? null : forma } : x)));
    if (!l.pago) {
      if (l.origemTipo === "os" && l.origemId)
        setOrdens((os) => os.map((o) => o.id === l.origemId ? { ...o, historico: [...o.historico, { id: uid(), quando: HOJE, texto: `Pagamento de ${brl(l.valor)} recebido via ${forma}` }] } : o));
      aviso(`${brl(l.valor)} ${l.tipo === "receita" ? "recebido" : "pago"} via ${forma}`);
    } else aviso("Baixa desfeita");
  };

  /* --------- compras → conta a pagar --------- */
  const salvarCompra = async (c) => {
    if (real) {
      try { const salva=await salvarCompraDB(c,empresaId,usuarioAtual?.id); await uploadDocumentosCompraDB(salva.id,c.anexos||[],empresaId,usuarioAtual?.id); await recarregarDados(); aviso(c.id ? "Compra atualizada" : `${salva.numero} registrada. Conta a pagar criada no financeiro.`); setCompraAberta(salva.id); }
      catch(e){ aviso(mensagemErro(e)); }
      return;
    }
    const total = c.itens.reduce((t, i) => t + i.qtd * i.custo, 0);
    if (c.id) { setCompras((l) => l.map((x) => (x.id === c.id ? c : x))); setLancamentos((l) => l.map((x) => x.id === c.lancamentoId ? { ...x, valor: total, vencimento: c.vencimento, descricao: `Compra ${c.numero} · ${c.fornecedor}` } : x)); aviso("Compra atualizada"); return; }
    const id = uid(); const numero = proxNumero(comprasEmp, "CMP"); const lancamentoId = uid();
    setLancamentos((l) => [{ id: lancamentoId, empresaId, tipo: "despesa", descricao: `Compra ${numero} · ${c.fornecedor}`, valor: total, vencimento: c.vencimento || HOJE, pago: !!c.jaPago, pagoEm: c.jaPago ? HOJE : null, forma: c.jaPago ? c.forma : null, origemTipo: "compra", origemId: id, categoria: "Materiais" }, ...l]);
    setCompras((l) => [{ ...c, id, numero, lancamentoId, empresaId }, ...l]); aviso(`${numero} registrada. Conta a pagar criada no financeiro.`); setCompraAberta(id);
  };

  const props = {
    empresa, setEmpresa: salvarEmpresa,
    clientes: clientesEmp, servicos: servicosEmp, produtos: produtosEmp, orcamentos: orcamentosEmp,
    ordens: ordensEmp, lancamentos: lancamentosEmp, compras: comprasEmp, garantias: garantiasEmp,
    usuarioAtual, papel, permitido, empresaId, assinatura, equipe, usuarios,
    salvarColaborador, atualizarColaborador, reenviarAcesso, alternarColaborador, mudarAssinatura, sair,
    cliente, nomeCliente, irPara, aviso, salvarCliente, salvarServico, salvarProduto, salvarOrcamento,
    mudarStatusOrc, duplicarOrcamento, gerarOS, salvarOS, mudarStatusOS, agendarOS, desagendarOS, finalizarOS, resolverPrecificacao, baixar,
    salvarCompra, setLancamentos, setOrdens, setGarantias, abrirAtendimentoGarantia,
    clienteAberto, setClienteAberto, orcamentoAberto, setOrcamentoAberto, osAberta, setOsAberta,
    compraAberta, setCompraAberta, setTela, abrirOS, abrirOrc, abrirCliente, abrirCompra,
    garantiaAberta, setGarantiaAberta, abrirGarantia, real,
    pedirConfirmacao: setConfirmar,
  };

  const NAV = [
    { id: "inicio", label: "Início", icon: LayoutDashboard },
    { id: "agenda", label: "Agenda", icon: CalendarDays },
    { id: "clientes", label: "Clientes", icon: Users },
    { id: "catalogo", label: "Serviços e produtos", icon: Wrench },
    { id: "orcamentos", label: "Orçamentos", icon: FileText },
    { id: "ordens", label: "Ordens de serviço", icon: ClipboardList },
    { id: "garantias", label: "Garantias", icon: ShieldCheck },
    { id: "compras", label: "Compras", icon: ShoppingCart },
    { id: "equipe", label: "Equipe", icon: Users2 },
    { id: "financeiro", label: "Financeiro", icon: Wallet },
    { id: "config", label: "Configurações", icon: Settings },
  ];
  const NAV_MOBILE = ["inicio", "agenda", "orcamentos", "ordens"];

  const Marca = ({ rail }) => (
    <div className={cx("flex items-center gap-3 px-5 h-[68px]", rail && "lg:px-5 px-0 lg:justify-start justify-center")}>
      <div className="w-9 h-9 rounded-xl bg-teal-500 flex items-center justify-center shrink-0">
        <span className="text-slate-900 font-bold text-lg leading-none">Z</span>
      </div>
      <p className={cx("text-white font-semibold tracking-tight text-[17px]", rail && "hidden lg:block")}>ZiisTec</p>
    </div>
  );
  const Nav = ({ rail }) => (
    <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto" aria-label="Navegação principal">
      {NAV.filter((n) => permitido(n.id) && (n.id !== "equipe" || empresa.temEquipe)).map((n) => {
        const ativo = tela === n.id;
        return (
          <button key={n.id} onClick={() => irPara(n.id)} title={n.label} aria-current={ativo ? "page" : undefined}
            className={cx("relative w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-colors",
              rail && "lg:justify-start justify-center",
              ativo ? "bg-white/10 text-white font-medium" : "text-slate-400 hover:text-slate-100 hover:bg-white/5",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400")}>
            {ativo && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-teal-400" aria-hidden="true" />}
            <n.icon className={cx("w-[18px] h-[18px] shrink-0", ativo && "text-teal-300")} aria-hidden="true" />
            <span className={rail ? "hidden lg:inline" : ""}>{n.label}</span>
          </button>
        );
      })}
    </nav>
  );
  const Empresa = ({ rail }) => (
    <div className={cx("px-3 pb-4", rail && "hidden lg:block")}>
      <div className="flex items-center gap-3 rounded-xl px-3 py-3 bg-white/5">
        <div className="w-8 h-8 rounded-lg bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-semibold shrink-0">{iniciais(empresa.nome)}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-white font-medium truncate">{empresa.nome}</p>
          <p className="text-[11px] text-slate-400 truncate">
            {usuarioAtual?.nome} · {papel === "proprietario" ? "proprietário" : "técnico"}
          </p>
        </div>
        <button onClick={sair} aria-label="Sair da conta" title="Sair"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 shrink-0"><LogOut className="w-4 h-4" /></button>
      </div>
    </div>
  );

  const estiloGlobal = (
    <style>{`
      @media print { body{background:#fff} .zt-nao-imprime{display:none!important} .zt-doc{box-shadow:none!important} main{padding:0!important} }
      @media (prefers-reduced-motion: reduce){ *{transition:none!important;animation:none!important} }
    `}</style>
  );

  /* portão 1 — sem sessão, nada da aplicação é montado */
  if (!sessao) return (
    <>{estiloGlobal}<Autenticacao usuarios={usuarios} membresias={membresias} empresas={empresas}
      onEntrar={(s2) => { setSessao(s2); setTela("inicio"); }}
      onPrimeiroAcesso={concluirPrimeiroAcesso}
      onCriarConta={(dados) => {
        const jaExiste = usuarios.find((u) => u.email.toLowerCase() === dados.email.trim().toLowerCase());
        if (jaExiste && membresias.some((m) => m.usuarioId === jaExiste.id)) {
          aviso("Este e-mail já faz parte de uma empresa. Entre com ele em vez de criar outra conta.");
          return;
        }
        const eId = uid(), uId = uid(), mId = uid();
        setEmpresas((l) => [...l, { id: eId, nome: dados.empresa, documento: "", atividade: dados.atividade,
          telefone: "", whatsapp: "", email: dados.email, endereco: "", responsavel: dados.nome,
          temEquipe: dados.temEquipe, validadePadrao: 15, criadaEm: HOJE,
          condicaoPadrao: "50% na aprovação e 50% na entrega do serviço.", observacaoPadrao: "" }]);
        setUsuarios((l) => [...l, { id: uId, nome: dados.nome, email: dados.email, ultimoAcesso: HOJE }]);
        setMembresias((l) => [...l, { id: mId, usuarioId: uId, empresaId: eId, papel: "proprietario", ativo: true, desde: HOJE }]);
        setAssinaturas((l) => [...l, { id: uid(), empresaId: eId, plano: PLANO.nome, valor: PLANO.valor,
          status: "trial", inicio: HOJE, proximaCobranca: addDays(HOJE, 14) }]);
        setSessao({ usuarioId: uId, membresiaId: mId });
        setTela("inicio");
      }} /></>
  );

  /* portão 2 — administração da plataforma é outra aplicação, sem acesso a dado de cliente */
  if (ehPlataforma(usuarioAtual)) return (
    <>{estiloGlobal}<AdminPlataforma empresas={empresas} usuarios={usuarios} membresias={membresias}
      assinaturas={assinaturas} mudarAssinatura={mudarAssinatura} sair={sair} toast={toast} /></>
  );

  /* portão 3 — assinatura sem liberação bloqueia o uso, nunca os dados */
  if (assinatura && !ST_ASSINATURA[assinatura.status].libera) return (
    <>{estiloGlobal}<AssinaturaBloqueada assinatura={assinatura} empresa={empresa} papel={papel} sair={sair}
      reativar={() => mudarAssinatura(empresaId, "ativa")} /></>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
      {estiloGlobal}

      <aside className="zt-nao-imprime hidden md:flex fixed inset-y-0 left-0 z-30 md:w-[72px] lg:w-[248px] bg-slate-900 flex-col">
        <Marca rail /><Nav rail /><Empresa rail />
      </aside>

      <header className="zt-nao-imprime md:hidden sticky top-0 z-30 bg-slate-900 flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-500 flex items-center justify-center"><span className="text-slate-900 font-bold text-sm leading-none">Z</span></div>
          <span className="text-white font-semibold tracking-tight">ZiisTec</span>
        </div>
        <div className="flex items-center">
          <button onClick={() => setBusca(true)} aria-label="Buscar" className="p-2.5 text-slate-300"><Search className="w-5 h-5" /></button>
          <button onClick={() => setDrawer(true)} aria-label="Abrir menu" className="p-2.5 -mr-2 text-slate-300"><Menu className="w-6 h-6" /></button>
        </div>
      </header>

      {drawer && (
        <div className="zt-nao-imprime md:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-slate-900 flex flex-col">
            <div className="flex items-center justify-between pr-2">
              <Marca />
              <button onClick={() => setDrawer(false)} aria-label="Fechar menu" className="p-2.5 text-slate-400"><X className="w-5 h-5" /></button>
            </div>
            <Nav /><Empresa />
          </div>
        </div>
      )}

      <main className="md:pl-[72px] lg:pl-[248px]">
        <div className="hidden md:flex zt-nao-imprime justify-end max-w-[1180px] mx-auto px-8 lg:px-10 pt-5">
          <button onClick={() => setBusca(true)}
            className={cx("flex items-center gap-2.5 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5 text-[13px] text-slate-400 hover:ring-slate-300 w-72", ring)}>
            <Search className="w-4 h-4" aria-hidden="true" />
            Buscar cliente, orçamento, OS…
          </button>
        </div>
        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 lg:px-10 py-6 sm:py-7 pb-28 md:pb-16">
          {!permitido(tela) ? <SemPermissao papel={papel} /> : <>
          {tela === "inicio" && <Inicio {...props} />}
          {tela === "agenda" && <Agenda {...props} />}
          {tela === "clientes" && <Clientes {...props} />}
          {tela === "catalogo" && <Catalogo {...props} />}
          {tela === "orcamentos" && <Orcamentos {...props} />}
          {tela === "ordens" && <OrdensServico {...props} />}
          {tela === "garantias" && <Garantias {...props} />}
          {tela === "compras" && <Compras {...props} />}
          {tela === "financeiro" && <Financeiro {...props} />}
          {tela === "equipe" && <Equipe {...props} />}
          {tela === "config" && <Config {...props} />}
          </>}
        </div>
      </main>

      <nav className="zt-nao-imprime md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 flex" aria-label="Navegação rápida">
        {NAV.filter((n) => NAV_MOBILE.includes(n.id) && permitido(n.id)).map((n) => {
          const ativo = tela === n.id;
          return (
            <button key={n.id} onClick={() => irPara(n.id)} aria-current={ativo ? "page" : undefined}
              className={cx("flex-1 flex flex-col items-center gap-1 py-2.5", ativo ? "text-teal-800" : "text-slate-400")}>
              <n.icon className="w-[22px] h-[22px]" aria-hidden="true" />
              <span className="text-[10px] font-medium">{n.label.split(" ")[0]}</span>
            </button>
          );
        })}
        <button onClick={() => setDrawer(true)} className="flex-1 flex flex-col items-center gap-1 py-2.5 text-slate-400" aria-label="Mais seções">
          <MoreHorizontal className="w-[22px] h-[22px]" aria-hidden="true" />
          <span className="text-[10px] font-medium">Mais</span>
        </button>
      </nav>

      {busca && <BuscaGlobal onClose={() => setBusca(false)} {...props} />}

      {toast && (
        <div role="status" className="zt-nao-imprime fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-[14px] px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5 max-w-[92vw]">
          <CircleCheck className="w-4 h-4 text-teal-400 shrink-0" aria-hidden="true" />{toast}
        </div>
      )}
      <Confirm estado={confirmar} onClose={() => setConfirmar(null)} />
    </div>
  );
}

/* ============================================================ busca global */
function BuscaGlobal({ onClose, clientes, orcamentos, ordens, compras, nomeCliente, abrirCliente, abrirOrc, abrirOS, abrirCompra, permitido }) {
  const [q, setQ] = useState("");
  const t = semAcento(q.trim());
  const digitos = soDigitos(q);
  const bate = (...campos) => {
    if (t.length < 2 && digitos.length < 3) return false;
    return campos.some((c) => {
      const v = String(c || "");
      if (t.length >= 2 && semAcento(v).includes(t)) return true;
      return digitos.length >= 3 && soDigitos(v).length > 0 && soDigitos(v).includes(digitos);
    });
  };

  /* a busca respeita o papel: o técnico só alcança as ordens dele */
  const rc = permitido("clientes") ? clientes.filter((c) => bate(c.nome, c.fantasia, c.documento, c.telefone, c.whatsapp, c.endereco)) : [];
  const ro = permitido("orcamentos") ? orcamentos.filter((o) => bate(o.numero, nomeCliente(o.clienteId), o.local, o.localServico)) : [];
  const rs = ordens.filter((o) => bate(o.numero, nomeCliente(o.clienteId), o.local, o.localServico));
  const rp = permitido("compras") ? compras.filter((c) => bate(c.numero, c.fornecedor)) : [];
  const total = rc.length + ro.length + rs.length + rp.length;
  const buscou = t.length >= 2 || digitos.length >= 3;

  const Grupo = ({ titulo, itens, render }) => itens.length === 0 ? null : (
    <div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] px-1 mb-1.5">{titulo}</p>
      <div className="space-y-1">{itens.slice(0, 5).map(render)}</div>
    </div>
  );
  const Item = ({ onClick, titulo, sub }) => (
    <button onClick={onClick} className={cx("w-full text-left rounded-xl px-3 py-2.5 hover:bg-slate-50", ring)}>
      <p className="text-[14px] font-medium text-slate-800 truncate">{titulo}</p>
      <p className="text-[12px] text-slate-500 truncate">{sub}</p>
    </button>
  );

  return (
    <Modal open onClose={onClose} title="Buscar"
      sub={permitido("clientes") ? "Cliente, telefone, documento, endereço, número de orçamento, OS ou compra" : "Suas ordens de serviço"} wide>
      <SearchBox value={q} onChange={setQ}
        placeholder={permitido("clientes") ? "Nome, telefone, CPF, CNPJ, endereço ou número do documento" : "Número da ordem, cliente ou endereço do atendimento"} autoFocus />
      {buscou && total === 0 && <p className="text-[14px] text-slate-500 py-4">Nada encontrado para “{q}”.</p>}
      <div className="space-y-5">
        <Grupo titulo="Clientes" itens={rc} render={(c) => <Item key={c.id} titulo={c.fantasia || c.nome} sub={`${c.telefone} · ${c.endereco}`} onClick={() => { abrirCliente(c.id); onClose(); }} />} />
        <Grupo titulo="Orçamentos" itens={ro} render={(o) => <Item key={o.id} titulo={`${o.numero} · ${nomeCliente(o.clienteId)}`} sub={`${brl(totalDoc(o))} · ${ST_ORC[o.status].label}`} onClick={() => { abrirOrc(o.id); onClose(); }} />} />
        <Grupo titulo="Ordens de serviço" itens={rs} render={(o) => <Item key={o.id} titulo={`${o.numero} · ${nomeCliente(o.clienteId)}`} sub={`${o.data ? dataBR(o.data) : "sem data"} · ${ST_OS[o.status].label}`} onClick={() => { abrirOS(o.id); onClose(); }} />} />
        <Grupo titulo="Compras" itens={rp} render={(c) => <Item key={c.id} titulo={`${c.numero} · ${c.fornecedor}`} sub={`${dataBR(c.data)} · ${brl(c.itens.reduce((t2, i) => t2 + i.qtd * i.custo, 0))}`} onClick={() => { abrirCompra(c.id); onClose(); }} />} />
      </div>
    </Modal>
  );
}

/* =============================================================== Dashboard */
function Inicio({ ordens, orcamentos, lancamentos, nomeCliente, irPara, abrirOS, abrirOrc, setTela, setOrcamentoAberto, empresa, permitido, usuarioAtual, papel, empresaId, real, aviso }) {
  const verFinanceiro = permitido("financeiro");
  const [revisoesInicio, setRevisoesInicio] = useState([]);
  useEffect(() => {
    if (!real || !empresaId || papel !== "proprietario") { setRevisoesInicio([]); return; }
    let ativo=true;
    carregarRevisoesDB(empresaId).then((r)=>{ if(ativo) setRevisoesInicio(r); }).catch((e)=>aviso?.(e?.message || "Não foi possível carregar o pós-venda."));
    return ()=>{ ativo=false; };
  }, [real, empresaId, papel]);
  const hojeOS = ordens.filter((o) => o.data === HOJE && o.status !== "cancelada" && o.status !== "concluida").sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  const proximas = ordens.filter((o) => o.data > HOJE && o.status !== "cancelada" && o.status !== "concluida").sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).slice(0, 3);

  const mes = mesRef(HOJE);
  const noMes = (l) => mesRef(l.pago ? l.pagoEm : l.vencimento) === mes;
  const soma = (ls) => ls.reduce((t, l) => t + l.valor, 0);
  const recebido = soma(lancamentos.filter((l) => l.tipo === "receita" && l.pago && noMes(l)));
  const aReceber = soma(lancamentos.filter((l) => l.tipo === "receita" && !l.pago && noMes(l)));
  const aPagar = soma(lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && noMes(l)));
  const despesasPagas = soma(lancamentos.filter((l) => l.tipo === "despesa" && l.pago && noMes(l)));

  const pend = [];
  if (papel === "proprietario") {
    const revisoesPendentes = revisoesInicio.filter((r)=>r.status === "pending" && r.data <= HOJE);
    const atrasadas = revisoesPendentes.filter((r)=>r.data < HOJE);
    const hoje = revisoesPendentes.filter((r)=>r.data === HOJE);
    if (atrasadas.length) pend.push({ id:"pos-venda-atrasado", tom:"erro", titulo: atrasadas.length + " retorno" + (atrasadas.length>1?"s":"") + " de pós-venda atrasado" + (atrasadas.length>1?"s":""), detalhe:"Mais antigo: " + dataBR(atrasadas[0].data), acao:"Abrir pós-venda", ir:()=>irPara("garantias") });
    if (hoje.length) pend.push({ id:"pos-venda-hoje", tom:"atencao", titulo: hoje.length + " retorno" + (hoje.length>1?"s":"") + " de pós-venda para hoje", detalhe:"Revisar clientes e concluir ou dispensar", acao:"Abrir pós-venda", ir:()=>irPara("garantias") });
  }
  if (verFinanceiro) {
  const vencidas = lancamentos.filter((l) => !l.pago && l.vencimento < HOJE);
  const vencR = vencidas.filter((l) => l.tipo === "receita");
  const vencD = vencidas.filter((l) => l.tipo === "despesa");
  if (vencR.length) pend.push({ id: "vr", tom: "erro", titulo: `${vencR.length} cobrança${vencR.length > 1 ? "s" : ""} vencida${vencR.length > 1 ? "s" : ""}`, detalhe: `${brl(soma(vencR))} em atraso`, acao: "Ver no financeiro", ir: () => irPara("financeiro") });
  if (vencD.length) pend.push({ id: "vd", tom: "erro", titulo: `${vencD.length} conta${vencD.length > 1 ? "s" : ""} a pagar vencida${vencD.length > 1 ? "s" : ""}`, detalhe: brl(soma(vencD)), acao: "Ver no financeiro", ir: () => irPara("financeiro") });
  const hojeAberta = hojeOS.filter((o) => o.status !== "concluida");
  if (hojeAberta.length) pend.push({ id: "hj", tom: "atencao", titulo: `${hojeAberta.length} atendimento${hojeAberta.length > 1 ? "s" : ""} de hoje ainda em aberto`, detalhe: hojeAberta.map((o) => nomeCliente(o.clienteId)).join(", "), acao: "Abrir agenda", ir: () => irPara("agenda") });
  const aprovSemOS = orcamentos.filter((o) => o.status === "aprovado" && !o.osId);
  aprovSemOS.forEach((o) => pend.push({ id: "a" + o.id, tom: "marca", titulo: `${o.numero} aprovado aguardando ordem de serviço`, detalhe: nomeCliente(o.clienteId), acao: "Gerar OS", ir: () => abrirOrc(o.id) }));
  const semData = ordens.filter((o) => o.status === "aguardando");
  if (semData.length) pend.push({ id: "sd", tom: "atencao", titulo: `${semData.length} serviço${semData.length > 1 ? "s" : ""} aguardando agendamento`, detalhe: semData.map((o) => o.numero).join(", "), acao: "Agendar", ir: () => irPara("agenda") });
  const aguardResp = orcamentos.filter((o) => o.status === "enviado");
  if (aguardResp.length) pend.push({ id: "ar", tom: "atencao", titulo: `${aguardResp.length} orçamento${aguardResp.length > 1 ? "s" : ""} aguardando resposta`, detalhe: aguardResp.map((o) => `${o.numero} · ${nomeCliente(o.clienteId)}`).join(" · "), acao: "Acompanhar", ir: () => irPara("orcamentos") });
  if (aReceber > 0) pend.push({ id: "rc", tom: "marca", titulo: `${brl(aReceber)} a receber neste mês`, detalhe: "Cobranças em aberto com vencimento no mês", acao: "Ver", ir: () => irPara("financeiro") });
  }
  if (!verFinanceiro) {
    const minhasSemData = ordens.filter((o) => o.status === "aguardando");
    if (minhasSemData.length) pend.push({ id: "sd", tom: "atencao", titulo: `${minhasSemData.length} ordem(ns) sua(s) sem data`, detalhe: minhasSemData.map((o) => o.numero).join(", "), acao: "Ver", ir: () => irPara("ordens") });
    const emAndamento = ordens.filter((o) => o.status === "andamento");
    if (emAndamento.length) pend.push({ id: "and", tom: "atencao", titulo: `${emAndamento.length} atendimento(s) em andamento`, detalhe: "Finalize para registrar o relato", acao: "Abrir", ir: () => irPara("ordens") });
  }

  const hora = new Date().getHours();
  const saudacao = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const atalhos = verFinanceiro ? [
    { label: "Novo orçamento", icon: FileText, ir: () => { setTela("orcamentos"); setOrcamentoAberto("novo"); } },
    { label: "Novo cliente", icon: Users, ir: () => irPara("clientes") },
    { label: "Nova OS", icon: ClipboardList, ir: () => irPara("ordens") },
    { label: "Nova compra", icon: ShoppingCart, ir: () => irPara("compras") },
  ] : [
    { label: "Minhas ordens", icon: ClipboardList, ir: () => irPara("ordens") },
    { label: "Agenda", icon: CalendarDays, ir: () => irPara("agenda") },
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
        <div>
          <p className="text-[15px] text-slate-500">{saudacao}, {(usuarioAtual?.nome || empresa.responsavel).split(" ")[0]}</p>
          <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em] mt-0.5">{diaSemana(HOJE)}, {dataBR(HOJE)}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {atalhos.map((a) => (
            <button key={a.label} onClick={a.ir}
              className={cx("inline-flex items-center gap-2 rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-2.5 text-[13px] font-medium text-slate-700 hover:bg-slate-50", ring)}>
              <a.icon className="w-4 h-4 text-slate-400" aria-hidden="true" />{a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <Rotulo acao={<button onClick={() => irPara("agenda")} className="text-[13px] font-medium text-teal-800 hover:underline">Ver agenda</button>}>
              {verFinanceiro ? "O que tenho para hoje" : "Meus atendimentos de hoje"}
            </Rotulo>
            <Panel className="divide-y divide-slate-100 overflow-hidden">
              {hojeOS.length === 0 ? <Empty icon={CalendarDays} title="Nenhum atendimento hoje" sub="Aproveite para colocar os orçamentos em dia." />
                : hojeOS.map((os) => (
                  <Linha key={os.id}>
                    <div className="flex items-start gap-4">
                      <button onClick={() => abrirOS(os.id)} className={cx("w-[52px] shrink-0 text-left", ring)}>
                        <p className="text-[17px] font-semibold text-slate-900 leading-none tabular-nums">{os.hora || "—"}</p>
                        <p className="text-[11px] text-slate-400 mt-1.5">{os.numero}</p>
                      </button>
                      <button onClick={() => abrirOS(os.id)} className={cx("min-w-0 flex-1 text-left", ring)}>
                        <p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p>
                        <p className="text-[13px] text-slate-500 truncate">{resumoOS(os)}</p>
                      </button>
                      <Pill tone={ST_OS[os.status].tone}>{ST_OS[os.status].label}</Pill>
                    </div>
                    <div className="pl-[68px] mt-1.5 text-[12px]"><Endereco valor={os.local} local={os.localServico} compacto /></div>
                  </Linha>
                ))}
              {proximas.length > 0 && (
                <div className="px-4 sm:px-5 py-3 bg-slate-50/60">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2">Próximos atendimentos</p>
                  <div className="space-y-1">
                    {proximas.map((os) => (
                      <button key={os.id} onClick={() => abrirOS(os.id)} className={cx("w-full flex items-center gap-3 py-1.5 text-left", ring)}>
                        <span className="text-[12px] font-medium text-slate-500 tabular-nums w-[86px] shrink-0">{diaCurto(os.data)} {dataCurta(os.data)} · {os.hora}</span>
                        <span className="text-[13px] text-slate-600 truncate">{nomeCliente(os.clienteId)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </section>

          <section>
            <Rotulo>Precisa da sua atenção</Rotulo>
            {pend.length === 0 ? <Panel><Empty icon={CheckCircle2} title="Tudo em dia" sub="Nenhuma pendência aguardando você agora." /></Panel> : (
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {pend.slice(0, 7).map((a) => (
                  <Linha key={a.id} onClick={a.ir}>
                    <div className="flex items-center gap-3.5">
                      <span className={cx("w-1.5 h-1.5 rounded-full shrink-0", a.tom === "erro" ? "bg-rose-500" : a.tom === "atencao" ? "bg-amber-500" : "bg-teal-600")} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-slate-800 truncate">{a.titulo}</p>
                        <p className="text-[12.5px] text-slate-500 truncate">{a.detalhe}</p>
                      </div>
                      <span className="text-[13px] font-medium text-slate-400 hidden sm:flex items-center gap-1 shrink-0">{a.acao}<ChevronRight className="w-4 h-4" /></span>
                      <ChevronRight className="w-4 h-4 text-slate-300 sm:hidden shrink-0" aria-hidden="true" />
                    </div>
                  </Linha>
                ))}
              </Panel>
            )}
          </section>
        </div>

        {verFinanceiro && <section className="lg:sticky lg:top-6">
          <Rotulo acao={<button onClick={() => irPara("financeiro")} className="text-[13px] font-medium text-teal-800 hover:underline">Abrir</button>}>
            Meu dinheiro em {nomeMes(mes).split(" de ")[0].toLowerCase()}
          </Rotulo>
          <Panel className="p-5 sm:p-6">
            <p className="text-[13px] text-slate-500">Recebido no mês</p>
            <p className="text-3xl font-semibold text-slate-900 tracking-tight mt-1 tabular-nums">{brl(recebido)}</p>
            <div className="mt-5 space-y-3 text-[14px]">
              <div className="flex justify-between"><span className="text-slate-500">A receber no mês</span><span className="font-medium tabular-nums">{brl(aReceber)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">A pagar no mês</span><span className="font-medium tabular-nums">{brl(aPagar)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Despesas pagas</span><span className="font-medium tabular-nums">− {brl(despesasPagas)}</span></div>
              <div className="flex justify-between pt-3 border-t border-slate-100">
                <span className="text-slate-600 font-medium">Resultado do mês</span>
                <span className={cx("font-semibold tabular-nums", recebido - despesasPagas >= 0 ? "text-emerald-700" : "text-rose-700")}>{brl(recebido - despesasPagas)}</span>
              </div>
            </div>
          </Panel>
        </section>}
      </div>
    </>
  );
}

/* =================================================================== Agenda */
function Agenda({ ordens, nomeCliente, abrirOS, agendarOS, empresa, equipe }) {
  const [dia, setDia] = useState(HOJE);
  const [agendando, setAgendando] = useState(null);
  const semana = Array.from({ length: 7 }, (_, i) => addDays(dia, i - 3));
  const doDia = ordens.filter((o) => o.data === dia && o.status !== "cancelada").sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  const semAgenda = ordens.filter((o) => !o.data && o.status !== "cancelada" && o.status !== "concluida");

  return (
    <>
      <PageHead title="Agenda" sub="O que está marcado e o que ainda precisa de data."
        action={dia !== HOJE ? <Btn variant="soft" size="sm" onClick={() => setDia(HOJE)}>Hoje</Btn> : null} />

      <div className="flex items-center gap-1 sm:gap-2 mb-6">
        <button onClick={() => setDia(addDays(dia, -7))} aria-label="Semana anterior" className={cx("p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0", ring)}><ArrowLeft className="w-4 h-4" /></button>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2 flex-1">
          {semana.map((d) => {
            const qtd = ordens.filter((o) => o.data === d && o.status !== "cancelada").length;
            const sel = d === dia;
            return (
              <button key={d} onClick={() => setDia(d)} aria-pressed={sel} aria-label={`${diaSemana(d)} ${dataBR(d)}`}
                className={cx("rounded-2xl py-3 text-center transition-colors", ring, sel ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200/70 text-slate-600 hover:ring-slate-300")}>
                <p className={cx("text-[11px] uppercase tracking-wide", sel ? "text-slate-300" : d === HOJE ? "text-teal-700 font-semibold" : "text-slate-400")}>{diaCurto(d)}</p>
                <p className={cx("text-[19px] font-semibold leading-tight mt-0.5 tabular-nums", d === HOJE && !sel && "text-teal-800")}>{d.slice(8)}</p>
                <div className="h-2 flex justify-center items-center">{qtd > 0 && <span className={cx("w-1.5 h-1.5 rounded-full", sel ? "bg-teal-400" : "bg-teal-600")} />}</div>
              </button>
            );
          })}
        </div>
        <button onClick={() => setDia(addDays(dia, 7))} aria-label="Próxima semana" className={cx("p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 shrink-0", ring)}><ArrowRight className="w-4 h-4" /></button>
      </div>

      <Rotulo>{diaSemana(dia)}, {dataBR(dia)}{dia === HOJE ? " · hoje" : ""}</Rotulo>
      <Panel className="divide-y divide-slate-100 overflow-hidden mb-8">
        {doDia.length === 0 ? <Empty icon={CalendarDays} title="Nenhum atendimento neste dia" sub="Agende uma ordem de serviço para ela aparecer aqui." />
          : doDia.map((os) => (
            <Linha key={os.id}>
              <div className="flex gap-4">
                <button onClick={() => abrirOS(os.id)} className={cx("w-14 shrink-0 text-left", ring)}>
                  <p className="text-[17px] font-semibold text-slate-900 leading-none tabular-nums">{os.hora || "—"}</p>
                  <p className="text-[11px] text-slate-400 mt-1.5">{os.numero}</p>
                </button>
                <div className="min-w-0 flex-1">
                  <button onClick={() => abrirOS(os.id)} className={cx("w-full text-left", ring)}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p>
                      <Pill tone={ST_OS[os.status].tone}>{ST_OS[os.status].label}</Pill>
                    </div>
                    <p className="text-[13px] text-slate-600 mt-1">{os.itens.length ? os.itens.map((i) => `${i.qtd}× ${i.nome}`).join(" · ") : resumoOS(os)}</p>
                  </button>
                  <div className="flex items-center gap-4 mt-2 text-[12px] flex-wrap">
                    <Endereco valor={os.local} local={os.localServico} compacto className="max-w-full" />
                    {empresa.temEquipe && <span className="flex items-center gap-1.5 text-slate-400"><User className="w-3.5 h-3.5" />{os.responsavel}</span>}
                  </div>
                </div>
              </div>
            </Linha>
          ))}
      </Panel>

      {semAgenda.length > 0 && (
        <section>
          <Rotulo>Aguardando agendamento · {semAgenda.length}</Rotulo>
          <Panel className="divide-y divide-slate-100 overflow-hidden">
            {semAgenda.map((os) => (
              <Linha key={os.id}>
                <div className="flex items-center justify-between gap-3">
                  <button onClick={() => abrirOS(os.id)} className={cx("min-w-0 text-left", ring)}>
                    <p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p>
                    <p className="text-[13px] text-slate-500 truncate">{os.numero} · {resumoOS(os)}</p>
                  </button>
                  <Btn size="sm" variant="soft" icon={CalendarClock} onClick={() => setAgendando(os)}>Agendar</Btn>
                </div>
              </Linha>
            ))}
          </Panel>
        </section>
      )}

      <AgendarModal os={agendando} onClose={() => setAgendando(null)} onSalvar={agendarOS} empresa={empresa} diaSugerido={dia} equipe={equipe} />
    </>
  );
}

function AgendarModal({ os, onClose, onSalvar, empresa, diaSugerido, equipe = [] }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (os) setF({ data: os.data || diaSugerido || HOJE, hora: os.hora || "09:00",
    responsavel: os.responsavel || empresa.responsavel, responsavelId: os.responsavelId || null }); }, [os]);
  if (!os || !f) return null;
  return (
    <Modal open onClose={onClose} title="Agendar atendimento" sub={os.numero}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn disabled={!f.data} onClick={() => { onSalvar(os.id, f); onClose(); }}>Confirmar agendamento</Btn></>}>
      <div className="grid sm:grid-cols-2 gap-5">
        <Field label="Data do atendimento"><Input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
        <Field label="Horário"><Input type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} /></Field>
      </div>
      {empresa.temEquipe && (
        <Field label="Responsável" hint="A ordem aparece em 'Minhas OS' de quem for atribuído.">
          <Select value={f.responsavelId || ""} onChange={(e) => {
            const m = equipe.find((x) => x.usuarioId === e.target.value);
            setF({ ...f, responsavelId: e.target.value || null, responsavel: m?.usuario?.nome || f.responsavel });
          }}>
            <option value="">Selecione</option>
            {equipe.filter((m) => m.ativo).map((m) => (
              <option key={m.usuarioId} value={m.usuarioId}>{m.usuario?.nome}{m.papel === "proprietario" ? " (proprietário)" : ""}</option>
            ))}
          </Select>
        </Field>
      )}
      <p className="text-[13px] text-slate-500 leading-relaxed">Ao confirmar, a ordem passa para <span className="font-medium text-slate-700">Agendada</span> e aparece na agenda do dia escolhido.</p>
    </Modal>
  );
}

/* ================================================================ Clientes */
function Clientes(p) {
  const { clientes, orcamentos, ordens, lancamentos, garantias, salvarCliente, clienteAberto, setClienteAberto, abrirOrc, abrirOS, abrirGarantia, setTela, setOrcamentoAberto, empresaId, real, aviso } = p;
  const [revisoesCliente, setRevisoesCliente] = useState([]);
  useEffect(() => {
    if (!real || !empresaId) return;
    let ativo=true;
    carregarRevisoesDB(empresaId).then((r)=>{ if(ativo) setRevisoesCliente(r); }).catch((e)=>aviso?.(e?.message || "Não foi possível carregar os retornos."));
    return ()=>{ ativo=false; };
  }, [real, empresaId]);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState(null);
  const lista = clientes.filter((c) => semAcento(c.nome + (c.fantasia || "") + c.documento + c.telefone).includes(semAcento(busca)));

  if (clienteAberto) {
    const c = clientes.find((x) => x.id === clienteAberto);
    if (!c) { setClienteAberto(null); return null; }
    const orcs = orcamentos.filter((o) => o.clienteId === c.id);
    const oss = ordens.filter((o) => o.clienteId === c.id);
    const pgs = lancamentos.filter((l) => l.clienteId === c.id);
    const gar = garantias.filter((g) => g.clienteId === c.id);
    const recebido = pgs.filter((l) => l.pago).reduce((t, l) => t + l.valor, 0);
    const aberto = pgs.filter((l) => !l.pago).reduce((t, l) => t + l.valor, 0);
    const locais = [...new Set(oss.map((o) => o.localServico).filter(Boolean))];
    const retornos = real ? revisoesCliente.filter((r)=>r.clienteId===c.id && r.status==="pending").map((r)=>({ data:r.data, servico:r.descricao })) : oss.filter((o) => o.retorno).map((o) => o.retorno);

    return (
      <>
        <button onClick={() => setClienteAberto(null)} className={cx("flex items-center gap-2 text-[14px] text-slate-500 mb-5 hover:text-slate-900 py-1", ring)}>
          <ArrowLeft className="w-4 h-4" /> Clientes
        </button>

        <div className="flex items-start justify-between gap-5 flex-wrap mb-8">
          <div className="flex items-start gap-4">
            <Avatar nome={c.nome} tipo={c.tipo} size="lg" />
            <div>
              <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em]">{c.fantasia || c.nome}</h1>
              <p className="text-[14px] text-slate-500 mt-1">{c.tipo === "PJ" ? c.nome : "Pessoa física"} · {c.documento}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Btn variant="soft" size="sm" icon={Pencil} onClick={() => setForm(c)}>Editar</Btn>
            <Btn size="sm" icon={FileText} onClick={() => { setTela("orcamentos"); setOrcamentoAberto("novo:" + c.id); }}>Novo orçamento</Btn>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {[["Já recebido", brl(recebido), "text-slate-900"], ["Em aberto", brl(aberto), aberto > 0 ? "text-amber-700" : "text-slate-900"],
            ["Orçamentos", orcs.length, "text-slate-900"], ["Ordens de serviço", oss.length, "text-slate-900"]].map(([t, v, cor]) => (
            <Panel key={t} className="p-4 sm:p-5">
              <p className="text-[12px] text-slate-500">{t}</p>
              <p className={cx("text-xl font-semibold mt-1 tabular-nums", cor)}>{v}</p>
            </Panel>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
          <div className="space-y-6">
            <section>
              <Rotulo>Contato e endereço</Rotulo>
              <Panel className="p-5 space-y-4 text-[14px]">
                <div className="flex gap-3"><Phone className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" /><div><p className="text-slate-800">{c.telefone}</p><p className="text-slate-500">WhatsApp {c.whatsapp}</p></div></div>
                <Endereco valor={c.endereco} className="text-[14px]" />
                {c.responsavel && <div className="flex gap-3"><User className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" /><p className="text-slate-700">{c.responsavel}</p></div>}
                {c.whatsapp && <Btn variant="soft" size="sm" icon={Share2} className="w-full" onClick={() => window.open(`https://wa.me/55${soDigitos(c.whatsapp)}`, "_blank")}>Falar no WhatsApp</Btn>}
              </Panel>
            </section>
            {locais.length > 0 && (
              <section>
                <Rotulo>Locais atendidos</Rotulo>
                <Panel className="p-5 flex flex-wrap gap-2">
                  {locais.map((l) => <Pill key={l} tone="neutro">{l}</Pill>)}
                </Panel>
              </section>
            )}
            {c.obs && (
              <section>
                <Rotulo>Observações importantes</Rotulo>
                <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 p-5 text-[14px] text-amber-900 leading-relaxed">{c.obs}</div>
              </section>
            )}
            {retornos.length > 0 && (
              <section>
                <Rotulo>Retorno recomendado</Rotulo>
                <Panel className="p-5 space-y-2.5">
                  {retornos.map((r, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 text-[13.5px]">
                      <span className="text-slate-700 truncate">{r.servico}</span>
                      <span className="text-slate-500 tabular-nums shrink-0">{dataBR(r.data)}</span>
                    </div>
                  ))}
                </Panel>
              </section>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            <section>
              <Rotulo>Garantias</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {gar.length === 0 ? <Empty icon={ShieldCheck} title="Nenhuma garantia registrada" sub="Garantias são criadas automaticamente ao finalizar uma OS, conforme o prazo configurado no serviço." />
                  : gar.map((g) => {
                    const st = statusGarantia(g);
                    return (
                      <Linha key={g.id} onClick={() => abrirGarantia(g.id)}>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-slate-800 truncate">{g.descricao}</p>
                            <p className="text-[12px] text-slate-400">
                              {g.tipo === "servico" ? "Garantia do serviço" : "Garantia do fabricante"}
                              {g.local ? ` · ${g.local}` : ""} · executado em {dataBR(g.inicio)}
                              {g.serie ? ` · série ${g.serie}` : ""}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <Pill tone={st.tone}>{st.label}</Pill>
                            <p className="text-[12px] text-slate-400 mt-1">até {dataBR(g.ate)} · {st.detalhe}</p>
                          </div>
                        </div>
                      </Linha>
                    );
                  })}
              </Panel>
            </section>

            <section>
              <Rotulo>Orçamentos</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {orcs.length === 0 ? <Empty icon={FileText} title="Nenhum orçamento ainda" /> : orcs.map((o) => (
                  <Linha key={o.id} onClick={() => abrirOrc(o.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div><p className="text-[14px] font-medium text-slate-800">{o.numero}</p><p className="text-[12px] text-slate-400">{dataBR(o.data)}</p></div>
                      <div className="flex items-center gap-3"><Pill tone={ST_ORC[o.status].tone}>{ST_ORC[o.status].label}</Pill><span className="text-[14px] font-semibold tabular-nums">{brl(totalDoc(o))}</span></div>
                    </div>
                  </Linha>
                ))}
              </Panel>
            </section>

            <section>
              <Rotulo>Histórico de serviços</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {oss.length === 0 ? <Empty icon={ClipboardList} title="Nenhuma OS ainda" /> : oss.map((o) => (
                  <Linha key={o.id} onClick={() => abrirOS(o.id)}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-slate-800">{o.numero} {o.localServico && <span className="text-slate-400 font-normal">· {o.localServico}</span>}</p>
                        <p className="text-[12px] text-slate-400 truncate">
                          {o.data ? dataBR(o.data) : "sem agendamento"} · {resumoOS(o)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {o.emGarantia && <Pill tone="marca"><ShieldCheck className="w-3 h-3" />Em garantia</Pill>}
                        <Pill tone={ST_OS[o.status].tone}>{ST_OS[o.status].label}</Pill>
                      </div>
                    </div>
                  </Linha>
                ))}
              </Panel>
            </section>

            <section>
              <Rotulo>Pagamentos</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {pgs.length === 0 ? <Empty icon={Wallet} title="Nada lançado" /> : pgs.map((l) => (
                  <Linha key={l.id}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><p className="text-[14px] text-slate-800 truncate">{l.descricao}</p>
                        <p className="text-[12px] text-slate-400">{l.pago ? `recebido em ${dataBR(l.pagoEm)}${l.forma ? ` · ${l.forma}` : ""}` : `vence ${dataBR(l.vencimento)}`}</p></div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Pill tone={statusLanc(l).tone}>{statusLanc(l).label}</Pill>
                        <span className="text-[14px] font-semibold tabular-nums">{brl(l.valor)}</span>
                      </div>
                    </div>
                  </Linha>
                ))}
              </Panel>
            </section>
          </div>
        </div>
        <ClienteForm form={form} setForm={setForm} onSave={salvarCliente} />
      </>
    );
  }

  return (
    <>
      <PageHead title="Clientes" sub={`${clientes.length} cadastrados`} action={<Btn icon={Plus} onClick={() => setForm({ tipo: "PF" })}>Novo cliente</Btn>} />
      <div className="mb-5 max-w-md"><SearchBox value={busca} onChange={setBusca} placeholder="Buscar por nome, documento ou telefone" /></div>
      {lista.length === 0 ? (
        <Panel><Empty icon={Users} title="Nenhum cliente encontrado" sub="Cadastre um cliente para começar a criar orçamentos." action={<Btn icon={Plus} onClick={() => setForm({ tipo: "PF" })}>Novo cliente</Btn>} /></Panel>
      ) : (
        <Panel className="divide-y divide-slate-100 overflow-hidden">
          {lista.map((c) => (
            <Linha key={c.id} onClick={() => setClienteAberto(c.id)}>
              <div className="flex items-center gap-4">
                <Avatar nome={c.nome} tipo={c.tipo} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{c.fantasia || c.nome}</p>
                  <p className="text-[13px] text-slate-500 truncate">{c.telefone} · {c.tipo === "PJ" ? "Pessoa jurídica" : "Pessoa física"}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" aria-hidden="true" />
              </div>
            </Linha>
          ))}
        </Panel>
      )}
      <ClienteForm form={form} setForm={setForm} onSave={salvarCliente} />
    </>
  );
}

/* Cadastro rápido usado de dentro do orçamento e da nova OS.
   Mínimo para continuar: nome + telefone. O resto pode vir depois. */
function ClienteRapido({ aberto, onClose, onSave, nomeInicial = "" }) {
  const [f, setF] = useState(null);
  useEffect(() => { if (aberto) setF({ tipo: "PF", nome: nomeInicial, telefone: "", whatsapp: "", endereco: "", documento: "", fantasia: "", responsavel: "", obs: "" }); }, [aberto]);
  if (!aberto || !f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const pj = f.tipo === "PJ";
  const pronto = f.nome.trim() && f.telefone.trim();
  const faltaFiscal = pj && !f.documento.trim();

  return (
    <Modal open onClose={onClose} wide title="Cadastrar cliente" sub="Só o essencial agora. Você completa depois se precisar."
      footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn disabled={!pronto} onClick={() => { onSave({ ...f, whatsapp: f.whatsapp || f.telefone }); onClose(); }}>Salvar e usar</Btn></>}>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl" role="tablist">
        {["PF", "PJ"].map((t) => (
          <button key={t} role="tab" aria-selected={f.tipo === t} onClick={() => set("tipo", t)}
            className={cx("flex-1 py-2.5 rounded-lg text-[14px] font-medium transition-colors", f.tipo === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}>
            {t === "PF" ? "Pessoa física" : "Pessoa jurídica"}
          </button>
        ))}
      </div>
      <Field label={pj ? "Razão social ou nome da empresa" : "Nome do cliente"}>
        <Input value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder={pj ? "Empresa Ltda" : "Nome completo"} autoFocus />
      </Field>
      <div className="grid sm:grid-cols-2 gap-5">
        <Field label="Telefone"><Input value={f.telefone} onChange={(e) => set("telefone", e.target.value)} placeholder="(00) 00000-0000" /></Field>
        <Field label="WhatsApp" hint="Deixe vazio para usar o mesmo telefone."><Input value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
      </div>
      <Field label="Endereço" hint="Usado para abrir a rota até o cliente."><Input value={f.endereco} onChange={(e) => set("endereco", e.target.value)} placeholder="Rua, número, bairro, cidade" /></Field>
      {pj && (
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Nome fantasia" hint="Opcional."><Input value={f.fantasia} onChange={(e) => set("fantasia", e.target.value)} /></Field>
          <Field label="Responsável" hint="Opcional."><Input value={f.responsavel} onChange={(e) => set("responsavel", e.target.value)} /></Field>
        </div>
      )}
      <Field label={pj ? "CNPJ" : "CPF"} hint="Opcional agora.">
        <Input value={f.documento} onChange={(e) => set("documento", e.target.value)} />
      </Field>
      {faltaFiscal && (
        <p className="text-[13px] text-amber-800 bg-amber-50 ring-1 ring-amber-200/70 rounded-xl px-3.5 py-3 leading-relaxed">
          Sem o CNPJ o orçamento sai sem identificação fiscal da empresa. Dá para seguir assim e completar depois na ficha do cliente.
        </p>
      )}
    </Modal>
  );
}

function ClienteForm({ form, setForm, onSave, onSaved }) {
  if (!form) return null;
  const set = (k, v) => setForm({ ...form, [k]: v });
  const pj = form.tipo === "PJ";
  return (
    <Modal open onClose={() => setForm(null)} title={form.id ? "Editar cliente" : "Novo cliente"} wide
      footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
        <Btn onClick={() => { const id = onSave(form); setForm(null); onSaved?.(id); }} disabled={!form.nome}>Salvar cliente</Btn></>}>
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl" role="tablist">
        {["PF", "PJ"].map((t) => (
          <button key={t} role="tab" aria-selected={form.tipo === t} onClick={() => set("tipo", t)}
            className={cx("flex-1 py-2.5 rounded-lg text-[14px] font-medium transition-colors", form.tipo === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}>
            {t === "PF" ? "Pessoa física" : "Pessoa jurídica"}
          </button>
        ))}
      </div>
      <Field label={pj ? "Razão social" : "Nome completo"}><Input value={form.nome || ""} onChange={(e) => set("nome", e.target.value)} placeholder={pj ? "Empresa Ltda" : "Nome do cliente"} /></Field>
      {pj && (
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Nome fantasia"><Input value={form.fantasia || ""} onChange={(e) => set("fantasia", e.target.value)} /></Field>
          <Field label="Responsável"><Input value={form.responsavel || ""} onChange={(e) => set("responsavel", e.target.value)} /></Field>
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-5">
        <Field label={pj ? "CNPJ" : "CPF"}><Input value={form.documento || ""} onChange={(e) => set("documento", e.target.value)} /></Field>
        <Field label="Telefone"><Input value={form.telefone || ""} onChange={(e) => set("telefone", e.target.value)} placeholder="(00) 0000-0000" /></Field>
      </div>
      <Field label="WhatsApp"><Input value={form.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} placeholder="(00) 00000-0000" /></Field>
      <Field label="Endereço"><Input value={form.endereco || ""} onChange={(e) => set("endereco", e.target.value)} placeholder="Rua, número, bairro, cidade" /></Field>
      <Field label="Observações" hint="Aparecem na ficha do cliente e na ordem de serviço.">
        <CampoVoz rows={3} valor={form.obs || ""} onChange={(v) => set("obs", v)} placeholder="Ex.: portaria libera acesso das 8h às 18h, falar com a síndica" />
      </Field>
    </Modal>
  );
}

/* ==================================================== Catálogo (serviços + produtos) */
function Catalogo({ servicos, produtos, salvarServico, salvarProduto }) {
  const [aba, setAba] = useState("servicos");
  const [busca, setBusca] = useState("");
  const [formS, setFormS] = useState(null);
  const [formP, setFormP] = useState(null);
  const [verInativos, setVerInativos] = useState(false);

  const fs = servicos.filter((s) => semAcento(s.nome + s.categoria).includes(semAcento(busca)));
  const fp = produtos.filter((p) => semAcento(`${p.nome} ${p.marca} ${p.modelo}`).includes(semAcento(busca)));
  const ativosS = fs.filter((s) => s.ativo), inativosS = fs.filter((s) => !s.ativo);
  const ativosP = fp.filter((p) => p.ativo), inativosP = fp.filter((p) => !p.ativo);
  const categorias = [...new Set(ativosS.map((s) => s.categoria))];

  const LinhaServico = ({ s, apagado }) => (
    <Linha onClick={() => setFormS(s)} className={apagado ? "opacity-55" : ""}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 truncate">{s.nome}</p>
          <div className="flex items-center gap-2 flex-wrap mt-0.5">
            <p className="text-[13px] text-slate-500 truncate">{s.descricao}</p>
            {s.garantiaDias > 0 && <Pill tone="neutro"><ShieldCheck className="w-3 h-3" />{s.garantiaDias} dias</Pill>}
            {s.retornoDias > 0 && <Pill tone="neutro"><RotateCcw className="w-3 h-3" />retorno {s.retornoDias}d</Pill>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[15px] font-semibold text-slate-900 tabular-nums">{brl(s.preco)}</p>
          <p className="text-[12px] text-slate-400">por {unidadeLabel(s.unidade)}</p>
        </div>
        <span className="hidden sm:block text-[12px] text-slate-300 w-20 text-right shrink-0">custo {brlCurto(s.custo)}</span>
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </div>
    </Linha>
  );
  const LinhaProduto = ({ p, apagado }) => (
    <Linha onClick={() => setFormP(p)} className={apagado ? "opacity-55" : ""}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 truncate">{p.nome}</p>
          <p className="text-[13px] text-slate-500 truncate">
            {[p.marca, p.modelo].filter(Boolean).join(" ")}{p.garantiaMeses > 0 ? ` · garantia de fábrica ${p.garantiaMeses} meses` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[15px] font-semibold text-slate-900 tabular-nums">{brl(p.preco)}</p>
          <p className="text-[12px] text-slate-400">por {unidadeLabel(p.unidade)}</p>
        </div>
        <span className="hidden sm:block text-[12px] text-slate-300 w-20 text-right shrink-0">custo {brlCurto(p.custo)}</span>
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </div>
    </Linha>
  );

  const inativos = aba === "servicos" ? inativosS : inativosP;

  return (
    <>
      <PageHead title="Serviços e produtos" sub="O que você vende, quanto cobra e como cobra."
        action={aba === "servicos"
          ? <Btn icon={Plus} onClick={() => setFormS({ unidade: "unidade", ativo: true, preco: 0, custo: 0, categoria: "", garantiaDias: 0, retornoDias: 0 })}>Novo serviço</Btn>
          : <Btn icon={Plus} onClick={() => setFormP({ unidade: "unidade", ativo: true, preco: 0, custo: 0, garantiaMeses: 0 })}>Novo produto</Btn>} />

      <Tabs valor={aba} onChange={setAba} opcoes={[{ id: "servicos", label: `Serviços · ${ativosS.length}` }, { id: "produtos", label: `Produtos e materiais · ${ativosP.length}` }]} className="mb-5" />
      <div className="mb-6 max-w-md"><SearchBox value={busca} onChange={setBusca} placeholder={aba === "servicos" ? "Buscar serviço" : "Buscar produto, marca ou modelo"} /></div>

      {aba === "servicos" ? (
        <div className="space-y-7">
          {ativosS.length === 0 && <Panel><Empty icon={Wrench} title="Nenhum serviço encontrado" sub="Cadastre o que você vende para montar orçamentos em segundos." /></Panel>}
          {categorias.map((cat) => (
            <section key={cat}>
              <Rotulo>{cat}</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {ativosS.filter((s) => s.categoria === cat).map((s) => <LinhaServico key={s.id} s={s} />)}
              </Panel>
            </section>
          ))}
        </div>
      ) : (
        <>
          {ativosP.length === 0 ? <Panel><Empty icon={Package} title="Nenhum produto encontrado" sub="Cadastre os equipamentos e materiais que você revende junto com o serviço." /></Panel> : (
            <Panel className="divide-y divide-slate-100 overflow-hidden">{ativosP.map((p) => <LinhaProduto key={p.id} p={p} />)}</Panel>
          )}
        </>
      )}

      {inativos.length > 0 && (
        <section className="mt-8">
          <button onClick={() => setVerInativos((v) => !v)} className={cx("text-[13px] font-medium text-slate-500 hover:text-slate-800 py-2", ring)}>
            {verInativos ? "Ocultar" : "Mostrar"} {inativos.length} item{inativos.length > 1 ? "ns" : ""} inativo{inativos.length > 1 ? "s" : ""}
          </button>
          {verInativos && (
            <Panel className="divide-y divide-slate-100 overflow-hidden mt-2">
              {aba === "servicos" ? inativosS.map((s) => <LinhaServico key={s.id} s={s} apagado />) : inativosP.map((p) => <LinhaProduto key={p.id} p={p} apagado />)}
            </Panel>
          )}
        </section>
      )}

      {formS && (
        <Modal open onClose={() => setFormS(null)} title={formS.id ? "Editar serviço" : "Novo serviço"} wide
          footer={<><Btn variant="ghost" onClick={() => setFormS(null)}>Cancelar</Btn>
            <Btn onClick={() => { salvarServico(formS); setFormS(null); }} disabled={!formS.nome}>Salvar serviço</Btn></>}>
          <Field label="Nome do serviço"><Input value={formS.nome || ""} onChange={(e) => setFormS({ ...formS, nome: e.target.value })} placeholder="Ex.: Instalação de fechadura digital" /></Field>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Categoria"><Input value={formS.categoria || ""} onChange={(e) => setFormS({ ...formS, categoria: e.target.value })} placeholder="Ex.: Controle de acesso" /></Field>
            <Field label="Cobrado por" hint="Define como a quantidade é contada nos orçamentos.">
              <Select value={formS.unidade} onChange={(e) => setFormS({ ...formS, unidade: e.target.value })}>
                {UNIDADES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Preço de venda"><Input type="number" min="0" value={formS.preco} onChange={(e) => setFormS({ ...formS, preco: Number(e.target.value) })} /></Field>
            <Field label="Custo estimado" hint="Uso interno. Nunca aparece para o cliente."><Input type="number" min="0" value={formS.custo} onChange={(e) => setFormS({ ...formS, custo: Number(e.target.value) })} /></Field>
          </div>
          <div className="rounded-2xl ring-1 ring-slate-200 p-4 space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-[14px] font-medium text-slate-800">Este serviço tem garantia?</p>
                <p className="text-[12.5px] text-slate-500 mt-0.5">Ao finalizar uma OS com este serviço, a garantia nasce sozinha.</p>
              </div>
              <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
                {[["nao", "Não"], ["sim", "Sim"]].map(([v, label]) => {
                  const ativo = v === "sim" ? formS.garantiaDias > 0 : !formS.garantiaDias;
                  return (
                    <button key={v} onClick={() => setFormS({ ...formS, garantiaDias: v === "sim" ? (formS.garantiaDias || 90) : 0 })}
                      aria-pressed={ativo}
                      className={cx("px-5 py-2 rounded-lg text-[14px] font-medium transition-colors", ativo ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {formS.garantiaDias > 0 && (
              <div className="flex flex-wrap gap-2 items-end">
                {PRAZOS_GARANTIA.map((p) => (
                  <button key={p.dias} onClick={() => setFormS({ ...formS, garantiaDias: p.dias })} aria-pressed={formS.garantiaDias === p.dias}
                    className={cx("px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors", ring,
                      formS.garantiaDias === p.dias ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50")}>
                    {p.label}
                  </button>
                ))}
                <div className="w-[150px]">
                  <Field label="Personalizado">
                    <Input type="number" min="1" value={formS.garantiaDias} aria-label="Prazo de garantia em dias"
                      onChange={(e) => setFormS({ ...formS, garantiaDias: Math.max(1, Number(e.target.value)) })} />
                  </Field>
                </div>
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Recomendar novo atendimento em" hint="Usado para pós-venda.">
              <Select value={formS.retornoDias || 0} onChange={(e) => setFormS({ ...formS, retornoDias: Number(e.target.value) })}>
                {PRAZOS_RETORNO.map((d) => <option key={d} value={d}>{d === 0 ? "Não recomendar" : d === 365 ? "12 meses" : d === 180 ? "6 meses" : `${d} dias`}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Descrição">
            <CampoVoz rows={3} valor={formS.descricao || ""} onChange={(v) => setFormS({ ...formS, descricao: v })} placeholder="O que está incluso neste serviço" />
          </Field>
          <label className="flex items-center gap-3 py-1">
            <input type="checkbox" checked={formS.ativo} onChange={(e) => setFormS({ ...formS, ativo: e.target.checked })} className="w-5 h-5 rounded accent-teal-700" />
            <span className="text-[14px] text-slate-700">Disponível para uso em orçamentos</span>
          </label>
        </Modal>
      )}

      {formP && (
        <Modal open onClose={() => setFormP(null)} title={formP.id ? "Editar produto" : "Novo produto ou material"} wide
          footer={<><Btn variant="ghost" onClick={() => setFormP(null)}>Cancelar</Btn>
            <Btn onClick={() => { salvarProduto(formP); setFormP(null); }} disabled={!formP.nome}>Salvar produto</Btn></>}>
          <Field label="Nome do produto"><Input value={formP.nome || ""} onChange={(e) => setFormP({ ...formP, nome: e.target.value })} placeholder="Ex.: Fechadura digital biométrica" /></Field>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Marca"><Input value={formP.marca || ""} onChange={(e) => setFormP({ ...formP, marca: e.target.value })} placeholder="Ex.: Intelbras" /></Field>
            <Field label="Modelo ou referência"><Input value={formP.modelo || ""} onChange={(e) => setFormP({ ...formP, modelo: e.target.value })} placeholder="Ex.: FR 320" /></Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Custo de compra"><Input type="number" min="0" value={formP.custo} onChange={(e) => setFormP({ ...formP, custo: Number(e.target.value) })} /></Field>
            <Field label="Preço de venda"><Input type="number" min="0" value={formP.preco} onChange={(e) => setFormP({ ...formP, preco: Number(e.target.value) })} /></Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Unidade">
              <Select value={formP.unidade} onChange={(e) => setFormP({ ...formP, unidade: e.target.value })}>
                {UNIDADES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </Select>
            </Field>
            <Field label="Garantia do fabricante" hint="Separada da garantia do seu serviço.">
              <Select value={formP.garantiaMeses || 0} onChange={(e) => setFormP({ ...formP, garantiaMeses: Number(e.target.value) })}>
                {[0, 3, 6, 12, 24, 36].map((m) => <option key={m} value={m}>{m === 0 ? "Sem garantia" : `${m} meses`}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Fornecedor" hint="Opcional."><Input value={formP.fornecedor || ""} onChange={(e) => setFormP({ ...formP, fornecedor: e.target.value })} /></Field>
          <Field label="Descrição" hint="Opcional."><Textarea rows={2} value={formP.descricao || ""} onChange={(e) => setFormP({ ...formP, descricao: e.target.value })} /></Field>
          <label className="flex items-center gap-3 py-1">
            <input type="checkbox" checked={formP.ativo} onChange={(e) => setFormP({ ...formP, ativo: e.target.checked })} className="w-5 h-5 rounded accent-teal-700" />
            <span className="text-[14px] text-slate-700">Disponível para uso em orçamentos</span>
          </label>
        </Modal>
      )}
    </>
  );
}

/* ============================================================== Orçamentos */
function Orcamentos(p) {
  const { orcamentos, nomeCliente, orcamentoAberto, setOrcamentoAberto } = p;
  const [filtro, setFiltro] = useState("todos");
  const [voz, setVoz] = useState(false);
  const [rascunhoVoz, setRascunhoVoz] = useState(null);

  if (orcamentoAberto) {
    if (String(orcamentoAberto).startsWith("novo")) {
      const preCliente = String(orcamentoAberto).split(":")[1] || "";
      return <OrcamentoEditor {...p} inicial={{ clienteId: preCliente }} onFechar={() => setOrcamentoAberto(null)} />;
    }
    const o = orcamentos.find((x) => x.id === orcamentoAberto);
    if (o) return <OrcamentoDoc {...p} orc={o} />;
  }
  if (rascunhoVoz) return <OrcamentoEditor {...p} inicial={rascunhoVoz} onFechar={() => setRascunhoVoz(null)} />;

  const filtrados = orcamentos.filter((o) => filtro === "todos" || o.status === filtro);

  return (
    <>
      <PageHead title="Orçamentos" sub="Monte, envie e acompanhe a resposta do cliente."
        action={
          <div className="flex gap-2">
            <Btn variant="soft" icon={Mic} onClick={() => setVoz(true)}>Por voz</Btn>
            <Btn icon={Plus} onClick={() => setOrcamentoAberto("novo")}>Novo</Btn>
          </div>
        } />
      <Tabs valor={filtro} onChange={setFiltro} className="mb-5"
        opcoes={[{ id: "todos", label: "Todos" }, { id: "rascunho", label: "Rascunhos" }, { id: "enviado", label: "Aguardando" }, { id: "aprovado", label: "Aprovados" }]} />

      {filtrados.length === 0 ? (
        <Panel><Empty icon={FileText} title="Nenhum orçamento por aqui" sub="Crie um orçamento em menos de um minuto usando seus serviços cadastrados."
          action={<Btn icon={Plus} onClick={() => setOrcamentoAberto("novo")}>Novo orçamento</Btn>} /></Panel>
      ) : (
        <Panel className="divide-y divide-slate-100 overflow-hidden">
          {filtrados.map((o) => (
            <Linha key={o.id} onClick={() => setOrcamentoAberto(o.id)}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{nomeCliente(o.clienteId)}</p>
                  <p className="text-[13px] text-slate-500">{o.numero} · {dataBR(o.data)} · {o.itens.length} item{o.itens.length > 1 ? "ns" : ""}</p>
                  <div className="mt-2.5">
                    <Trilha etapas={[
                      { label: "Orçamento", feito: true },
                      { label: "Aprovado", feito: o.status === "aprovado", alerta: o.status === "enviado" },
                      { label: "Ordem de serviço", feito: !!o.osId },
                    ]} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[17px] font-semibold text-slate-900 tabular-nums">{brl(totalDoc(o))}</p>
                  <Pill tone={ST_ORC[o.status].tone} className="mt-1.5">{ST_ORC[o.status].label}</Pill>
                </div>
              </div>
            </Linha>
          ))}
        </Panel>
      )}

      {voz && <OrcamentoVoz {...p} onClose={() => setVoz(false)} onConfirmar={(rasc) => { setVoz(false); setRascunhoVoz(rasc); }} />}
    </>
  );
}

/* ------------------------------------------- orçamento por voz (com confirmação) */
function OrcamentoVoz({ onClose, onConfirmar, clientes, servicos, produtos, empresa, salvarCliente, aviso }) {
  const [fala, setFala] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [previa, setPrevia] = useState(null);
  const [comando, setComando] = useState("");
  const [novoCliente, setNovoCliente] = useState(null);

  const interpretar = async (comandoCorrecao) => {
    setCarregando(true); setErro(null);
    try {
      const bruto = await chamarIA(promptOrcamento({
        fala, clientes, servicos, produtos,
        rascunho: comandoCorrecao ? previa.bruto : null, comando: comandoCorrecao,
      }));
      setPrevia(montarPrevia(bruto));
      setComando("");
    } catch (e) {
      setErro("Não consegui interpretar agora. Você pode tentar de novo ou montar o orçamento manualmente.");
    }
    setCarregando(false);
  };

  const montarPrevia = (bruto) => {
    const itens = (bruto.itens || []).map((i) => {
      const cat = i.tipo === "produto" ? produtos.find((p) => p.id === i.catalogoId) : servicos.find((s) => s.id === i.catalogoId);
      const precoCatalogo = cat?.preco;
      return {
        id: uid(), tipo: i.tipo || "servico", catalogoId: cat?.id || null,
        nome: cat ? (i.tipo === "produto" ? `${cat.nome}${cat.marca ? " · " + cat.marca : ""}${cat.modelo ? " " + cat.modelo : ""}` : cat.nome) : i.nome,
        unidade: cat?.unidade || i.unidade || "unidade",
        qtd: Number(i.qtd) || 1,
        preco: i.preco != null ? Number(i.preco) : (precoCatalogo ?? null),
        custo: cat?.custo || 0,
        precoDito: i.preco != null && precoCatalogo != null && Number(i.preco) !== precoCatalogo,
        semCatalogo: !cat,
      };
    });
    const cl = clientes.find((c) => c.id === bruto.clienteId);
    const parecidos = !cl && bruto.clienteSugerido
      ? clientes.filter((c) => semAcento(c.fantasia || c.nome).includes(semAcento(bruto.clienteSugerido.split(" ")[0] || ""))) : [];
    return { bruto, itens, clienteId: cl?.id || null, clienteSugerido: bruto.clienteSugerido, parecidos,
      desconto: Number(bruto.desconto) || 0, acrescimo: Number(bruto.acrescimo) || 0,
      validadeDias: bruto.validadeDias || empresa.validadePadrao,
      condicao: bruto.condicao || empresa.condicaoPadrao, obs: bruto.obs || "",
      localServico: bruto.localServico || "", avisos: bruto.avisos || [] };
  };

  const total = previa ? Math.max(0, previa.itens.reduce((t, i) => t + i.qtd * (i.preco || 0), 0) - previa.desconto + previa.acrescimo) : 0;
  const faltaPreco = previa?.itens.some((i) => i.preco == null);

  const confirmar = () => {
    onConfirmar({
      clienteId: previa.clienteId, itens: previa.itens.filter((i) => i.preco != null).map(({ precoDito, semCatalogo, ...i }) => i),
      desconto: previa.desconto, acrescimo: previa.acrescimo,
      validade: addDays(HOJE, previa.validadeDias), condicao: previa.condicao, obs: previa.obs,
      localServico: previa.localServico, data: HOJE, status: "rascunho",
    });
  };

  return (
    <>
      <Modal open onClose={onClose} wide title="Orçamento por voz"
        sub={previa ? "Confira antes de criar. Nada é salvo sem a sua confirmação." : "Fale naturalmente o que o cliente pediu."}
        footer={previa ? (
          <>
            <Btn variant="ghost" onClick={() => { setPrevia(null); }}>Recomeçar</Btn>
            <Btn disabled={!previa.clienteId || previa.itens.length === 0 || faltaPreco} onClick={confirmar}>Confirmar e abrir orçamento</Btn>
          </>
        ) : (
          <>
            <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn disabled={!fala.trim() || carregando} icon={carregando ? Loader2 : Sparkles} onClick={() => interpretar(null)}>
              {carregando ? "Interpretando…" : "Interpretar"}
            </Btn>
          </>
        )}>

        {!previa && (
          <>
            <CampoVoz valor={fala} onChange={setFala} rows={6}
              placeholder="Ex.: cria um orçamento para o Condomínio Jardins com duas instalações de fechadura digital, mais uma visita técnica, cem reais de desconto, validade de 15 dias, serviço na portaria"
              dica="Você também pode digitar." />
            {erro && <p className="text-[13px] text-rose-700">{erro}</p>}
            <p className="text-[12px] text-slate-400 leading-relaxed">
              A interpretação usa um serviço de IA online. Se ele estiver indisponível, monte o orçamento pela tela normal — o resultado é exatamente o mesmo tipo de orçamento.
            </p>
          </>
        )}

        {previa && (
          <>
            <p className="text-[14px] font-medium text-slate-700">Entendi seu orçamento assim:</p>

            <div className="rounded-2xl ring-1 ring-slate-200 p-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1.5">Cliente</p>
              {previa.clienteId ? (
                <p className="text-[15px] font-medium text-slate-900">{clientes.find((c) => c.id === previa.clienteId)?.fantasia || clientes.find((c) => c.id === previa.clienteId)?.nome}</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-[14px] text-amber-800">Não encontrei “{previa.clienteSugerido || "o cliente"}” no seu cadastro.</p>
                  {previa.parecidos.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[12px] text-slate-500">Você quis dizer:</p>
                      {previa.parecidos.map((c) => (
                        <button key={c.id} onClick={() => setPrevia({ ...previa, clienteId: c.id })}
                          className={cx("w-full text-left rounded-xl ring-1 ring-slate-200 px-3.5 py-2.5 text-[14px] hover:ring-teal-500", ring)}>
                          {c.fantasia || c.nome}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <Select value="" onChange={(e) => setPrevia({ ...previa, clienteId: e.target.value })} className="max-w-[240px]">
                      <option value="">Escolher da lista…</option>
                      {clientes.map((c) => <option key={c.id} value={c.id}>{c.fantasia || c.nome}</option>)}
                    </Select>
                    <Btn size="sm" variant="soft" icon={Plus} onClick={() => setNovoCliente({ tipo: "PF", nome: previa.clienteSugerido || "" })}>Cadastrar novo</Btn>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100">
              {previa.itens.map((i, idx) => (
                <div key={i.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] text-slate-900">{i.nome}</p>
                      <p className="text-[12px] text-slate-500 mt-0.5">
                        {i.qtd} {unidadeLabel(i.unidade)} × {i.preco != null ? brl(i.preco) : "preço não informado"}
                        {i.tipo === "produto" && " · produto"}
                      </p>
                      {i.precoDito && <p className="text-[12px] text-amber-700 mt-1">Preço dito por você — o catálogo não será alterado.</p>}
                      {i.semCatalogo && <p className="text-[12px] text-amber-700 mt-1">Não está no catálogo. Entra só neste orçamento.</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <p className="text-[15px] font-semibold text-slate-900 tabular-nums">{i.preco != null ? brl(i.qtd * i.preco) : "—"}</p>
                      <button onClick={() => setPrevia({ ...previa, itens: previa.itens.filter((_, k) => k !== idx) })}
                        aria-label={`Remover ${i.nome}`} className={cx("p-1.5 rounded-lg text-slate-300 hover:text-rose-600", ring)}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  {i.preco == null && (
                    <div className="mt-3 max-w-[200px]">
                      <Field label="Informe o preço unitário">
                        <Input type="number" min="0" onChange={(e) => setPrevia({ ...previa, itens: previa.itens.map((x, k) => k === idx ? { ...x, preco: Number(e.target.value) } : x) })} />
                      </Field>
                    </div>
                  )}
                </div>
              ))}
              <div className="p-4 space-y-1.5 text-[14px]">
                {previa.desconto > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span className="tabular-nums">− {brl(previa.desconto)}</span></div>}
                {previa.acrescimo > 0 && <div className="flex justify-between text-slate-500"><span>Acréscimo</span><span className="tabular-nums">+ {brl(previa.acrescimo)}</span></div>}
                <div className="flex justify-between items-baseline pt-2">
                  <span className="font-medium text-slate-700">Total</span>
                  <span className="text-2xl font-semibold text-slate-900 tabular-nums">{brl(total)}</span>
                </div>
                <p className="text-[12px] text-slate-400 pt-1">Validade de {previa.validadeDias} dias · {previa.condicao}</p>
                {previa.localServico && <p className="text-[12px] text-slate-400">Local do serviço: {previa.localServico}</p>}
                {previa.obs && <p className="text-[12px] text-slate-400">Observações: {previa.obs}</p>}
              </div>
            </div>

            {previa.avisos.length > 0 && (
              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/70 p-3.5 space-y-1">
                {previa.avisos.map((a, i) => <p key={i} className="text-[13px] text-amber-900">{a}</p>)}
              </div>
            )}

            <div>
              <Field label="Quer corrigir algo? Fale ou escreva a correção">
                <Input value={comando} onChange={(e) => setComando(e.target.value)} placeholder="Ex.: muda para três fechaduras e tira a visita técnica" />
              </Field>
              <div className="flex gap-2 mt-2">
                <Btn size="sm" variant="soft" disabled={!comando.trim() || carregando} icon={carregando ? Loader2 : Sparkles} onClick={() => interpretar(comando)}>
                  {carregando ? "Aplicando…" : "Aplicar correção"}
                </Btn>
              </div>
              {erro && <p className="text-[13px] text-rose-700 mt-2">{erro}</p>}
            </div>
          </>
        )}
      </Modal>

      <ClienteForm form={novoCliente} setForm={setNovoCliente} onSave={salvarCliente}
        onSaved={(id) => id && setPrevia((pv) => ({ ...pv, clienteId: id }))} />
    </>
  );
}

/* -------------------------------------------------------- documento do orçamento */
function OrcamentoDoc(p) {
  const { orc, cliente, empresa, mudarStatusOrc, duplicarOrcamento, gerarOS, setOrcamentoAberto, aviso, pedirConfirmacao } = p;
  const [editando, setEditando] = useState(false);
  const c = cliente(orc.clienteId);
  if (editando) return <OrcamentoEditor {...p} inicial={orc} onFechar={() => setEditando(false)} />;

  const [gerandoPdf, setGerandoPdf] = useState(false);
  const arquivoPdf = `Orcamento-${orc.numero}.pdf`;
  const textoWhats = () => {
    const linhas = orc.itens.map((i) => `• ${i.qtd}× ${i.nome} — ${brl(i.qtd * i.preco)}`).join("\n");
    return `*${empresa.nome}*\nOrçamento ${orc.numero}\n\n${linhas}\n\n*Total: ${brl(totalDoc(orc))}*\nValidade: ${dataBR(orc.validade)}\n${orc.condicao}`;
  };
  const baixarPdf = async () => {
    if (gerandoPdf) return;
    setGerandoPdf(true);
    try {
      await baixarOrcamentoPDF(orc.id, orc.empresaId, arquivoPdf);
      aviso("PDF gerado a partir do orçamento salvo no sistema.");
    } catch (e) { aviso(e?.message || "Não foi possível gerar o PDF."); }
    finally { setGerandoPdf(false); }
  };
  const enviarWhats = async () => {
    if (gerandoPdf) return;
    const txt = textoWhats();
    if (suportaCompartilharArquivo()) {
      setGerandoPdf(true);
      try {
        const r = await compartilharOrcamentoPDF({ quoteId: orc.id, companyId: orc.empresaId, filename: arquivoPdf, text: txt });
        if (r.shared) {
          if (orc.status === "rascunho") await mudarStatusOrc(orc.id, "enviado");
          else aviso("PDF compartilhado.");
        }
      } catch (e) { aviso(e?.message || "Não foi possível compartilhar o PDF."); }
      finally { setGerandoPdf(false); }
      return;
    }
    const numero = soDigitos(c?.whatsapp);
    if (!numero) {
      setGerandoPdf(true);
      try { await baixarOrcamentoPDF(orc.id, orc.empresaId, arquivoPdf); aviso("Cliente sem WhatsApp cadastrado. PDF baixado para envio manual."); }
      catch (e) { aviso(e?.message || "Não foi possível gerar o PDF."); }
      finally { setGerandoPdf(false); }
      return;
    }
    window.open(`https://wa.me/55${numero}?text=${encodeURIComponent(txt)}`, "_blank");
    setGerandoPdf(true);
    try {
      await baixarOrcamentoPDF(orc.id, orc.empresaId, arquivoPdf);
      if (orc.status === "rascunho") await mudarStatusOrc(orc.id, "enviado");
      aviso("WhatsApp aberto e PDF baixado para anexar.");
    } catch (e) { aviso("WhatsApp aberto. Não consegui baixar o PDF: " + (e?.message || "erro de geração")); }
    finally { setGerandoPdf(false); }
  };

  return (
    <>
      <div className="zt-nao-imprime">
        <button onClick={() => setOrcamentoAberto(null)} className={cx("flex items-center gap-2 text-[14px] text-slate-500 mb-5 hover:text-slate-900 py-1", ring)}>
          <ArrowLeft className="w-4 h-4" /> Orçamentos
        </button>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em]">{orc.numero}</h1>
            <Pill tone={ST_ORC[orc.status].tone}>{ST_ORC[orc.status].label}</Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <Btn variant="soft" size="sm" icon={Pencil} onClick={() => setEditando(true)}>Editar</Btn>
            <Btn variant="soft" size="sm" icon={Copy} onClick={() => pedirConfirmacao({
              titulo: `Duplicar o ${orc.numero}?`,
              texto: "Cria um novo rascunho com o mesmo cliente, itens e condições. Aprovação, OS e pagamentos não são copiados.",
              confirmar: "Duplicar", acao: () => duplicarOrcamento(orc),
            })}>Duplicar</Btn>
            <Btn variant="soft" size="sm" icon={gerandoPdf ? Loader2 : Printer} disabled={gerandoPdf} onClick={baixarPdf}>{gerandoPdf ? "Gerando PDF…" : "Gerar PDF"}</Btn>
            <Btn size="sm" icon={Send} onClick={enviarWhats}>Enviar pelo WhatsApp</Btn>
          </div>
        </div>

        {orc.status === "rascunho" && (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200/70 px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-slate-600">Ainda é um rascunho. Envie para o cliente quando estiver pronto.</p>
            <Btn size="sm" icon={Send} onClick={enviarWhats}>Enviar agora</Btn>
          </div>
        )}
        {orc.status === "enviado" && (
          <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-amber-900">Enviado em {dataBR(orc.data)}. Já teve retorno do cliente?</p>
            <div className="flex gap-2">
              <Btn size="sm" variant="soft" onClick={() => pedirConfirmacao({ titulo: "Marcar como recusado?", texto: "O orçamento sai da lista de pendentes. Você pode reabri-lo depois.", confirmar: "Marcar recusado", acao: () => mudarStatusOrc(orc.id, "recusado") })}>Recusado</Btn>
              <Btn size="sm" icon={Check} onClick={() => mudarStatusOrc(orc.id, "aprovado")}>Aprovado</Btn>
            </div>
          </div>
        )}
        {orc.status === "aprovado" && (
          <div className="rounded-2xl bg-teal-50 ring-1 ring-teal-200/70 px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-teal-900">{orc.osId ? "Ordem de serviço já criada a partir deste orçamento." : "Aprovado. Gere a ordem de serviço sem redigitar nada."}</p>
            <Btn size="sm" icon={ClipboardList} onClick={() => gerarOS(orc)}>{orc.osId ? "Abrir ordem de serviço" : "Criar ordem de serviço"}</Btn>
          </div>
        )}
      </div>

      <div className="zt-doc bg-white rounded-2xl ring-1 ring-slate-200/70 overflow-hidden">
        <div className="px-7 sm:px-10 pt-9 pb-7 flex flex-wrap items-start justify-between gap-6 border-b border-slate-100">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-lg font-semibold shrink-0">{iniciais(empresa.nome)}</div>
            <div>
              <p className="text-[19px] font-semibold text-slate-900 tracking-tight">{empresa.nome}</p>
              <p className="text-[13px] text-slate-500 mt-0.5">{empresa.atividade}</p>
              <p className="text-[12px] text-slate-400 mt-2 leading-relaxed">{empresa.documento} · {empresa.telefone}<br />{empresa.endereco}</p>
            </div>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.12em]">Orçamento</p>
            <p className="text-[28px] font-semibold text-slate-900 tracking-tight leading-tight">{orc.numero}</p>
            <p className="text-[12px] text-slate-500 mt-1.5">Emitido em {dataBR(orc.data)}</p>
            <p className="text-[12px] text-slate-500">Válido até {dataBR(orc.validade)}</p>
          </div>
        </div>

        <div className="px-7 sm:px-10 py-6 border-b border-slate-100">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-2">Para</p>
          <p className="text-[16px] font-medium text-slate-900">{c?.nome}</p>
          {c?.tipo === "PJ" && c?.responsavel && <p className="text-[13px] text-slate-500">A/C {c.responsavel}</p>}
          <p className="text-[13px] text-slate-500 mt-1">{c?.documento} · {c?.telefone}</p>
          <p className="text-[13px] text-slate-500">{orc.local || c?.endereco}{orc.localServico ? ` · ${orc.localServico}` : ""}</p>
        </div>

        <div className="px-7 sm:px-10 py-7">
          <div className="hidden sm:flex items-center gap-4 pb-3 mb-1 border-b border-slate-100 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em]">
            <span className="flex-1">Descrição</span><span className="w-28 text-right">Quantidade</span>
            <span className="w-28 text-right">Valor unitário</span><span className="w-28 text-right">Total</span>
          </div>
          <div className="divide-y divide-slate-100">
            {orc.itens.map((i) => (
              <div key={i.id} className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-4 gap-y-1 py-3.5">
                <p className="flex-1 min-w-full sm:min-w-0 text-[15px] text-slate-800">{i.nome}</p>
                <p className="w-28 text-[13px] text-slate-500 sm:text-right tabular-nums">{i.qtd} {unidadeLabel(i.unidade)}</p>
                <p className="w-28 text-[13px] text-slate-500 text-right tabular-nums">{brl(i.preco)}</p>
                <p className="w-28 text-[15px] font-medium text-slate-900 text-right tabular-nums ml-auto">{brl(i.qtd * i.preco)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 sm:ml-auto sm:max-w-sm space-y-2.5 text-[14px]">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span className="tabular-nums">{brl(somaItens(orc.itens))}</span></div>
            {orc.desconto > 0 && <div className="flex justify-between text-slate-500"><span>Desconto</span><span className="tabular-nums">− {brl(orc.desconto)}</span></div>}
            {orc.acrescimo > 0 && <div className="flex justify-between text-slate-500"><span>Acréscimo</span><span className="tabular-nums">+ {brl(orc.acrescimo)}</span></div>}
            <div className="flex justify-between items-baseline pt-4 mt-2 border-t-2 border-slate-900">
              <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-[0.08em]">Total</span>
              <span className="text-[30px] font-semibold text-slate-900 tracking-tight tabular-nums">{brl(totalDoc(orc))}</span>
            </div>
          </div>
        </div>

        <div className="px-7 sm:px-10 py-7 bg-slate-50 border-t border-slate-100 grid sm:grid-cols-2 gap-7 text-[14px]">
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1.5">Condições de pagamento</p>
            <p className="text-slate-700 leading-relaxed">{orc.condicao}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1.5">Observações</p>
            <p className="text-slate-700 leading-relaxed">{orc.obs || "—"}</p>
          </div>
          <p className="sm:col-span-2 text-[12px] text-slate-400 pt-2 border-t border-slate-200">
            Proposta válida até {dataBR(orc.validade)} · {empresa.nome} · {empresa.telefone}
          </p>
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------- editor de orçamento */
function OrcamentoEditor(p) {
  const { clientes, servicos, produtos, empresa, salvarOrcamento, salvarCliente, inicial, onFechar, cliente } = p;
  const [novoCliente, setNovoCliente] = useState(false);
  const [d, setD] = useState(() => ({
    id: inicial?.id, numero: inicial?.numero, clienteId: inicial?.clienteId || "",
    status: inicial?.status || "rascunho", data: inicial?.data || HOJE,
    validade: inicial?.validade || addDays(HOJE, empresa.validadePadrao),
    itens: inicial?.itens ? inicial.itens.map((i) => ({ ...i })) : [],
    desconto: inicial?.desconto || 0, acrescimo: inicial?.acrescimo || 0,
    condicao: inicial?.condicao || empresa.condicaoPadrao, obs: inicial?.obs ?? empresa.observacaoPadrao,
    local: inicial?.local || "", localServico: inicial?.localServico || "", osId: inicial?.osId || null,
  }));
  const [buscaCat, setBuscaCat] = useState("");
  const [abaCat, setAbaCat] = useState("servicos");
  const [maisOpcoes, setMaisOpcoes] = useState(!!inicial?.id);
  const c = cliente(d.clienteId);

  useEffect(() => {
    if (d.clienteId && !d.local) {
      const cl = clientes.find((x) => x.id === d.clienteId);
      if (cl) setD((s) => ({ ...s, local: cl.endereco || "" }));
    }
  }, [d.clienteId]);

  const escolherCliente = (id) => {
    const cl = clientes.find((x) => x.id === id);
    setD((s) => ({ ...s, clienteId: id, local: cl?.endereco || s.local }));
  };
  const addServico = (s) => setD((st) => ({ ...st, itens: [...st.itens, itemServico(s, 1)] }));
  const addProduto = (pr) => setD((st) => ({ ...st, itens: [...st.itens, itemProduto(pr, 1)] }));
  const addLivre = (dados) => setD((st) => ({ ...st, itens: [...st.itens, itemLivre(dados)] }));
  const upItem = (id, k, v) => setD((s) => ({ ...s, itens: s.itens.map((i) => (i.id === id ? { ...i, [k]: v } : i)) }));
  const rmItem = (id) => setD((s) => ({ ...s, itens: s.itens.filter((i) => i.id !== id) }));

  const dispS = servicos.filter((s) => s.ativo && semAcento(s.nome).includes(semAcento(buscaCat)));
  const dispP = produtos.filter((x) => x.ativo && semAcento(`${x.nome} ${x.marca} ${x.modelo}`).includes(semAcento(buscaCat)));

  return (
    <>
      <button onClick={onFechar} className={cx("flex items-center gap-2 text-[14px] text-slate-500 mb-5 hover:text-slate-900 py-1", ring)}>
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>
      <PageHead title={d.id ? `Editar ${d.numero}` : "Novo orçamento"} sub="Cliente, itens, quantidade. O resto o ZiisTec preenche." />

      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-2 space-y-7">
          <section>
            <Rotulo>1 · Cliente</Rotulo>
            <Panel className="p-5 space-y-5">
              <Field label="Quem vai receber este orçamento">
                <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                  <Select value={d.clienteId} onChange={(e) => escolherCliente(e.target.value)} className="flex-1">
                    <option value="">Selecione um cliente</option>
                    {clientes.map((x) => <option key={x.id} value={x.id}>{x.fantasia || x.nome}</option>)}
                  </Select>
                  <Btn variant="soft" icon={Plus} onClick={() => setNovoCliente(true)} className="shrink-0">Cadastrar novo cliente</Btn>
                </div>
              </Field>
              {c && (
                <div className="grid sm:grid-cols-2 gap-5">
                  <Field label="Endereço do atendimento" hint="Vem do cadastro do cliente.">
                    <Input value={d.local} onChange={(e) => setD({ ...d, local: e.target.value })} />
                  </Field>
                  <Field label="Local do serviço" hint="Ex.: Apto 304, Bloco B, Portaria, Loja 4.">
                    <Input value={d.localServico} onChange={(e) => setD({ ...d, localServico: e.target.value })} />
                  </Field>
                </div>
              )}
            </Panel>
          </section>

          <section>
            <Rotulo>2 · Serviços e produtos</Rotulo>
            <Panel className="overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-slate-100 space-y-3">
                <Tabs valor={abaCat} onChange={setAbaCat} opcoes={[{ id: "servicos", label: "Serviços" }, { id: "produtos", label: "Produtos" }, { id: "livre", label: "Item livre" }]} />
                {abaCat === "livre" ? (
                  <FormItemLivre onAdicionar={addLivre} />
                ) : (<>
                <SearchBox value={buscaCat} onChange={setBuscaCat} placeholder="Buscar no catálogo e tocar para adicionar" />
                <div className="flex flex-wrap gap-2">
                  {abaCat === "servicos"
                    ? dispS.slice(0, buscaCat ? 8 : 5).map((s) => (
                      <button key={s.id} onClick={() => addServico(s)}
                        className={cx("inline-flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[13px] text-slate-700 hover:bg-white hover:ring-teal-500", ring)}>
                        <Plus className="w-3.5 h-3.5 text-teal-700" />{s.nome}<span className="text-slate-400">{brlCurto(s.preco)}</span>
                      </button>))
                    : dispP.slice(0, buscaCat ? 8 : 5).map((x) => (
                      <button key={x.id} onClick={() => addProduto(x)}
                        className={cx("inline-flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[13px] text-slate-700 hover:bg-white hover:ring-teal-500", ring)}>
                        <Plus className="w-3.5 h-3.5 text-teal-700" />{x.nome} {x.modelo}<span className="text-slate-400">{brlCurto(x.preco)}</span>
                      </button>))}
                  {(abaCat === "servicos" ? dispS : dispP).length === 0 && <p className="text-[13px] text-slate-400 py-1">Nada encontrado com esse nome.</p>}
                </div>
                </>)}
              </div>

              {d.itens.length === 0 ? (
                <Empty icon={Wrench} title="Nenhum item adicionado" sub="Use o catálogo para o que é repetitivo, ou descreva um item livre para algo pontual." />
              ) : (
                <div className="divide-y divide-slate-100">
                  {d.itens.map((i) => (
                    <div key={i.id} className="p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="min-w-0">
                          {i.tipo === "livre" ? (
                            <Input value={i.nome} onChange={(e) => upItem(i.id, "nome", e.target.value)} aria-label="Descrição do item" className="font-medium" />
                          ) : <p className="font-medium text-slate-900">{i.nome}</p>}
                          <div className="flex gap-2 mt-1.5 flex-wrap">
                            {i.tipo === "produto" && <Pill tone="neutro"><Package className="w-3 h-3" />Produto</Pill>}
                            {i.tipo === "livre" && <Pill tone="neutro">Item livre · {unidadeLabel(i.unidade)}</Pill>}
                          </div>
                          {i.tipo === "livre" && i.obs && <p className="text-[12.5px] text-slate-500 mt-1.5 leading-relaxed">{i.obs}</p>}
                        </div>
                        <button onClick={() => rmItem(i.id)} aria-label={`Remover ${i.nome}`}
                          className={cx("p-1.5 -m-1 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 shrink-0", ring)}><Trash2 className="w-4 h-4" /></button>
                      </div>
                      <div className="grid grid-cols-3 gap-3 sm:gap-4 items-end">
                        <Field label={`Qtd em ${unidadeLabel(i.unidade)}`}><Input type="number" min="0" step="0.5" value={i.qtd} onChange={(e) => upItem(i.id, "qtd", num(e.target.value))} /></Field>
                        <Field label="Valor unitário"><Input type="number" min="0" step="0.01" value={i.preco} onChange={(e) => upItem(i.id, "preco", num(e.target.value))} /></Field>
                        <div className="text-right pb-3">
                          <p className="text-[12px] text-slate-400">Total</p>
                          <p className="text-[19px] font-semibold text-slate-900 tabular-nums">{brl(i.qtd * i.preco)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </section>

          <section>
            <Rotulo acao={<button onClick={() => setMaisOpcoes((v) => !v)} className="text-[13px] font-medium text-teal-800 hover:underline">{maisOpcoes ? "Ocultar" : "Ajustar"}</button>}>
              3 · Validade, condições e observações
            </Rotulo>
            {maisOpcoes ? (
              <Panel className="p-5 space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <Field label="Data do orçamento"><Input type="date" value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} /></Field>
                  <Field label="Válido até"><Input type="date" value={d.validade} onChange={(e) => setD({ ...d, validade: e.target.value })} /></Field>
                </div>
                <Field label="Condições de pagamento">
                  <CampoVoz rows={2} valor={d.condicao} onChange={(v) => setD({ ...d, condicao: v })}
                    placeholder="Ex.: cinquenta por cento na aprovação e cinquenta por cento após a conclusão" />
                </Field>
                <Field label="Observações para o cliente">
                  <CampoVoz rows={3} valor={d.obs} onChange={(v) => setD({ ...d, obs: v })}
                    placeholder="Ex.: o orçamento inclui instalação e configuração; a infraestrutura elétrica deve estar disponível no local" />
                </Field>
              </Panel>
            ) : (
              <Panel className="px-5 py-4 text-[13px] text-slate-500 leading-relaxed">Válido até {dataBR(d.validade)} · {d.condicao}</Panel>
            )}
          </section>
        </div>

        <section className="lg:sticky lg:top-6">
          <Rotulo>Resumo</Rotulo>
          <Panel className="p-5">
            <div className="flex justify-between text-[14px] text-slate-500 mb-4"><span>Subtotal</span><span className="tabular-nums">{brl(somaItens(d.itens))}</span></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto"><Input type="number" min="0" value={d.desconto} onChange={(e) => setD({ ...d, desconto: Number(e.target.value) })} /></Field>
              <Field label="Acréscimo"><Input type="number" min="0" value={d.acrescimo} onChange={(e) => setD({ ...d, acrescimo: Number(e.target.value) })} /></Field>
            </div>
            <div className="flex justify-between items-baseline pt-4 mt-4 border-t border-slate-200">
              <span className="text-[14px] font-medium text-slate-600">Total</span>
              <span className="text-[26px] font-semibold text-slate-900 tracking-tight tabular-nums">{brl(totalDoc(d))}</span>
            </div>
            <Btn className="w-full mt-5" disabled={!d.clienteId || d.itens.length === 0} onClick={() => { salvarOrcamento(d); onFechar(); }}>
              {d.id ? "Salvar alterações" : "Criar orçamento"}
            </Btn>
            <p className="text-[12px] text-slate-400 text-center mt-3 leading-relaxed">Mudar o valor aqui não altera o preço do seu catálogo.</p>
          </Panel>
        </section>
      </div>

      <ClienteRapido aberto={novoCliente} onClose={() => setNovoCliente(false)}
        onSave={(novo) => { const id = salvarCliente(novo); if (id) escolherCliente(id); }} />
    </>
  );
}

/* Item livre: para o que é pontual e não vale cadastrar no catálogo.
   Usado no orçamento e nos adicionais da OS. */
function FormItemLivre({ onAdicionar, rotulo = "Adicionar ao orçamento" }) {
  const vazio = { nome: "", qtd: 1, unidade: "unidade", preco: 0, obs: "" };
  const [f, setF] = useState(vazio);
  const set = (k, v) => setF({ ...f, [k]: v });
  const total = (Number(f.qtd) || 0) * (Number(f.preco) || 0);

  return (
    <div className="space-y-4">
      <Field label="O que é">
        <CampoVoz rows={2} valor={f.nome} onChange={(v) => set("nome", v)}
          placeholder="Ex.: adequação da infraestrutura elétrica existente" />
      </Field>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
        <Field label="Quantidade"><Input type="number" min="0" step="0.5" value={f.qtd} onChange={(e) => set("qtd", num(e.target.value))} /></Field>
        <Field label="Unidade">
          <Select value={f.unidade} onChange={(e) => set("unidade", e.target.value)}>
            {UNIDADES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </Select>
        </Field>
        <Field label="Preço unitário"><Input type="number" min="0" step="0.01" value={f.preco} onChange={(e) => set("preco", num(e.target.value))} /></Field>
        <div className="text-right pb-3">
          <p className="text-[12px] text-slate-400">Total</p>
          <p className="text-[19px] font-semibold text-slate-900 tabular-nums">{brl(total)}</p>
        </div>
      </div>
      <Field label="Observação" hint="Opcional. Aparece abaixo do item.">
        <CampoVoz rows={2} valor={f.obs} onChange={(v) => set("obs", v)} placeholder="Detalhe que o cliente precisa saber sobre este item" />
      </Field>
      <Btn className="w-full" icon={Plus} disabled={!f.nome.trim() || total <= 0}
        onClick={() => { onAdicionar(f); setF(vazio); }}>{rotulo}</Btn>
    </div>
  );
}

/* ====================================================== Ordens de serviço */
function OrdensServico(p) {
  const { ordens, nomeCliente, osAberta, setOsAberta, clientes, salvarOS, empresa, orcamentos, lancamentos, abrirOS, permitido } = p;
  const soMinhas = !permitido("todasOS");
  const [filtro, setFiltro] = useState("dia");
  const [criando, setCriando] = useState(false);

  if (osAberta) {
    const os = ordens.find((o) => o.id === osAberta);
    if (os) return <OSDetalhe {...p} os={os} />;
  }

  const viva = (o) => o.status !== "concluida" && o.status !== "cancelada";
  const hoje = ordens.filter((o) => viva(o) && o.data === HOJE).sort((a, b) => (a.hora || "").localeCompare(b.hora || ""));
  const proximos = ordens.filter((o) => viva(o) && o.data > HOJE).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  const atrasadas = ordens.filter((o) => viva(o) && o.data && o.data < HOJE);
  const semData = ordens.filter((o) => viva(o) && !o.data);
  const concluidas = ordens.filter((o) => o.status === "concluida").sort((a, b) => (b.data || "").localeCompare(a.data || ""));

  const Cartao = ({ os }) => {
    const orc = orcamentos.find((o) => o.id === os.orcamentoId);
    const cob = lancamentos.find((l) => l.origemTipo === "os" && l.origemId === os.id);
    return (
      <Linha>
        <div className="flex items-start justify-between gap-4">
          <button onClick={() => abrirOS(os.id)} className={cx("min-w-0 text-left flex-1", ring)}>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p>
              {os.localServico && <span className="text-[13px] text-slate-400">· {os.localServico}</span>}
            </div>
            <p className="text-[13px] text-slate-500 truncate">{os.numero} · {resumoOS(os)}</p>
            <p className="text-[12px] text-slate-400 mt-1">{os.data ? `${dataBR(os.data)}${os.hora ? ` às ${os.hora}` : ""}` : "Sem agendamento"}{empresa.temEquipe ? ` · ${os.responsavel}` : ""}</p>
            <div className="mt-2.5">
              <Trilha etapas={[
                { label: orc ? orc.numero : "OS direta", feito: true },
                { label: "Agendada", feito: !!os.data },
                { label: "Concluída", feito: os.status === "concluida" },
                { label: cob?.pago ? "Recebido" : "Cobrança", feito: !!cob?.pago, alerta: !!cob && !cob.pago },
              ]} />
            </div>
          </button>
          <div className="text-right shrink-0">
            {permitido("verValores") && <p className="text-[16px] font-semibold text-slate-900 tabular-nums">{brl(totalOS(os))}</p>}
            <Pill tone={ST_OS[os.status].tone} className="mt-1.5">{ST_OS[os.status].label}</Pill>
            <div className="mt-2 text-[12px] flex justify-end"><Endereco valor={os.local} local={os.localServico} compacto className="max-w-[220px]" /></div>
          </div>
        </div>
      </Linha>
    );
  };

  const Bloco = ({ titulo, itens, vazio }) => (
    <section className="mb-8">
      <Rotulo>{titulo}{itens.length > 0 ? ` · ${itens.length}` : ""}</Rotulo>
      <Panel className="divide-y divide-slate-100 overflow-hidden">
        {itens.length === 0 ? <Empty icon={ClipboardList} title={vazio} /> : itens.map((os) => <Cartao key={os.id} os={os} />)}
      </Panel>
    </section>
  );

  return (
    <>
      <PageHead title={soMinhas ? "Minhas ordens de serviço" : "Ordens de serviço"} sub={`${diaSemana(HOJE)}, ${dataBR(HOJE)}`}
        action={permitido("todasOS") ? <Btn icon={Plus} onClick={() => setCriando(true)}>Nova OS</Btn> : null} />
      <Tabs valor={filtro} onChange={setFiltro} className="mb-5"
        opcoes={[{ id: "dia", label: "Meu dia" }, { id: "abertas", label: "Todas em aberto" }, { id: "concluidas", label: "Concluídas" }]} />

      {filtro === "dia" && (
        <>
          {atrasadas.length > 0 && <Bloco titulo="Atrasadas" itens={atrasadas} />}
          <Bloco titulo="Hoje" itens={hoje} vazio="Nenhum atendimento marcado para hoje" />
          <Bloco titulo="Próximos atendimentos" itens={proximos.slice(0, 6)} vazio="Nada agendado à frente" />
          <Bloco titulo="Aguardando agendamento" itens={semData} vazio="Tudo agendado" />
        </>
      )}
      {filtro === "abertas" && <Bloco titulo="Em aberto" itens={[...atrasadas, ...hoje, ...proximos, ...semData]} vazio="Nenhuma ordem em aberto" />}
      {filtro === "concluidas" && <Bloco titulo="Concluídas" itens={concluidas} vazio="Nenhuma ordem concluída ainda" />}

      {criando && <NovaOS {...p} onClose={() => setCriando(false)} />}
    </>
  );
}

/* Abertura de OS pensada para o campo: descrever o problema já basta.
   O catálogo é atalho, não obrigação. */
function NovaOS({ onClose, clientes, servicos, produtos, empresa, salvarOS, salvarCliente, equipe = [], usuarioAtual }) {
  const [novoCliente, setNovoCliente] = useState(false);
  const [f, setF] = useState({
    clienteId: "", descricaoLivre: "", local: "", localServico: "",
    itens: [], data: "", hora: "09:00", responsavel: empresa.responsavel, responsavelId: usuarioAtual?.id || null, obs: "",
  });
  const [catalogo, setCatalogo] = useState(false);
  const [abaCat, setAbaCat] = useState("servicos");
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const escolherCliente = (id) => {
    const cl = clientes.find((x) => x.id === id);
    setF((s) => ({ ...s, clienteId: id, local: cl?.endereco || s.local }));
  };
  const pronto = f.clienteId && (f.descricaoLivre.trim() || f.itens.length > 0);

  const criar = () => {
    salvarOS({
      ...f, status: f.data ? "agendada" : "aguardando", checklist: [],
      responsavel: f.responsavel || empresa.responsavel,
    });
    onClose();
  };

  return (
    <>
      <Modal open onClose={onClose} wide title="Nova ordem de serviço" sub="Descreva o que precisa ser feito. Escolher serviço do catálogo é opcional."
        footer={<><Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn disabled={!pronto} onClick={criar}>Abrir ordem de serviço</Btn></>}>

        <Field label="Cliente">
          <div className="flex gap-2 flex-wrap sm:flex-nowrap">
            <Select value={f.clienteId} onChange={(e) => escolherCliente(e.target.value)} className="flex-1">
              <option value="">Selecione um cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.fantasia || c.nome}</option>)}
            </Select>
            <Btn variant="soft" icon={Plus} onClick={() => setNovoCliente(true)} className="shrink-0">Cadastrar novo cliente</Btn>
          </div>
        </Field>

        <Field label="O que precisa ser feito?" hint="Fale ou escreva com suas palavras. Isso já é suficiente para abrir a ordem.">
          <CampoVoz rows={4} valor={f.descricaoLivre} onChange={(v) => set("descricaoLivre", v)}
            placeholder="Ex.: cliente informou que o portão está abrindo sozinho. Verificar central, sensores, controles cadastrados e alimentação." />
        </Field>

        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Endereço do atendimento"><Input value={f.local} onChange={(e) => set("local", e.target.value)} placeholder="Rua, número, bairro" /></Field>
          <Field label="Local do serviço" hint="Ex.: Portaria, Apto 304, Loja 4."><Input value={f.localServico} onChange={(e) => set("localServico", e.target.value)} /></Field>
        </div>

        <div>
          <button onClick={() => setCatalogo((v) => !v)} className={cx("text-[13px] font-medium text-teal-800 hover:underline py-1", ring)}>
            {catalogo ? "Ocultar catálogo" : "Adicionar serviços ou produtos do catálogo (opcional)"}
          </button>
          {f.itens.length > 0 && (
            <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100 mt-3">
              {f.itens.map((i, idx) => (
                <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-slate-800 truncate">{i.nome}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" min="0" step="0.5" value={i.qtd} aria-label="Quantidade"
                        onChange={(e) => set("itens", f.itens.map((x, k) => (k === idx ? { ...x, qtd: num(e.target.value) } : x)))}
                        className="w-16 rounded-lg ring-1 ring-slate-200 px-2 py-1.5 text-[13px]" />
                      <span className="text-[12px] text-slate-400">{unidadeLabel(i.unidade)} × {brl(i.preco)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 tabular-nums">{brl(i.qtd * i.preco)}</span>
                    <button onClick={() => set("itens", f.itens.filter((_, k) => k !== idx))} aria-label={`Remover ${i.nome}`}
                      className={cx("p-2 rounded-lg text-slate-300 hover:text-rose-600", ring)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {catalogo && (
            <div className="mt-3 space-y-3">
              <Tabs valor={abaCat} onChange={setAbaCat} opcoes={[{ id: "servicos", label: "Serviços" }, { id: "produtos", label: "Produtos" }]} />
              <div className="flex flex-wrap gap-2">
                {(abaCat === "servicos" ? servicos : produtos).filter((x) => x.ativo).map((x) => (
                  <button key={x.id} onClick={() => set("itens", [...f.itens, abaCat === "servicos" ? itemServico(x, 1) : itemProduto(x, 1)])}
                    className={cx("inline-flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-[13px] text-slate-700 hover:bg-white hover:ring-teal-500", ring)}>
                    <Plus className="w-3.5 h-3.5 text-teal-700" />{x.nome}<span className="text-slate-400">{brlCurto(x.preco)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Data" hint="Deixe vazio para agendar depois."><Input type="date" value={f.data} onChange={(e) => set("data", e.target.value)} /></Field>
          {f.data && <Field label="Horário"><Input type="time" value={f.hora} onChange={(e) => set("hora", e.target.value)} /></Field>}
        </div>
        {empresa.temEquipe && (
          <Field label="Responsável" hint="A ordem aparece em 'Minhas OS' de quem for atribuído.">
            <Select value={f.responsavelId || ""} onChange={(e) => {
              const m = equipe.find((x) => x.usuarioId === e.target.value);
              setF((st) => ({ ...st, responsavelId: e.target.value || null, responsavel: m?.usuario?.nome || st.responsavel }));
            }}>
              <option value="">Selecione</option>
              {equipe.filter((m) => m.ativo).map((m) => (
                <option key={m.usuarioId} value={m.usuarioId}>{m.usuario?.nome}{m.papel === "proprietario" ? " (proprietário)" : ""}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Observações antes do atendimento" hint="Opcional. O que a equipe precisa saber antes de ir.">
          <CampoVoz rows={2} valor={f.obs} onChange={(v) => set("obs", v)} placeholder="Ex.: falar com o síndico antes de entrar" />
        </Field>
      </Modal>

      <ClienteRapido aberto={novoCliente} onClose={() => setNovoCliente(false)}
        onSave={(novo) => { const id = salvarCliente(novo); if (id) escolherCliente(id); }} />
    </>
  );
}

function OSDetalhe(p) {
  const { os, cliente, nomeCliente, setOsAberta, mudarStatusOS, setOrdens, servicos, produtos, orcamentos, setTela, setOrcamentoAberto,
    lancamentos, ordens, agendarOS, desagendarOS, empresa, pedirConfirmacao, garantias, finalizarOS, abrirGarantia, abrirOS,
    permitido, equipe, usuarioAtual, real, empresaId, aviso, papel, resolverPrecificacao } = p;
  const verValores = permitido("verValores");
  const [precosPendentes, setPrecosPendentes] = useState({});
  const [liberandoCobranca, setLiberandoCobranca] = useState(false);
  useEffect(() => {
    const prox = {};
    (os.itens || []).filter((i) => i.aguardandoValor).forEach((i) => { prox[i.id] = Number(i.preco || 0); });
    setPrecosPendentes(prox);
  }, [os.id, os.pendentePrecificacao, os.itens]);
  const c = cliente(os.clienteId);
  const [novoItem, setNovoItem] = useState(null);
  const [txtCheck, setTxtCheck] = useState("");
  const [agendando, setAgendando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const orc = orcamentos.find((o) => o.id === os.orcamentoId);
  const cobranca = lancamentos.find((l) => l.origemTipo === "os" && l.origemId === os.id);
  const gar = garantias.filter((g) => g.osId === os.id);
  const garantiaOrigem = os.garantiaId ? garantias.find((g) => g.id === os.garantiaId) : null;
  const osOrigem = os.osOrigemId ? ordens.find((o) => o.id === os.osOrigemId) : null;

  const persistTimer = useRef(null);
  const up = (patch) => {
    const next = { ...os, ...patch };
    setOrdens((l) => l.map((x) => (x.id === os.id ? { ...x, ...patch } : x)));
    if (real) {
      clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => { const tarefa = patch.fotos ? persistirFotosOSDB(os.id, patch.fotos, empresaId, usuarioAtual?.id) : persistirEdicaoOSDB(next, patch, empresaId, usuarioAtual?.id, papel); tarefa.then((r) => { if (r?.checklist) setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, checklist: r.checklist } : x)); if (r?.fotos) setOrdens((l) => l.map((x) => x.id === os.id ? { ...x, fotos: r.fotos } : x)); }).catch((e) => aviso(mensagemErro(e))); }, 500);
    }
  };
  const toggleCheck = (id) => up({ checklist: os.checklist.map((k) => (k.id === id ? { ...k, feito: !k.feito } : k)) });
  const addCheck = () => { if (!txtCheck.trim()) return; up({ checklist: [...os.checklist, { id: uid(), texto: txtCheck.trim(), feito: false }] }); setTxtCheck(""); };

  const custoTotal = somaCustos(os.itens) + (os.custosExtras || 0);
  const cobrado = totalOS(os);
  const margem = cobrado > 0 ? Math.round(((cobrado - custoTotal) / cobrado) * 100) : 0;

  const acoes = [];
  if (os.status === "aguardando") acoes.push({ label: "Agendar", icon: CalendarClock, fn: () => setAgendando(true), principal: true });
  if (os.status === "agendada") {
    acoes.push({ label: "Iniciar atendimento", fn: () => mudarStatusOS(os, "andamento"), principal: true });
    acoes.push({ label: "Reagendar", icon: CalendarClock, fn: () => setAgendando(true) });
  }
  if (os.status === "andamento") acoes.push({ label: "Finalizar atendimento", icon: Check, fn: () => setFinalizando(true), principal: true });

  return (
    <>
      <button onClick={() => setOsAberta(null)} className={cx("flex items-center gap-2 text-[14px] text-slate-500 mb-5 hover:text-slate-900 py-1", ring)}>
        <ArrowLeft className="w-4 h-4" /> Ordens de serviço
      </button>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em]">{os.numero}</h1>
          <Pill tone={ST_OS[os.status].tone}>{ST_OS[os.status].label}</Pill>
        </div>
        <div className="flex flex-wrap gap-2">
          {acoes.map((a) => <Btn key={a.label} size="sm" icon={a.icon} variant={a.principal ? "primary" : "soft"} onClick={a.fn}>{a.label}</Btn>)}
          {os.status !== "concluida" && os.status !== "cancelada" && (
            <Btn size="sm" variant="danger" onClick={() => pedirConfirmacao({
              titulo: `Cancelar a ${os.numero}?`, texto: "A ordem sai da agenda e da lista de trabalhos em aberto. O histórico continua disponível.",
              confirmar: "Cancelar ordem", acao: () => mudarStatusOS(os, "cancelada"),
            })}>Cancelar OS</Btn>
          )}
        </div>
      </div>

      <Panel className="px-5 py-4 mb-6">
        <Trilha etapas={[
          { label: "Criada", feito: true },
          { label: os.data ? `Agendada · ${dataBR(os.data)}` : "Sem agendamento", feito: !!os.data },
          { label: "Serviço concluído", feito: os.status === "concluida" },
          ...(verValores ? [
            { label: cobranca ? `Cobrança ${brl(cobranca.valor)}` : "Cobrança", feito: !!cobranca, alerta: !!cobranca && !cobranca.pago },
            { label: "Recebido", feito: !!cobranca?.pago, alerta: !!cobranca && !cobranca.pago },
          ] : []),
        ]} />
      </Panel>

      {verValores && cobranca && !cobranca.pago && (
        <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[14px] text-amber-900 flex items-center gap-2"><Receipt className="w-4 h-4 shrink-0" />
            Cobrança de {brl(cobranca.valor)} aguardando pagamento · vence {dataBR(cobranca.vencimento)}</p>
          <Btn size="sm" variant="soft" icon={Wallet} onClick={() => setTela("financeiro")}>Ver no financeiro</Btn>
        </div>
      )}
      {verValores && cobranca?.pago && (
        <div className="rounded-2xl bg-emerald-50 ring-1 ring-emerald-200/70 px-5 py-4 mb-6 flex items-center gap-2">
          <Banknote className="w-4 h-4 text-emerald-700 shrink-0" />
          <p className="text-[14px] text-emerald-900">Pagamento de {brl(cobranca.valor)} recebido em {dataBR(cobranca.pagoEm)}{cobranca.forma ? ` via ${cobranca.forma}` : ""}.</p>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
        <div className="lg:col-span-2 space-y-7">
          <section>
            <Rotulo acao={os.data ? (
              <button onClick={() => pedirConfirmacao({ titulo: "Remover agendamento?", texto: "A ordem volta para a lista de trabalhos sem data.", confirmar: "Remover", acao: () => desagendarOS(os.id) })}
                className="text-[13px] font-medium text-slate-500 hover:text-rose-700">Remover agendamento</button>) : null}>Agendamento e local</Rotulo>
            <Panel className="p-5 space-y-5">
              {os.data ? (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="text-center px-4 py-2 rounded-xl bg-slate-900 text-white">
                      <p className="text-[11px] uppercase tracking-wide text-slate-300">{diaCurto(os.data)}</p>
                      <p className="text-xl font-semibold leading-tight tabular-nums">{os.data.slice(8)}</p>
                    </div>
                    <div>
                      <p className="text-[15px] font-medium text-slate-900">{diaSemana(os.data)}, {dataBR(os.data)}{os.hora ? ` às ${os.hora}` : ""}</p>
                      {empresa.temEquipe && <p className="text-[13px] text-slate-500">Responsável: {os.responsavel}</p>}
                    </div>
                  </div>
                  <Btn size="sm" variant="soft" icon={CalendarClock} onClick={() => setAgendando(true)}>Alterar</Btn>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="text-[14px] text-slate-600">Esta ordem ainda não tem data definida.</p>
                  <Btn size="sm" icon={CalendarClock} onClick={() => setAgendando(true)}>Agendar atendimento</Btn>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-5 pt-1">
                <Field label="Endereço"><Input value={os.local} onChange={(e) => up({ local: e.target.value })} /></Field>
                <Field label="Local do serviço" hint="Ex.: Apto 304, Bloco B, Portaria, Loja 4."><Input value={os.localServico || ""} onChange={(e) => up({ localServico: e.target.value })} /></Field>
              </div>
              <a href={mapsUrl([os.localServico, os.local].filter(Boolean).join(", "))} target="_blank" rel="noreferrer"
                className={cx("flex items-center justify-center gap-2 w-full rounded-xl bg-slate-900 text-white py-3 text-[14px] font-medium hover:bg-slate-800", ring)}>
                <Navigation className="w-[18px] h-[18px]" />Abrir rota até o cliente
              </a>
            </Panel>
          </section>

          <section>
            <Rotulo acao={permitido("catalogo")
              ? <Btn size="sm" variant="soft" icon={Plus} onClick={() => setNovoItem("servicos")}>Adicionar</Btn>
              : null}>Serviços e materiais</Rotulo>
            <Panel className="overflow-hidden">
              {os.itens.length === 0 ? <Empty icon={Wrench} title="Nenhum item vinculado" sub="Adicione o que será executado neste atendimento." /> : (
                <>
                  <div className="divide-y divide-slate-100">
                    {os.itens.map((i) => (
                      <div key={i.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-[15px] text-slate-800 truncate">{i.nome}</p>
                          <p className="text-[12px] text-slate-400">
                            {i.qtd} {unidadeLabel(i.unidade)}{verValores ? ` × ${brl(i.preco)}` : ""}{i.tipo === "produto" ? " · produto" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {verValores && <span className="font-semibold text-slate-900 tabular-nums">{brl(i.qtd * i.preco)}</span>}
                          {os.status !== "concluida" && (
                            <button onClick={() => up({ itens: os.itens.filter((x) => x.id !== i.id) })} aria-label={`Remover ${i.nome}`}
                              className={cx("p-1.5 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50", ring)}><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </div>
                    ))}
                    {(os.adicionais || []).map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-[15px] text-slate-800 truncate">{a.nome}</p>
                          <p className="text-[12px] text-amber-700">
                            adicional durante a execução · {a.qtd} {unidadeLabel(a.unidade)}{verValores ? ` × ${brl(a.preco)}` : ""}
                            {!verValores && a.aguardandoValor ? " · valor a definir pelo proprietário" : ""}
                          </p>
                        </div>
                        {verValores && <span className="font-semibold text-slate-900 tabular-nums">{brl(a.qtd * a.preco)}</span>}
                      </div>
                    ))}
                    {os.valorAdicional > 0 && (
                      <div className="flex items-center justify-between gap-3 px-5 py-3.5">
                        <div><p className="text-[15px] text-slate-800">{os.descricaoAdicional || "Valor adicional"}</p>
                          <p className="text-[12px] text-amber-700">adicional durante a execução</p></div>
                        <span className="font-semibold text-slate-900 tabular-nums">{brl(os.valorAdicional)}</span>
                      </div>
                    )}
                  </div>
                  {verValores && (
                    <div className="flex justify-between items-baseline px-5 py-4 border-t border-slate-100 bg-slate-50/60">
                      <span className="text-[14px] font-medium text-slate-600">Total do atendimento</span>
                      <span className="text-xl font-semibold text-slate-900 tabular-nums">{brl(cobrado)}</span>
                    </div>
                  )}
                </>
              )}
            </Panel>
            {verValores && os.pendentePrecificacao && (
              <div className="mt-4 rounded-2xl bg-amber-50 ring-1 ring-amber-200/70 p-4 sm:p-5">
                <div className="flex items-start gap-3 mb-4">
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[14px] font-semibold text-amber-950">Há adicionais aguardando valor</p>
                    <p className="text-[12.5px] text-amber-900/80 mt-1">O técnico concluiu o atendimento sem definir preço. Informe os valores abaixo para liberar a cobrança.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {(os.itens || []).filter((i) => i.aguardandoValor).map((i) => (
                    <div key={i.id} className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 rounded-xl bg-white/80 px-3.5 py-3 ring-1 ring-amber-200/70">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-slate-800 truncate">{i.nome}</p>
                        <p className="text-[12px] text-slate-500">{i.qtd} {unidadeLabel(i.unidade)} · informado pelo técnico</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[12px] text-slate-500">R$</span>
                        <input type="number" min="0" step="0.01" value={precosPendentes[i.id] ?? 0}
                          onChange={(e) => setPrecosPendentes((v) => ({ ...v, [i.id]: Number(e.target.value) }))}
                          aria-label={`Valor de ${i.nome}`}
                          className="w-28 rounded-lg bg-white ring-1 ring-slate-200 px-3 py-2 text-right text-[14px] tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-500" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end mt-4">
                  <Btn disabled={liberandoCobranca || (os.itens || []).filter((i)=>i.aguardandoValor).some((i)=>Number(precosPendentes[i.id]) < 0)}
                    icon={liberandoCobranca ? Loader2 : Receipt}
                    onClick={async () => {
                      setLiberandoCobranca(true);
                      const itens = (os.itens || []).map((i) => i.aguardandoValor ? { ...i, preco: Number(precosPendentes[i.id] || 0) } : i);
                      await resolverPrecificacao?.(os.id, itens);
                      setLiberandoCobranca(false);
                    }}>
                    {liberandoCobranca ? "Liberando…" : "Definir valores e gerar cobrança"}
                  </Btn>
                </div>
              </div>
            )}
          </section>

          <section>
            <Rotulo>O que precisa ser feito</Rotulo>
            <Panel className="p-5">
              <CampoVoz rows={3} valor={os.descricaoLivre || ""} onChange={(v) => up({ descricaoLivre: v })}
                placeholder="Ex.: cliente relata que o portão abre sozinho durante a madrugada. Verificar central, sensores e controles." />
            </Panel>
          </section>

          <section>
            <Rotulo>Observações antes do atendimento</Rotulo>
            <Panel className="p-5">
              <CampoVoz rows={3} valor={os.obs} onChange={(v) => up({ obs: v })}
                placeholder="Ex.: falar com o síndico antes de entrar; o equipamento fica na portaria do bloco B" />
              {c?.obs && <p className="text-[12.5px] text-amber-800 bg-amber-50 ring-1 ring-amber-200/70 rounded-xl px-3.5 py-3 mt-3 leading-relaxed">Do cadastro do cliente: {c.obs}</p>}
            </Panel>
          </section>

          {os.emGarantia && (
            <section>
              <Rotulo>Atendimento em garantia</Rotulo>
              <Panel className="p-5 space-y-4">
                {garantiaOrigem && (
                  <div className="rounded-xl bg-teal-50 ring-1 ring-teal-200/70 p-4 space-y-1.5">
                    <p className="text-[14px] font-medium text-teal-900">{garantiaOrigem.descricao}</p>
                    <p className="text-[13px] text-teal-900/80">
                      Executado em {dataBR(garantiaOrigem.inicio)}
                      {garantiaOrigem.local ? ` · ${garantiaOrigem.local}` : ""}
                    </p>
                    <p className="text-[13px] text-teal-900/80">
                      Garantia até {dataBR(garantiaOrigem.ate)} · {statusGarantia(garantiaOrigem).detalhe}
                    </p>
                    {osOrigem && <p className="text-[12px] text-teal-900/70">Ordem original: {osOrigem.numero}</p>}
                  </div>
                )}
                <Field label="Problema relatado pelo cliente">
                  <CampoVoz rows={3} valor={os.relatoProblema || ""} onChange={(v) => up({ relatoProblema: v })}
                    placeholder="O que o cliente relatou ao acionar a garantia" />
                </Field>
                {osOrigem?.relato && permitido("garantias") && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1.5">Relato do serviço original</p>
                    <p className="text-[13.5px] text-slate-600 whitespace-pre-line leading-relaxed">{osOrigem.relato}</p>
                  </div>
                )}
              </Panel>
            </section>
          )}

          <section>
            <Rotulo acao={os.relato ? <span className="text-[12px] text-slate-400">salvo automaticamente</span> : null}>O que foi feito</Rotulo>
            <Panel className="p-5">
              <BlocoRelato valor={os.relato || ""} onChange={(v) => up({ relato: v })}
                placeholder="Ex.: cheguei no local e identifiquei defeito na fonte da fechadura. Substituí a fonte, recadastrei três usuários e realizei os testes." />
              {os.status !== "concluida" && (
                <p className="text-[12.5px] text-slate-400 mt-3 leading-relaxed">
                  Você pode registrar aqui durante o atendimento. Ao finalizar, este texto já vem preenchido.
                </p>
              )}
            </Panel>
          </section>

          <section>
            <Rotulo>Checklist do atendimento</Rotulo>
            <Panel className="p-5">
              {os.checklist.length > 0 && (
                <div className="space-y-0.5 mb-4">
                  {os.checklist.map((k) => (
                    <button key={k.id} onClick={() => toggleCheck(k.id)} aria-pressed={k.feito} className={cx("w-full flex items-center gap-3 py-2.5 text-left group", ring)}>
                      {k.feito ? <CheckCircle2 className="w-5 h-5 text-teal-700 shrink-0" /> : <Circle className="w-5 h-5 text-slate-300 shrink-0 group-hover:text-slate-400" />}
                      <span className={cx("text-[14px]", k.feito ? "text-slate-400 line-through" : "text-slate-700")}>{k.texto}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input value={txtCheck} onChange={(e) => setTxtCheck(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCheck()} placeholder="Adicionar item ao checklist" aria-label="Novo item do checklist" />
                <Btn variant="soft" icon={Plus} onClick={addCheck} title="Adicionar item" />
              </div>
            </Panel>
          </section>

          {os.fotos?.length > 0 && (
            <section>
              <Rotulo>Fotos do atendimento</Rotulo>
              <Panel className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {os.fotos.map((f) => (
                  <div key={f.id} className="rounded-xl overflow-hidden ring-1 ring-slate-200">
                    {f.url ? <img src={f.url} alt={f.categoria} className="w-full h-28 object-cover" /> : <div className="h-28 bg-slate-100" />}
                    <p className="text-[11px] text-slate-500 px-2 py-1.5 truncate">{f.categoria}</p>
                  </div>
                ))}
              </Panel>
            </section>
          )}
        </div>

        <div className="space-y-6">
          <section>
            <Rotulo>Cliente</Rotulo>
            <Panel className="p-5">
              <div className="flex items-center gap-3">
                <Avatar nome={c?.nome} tipo={c?.tipo} />
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{nomeCliente(os.clienteId)}</p>
                  <p className="text-[13px] text-slate-500">{c?.telefone}</p>
                </div>
              </div>
              <div className="mt-3 text-[13px]"><Endereco valor={os.local} local={os.localServico} /></div>
              {c?.whatsapp && (
                <Btn variant="soft" size="sm" icon={Share2} className="w-full mt-4"
                  onClick={() => window.open(`https://wa.me/55${soDigitos(c.whatsapp)}?text=${encodeURIComponent(`Olá! Confirmando nosso atendimento${os.data ? ` dia ${dataBR(os.data)}${os.hora ? ` às ${os.hora}` : ""}` : ""}.`)}`, "_blank")}>
                  Confirmar com o cliente
                </Btn>
              )}
              {orc && permitido("orcamentos") && (
                <button onClick={() => { setTela("orcamentos"); setOrcamentoAberto(orc.id); }} className={cx("w-full text-[13px] font-medium text-teal-800 mt-3 py-2 hover:underline", ring)}>
                  Ver orçamento {orc.numero}
                </button>
              )}
              {!permitido("clientes") && (
                <p className="text-[12px] text-slate-400 mt-4 leading-relaxed">
                  Estes são os dados necessários para este atendimento. A carteira de clientes da empresa fica com o proprietário.
                </p>
              )}
            </Panel>
          </section>

          {verValores && os.status === "concluida" && (
            <section>
              <Rotulo>Resultado deste serviço</Rotulo>
              <Panel className="p-5 space-y-3 text-[14px]">
                <div className="flex justify-between"><span className="text-slate-500">Cobrado</span><span className="font-medium tabular-nums">{brl(cobrado)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Custo de itens</span><span className="tabular-nums">− {brl(somaCustos(os.itens))}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Outros custos</span><span className="tabular-nums">− {brl(os.custosExtras || 0)}</span></div>
                <div className="flex justify-between pt-3 border-t border-slate-100">
                  <span className="font-medium text-slate-700">Resultado bruto</span>
                  <span className={cx("font-semibold tabular-nums", cobrado - custoTotal >= 0 ? "text-emerald-700" : "text-rose-700")}>{brl(cobrado - custoTotal)}</span>
                </div>
                <p className="text-[12px] text-slate-400">Margem de {margem}% sobre o valor cobrado.</p>
              </Panel>
            </section>
          )}

          {gar.length > 0 && permitido("garantias") && (
            <section>
              <Rotulo>Garantias geradas</Rotulo>
              <Panel className="p-5 space-y-3">
                {gar.map((g) => {
                  const st = statusGarantia(g);
                  return (
                    <button key={g.id} onClick={() => abrirGarantia(g.id)} className={cx("w-full flex items-start justify-between gap-3 text-left", ring)}>
                      <div className="min-w-0">
                        <p className="text-[13.5px] text-slate-800 truncate">{g.descricao}</p>
                        <p className="text-[12px] text-slate-400">{g.tipo === "servico" ? "Serviço" : "Fabricante"}{g.serie ? ` · série ${g.serie}` : ""} · {st.detalhe}</p>
                      </div>
                      <span className="text-[12px] text-slate-500 shrink-0 tabular-nums">até {dataBR(g.ate)}</span>
                    </button>
                  );
                })}
              </Panel>
            </section>
          )}

          <section>
            <Rotulo>Histórico</Rotulo>
            <Panel className="p-5">
              <div className="space-y-3.5">
                {os.historico.map((h) => (
                  <div key={h.id} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-teal-600 mt-2 shrink-0" />
                    <div><p className="text-[13.5px] text-slate-700 leading-snug">{h.texto}</p><p className="text-[12px] text-slate-400 mt-0.5">{dataBR(h.quando)}</p></div>
                  </div>
                ))}
              </div>
            </Panel>
          </section>
        </div>
      </div>

      <AgendarModal os={agendando ? os : null} onClose={() => setAgendando(false)} onSalvar={agendarOS} empresa={empresa} diaSugerido={HOJE} equipe={equipe} />

      {novoItem && (
        <Modal open onClose={() => setNovoItem(null)} title="Adicionar ao atendimento" sub="Do seu catálogo" wide>
          <Tabs valor={novoItem} onChange={setNovoItem} opcoes={[{ id: "servicos", label: "Serviços" }, { id: "produtos", label: "Produtos" }]} />
          <div className="space-y-2">
            {(novoItem === "servicos" ? servicos.filter((s) => s.ativo) : produtos.filter((x) => x.ativo)).map((x) => (
              <button key={x.id} onClick={() => { up({ itens: [...os.itens, novoItem === "servicos" ? itemServico(x, 1) : itemProduto(x, 1)] }); setNovoItem(null); }}
                className={cx("w-full flex items-center justify-between gap-4 rounded-xl ring-1 ring-slate-200 px-4 py-3.5 text-left hover:ring-teal-500", ring)}>
                <div><p className="font-medium text-slate-800">{x.nome}</p><p className="text-[12px] text-slate-400">{x.categoria || [x.marca, x.modelo].filter(Boolean).join(" ")}</p></div>
                <div className="text-right"><p className="font-semibold text-slate-900 tabular-nums">{brl(x.preco)}</p><p className="text-[12px] text-slate-400">por {unidadeLabel(x.unidade)}</p></div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {finalizando && <FinalizarAtendimento os={os} onClose={() => setFinalizando(false)} servicos={servicos} produtos={produtos}
        onSalvarParcial={(patch) => up(patch)} onFinalizar={(extras) => { finalizarOS(os.id, extras); setFinalizando(false); }} jaConcluida={os.status === "concluida"} verValores={verValores} />}
    </>
  );
}

/* Relato com ditado em destaque + organização opcional por IA (não inventa nada). */
function BlocoRelato({ valor, onChange, placeholder, destaque = true, rows = 5 }) {
  const [organizando, setOrganizando] = useState(false);
  const [erro, setErro] = useState(null);
  const organizar = async () => {
    setOrganizando(true); setErro(null);
    try { const r = await chamarIA(promptRelato(valor)); if (r?.texto) onChange(r.texto); }
    catch { setErro("Não consegui organizar agora. Seu relato continua salvo exatamente como você falou."); }
    setOrganizando(false);
  };
  return (
    <div>
      <CampoVoz rows={rows} destaque={destaque} valor={valor} onChange={onChange} placeholder={placeholder}
        dica="Fale, revise e corrija à vontade antes de salvar." />
      {valor.trim() && (
        <Btn size="sm" variant="soft" className="mt-2" icon={organizando ? Loader2 : Sparkles} disabled={organizando} onClick={organizar}>
          {organizando ? "Organizando…" : "Organizar relato"}
        </Btn>
      )}
      {erro && <p className="text-[12.5px] text-rose-700 mt-2">{erro}</p>}
    </div>
  );
}

/* --------------------------------------------------- finalizar atendimento */
function FinalizarAtendimento({ os, onClose, onFinalizar, onSalvarParcial, produtos, jaConcluida, verValores = true }) {
  const [etapa, setEtapa] = useState(0);
  const [relato, setRelato] = useState(os.relato || "");
  const [materiais, setMateriais] = useState([]);
  const [temAdicional, setTemAdicional] = useState((os.adicionais || []).length > 0 ? true : null);
  const [adicionais, setAdicionais] = useState(os.adicionais || []);
  const [custosExtras, setCustosExtras] = useState(os.custosExtras || 0);
  const [temPendencia, setTemPendencia] = useState(os.pendencia ? true : null);
  const [pendencia, setPendencia] = useState(os.pendencia || "");
  const [fotos, setFotos] = useState(os.fotos || []);
  const [addProduto, setAddProduto] = useState(false);

  const anexarFotos = (ev, categoria) => {
    const arquivos = Array.from(ev.target.files || []);
    setFotos((f) => [...f, ...arquivos.map((a) => ({ id: uid(), nome: a.name, categoria, url: URL.createObjectURL(a), arquivo: a }))]);
  };

  const itensFinais = [...os.itens, ...materiais];
  const adicionaisFinais = temAdicional ? adicionais : [];
  const somaAdd = adicionaisFinais.reduce((t, a) => t + a.qtd * a.preco, 0);
  const total = itensFinais.reduce((t, i) => t + i.qtd * i.preco, 0) + somaAdd;
  const extras = {
    relato, itens: itensFinais, adicionais: adicionaisFinais, valorAdicional: 0, descricaoAdicional: "",
    custosExtras: num(custosExtras), pendencia: temPendencia ? pendencia : "", fotos,
  };

  /* edição do registro depois de concluído: sem etapas, só o que faz sentido rever */
  if (jaConcluida) {
    return (
      <Modal open onClose={onClose} wide title="Editar registro do atendimento" sub={os.numero}
        footer={<><Btn variant="ghost" onClick={onClose}>Fechar</Btn>
          <Btn onClick={() => { onSalvarParcial({ relato, fotos, pendencia }); onClose(); }}>Salvar alterações</Btn></>}>
        <Field label="O que foi feito">
          <BlocoRelato valor={relato} onChange={setRelato} placeholder="Descreva o atendimento" />
        </Field>
        <Field label="Pendência" hint="Opcional.">
          <CampoVoz rows={2} valor={pendencia} onChange={setPendencia} placeholder="O que ficou para depois" />
        </Field>
        <div>
          <p className="text-[13px] font-medium text-slate-600 mb-2">Fotos</p>
          <FotosDoAtendimento fotos={fotos} anexar={anexarFotos} />
        </div>
      </Modal>
    );
  }

  const SimNao = ({ valor, onChange, sim = "Sim", nao = "Não" }) => (
    <div className="flex gap-2">
      {[[false, nao], [true, sim]].map(([v, label]) => (
        <button key={label} onClick={() => onChange(v)} aria-pressed={valor === v}
          className={cx("flex-1 py-3.5 rounded-xl text-[15px] font-medium transition-colors", ring,
            valor === v ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50")}>
          {label}
        </button>
      ))}
    </div>
  );

  const etapas = [
    {
      titulo: "O que foi feito?",
      sub: "Fale naturalmente. Você revisa antes de salvar.",
      pular: null,
      conteudo: (
        <BlocoRelato valor={relato} onChange={setRelato}
          placeholder="Ex.: cheguei no local, identifiquei defeito na fonte da fechadura, fiz a substituição, recadastrei três usuários e testei o equipamento." />
      ),
    },
    {
      titulo: "Usou algum material?",
      sub: "Some apenas o que saiu do seu estoque ou foi comprado para este serviço.",
      pular: "Não usei material",
      conteudo: (
        <>
          {materiais.length > 0 && (
            <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100 mb-3">
              {materiais.map((m, idx) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] text-slate-800 truncate">{m.nome}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" min="1" value={m.qtd} aria-label="Quantidade"
                        onChange={(e) => setMateriais((l) => l.map((x, k) => (k === idx ? { ...x, qtd: Number(e.target.value) } : x)))}
                        className="w-16 rounded-lg ring-1 ring-slate-200 px-2 py-1.5 text-[13px]" />
                      <span className="text-[12px] text-slate-400">× {brl(m.preco)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 tabular-nums">{brl(m.qtd * m.preco)}</span>
                    <button onClick={() => setMateriais((l) => l.filter((_, k) => k !== idx))} aria-label="Remover material"
                      className={cx("p-2 rounded-lg text-slate-300 hover:text-rose-600", ring)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Btn variant="soft" icon={Package} onClick={() => setAddProduto(true)} className="w-full">Adicionar material do catálogo</Btn>
          <Field label="Outros custos que você teve" hint="Uso interno, entra no cálculo do resultado deste serviço." className="mt-5">
            <Input type="number" min="0" step="0.01" value={custosExtras} onChange={(e) => setCustosExtras(e.target.value)} className="max-w-[180px]" />
          </Field>
        </>
      ),
    },
    {
      titulo: "Quer registrar fotos?",
      sub: "Opcional. Ajuda em garantia e em qualquer dúvida futura do cliente.",
      pular: "Sem fotos",
      conteudo: <FotosDoAtendimento fotos={fotos} anexar={anexarFotos} />,
    },
    {
      titulo: "Houve valor adicional?",
      sub: "Trabalho que apareceu durante a execução e não estava na ordem.",
      pular: null,
      conteudo: (
        <>
          <SimNao valor={temAdicional} onChange={(v) => { setTemAdicional(v); if (!v) setAdicionais([]); }} />
          {temAdicional && (
            <div className="mt-5 space-y-4">
              {adicionais.length > 0 && (
                <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100">
                  {adicionais.map((a, idx) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[14px] text-slate-800 truncate">{a.nome}</p>
                        <p className="text-[12px] text-slate-400">{a.qtd} {unidadeLabel(a.unidade)} × {brl(a.preco)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 tabular-nums">{brl(a.qtd * a.preco)}</span>
                        <button onClick={() => setAdicionais((l) => l.filter((_, k) => k !== idx))} aria-label="Remover adicional"
                          className={cx("p-2 rounded-lg text-slate-300 hover:text-rose-600", ring)}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {verValores
                ? <FormItemLivre onAdicionar={(dados) => setAdicionais((l) => [...l, itemLivre(dados)])} rotulo="Adicionar cobrança extra" />
                : <FormAdicionalTecnico onAdicionar={(dados) => setAdicionais((l) => [...l, { ...itemLivre(dados), preco: 0, aguardandoValor: true }])} />}
              <p className="text-[12.5px] text-slate-400 leading-relaxed">
                Ex.: 2 horas de mão de obra a R$ 100/h, ou substituição emergencial de fonte por R$ 180.
                O orçamento original não é alterado — o adicional fica registrado como surgido durante a execução.
                {!verValores && " O valor é definido pelo proprietário depois."}
              </p>
            </div>
          )}
        </>
      ),
      bloqueio: temAdicional === null ? "Escolha sim ou não para seguir." : null,
    },
    {
      titulo: "Ficou alguma pendência?",
      sub: "Algo que ainda precisa ser resolvido neste cliente.",
      pular: null,
      conteudo: (
        <>
          <SimNao valor={temPendencia} onChange={setTemPendencia} />
          {temPendencia && (
            <div className="mt-5">
              <CampoVoz rows={3} valor={pendencia} onChange={setPendencia}
                placeholder="Ex.: falta trocar a fonte do portão, o cliente vai confirmar a data" />
            </div>
          )}
        </>
      ),
      bloqueio: temPendencia === null ? "Escolha sim ou não para seguir." : null,
    },
    {
      titulo: "Tudo certo para concluir?",
      sub: "Confira antes de finalizar.",
      pular: null,
      conteudo: (
        <div className="space-y-4">
          <div className="rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100">
            <div className="px-4 py-3.5">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] mb-1">O que foi feito</p>
              <p className="text-[14px] text-slate-700 whitespace-pre-line leading-relaxed">{relato.trim() || "Nenhum relato registrado."}</p>
            </div>
            <div className="px-4 py-3.5 flex justify-between gap-3">
              <span className="text-[14px] text-slate-500">Materiais utilizados</span>
              <span className="text-[14px] text-slate-800 text-right">{materiais.length ? materiais.map((m) => `${m.qtd}× ${m.nome}`).join(", ") : "nenhum"}</span>
            </div>
            <div className="px-4 py-3.5 flex justify-between gap-3">
              <span className="text-[14px] text-slate-500">Fotos</span>
              <span className="text-[14px] text-slate-800">{fotos.length || "nenhuma"}</span>
            </div>
            <div className="px-4 py-3.5 flex justify-between gap-3">
              <span className="text-[14px] text-slate-500">Valor adicional</span>
              <span className="text-[14px] text-slate-800 text-right">
                {adicionaisFinais.length === 0 ? "não houve"
                  : verValores ? `${brl(somaAdd)} · ${adicionaisFinais.map((a) => a.nome).join(", ")}`
                  : `${adicionaisFinais.map((a) => `${a.qtd} ${unidadeLabel(a.unidade)} · ${a.nome}`).join(", ")} · valor a definir`}
              </span>
            </div>
            <div className="px-4 py-3.5 flex justify-between gap-3">
              <span className="text-[14px] text-slate-500">Pendência</span>
              <span className="text-[14px] text-slate-800 text-right">{temPendencia && pendencia.trim() ? pendencia : "nenhuma"}</span>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 ring-1 ring-slate-200 p-4">
            {verValores ? (
              <div className="flex justify-between items-baseline">
                <span className="text-[14px] font-medium text-slate-600">{os.emGarantia ? "Atendimento em garantia" : "Total a cobrar"}</span>
                <span className="text-2xl font-semibold text-slate-900 tabular-nums">{os.emGarantia ? brl(0) : brl(total)}</span>
              </div>
            ) : (
              <p className="text-[14px] font-medium text-slate-700">Tudo pronto para concluir o atendimento.</p>
            )}
            <p className="text-[12.5px] text-slate-500 mt-2 leading-relaxed">
              Ao concluir, o ZiisTec {os.emGarantia ? "registra o atendimento no histórico do cliente sem gerar cobrança"
                : "cria a conta a receber com vencimento em 7 dias"}, guarda o relato, relaciona os materiais e registra as garantias dos serviços que têm prazo configurado.
            </p>
          </div>
        </div>
      ),
    },
  ];

  const atual = etapas[etapa];
  const ultima = etapa === etapas.length - 1;

  return (
    <>
      <Modal open onClose={onClose} wide title={atual.titulo} sub={atual.sub}
        footer={
          <div className="flex items-center justify-between gap-3 w-full">
            <Btn variant="ghost" onClick={() => (etapa === 0 ? onClose() : setEtapa(etapa - 1))}>{etapa === 0 ? "Cancelar" : "Voltar"}</Btn>
            <div className="flex items-center gap-3">
              {atual.pular && <Btn variant="ghost" onClick={() => setEtapa(etapa + 1)}>{atual.pular}</Btn>}
              {ultima
                ? <Btn icon={Check} onClick={() => onFinalizar(extras)}>Concluir atendimento</Btn>
                : <Btn icon={ArrowRight} disabled={!!atual.bloqueio} onClick={() => setEtapa(etapa + 1)}>Continuar</Btn>}
            </div>
          </div>
        }>
        <div className="flex items-center gap-1.5" aria-label={`Etapa ${etapa + 1} de ${etapas.length}`}>
          {etapas.map((_, i) => (
            <span key={i} className={cx("h-1 flex-1 rounded-full", i <= etapa ? "bg-teal-600" : "bg-slate-200")} aria-hidden="true" />
          ))}
        </div>
        {atual.conteudo}
        {atual.bloqueio && <p className="text-[12.5px] text-slate-400">{atual.bloqueio}</p>}
      </Modal>

      {addProduto && (
        <Modal open onClose={() => setAddProduto(false)} title="Materiais utilizados" sub="Do seu catálogo de produtos" wide>
          <div className="space-y-2">
            {produtos.filter((x) => x.ativo).map((x) => (
              <button key={x.id} onClick={() => { setMateriais((l) => [...l, itemProduto(x, 1)]); setAddProduto(false); }}
                className={cx("w-full flex items-center justify-between gap-4 rounded-xl ring-1 ring-slate-200 px-4 py-3.5 text-left hover:ring-teal-500", ring)}>
                <div><p className="font-medium text-slate-800">{x.nome}</p><p className="text-[12px] text-slate-400">{[x.marca, x.modelo].filter(Boolean).join(" ")}</p></div>
                <p className="font-semibold text-slate-900 tabular-nums">{brl(x.preco)}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function FotosDoAtendimento({ fotos, anexar }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {["Antes", "Depois", "Defeito encontrado", "Produto instalado", "Local"].map((cat) => (
          <label key={cat} className="inline-flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5 text-[13px] text-slate-700 cursor-pointer hover:bg-white hover:ring-teal-500">
            <Camera className="w-4 h-4 text-teal-700" />{cat}
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => anexar(e, cat)} />
          </label>
        ))}
      </div>
      {fotos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
          {fotos.map((f) => (
            <div key={f.id} className="rounded-xl overflow-hidden ring-1 ring-slate-200">
              {f.url ? <img src={f.url} alt={f.categoria} className="w-full h-20 object-cover" /> : <div className="h-20 bg-slate-100" />}
              <p className="text-[10px] text-slate-500 px-1.5 py-1 truncate">{f.categoria}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[12px] text-slate-400 mt-2 leading-relaxed">As fotos novas são enviadas com segurança para a empresa ao salvar ou concluir o atendimento.</p>
    </div>
  );
}

/* ================================================================= Compras */
function Compras({ compras, produtos, lancamentos, salvarCompra, compraAberta, setCompraAberta, setTela, pedirConfirmacao }) {
  const [form, setForm] = useState(null);
  const total = (c) => c.itens.reduce((t, i) => t + i.qtd * i.custo, 0);

  if (compraAberta) {
    const c = compras.find((x) => x.id === compraAberta);
    if (c) {
      const lanc = lancamentos.find((l) => l.id === c.lancamentoId);
      return (
        <>
          <button onClick={() => setCompraAberta(null)} className={cx("flex items-center gap-2 text-[14px] text-slate-500 mb-5 hover:text-slate-900 py-1", ring)}>
            <ArrowLeft className="w-4 h-4" /> Compras
          </button>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em]">{c.numero}</h1>
              <p className="text-[15px] text-slate-500 mt-1">{c.fornecedor} · {dataBR(c.data)}</p>
            </div>
            <Btn variant="soft" size="sm" icon={Pencil} onClick={() => setForm({ ...c, jaPago: Boolean(lanc?.pago) })}>Editar</Btn>
          </div>

          {lanc && (
            <div className={cx("rounded-2xl px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-3 ring-1",
              lanc.pago ? "bg-emerald-50 ring-emerald-200/70" : lanc.vencimento < HOJE ? "bg-rose-50 ring-rose-200/70" : "bg-amber-50 ring-amber-200/70")}>
              <p className={cx("text-[14px]", lanc.pago ? "text-emerald-900" : lanc.vencimento < HOJE ? "text-rose-900" : "text-amber-900")}>
                {lanc.pago ? `Pago em ${dataBR(lanc.pagoEm)}${lanc.forma ? ` via ${lanc.forma}` : ""}.`
                  : `Conta a pagar de ${brl(lanc.valor)} · vence ${dataBR(lanc.vencimento)}${lanc.vencimento < HOJE ? " · vencida" : ""}`}
              </p>
              <Btn size="sm" variant="soft" icon={Wallet} onClick={() => setTela("financeiro")}>Ver no financeiro</Btn>
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2">
              <Rotulo>Itens comprados</Rotulo>
              <Panel className="overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {c.itens.map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                      <div className="min-w-0"><p className="text-[15px] text-slate-800 truncate">{i.nome}</p>
                        <p className="text-[12px] text-slate-400">{i.qtd} × {brl(i.custo)}</p></div>
                      <span className="font-semibold text-slate-900 tabular-nums">{brl(i.qtd * i.custo)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-baseline px-5 py-4 border-t border-slate-100 bg-slate-50/60">
                  <span className="text-[14px] font-medium text-slate-600">Total da compra</span>
                  <span className="text-xl font-semibold text-slate-900 tabular-nums">{brl(total(c))}</span>
                </div>
              </Panel>
            </div>
            <div className="space-y-6">
              <section>
                <Rotulo>Pagamento</Rotulo>
                <Panel className="p-5 space-y-2.5 text-[14px]">
                  <div className="flex justify-between"><span className="text-slate-500">Forma</span><span>{c.forma}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Vencimento</span><span className="tabular-nums">{dataBR(c.vencimento)}</span></div>
                  {c.obs && <p className="text-[13px] text-slate-500 pt-2 border-t border-slate-100">{c.obs}</p>}
                </Panel>
              </section>
              <section>
                <Rotulo>Documentos</Rotulo>
                <Panel className="p-5">
                  {c.anexos?.length ? c.anexos.map((a) => (
                    <div key={a.id} className="flex items-center gap-2.5 text-[13.5px] text-slate-700 py-1.5">
                      <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="truncate text-teal-800 hover:underline" onClick={(e) => e.stopPropagation()}>{a.nome}</a> : <span className="truncate">{a.nome}</span>}
                    </div>
                  )) : <p className="text-[13.5px] text-slate-500">Nenhum documento anexado.</p>}
                  <p className="text-[12px] text-slate-400 mt-3 leading-relaxed">Documentos armazenados com acesso restrito à empresa.</p>
                </Panel>
              </section>
            </div>
          </div>
          <CompraForm form={form} setForm={setForm} onSave={salvarCompra} produtos={produtos} />
        </>
      );
    }
  }

  return (
    <>
      <PageHead title="Compras" sub="Materiais comprados de fornecedores. Cada compra vira uma conta a pagar."
        action={<Btn icon={Plus} onClick={() => setForm({ fornecedor: "", data: HOJE, itens: [], forma: "Boleto", vencimento: addDays(HOJE, 15), anexos: [], obs: "", jaPago: false })}>Nova compra</Btn>} />
      {compras.length === 0 ? (
        <Panel><Empty icon={ShoppingCart} title="Nenhuma compra registrada" sub="Registre a compra e o ZiisTec cria a conta a pagar automaticamente." /></Panel>
      ) : (
        <Panel className="divide-y divide-slate-100 overflow-hidden">
          {compras.map((c) => {
            const lanc = lancamentos.find((l) => l.id === c.lancamentoId);
            return (
              <Linha key={c.id} onClick={() => setCompraAberta(c.id)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{c.fornecedor}</p>
                    <p className="text-[13px] text-slate-500">{c.numero} · {dataBR(c.data)} · {c.itens.length} item{c.itens.length > 1 ? "ns" : ""}</p>
                    <div className="mt-2.5">
                      <Trilha etapas={[
                        { label: "Compra", feito: true },
                        { label: "Conta a pagar", feito: !!lanc, alerta: !!lanc && !lanc.pago },
                        { label: "Paga", feito: !!lanc?.pago, alerta: !!lanc && !lanc.pago },
                      ]} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[16px] font-semibold text-slate-900 tabular-nums">{brl(total(c))}</p>
                    {lanc && <Pill tone={statusLanc(lanc).tone} className="mt-1.5">{statusLanc(lanc).label}</Pill>}
                    {c.anexos?.length > 0 && <p className="text-[12px] text-slate-400 mt-1.5 flex items-center gap-1 justify-end"><Paperclip className="w-3 h-3" />{c.anexos.length}</p>}
                  </div>
                </div>
              </Linha>
            );
          })}
        </Panel>
      )}
      <CompraForm form={form} setForm={setForm} onSave={salvarCompra} produtos={produtos} />

      <Panel className="p-5 mt-8">
        <div className="flex items-start gap-3">
          <Paperclip className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[13px] text-slate-500 leading-relaxed">
            Boletos, notas e pedidos anexados manualmente ficam salvos no armazenamento privado da empresa. A importação automática pelo Gmail continua separada e só será ligada com autorização explícita da conta.
          </p>
        </div>
      </Panel>
    </>
  );
}

function CompraForm({ form, setForm, onSave, produtos }) {
  const [novoItem, setNovoItem] = useState(false);
  if (!form) return null;
  const set = (k, v) => setForm({ ...form, [k]: v });
  const total = form.itens.reduce((t, i) => t + i.qtd * i.custo, 0);
  const addDoCatalogo = (p) => { setForm({ ...form, itens: [...form.itens, { id: uid(), catalogoId: p.id, nome: `${p.nome}${p.marca ? " · " + p.marca : ""}${p.modelo ? " " + p.modelo : ""}`, qtd: 1, custo: p.custo }] }); setNovoItem(false); };
  const addLivre = () => setForm({ ...form, itens: [...form.itens, { id: uid(), nome: "", qtd: 1, custo: 0 }] });
  const upItem = (id, k, v) => setForm({ ...form, itens: form.itens.map((i) => (i.id === id ? { ...i, [k]: v } : i)) });

  return (
    <>
      <Modal open onClose={() => setForm(null)} wide title={form.id ? `Editar ${form.numero}` : "Nova compra"}
        sub={form.id ? "" : "Ao salvar, a conta a pagar é criada no financeiro."}
        footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
          <Btn disabled={!form.fornecedor || form.itens.length === 0} onClick={() => { onSave(form); setForm(null); }}>
            {form.id ? "Salvar alterações" : `Registrar compra de ${brl(total)}`}
          </Btn></>}>
        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Fornecedor"><Input value={form.fornecedor} onChange={(e) => set("fornecedor", e.target.value)} placeholder="Ex.: Distribuidora Eletro Sul" /></Field>
          <Field label="Data da compra"><Input type="date" value={form.data} onChange={(e) => set("data", e.target.value)} /></Field>
        </div>

        <div>
          <p className="text-[13px] font-medium text-slate-600 mb-2">Itens comprados</p>
          {form.itens.length > 0 && (
            <div className="rounded-xl ring-1 ring-slate-200 divide-y divide-slate-100 mb-3">
              {form.itens.map((i) => (
                <div key={i.id} className="p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Input value={i.nome} onChange={(e) => upItem(i.id, "nome", e.target.value)} placeholder="Descrição do item" className="text-[14px]" />
                    <button onClick={() => setForm({ ...form, itens: form.itens.filter((x) => x.id !== i.id) })} aria-label="Remover item"
                      className={cx("p-2 rounded-lg text-slate-300 hover:text-rose-600 shrink-0", ring)}><Trash2 className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-3 items-end mt-3">
                    <Field label="Quantidade"><Input type="number" min="1" value={i.qtd} onChange={(e) => upItem(i.id, "qtd", Number(e.target.value))} /></Field>
                    <Field label="Custo unitário"><Input type="number" min="0" value={i.custo} onChange={(e) => upItem(i.id, "custo", Number(e.target.value))} /></Field>
                    <div className="text-right pb-3"><p className="text-[12px] text-slate-400">Total</p>
                      <p className="text-[17px] font-semibold text-slate-900 tabular-nums">{brl(i.qtd * i.custo)}</p></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 flex-wrap">
            <Btn size="sm" variant="soft" icon={Package} onClick={() => setNovoItem(true)}>Do catálogo</Btn>
            <Btn size="sm" variant="soft" icon={Plus} onClick={addLivre}>Item avulso</Btn>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <Field label="Forma de pagamento">
            <Select value={form.forma} onChange={(e) => set("forma", e.target.value)}>{FORMAS.map((f) => <option key={f}>{f}</option>)}</Select>
          </Field>
          <Field label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => set("vencimento", e.target.value)} /></Field>
        </div>

        {!form.id && (
          <label className="flex items-center gap-3 py-1">
            <input type="checkbox" checked={form.jaPago} onChange={(e) => set("jaPago", e.target.checked)} className="w-5 h-5 rounded accent-teal-700" />
            <span className="text-[14px] text-slate-700">Já paguei esta compra</span>
          </label>
        )}

        <Field label="Documentos" hint="Boleto, nota ou pedido. PDF ou imagem, até 20 MB por arquivo.">
          <label className={cx("flex items-center gap-2 rounded-xl ring-1 ring-slate-200 px-3.5 py-3 text-[14px] text-slate-600 cursor-pointer hover:ring-teal-500")}>
            <Paperclip className="w-4 h-4 text-slate-400" />Anexar arquivo
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => set("anexos", [...(form.anexos || []), ...Array.from(e.target.files || []).map((a) => ({ id: uid(), nome: a.name, arquivo: a }))])} />
          </label>
          {form.anexos?.length > 0 && (
            <div className="mt-2 space-y-1">
              {form.anexos.map((a) => <p key={a.id} className="text-[13px] text-slate-600 truncate">{a.nome}</p>)}
            </div>
          )}
        </Field>

        <Field label="Observações"><Textarea rows={2} value={form.obs} onChange={(e) => set("obs", e.target.value)} placeholder="Ex.: número do pedido" /></Field>
      </Modal>

      {novoItem && (
        <Modal open onClose={() => setNovoItem(false)} title="Produtos do catálogo" wide>
          <div className="space-y-2">
            {produtos.filter((p) => p.ativo).map((p) => (
              <button key={p.id} onClick={() => addDoCatalogo(p)} className={cx("w-full flex items-center justify-between gap-4 rounded-xl ring-1 ring-slate-200 px-4 py-3.5 text-left hover:ring-teal-500", ring)}>
                <div><p className="font-medium text-slate-800">{p.nome}</p><p className="text-[12px] text-slate-400">{[p.marca, p.modelo].filter(Boolean).join(" ")}</p></div>
                <p className="text-[13px] text-slate-500 tabular-nums">custo {brl(p.custo)}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/* ============================================================== Financeiro */
function Financeiro({ lancamentos, setLancamentos, baixar, clientes, ordens, aviso, pedirConfirmacao, abrirOS, abrirCompra, compras, real, empresaId }) {
  const [mes, setMes] = useState(mesRef(HOJE));
  const [aba, setAba] = useState("receber");
  const [form, setForm] = useState(null);
  const [baixando, setBaixando] = useState(null);

  /* regra única de período: pago conta no mês do pagamento; em aberto conta no mês do vencimento */
  const noMes = (l) => mesRef(l.pago ? l.pagoEm : l.vencimento) === mes;
  const soma = (ls) => ls.reduce((t, l) => t + l.valor, 0);

  const recebidoMes = lancamentos.filter((l) => l.tipo === "receita" && l.pago && noMes(l));
  const aReceberMes = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && noMes(l));
  const pagoMes = lancamentos.filter((l) => l.tipo === "despesa" && l.pago && noMes(l));
  const aPagarMes = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && noMes(l));
  const vencidosReceber = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && l.vencimento < HOJE);
  const vencidosPagar = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && l.vencimento < HOJE);
  const resultado = soma(recebidoMes) - soma(pagoMes);

  const futuroReceber = soma(lancamentos.filter((l) => l.tipo === "receita" && !l.pago)) - soma(aReceberMes);
  const futuroPagar = soma(lancamentos.filter((l) => l.tipo === "despesa" && !l.pago)) - soma(aPagarMes);

  /* fluxo de caixa 30 dias: atraso fica separado, previsão olha somente para frente */
  const saldoAtual = soma(lancamentos.filter((l) => l.tipo === "receita" && l.pago)) - soma(lancamentos.filter((l) => l.tipo === "despesa" && l.pago));
  const limite = addDays(HOJE, 30);
  const entradas30 = lancamentos.filter((l) => l.tipo === "receita" && !l.pago && l.vencimento >= HOJE && l.vencimento <= limite);
  const saidas30 = lancamentos.filter((l) => l.tipo === "despesa" && !l.pago && l.vencimento >= HOJE && l.vencimento <= limite);
  const projetado = saldoAtual + soma(entradas30) - soma(saidas30);

  /* margem dos serviços: usa conclusão real e cobrança efetivamente gerada para a OS */
  const osConcluidasMes = ordens.filter((o) => o.status === "concluida" && mesRef(o.concluidaEm || o.data || HOJE) === mes);
  const cobrancaDaOS = (o) => lancamentos.find((l) => l.tipo === "receita" && l.origemTipo === "os" && l.origemId === o.id);
  const custoDiretoOS = (o) => {
    const materiaisJaNosItens = (o.itens || []).some((i) => i.materialRegistrado);
    const custoMateriais = materiaisJaNosItens ? 0 : (o.materiais || []).reduce((t, m) => t + (Number(m.qtd) || 0) * (Number(m.custo) || 0), 0);
    return somaCustos(o.itens) + custoMateriais + (Number(o.custosExtras) || 0);
  };
  const osFaturadasMes = osConcluidasMes.filter((o) => !!cobrancaDaOS(o));
  const faturadoServicos = osFaturadasMes.reduce((t, o) => t + (Number(cobrancaDaOS(o)?.valor) || 0), 0);
  const custoServicos = osFaturadasMes.reduce((t, o) => t + custoDiretoOS(o), 0);
  const margemServicos = faturadoServicos - custoServicos;
  const outrasDespesas = soma(pagoMes.filter((l) => l.origemTipo !== "compra"));
  const resultadoOperacional = margemServicos - outrasDespesas;
  const pendentesPrecoMes = osConcluidasMes.filter((o) => o.pendentePrecificacao);

  const mudarMes = (n) => {
    const [a, m] = mes.split("-").map(Number);
    const d = new Date(a, m - 1 + n, 1);
    setMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const ListaLanc = ({ itens, vazio }) => (
    <Panel className="divide-y divide-slate-100 overflow-hidden">
      {itens.length === 0 ? <Empty icon={Wallet} title="Nada neste período" sub={vazio} /> : itens.map((l) => {
        const st = statusLanc(l);
        return (
          <Linha key={l.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <button onClick={() => { if (l.origemTipo === "os") abrirOS(l.origemId); if (l.origemTipo === "compra") abrirCompra(l.origemId); }}
                  disabled={l.origemTipo === "manual"} className={cx("text-left", l.origemTipo !== "manual" && "hover:underline", ring)}>
                  <p className="font-medium text-slate-800 truncate">{l.descricao}</p>
                </button>
                <p className="text-[12px] text-slate-400">
                  {l.pago ? `${l.tipo === "receita" ? "Recebido" : "Pago"} em ${dataBR(l.pagoEm)}${l.forma ? ` · ${l.forma}` : ""}` : `Vence ${dataBR(l.vencimento)}`} · {l.categoria}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Pill tone={st.tone}>{st.label}</Pill>
                <span className={cx("font-semibold tabular-nums", l.tipo === "receita" ? "text-slate-900" : "text-slate-500")}>
                  {l.tipo === "despesa" ? "− " : ""}{brl(l.valor)}
                </span>
                {l.pago ? (
                  <Btn size="sm" variant="ghost" onClick={() => pedirConfirmacao({
                    titulo: "Desfazer baixa?", texto: `O lançamento volta para ${l.tipo === "receita" ? "contas a receber" : "contas a pagar"}.`,
                    confirmar: "Desfazer", acao: () => baixar(l),
                  })}>Desfazer</Btn>
                ) : (
                  <Btn size="sm" variant="soft" icon={Check} onClick={() => setBaixando(l)}>{l.tipo === "receita" ? "Recebi" : "Paguei"}</Btn>
                )}
              </div>
            </div>
          </Linha>
        );
      })}
    </Panel>
  );

  return (
    <>
      <PageHead title="Financeiro" sub="Quanto entrou, quanto falta entrar e quanto sai."
        action={<Btn icon={Plus} onClick={() => setForm({ tipo: "despesa", vencimento: HOJE, pago: false, valor: 0, categoria: "Materiais", origemTipo: "manual" })}>Novo lançamento</Btn>} />

      <div className="flex items-center justify-between gap-2 mb-6">
        <button onClick={() => mudarMes(-1)} aria-label="Mês anterior" className={cx("p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700", ring)}><ArrowLeft className="w-4 h-4" /></button>
        <p className="text-[15px] font-medium text-slate-800">{nomeMes(mes)}</p>
        <button onClick={() => mudarMes(1)} aria-label="Próximo mês" className={cx("p-3 rounded-xl text-slate-400 hover:bg-white hover:text-slate-700", ring)}><ArrowRight className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-4">
        <Panel className="p-4 sm:p-5"><p className="text-[12.5px] text-slate-500">Recebido no mês</p>
          <p className="text-[20px] font-semibold text-emerald-700 mt-1 tabular-nums">{brl(soma(recebidoMes))}</p></Panel>
        <Panel className="p-4 sm:p-5"><p className="text-[12.5px] text-slate-500">A receber no mês</p>
          <p className="text-[20px] font-semibold text-slate-900 mt-1 tabular-nums">{brl(soma(aReceberMes))}</p></Panel>
        <Panel className="p-4 sm:p-5"><p className="text-[12.5px] text-slate-500">A pagar no mês</p>
          <p className="text-[20px] font-semibold text-slate-900 mt-1 tabular-nums">{brl(soma(aPagarMes))}</p></Panel>
        <Panel className="p-4 sm:p-5"><p className="text-[12.5px] text-slate-500">Em atraso</p>
          <p className={cx("text-[17px] font-semibold mt-1 tabular-nums", soma(vencidosReceber) > 0 ? "text-rose-700" : "text-slate-900")}>{brl(soma(vencidosReceber))} <span className="text-[11px] font-normal text-slate-400">a receber</span></p>
          <p className="text-[12px] text-slate-500 mt-1 tabular-nums">{brl(soma(vencidosPagar))} a pagar</p></Panel>
        <Panel className="p-4 sm:p-5 bg-slate-900 ring-slate-900 col-span-2 lg:col-span-1">
          <p className="text-[12.5px] text-slate-400">Resultado do mês</p>
          <p className="text-[20px] font-semibold text-white mt-1 tabular-nums">{brl(resultado)}</p></Panel>
      </div>

      <p className="text-[12.5px] text-slate-400 mb-6 leading-relaxed">
        Resultado = recebido menos despesas pagas dentro do mês.
        {futuroReceber > 0 && <> Fora deste mês há <span className="font-medium text-slate-600">{brl(futuroReceber)}</span> a receber</>}
        {futuroPagar > 0 && <> e <span className="font-medium text-slate-600">{brl(futuroPagar)}</span> a pagar</>}
        {(futuroReceber > 0 || futuroPagar > 0) && "."}
      </p>

      <Tabs valor={aba} onChange={setAba} className="mb-5"
        opcoes={[{ id: "receber", label: "A receber" }, { id: "recebido", label: "Recebido" }, { id: "pagar", label: "A pagar" },
          { id: "pago", label: "Pago" }, { id: "fluxo", label: "Fluxo de caixa" }, { id: "resultado", label: "Meu resultado" }]} />

      {aba === "receber" && (<><Rotulo>A receber neste mês</Rotulo>
        <ListaLanc itens={aReceberMes.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento))} vazio="Conclua uma ordem de serviço para gerar a cobrança automaticamente." /></>)}
      {aba === "recebido" && (<><Rotulo>Recebido neste mês</Rotulo><ListaLanc itens={recebidoMes} vazio="Nenhum recebimento registrado neste mês." /></>)}
      {aba === "pagar" && (<><Rotulo>A pagar neste mês</Rotulo>
        <ListaLanc itens={aPagarMes.slice().sort((a, b) => a.vencimento.localeCompare(b.vencimento))} vazio="Registre uma compra para gerar a conta a pagar automaticamente." /></>)}
      {aba === "pago" && (<><Rotulo>Pago neste mês</Rotulo><ListaLanc itens={pagoMes} vazio="Nenhum pagamento registrado neste mês." /></>)}

      {aba === "fluxo" && (
        <>
          <Rotulo>Previsão dos próximos 30 dias</Rotulo>
          <Panel className="p-5 sm:p-6">
            <div className="space-y-4 text-[15px]">
              <div className="flex justify-between"><span className="text-slate-500">Saldo registrado</span><span className="font-medium tabular-nums">{brl(saldoAtual)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Entradas previstas</span><span className="font-medium text-emerald-700 tabular-nums">+ {brl(soma(entradas30))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Saídas previstas</span><span className="font-medium text-rose-700 tabular-nums">− {brl(soma(saidas30))}</span></div>
              <div className="flex justify-between items-baseline pt-4 border-t border-slate-200">
                <span className="font-medium text-slate-700">Saldo projetado</span>
                <span className={cx("text-2xl font-semibold tabular-nums", projetado >= 0 ? "text-slate-900" : "text-rose-700")}>{brl(projetado)}</span>
              </div>
            </div>
            <p className="text-[12.5px] text-slate-400 mt-4 leading-relaxed">
              {projetado >= 0 ? "Se todos os recebimentos entrarem no prazo, o mês fecha positivo." : "Atenção: pelas datas atuais, o caixa fica negativo. Antecipe recebimentos ou renegocie vencimentos."}
              {" "}Saldo registrado considera apenas movimentações que passaram pelo ZiisTec; contas vencidas ficam fora da previsão dos próximos 30 dias.
            </p>
          </Panel>
          <div className="grid sm:grid-cols-2 gap-6 mt-6">
            <div><Rotulo>Entradas previstas</Rotulo><ListaLanc itens={entradas30} vazio="Nenhuma entrada prevista." /></div>
            <div><Rotulo>Saídas previstas</Rotulo><ListaLanc itens={saidas30} vazio="Nenhuma saída prevista." /></div>
          </div>
        </>
      )}

      {aba === "resultado" && (
        <>
          <Rotulo>Meu resultado em {nomeMes(mes).toLowerCase()}</Rotulo>
          <Panel className="p-5 sm:p-6">
            <div className="space-y-4 text-[15px]">
              <div className="flex justify-between"><span className="text-slate-500">Serviços faturados no mês</span><span className="font-medium tabular-nums">{brl(faturadoServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Custos diretos dessas OS</span><span className="tabular-nums">− {brl(custoServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Margem bruta dos serviços</span><span className="font-medium tabular-nums">{brl(margemServicos)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Outras despesas pagas</span><span className="tabular-nums">− {brl(outrasDespesas)}</span></div>
              <div className="flex justify-between items-baseline pt-4 border-t border-slate-200">
                <span className="font-medium text-slate-700">Resultado operacional estimado</span>
                <span className={cx("text-2xl font-semibold tabular-nums", resultadoOperacional >= 0 ? "text-emerald-700" : "text-rose-700")}>
                  {brl(resultadoOperacional)}
                </span>
              </div>
            </div>
            <p className="text-[12.5px] text-slate-400 mt-4 leading-relaxed">
              A margem usa a data real de conclusão da OS e o valor da cobrança gerada no Financeiro. Custos diretos incluem itens, materiais utilizados e custos extras registrados.
              Compras automáticas de materiais não são subtraídas novamente aqui, evitando contar o mesmo material duas vezes.
              {pendentesPrecoMes.length > 0 && <> Há {pendentesPrecoMes.length} OS concluída{pendentesPrecoMes.length > 1 ? "s" : ""} aguardando preço e ainda fora da margem.</>}
            </p>
          </Panel>

          <Rotulo acao={null}>Resultado por ordem concluída</Rotulo>
          <Panel className="divide-y divide-slate-100 overflow-hidden">
            {osFaturadasMes.length === 0 ? <Empty icon={TrendingUp} title="Nenhuma ordem faturada neste mês" /> : osFaturadasMes.map((o) => {
              const cobrado = Number(cobrancaDaOS(o)?.valor) || 0, custo = custoDiretoOS(o);
              const m = cobrado > 0 ? Math.round(((cobrado - custo) / cobrado) * 100) : 0;
              return (
                <Linha key={o.id} onClick={() => abrirOS(o.id)}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 truncate">{o.numero}</p>
                      <p className="text-[12px] text-slate-400">cobrado {brl(cobrado)} · custo {brl(custo)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-slate-900 tabular-nums">{brl(cobrado - custo)}</p>
                      <p className="text-[12px] text-slate-400">margem {m}%</p>
                    </div>
                  </div>
                </Linha>
              );
            })}
          </Panel>
        </>
      )}

      {/* baixa com forma de pagamento */}
      {baixando && (
        <Modal open onClose={() => setBaixando(null)} title={baixando.tipo === "receita" ? "Registrar recebimento" : "Registrar pagamento"} sub={`${baixando.descricao} · ${brl(baixando.valor)}`}>
          <Field label="Como foi pago">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FORMAS.map((f) => (
                <button key={f} onClick={() => { baixar(baixando, f); setBaixando(null); }}
                  className={cx("rounded-xl ring-1 ring-slate-200 px-3 py-3 text-[14px] text-slate-700 hover:ring-teal-600 hover:bg-teal-50", ring)}>{f}</button>
              ))}
            </div>
          </Field>
          <p className="text-[12.5px] text-slate-400">A data do {baixando.tipo === "receita" ? "recebimento" : "pagamento"} será hoje, {dataBR(HOJE)}.</p>
        </Modal>
      )}

      {form && (
        <Modal open onClose={() => setForm(null)} title="Novo lançamento" wide
          footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
            <Btn disabled={!form.descricao || !form.valor} onClick={async () => {
              if (real) {
                try { const salvo = await salvarLancamentoDB({ ...form, pagoEm: form.pago ? HOJE : null }, empresaId); setLancamentos((l) => [salvo, ...l]); setForm(null); aviso("Lançamento registrado"); }
                catch (e) { aviso(mensagemErro(e)); }
                return;
              }
              setLancamentos((l) => [{ ...form, id: uid(), empresaId, pagoEm: form.pago ? HOJE : null }, ...l]); setForm(null); aviso("Lançamento registrado");
            }}>Salvar lançamento</Btn></>}>
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl" role="tablist">
            {[["despesa", "Despesa"], ["receita", "Receita"]].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={form.tipo === id} onClick={() => setForm({ ...form, tipo: id })}
                className={cx("flex-1 py-2.5 rounded-lg text-[14px] font-medium transition-colors", form.tipo === id ? "bg-white shadow-sm text-slate-900" : "text-slate-500")}>{label}</button>
            ))}
          </div>
          <Field label="Descrição"><Input value={form.descricao || ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Ex.: Aluguel da oficina" /></Field>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Valor"><Input type="number" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: Number(e.target.value) })} /></Field>
            <Field label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></Field>
          </div>
          <Field label="Categoria"><Input value={form.categoria || ""} onChange={(e) => setForm({ ...form, categoria: e.target.value })} /></Field>
          {form.tipo === "receita" && (
            <Field label="Cliente">
              <Select value={form.clienteId || ""} onChange={(e) => setForm({ ...form, clienteId: e.target.value })}>
                <option value="">Sem vínculo</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.fantasia || c.nome}</option>)}
              </Select>
            </Field>
          )}
          <div className="grid sm:grid-cols-2 gap-5 items-end">
            <label className="flex items-center gap-3 py-3">
              <input type="checkbox" checked={form.pago} onChange={(e) => setForm({ ...form, pago: e.target.checked })} className="w-5 h-5 rounded accent-teal-700" />
              <span className="text-[14px] text-slate-700">Já foi {form.tipo === "receita" ? "recebido" : "pago"}</span>
            </label>
            {form.pago && (
              <Field label="Forma"><Select value={form.forma || "Pix"} onChange={(e) => setForm({ ...form, forma: e.target.value })}>{FORMAS.map((f) => <option key={f}>{f}</option>)}</Select></Field>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

/* =========================================================== Configurações */
function Config({ empresa, setEmpresa, aviso, assinatura, empresaId, mudarAssinatura, pedirConfirmacao }) {
  const [f, setF] = useState(empresa);
  const logoRef = useRef(null);
  const set = (k, v) => setF({ ...f, [k]: v });
  useEffect(() => {
    let ativo = true;
    if (f.logoPath && !f.logoUrl) resolverLogoEmpresaDB(f.logoPath).then((url) => { if (ativo && url) { setF((v) => ({ ...v, logoUrl: url })); setEmpresa((v) => ({ ...v, logoUrl: url })); } }).catch(() => {});
    return () => { ativo = false; };
  }, [f.logoPath]);
  const enviarLogo = async (file) => {
    if (!file) return;
    try { const logo = await uploadLogoEmpresaDB(file, empresaId); const prox = { ...f, logoPath: logo.path, logoUrl: logo.url }; setF(prox); setEmpresa(prox); aviso("Logo atualizado"); }
    catch (e) { aviso(mensagemErro(e)); }
  };
  const alterado = JSON.stringify(f) !== JSON.stringify(empresa);

  return (
    <>
      <PageHead title="Configurações" sub="Os dados que aparecem nos seus orçamentos e documentos." />
      <div className="max-w-2xl space-y-7">
        <section>
          <Rotulo>Identidade da empresa</Rotulo>
          <Panel className="p-5 sm:p-6 space-y-5">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl font-semibold shrink-0 overflow-hidden">{f.logoUrl ? <img src={f.logoUrl} alt="Logo da empresa" className="w-full h-full object-cover" /> : iniciais(f.nome)}</div>
              <div>
                <input ref={logoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => enviarLogo(e.target.files?.[0])} />
                <Btn variant="soft" size="sm" onClick={() => logoRef.current?.click()}>Enviar logo</Btn>
                <p className="text-[12px] text-slate-400 mt-2">Aparece no topo dos orçamentos.</p>
              </div>
            </div>
            <Field label="Nome da empresa ou profissional"><Input value={f.nome} onChange={(e) => set("nome", e.target.value)} /></Field>
            <Field label="Atividade" hint="Uma linha curta que descreve o que você faz."><Input value={f.atividade} onChange={(e) => set("atividade", e.target.value)} /></Field>
            <div className="grid sm:grid-cols-2 gap-5">
              <Field label="CPF ou CNPJ"><Input value={f.documento} onChange={(e) => set("documento", e.target.value)} /></Field>
              <Field label="Responsável"><Input value={f.responsavel} onChange={(e) => set("responsavel", e.target.value)} /></Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <Field label="Telefone"><Input value={f.telefone} onChange={(e) => set("telefone", e.target.value)} /></Field>
              <Field label="WhatsApp"><Input value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
            </div>
            <Field label="E-mail"><Input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
            <Field label="Endereço"><Input value={f.endereco} onChange={(e) => set("endereco", e.target.value)} /></Field>
          </Panel>
        </section>

        <section>
          <Rotulo>Como você trabalha</Rotulo>
          <Panel className="p-5 sm:p-6">
            <div className="flex gap-2">
              {[[false, "Trabalho sozinho"], [true, "Tenho equipe"]].map(([v, label]) => (
                <button key={label} onClick={() => set("temEquipe", v)} aria-pressed={!!f.temEquipe === v}
                  className={cx("flex-1 py-3.5 rounded-xl text-[15px] font-medium transition-colors", ring,
                    !!f.temEquipe === v ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50")}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">
              {f.temEquipe
                ? "Você escolhe o responsável ao agendar e ao abrir cada ordem de serviço."
                : `Você é o responsável padrão por todas as ordens. O ZiisTec não vai perguntar quem executa a cada agendamento — ${f.responsavel || "seu nome"} entra automaticamente.`}
            </p>
          </Panel>
        </section>

        <section>
          <Rotulo>Padrões dos orçamentos</Rotulo>
          <Panel className="p-5 sm:p-6 space-y-5">
            <Field label="Validade padrão em dias" hint="Usada automaticamente ao criar um orçamento novo.">
              <Input type="number" min="1" value={f.validadePadrao} onChange={(e) => set("validadePadrao", Number(e.target.value))} className="max-w-[140px]" />
            </Field>
            <Field label="Condição de pagamento padrão"><Textarea rows={2} value={f.condicaoPadrao} onChange={(e) => set("condicaoPadrao", e.target.value)} /></Field>
            <Field label="Observação padrão"><Textarea rows={3} value={f.observacaoPadrao} onChange={(e) => set("observacaoPadrao", e.target.value)} /></Field>
          </Panel>
        </section>

        {assinatura && (
          <section>
            <Rotulo>Minha assinatura</Rotulo>
            <Panel className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-[15px] font-medium text-slate-900">{assinatura.plano}</p>
                  <p className="text-[13px] text-slate-500 mt-0.5">
                    {brl(assinatura.valor)} por mês · próxima cobrança em {dataBR(assinatura.proximaCobranca)}
                  </p>
                </div>
                <Pill tone={ST_ASSINATURA[assinatura.status].tone}>{ST_ASSINATURA[assinatura.status].label}</Pill>
              </div>
              <div className="flex flex-wrap gap-2 mt-5">
                <Btn variant="soft" size="sm" icon={CreditCard} onClick={() => aviso("Pagamento depende do provedor que ainda vamos integrar")}>
                  Forma de pagamento
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => pedirConfirmacao({
                  titulo: "Cancelar assinatura?",
                  texto: "O acesso ao ZiisTec será interrompido ao confirmar. Seus dados não são apagados — cancelar assinatura é diferente de excluir a conta. Você pode reativar enquanto o período atual ainda estiver válido.",
                  confirmar: "Cancelar assinatura", acao: () => mudarAssinatura(empresaId, "cancelada"),
                })}>Cancelar assinatura</Btn>
              </div>
              <p className="text-[12px] text-slate-400 mt-4 leading-relaxed">
                Cobrança e checkout dependem de um provedor de pagamento ainda não integrado. O cancelamento, porém, já é gravado no servidor e mantém todos os seus dados.
              </p>
            </Panel>
          </section>
        )}

        <section>
          <Rotulo>Integrações</Rotulo>
          <Panel className="p-5 sm:p-6 space-y-4 text-[13.5px] text-slate-600 leading-relaxed">
            <div className="flex items-start gap-3"><Mic className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p><span className="font-medium text-slate-800">Voz:</span> usa o reconhecimento de fala do próprio navegador. Funciona melhor no Chrome; em outros navegadores você digita normalmente.</p></div>
            <div className="flex items-start gap-3"><Sparkles className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p><span className="font-medium text-slate-800">Interpretação de orçamento e organização do relato:</span> usam um serviço de IA online. Nada é salvo sem a sua confirmação.</p></div>
            <div className="flex items-start gap-3"><Paperclip className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p><span className="font-medium text-slate-800">Arquivos e fotos:</span> ficam apenas na sessão atual. Precisam de armazenamento no servidor para serem permanentes.</p></div>
            <div className="flex items-start gap-3"><ShoppingCart className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <p><span className="font-medium text-slate-800">Gmail de fornecedores e emissão de NFS-e:</span> ainda não conectados. A estrutura de compras, contas a pagar e dados fiscais já está preparada para receber essas integrações.</p></div>
          </Panel>
        </section>

        <div className="flex justify-end gap-3">
          {alterado && <Btn variant="ghost" onClick={() => setF(empresa)}>Descartar</Btn>}
          <Btn disabled={!alterado} onClick={() => { setEmpresa(f); aviso("Configurações salvas"); }}>Salvar configurações</Btn>
        </div>
      </div>
    </>
  );
}

/* =============================================================== Garantias
   Consulta e acionamento. As garantias não são cadastradas aqui: elas nascem
   da OS concluída, a partir do prazo configurado em cada serviço.           */
function Garantias({ garantias, ordens, clientes, nomeCliente, garantiaAberta, setGarantiaAberta, abrirOS, abrirCliente, abrirAtendimentoGarantia, produtos, empresaId, real, aviso }) {
  const [filtro, setFiltro] = useState("ativas");
  const [busca, setBusca] = useState("");
  const [acionando, setAcionando] = useState(false);
  const [relatoProblema, setRelatoProblema] = useState("");
  const [revisoes, setRevisoes] = useState([]);
  const carregarRevisoes = async () => {
    if (!real || !empresaId) return;
    try { setRevisoes(await carregarRevisoesDB(empresaId)); }
    catch (e) { aviso?.(e?.message || "Não foi possível carregar o pós-venda."); }
  };
  useEffect(() => { carregarRevisoes(); }, [real, empresaId]);
  const mudarRevisao = async (r, status) => {
    try {
      const salva = await atualizarRevisaoDB(r.id,status);
      setRevisoes((ls)=>ls.map((x)=>x.id===salva.id?salva:x));
      aviso?.(status === "done" ? "Revisão marcada como concluída." : "Revisão dispensada.");
    } catch (e) { aviso?.(e?.message || "Não foi possível atualizar o pós-venda."); }
  };

  if (garantiaAberta) {
    const g = garantias.find((x) => x.id === garantiaAberta);
    if (!g) { setGarantiaAberta(null); return null; }
    const st = statusGarantia(g);
    const origem = ordens.find((o) => o.id === g.osId);
    const cli = clientes.find((c) => c.id === g.clienteId);
    const produto = g.produtoId ? produtos.find((p) => p.id === g.produtoId) : null;
    const atendimentos = ordens.filter((o) => o.garantiaId === g.id);
    const fotos = origem?.fotos || [];

    return (
      <>
        <button onClick={() => setGarantiaAberta(null)} className={cx("flex items-center gap-2 text-[14px] text-slate-500 mb-5 hover:text-slate-900 py-1", ring)}>
          <ArrowLeft className="w-4 h-4" /> Garantias
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[26px] sm:text-3xl font-semibold text-slate-900 tracking-[-0.02em]">{g.descricao}</h1>
              <Pill tone={st.tone}>{st.label}</Pill>
            </div>
            <p className="text-[15px] text-slate-500 mt-1.5">
              {g.tipo === "servico" ? "Garantia do serviço executado" : "Garantia do fabricante"} · {st.detalhe}
            </p>
          </div>
          {st.ativa && <Btn icon={ShieldCheck} onClick={() => { setRelatoProblema(""); setAcionando(true); }}>Abrir atendimento em garantia</Btn>}
        </div>

        <div className="grid lg:grid-cols-3 gap-6 lg:gap-8 items-start">
          <div className="lg:col-span-2 space-y-6">
            <section>
              <Rotulo>Dados da garantia</Rotulo>
              <Panel className="divide-y divide-slate-100">
                {[
                  ["Cliente", nomeCliente(g.clienteId), () => abrirCliente(g.clienteId)],
                  ["Local do serviço", g.local || "—", null],
                  ["Executado em", dataBR(g.inicio), null],
                  ["Prazo", g.tipo === "servico" ? `${g.dias} dias` : `${g.meses} meses do fabricante`, null],
                  ["Válida até", dataBR(g.ate), null],
                  ["Ordem de origem", origem ? origem.numero : "—", origem ? () => abrirOS(origem.id) : null],
                  ...(produto ? [["Equipamento", `${produto.nome}${produto.marca ? " · " + produto.marca : ""} ${produto.modelo || ""}`, null]] : []),
                  ...(g.serie ? [["Número de série", g.serie, null]] : []),
                ].map(([rotulo, valor, acao]) => (
                  <div key={rotulo} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <span className="text-[14px] text-slate-500">{rotulo}</span>
                    {acao ? (
                      <button onClick={acao} className={cx("text-[14px] font-medium text-teal-800 hover:underline text-right", ring)}>{valor}</button>
                    ) : <span className="text-[14px] text-slate-800 text-right">{valor}</span>}
                  </div>
                ))}
              </Panel>
            </section>

            <section>
              <Rotulo>Relato do serviço executado</Rotulo>
              <Panel className="p-5">
                {origem?.relato ? (
                  <p className="text-[14px] text-slate-700 whitespace-pre-line leading-relaxed">{origem.relato}</p>
                ) : <p className="text-[14px] text-slate-500">Nenhum relato foi registrado nesta ordem.</p>}
              </Panel>
            </section>

            {fotos.length > 0 && (
              <section>
                <Rotulo>Fotos do atendimento original</Rotulo>
                <Panel className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {fotos.map((f) => (
                    <div key={f.id} className="rounded-xl overflow-hidden ring-1 ring-slate-200">
                      {f.url ? <img src={f.url} alt={f.categoria} className="w-full h-28 object-cover" /> : <div className="h-28 bg-slate-100" />}
                      <p className="text-[11px] text-slate-500 px-2 py-1.5 truncate">{f.categoria}</p>
                    </div>
                  ))}
                </Panel>
              </section>
            )}

            <section>
              <Rotulo>Atendimentos em garantia</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {atendimentos.length === 0
                  ? <Empty icon={ShieldCheck} title="Nenhum acionamento até agora" sub="Se o cliente relatar um problema, abra o atendimento em garantia por aqui." />
                  : atendimentos.map((o) => (
                    <Linha key={o.id} onClick={() => abrirOS(o.id)}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-slate-800">{o.numero}</p>
                          <p className="text-[12px] text-slate-400 truncate">{o.data ? dataBR(o.data) : "sem agendamento"} · {o.relatoProblema || "sem relato do problema"}</p>
                        </div>
                        <Pill tone={ST_OS[o.status].tone}>{ST_OS[o.status].label}</Pill>
                      </div>
                    </Linha>
                  ))}
              </Panel>
            </section>
          </div>

          <div className="space-y-6">
            <section>
              <Rotulo>Contato do cliente</Rotulo>
              <Panel className="p-5">
                <div className="flex items-center gap-3">
                  <Avatar nome={cli?.nome} tipo={cli?.tipo} />
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{nomeCliente(g.clienteId)}</p>
                    <p className="text-[13px] text-slate-500">{cli?.telefone}</p>
                  </div>
                </div>
                {origem?.local && <div className="mt-3 text-[13px]"><Endereco valor={origem.local} local={g.local} /></div>}
                {cli?.whatsapp && (
                  <Btn variant="soft" size="sm" icon={Share2} className="w-full mt-4"
                    onClick={() => window.open(`https://wa.me/55${soDigitos(cli.whatsapp)}`, "_blank")}>Falar no WhatsApp</Btn>
                )}
              </Panel>
            </section>
            {!st.ativa && (
              <Panel className="p-5">
                <p className="text-[13.5px] text-slate-600 leading-relaxed">
                  Esta garantia {st.detalhe}. Um novo chamado deste cliente entra como atendimento normal, com cobrança.
                </p>
              </Panel>
            )}
          </div>
        </div>

        <Modal open={acionando} onClose={() => setAcionando(false)} wide title="Abrir atendimento em garantia"
          sub={`${g.descricao} · ${nomeCliente(g.clienteId)}`}
          footer={<><Btn variant="ghost" onClick={() => setAcionando(false)}>Cancelar</Btn>
            <Btn icon={ShieldCheck} onClick={() => { abrirAtendimentoGarantia(g, relatoProblema); setAcionando(false); }}>Abrir ordem em garantia</Btn></>}>
          <Field label="O que o cliente está relatando?" hint="Fale ou digite. Isso fica registrado na nova ordem.">
            <CampoVoz rows={4} valor={relatoProblema} onChange={setRelatoProblema}
              placeholder="Ex.: o cliente diz que a fechadura parou de reconhecer duas digitais desde ontem" />
          </Field>
          <p className="text-[13px] text-slate-500 leading-relaxed">
            A nova ordem já vem com cliente, endereço e local do serviço preenchidos, ligada a esta garantia e à ordem de origem.
            Atendimento em garantia não gera cobrança ao ser concluído.
          </p>
        </Modal>
      </>
    );
  }

  const t = semAcento(busca);
  const lista = garantias
    .filter((g) => {
      const st = statusGarantia(g);
      if (filtro === "ativas" && !st.ativa) return false;
      if (filtro === "expiradas" && st.ativa) return false;
      return semAcento(`${g.descricao} ${nomeCliente(g.clienteId)} ${g.local || ""}`).includes(t);
    })
    .sort((a, b) => a.ate.localeCompare(b.ate));
  const ativas = garantias.filter((g) => statusGarantia(g).ativa).length;

  return (
    <>
      <PageHead title="Garantias" sub={`${ativas} ativa${ativas === 1 ? "" : "s"} agora. Cada uma nasceu de uma ordem de serviço concluída.`} />
      {revisoes.filter((r)=>r.status === "pending").length > 0 && (
        <section className="mb-7">
          <Rotulo>Pós-venda programado · {revisoes.filter((r)=>r.status === "pending").length}</Rotulo>
          <Panel className="divide-y divide-slate-100 overflow-hidden">
            {revisoes.filter((r)=>r.status === "pending").sort((a,b)=>a.data.localeCompare(b.data)).map((r)=>(
              <Linha key={r.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button onClick={()=>abrirOS(r.osId)} className={cx("min-w-0 text-left",ring)}>
                    <p className="font-medium text-slate-900 truncate">{r.descricao}</p>
                    <p className="text-[13px] text-slate-500 truncate">{nomeCliente(r.clienteId)} · retorno em {dataBR(r.data)}</p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <Pill tone={r.data < HOJE ? "erro" : r.data === HOJE ? "atencao" : "neutro"}>{r.data < HOJE ? "Atrasado" : r.data === HOJE ? "Hoje" : dataBR(r.data)}</Pill>
                    <Btn size="sm" variant="soft" icon={Check} onClick={()=>mudarRevisao(r,"done")}>Concluir</Btn>
                    <Btn size="sm" variant="ghost" onClick={()=>mudarRevisao(r,"dismissed")}>Dispensar</Btn>
                  </div>
                </div>
              </Linha>
            ))}
          </Panel>
        </section>
      )}
      <Tabs valor={filtro} onChange={setFiltro} className="mb-5"
        opcoes={[{ id: "ativas", label: "Ativas" }, { id: "expiradas", label: "Expiradas" }, { id: "todas", label: "Todas" }]} />
      <div className="mb-5 max-w-md"><SearchBox value={busca} onChange={setBusca} placeholder="Buscar por serviço, cliente ou local" /></div>

      {lista.length === 0 ? (
        <Panel><Empty icon={ShieldCheck} title="Nenhuma garantia por aqui"
          sub="Configure o prazo de garantia no cadastro do serviço. Ao finalizar uma OS com esse serviço, o registro aparece aqui sozinho." /></Panel>
      ) : (
        <Panel className="divide-y divide-slate-100 overflow-hidden">
          {lista.map((g) => {
            const st = statusGarantia(g);
            return (
              <Linha key={g.id} onClick={() => setGarantiaAberta(g.id)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{g.descricao}</p>
                    <p className="text-[13px] text-slate-500 truncate">
                      {nomeCliente(g.clienteId)}{g.local ? ` · ${g.local}` : ""}
                    </p>
                    <p className="text-[12px] text-slate-400 mt-1">
                      {g.tipo === "servico" ? `Garantia do serviço · ${g.dias} dias` : `Garantia do fabricante · ${g.meses} meses`} · executado em {dataBR(g.inicio)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Pill tone={st.tone}>{st.label}</Pill>
                    <p className="text-[12px] text-slate-500 mt-1.5 tabular-nums">até {dataBR(g.ate)}</p>
                    <p className="text-[12px] text-slate-400">{st.detalhe}</p>
                  </div>
                </div>
              </Linha>
            );
          })}
        </Panel>
      )}
    </>
  );
}

/* ==================================================== acesso e plataforma */

const AvisoAuth = () => (
  <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/70 px-4 py-3 flex gap-2.5">
    <Lock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" aria-hidden="true" />
    <p className="text-[12.5px] text-amber-900 leading-relaxed">
      Autenticação ainda não está conectada. Enquanto não houver servidor, senha e login com Google não validam nada —
      use os perfis abaixo para testar cada papel. Nenhuma proteção real existe até essa etapa.
    </p>
  </div>
);

function SemPermissao({ papel }) {
  return (
    <Panel className="mt-10">
      <Empty icon={Lock} title="Esta área não faz parte do seu acesso"
        sub={papel === "tecnico"
          ? "Seu perfil é técnico: você trabalha nas ordens atribuídas a você. Administração e financeiro ficam com o proprietário."
          : "Seu perfil não tem permissão para esta área."} />
    </Panel>
  );
}

function Autenticacao({ usuarios, membresias, empresas, onEntrar, onCriarConta, onPrimeiroAcesso }) {
  const [modo, setModo] = useState("entrar");
  const [trocaSenha, setTrocaSenha] = useState(null);
  const [nova, setNova] = useState({ senha: "", repete: "" });
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [novo, setNovo] = useState({ nome: "", email: "", senha: "", empresa: "", atividade: "", temEquipe: false });
  const [passo, setPasso] = useState(0);

  const perfis = membresias.map((m) => ({
    m, u: usuarios.find((x) => x.id === m.usuarioId), e: empresas.find((x) => x.id === m.empresaId),
  })).filter((p) => p.u && p.e);
  const plataforma = usuarios.filter(ehPlataforma);

  const Cabecalho = () => (
    <div className="text-center mb-8">
      <div className="w-12 h-12 rounded-2xl bg-teal-500 flex items-center justify-center mx-auto mb-4">
        <span className="text-slate-900 font-bold text-2xl leading-none">Z</span>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
        {modo === "entrar" ? "Entre na sua conta" : "Criar conta no ZiisTec"}
      </h1>
      <p className="text-[14px] text-slate-500 mt-1.5">
        {modo === "entrar" ? "Gestão de serviços para quem trabalha em campo." : "Leva menos de um minuto."}
      </p>
    </div>
  );

  const passos = [
    { campo: "nome", label: "Como você se chama?", place: "Seu nome" },
    { campo: "email", label: "Seu e-mail", place: "voce@email.com", tipo: "email" },
    { campo: "senha", label: "Crie uma senha", place: "Mínimo 8 caracteres", tipo: "password" },
    { campo: "empresa", label: "Nome do seu negócio", place: "Ex.: JR Serviços Técnicos" },
    { campo: "atividade", label: "O que você faz?", place: "Ex.: elétrica e automação" },
  ];

  if (trocaSenha) {
    const { u, m } = trocaSenha;
    const empresaConvite = empresas.find((x) => x.id === m.empresaId);
    const curta = nova.senha.length < 8;
    const diferente = nova.senha !== nova.repete;
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans antialiased">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-2xl bg-teal-500 flex items-center justify-center mx-auto mb-4">
              <span className="text-slate-900 font-bold text-2xl leading-none">Z</span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Crie sua nova senha</h1>
            <p className="text-[14px] text-slate-500 mt-1.5">
              Olá, {u.nome.split(" ")[0]}. Você foi adicionado à equipe da {empresaConvite?.nome}.
            </p>
          </div>
          <Panel className="p-6 space-y-4">
            <Field label="Nova senha" hint="Mínimo de 8 caracteres.">
              <Input type="password" autoFocus value={nova.senha} onChange={(e) => setNova({ ...nova, senha: e.target.value })} />
            </Field>
            <Field label="Repita a nova senha">
              <Input type="password" value={nova.repete} onChange={(e) => setNova({ ...nova, repete: e.target.value })} />
            </Field>
            {nova.repete && diferente && <p className="text-[13px] text-rose-700">As senhas não são iguais.</p>}
            <Btn className="w-full" disabled={curta || diferente}
              onClick={() => { onPrimeiroAcesso(u.id); onEntrar({ usuarioId: u.id, membresiaId: m.id }); }}>
              Definir senha e entrar
            </Btn>
            <button onClick={() => setTrocaSenha(null)} className={cx("w-full text-[13px] text-slate-500 py-2", ring)}>Voltar</button>
          </Panel>
          <div className="mt-5"><AvisoAuth /></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans antialiased">
      <div className="w-full max-w-md">
        <Cabecalho />

        {modo === "entrar" ? (
          <div className="space-y-5">
            <Panel className="p-6 space-y-4">
              <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" /></Field>
              <Field label="Senha"><Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Sua senha" /></Field>
              <Btn className="w-full" disabled title="Disponível quando a autenticação estiver conectada">Entrar</Btn>
              <div className="flex items-center gap-3">
                <span className="h-px bg-slate-200 flex-1" /><span className="text-[12px] text-slate-400">ou</span><span className="h-px bg-slate-200 flex-1" />
              </div>
              <Btn variant="soft" className="w-full" disabled title="Disponível quando a autenticação estiver conectada">Entrar com Google</Btn>
              <div className="flex justify-between text-[13px] pt-1">
                <button className="text-slate-400" disabled>Esqueci minha senha</button>
                <button onClick={() => { setModo("criar"); setPasso(0); }} className={cx("font-medium text-teal-800 hover:underline", ring)}>Criar conta</button>
              </div>
            </Panel>

            <AvisoAuth />

            <div>
              <Rotulo>Entrar como (perfis de teste)</Rotulo>
              <Panel className="divide-y divide-slate-100 overflow-hidden">
                {perfis.map(({ m, u, e }) => (
                  <Linha key={m.id} onClick={() => (u.precisaTrocarSenha
                    ? (setTrocaSenha({ u, m }), setNova({ senha: "", repete: "" }))
                    : onEntrar({ usuarioId: u.id, membresiaId: m.id }))}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-slate-800 truncate">{u.nome}</p>
                        <p className="text-[12px] text-slate-400 truncate">
                          {e.nome} · {m.papel === "proprietario" ? "proprietário" : "técnico"}
                          {u.precisaTrocarSenha ? " · primeiro acesso" : ""}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </div>
                  </Linha>
                ))}
                {plataforma.map((u) => (
                  <Linha key={u.id} onClick={() => onEntrar({ usuarioId: u.id, membresiaId: null })}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-slate-800 truncate">{u.nome}</p>
                        <p className="text-[12px] text-slate-400">Administração da plataforma</p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                    </div>
                  </Linha>
                ))}
              </Panel>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <Panel className="p-6 space-y-5">
              <div className="flex items-center gap-1.5">
                {[...passos, {}].map((_, i) => (
                  <span key={i} className={cx("h-1 flex-1 rounded-full", i <= passo ? "bg-teal-600" : "bg-slate-200")} />
                ))}
              </div>

              {passo < passos.length ? (
                <Field label={passos[passo].label}>
                  <Input type={passos[passo].tipo || "text"} autoFocus value={novo[passos[passo].campo]}
                    placeholder={passos[passo].place}
                    onChange={(e) => setNovo({ ...novo, [passos[passo].campo]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && novo[passos[passo].campo].trim() && setPasso(passo + 1)} />
                </Field>
              ) : (
                <div>
                  <p className="text-[13px] font-medium text-slate-600 mb-3">Como você trabalha?</p>
                  <div className="flex gap-2">
                    {[[false, "Trabalho sozinho"], [true, "Tenho equipe"]].map(([v, label]) => (
                      <button key={label} onClick={() => setNovo({ ...novo, temEquipe: v })} aria-pressed={novo.temEquipe === v}
                        className={cx("flex-1 py-3.5 rounded-xl text-[15px] font-medium transition-colors", ring,
                          novo.temEquipe === v ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600")}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">
                    CNPJ, endereço e logo você preenche depois, nas configurações.
                  </p>
                </div>
              )}

              <div className="flex justify-between gap-3">
                <Btn variant="ghost" onClick={() => (passo === 0 ? setModo("entrar") : setPasso(passo - 1))}>
                  {passo === 0 ? "Voltar ao login" : "Voltar"}
                </Btn>
                {passo < passos.length
                  ? <Btn icon={ArrowRight} disabled={!novo[passos[passo].campo].trim()} onClick={() => setPasso(passo + 1)}>Continuar</Btn>
                  : <Btn icon={Check} onClick={() => onCriarConta(novo)}>Entrar no ZiisTec</Btn>}
              </div>
            </Panel>
            <AvisoAuth />
          </div>
        )}
      </div>
    </div>
  );
}

function AssinaturaBloqueada({ assinatura, empresa, sair, reativar }) {
  const st = ST_ASSINATURA[assinatura.status];
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans antialiased">
      <div className="w-full max-w-md text-center">
        <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center mx-auto mb-5">
          <Lock className="w-5 h-5 text-teal-400" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          {assinatura.status === "cancelada" ? "Sua assinatura foi cancelada" : "Sua assinatura está pausada"}
        </h1>
        <p className="text-[15px] text-slate-500 mt-2 leading-relaxed">
          Os dados da {empresa.nome} continuam armazenados: clientes, orçamentos, ordens, financeiro, garantias e histórico.
          Nada foi apagado.
        </p>
        <Panel className="p-5 mt-7 text-left space-y-3">
          <div className="flex justify-between text-[14px]"><span className="text-slate-500">Plano</span><span className="font-medium">{assinatura.plano}</span></div>
          <div className="flex justify-between text-[14px]"><span className="text-slate-500">Valor</span><span className="font-medium tabular-nums">{brl(assinatura.valor)}/mês</span></div>
          <div className="flex justify-between items-center text-[14px]"><span className="text-slate-500">Situação</span><Pill tone={st.tone}>{st.label}</Pill></div>
        </Panel>
        <Btn className="w-full mt-5" icon={CreditCard} onClick={reativar}>Reativar assinatura</Btn>
        <p className="text-[12px] text-slate-400 mt-3 leading-relaxed">
          Se o período atual ainda estiver válido, a reativação restaura o acesso sem apagar nada. Depois do vencimento, uma nova cobrança será necessária quando o provedor de pagamento estiver integrado.
        </p>
        <button onClick={sair} className={cx("text-[13px] text-slate-500 mt-6 hover:text-slate-800", ring)}>Sair da conta</button>
      </div>
    </div>
  );
}

function Equipe({ equipe, usuarioAtual, empresa, salvarColaborador, atualizarColaborador, reenviarAcesso, alternarColaborador, ordens, pedirConfirmacao, aviso }) {
  const [form, setForm] = useState(null);
  const [editando, setEditando] = useState(null);
  const [credencial, setCredencial] = useState(null);

  const convidar = async () => {
    const r = await salvarColaborador(form);
    if (!r) return;
    setForm(null);
    setCredencial({ nome: form.nome, email: form.email.trim().toLowerCase(), senha: r.senhaTemporaria || null, convite: Boolean(r.convite) });
  };

  return (
    <>
      <PageHead title="Equipe" sub="Quem tem acesso à sua empresa e o que cada um enxerga."
        action={<Btn icon={Plus} onClick={() => setForm({ nome: "", email: "", telefone: "", funcao: "", papel: "tecnico" })}>Adicionar colaborador</Btn>} />

      <Panel className="divide-y divide-slate-100 overflow-hidden">
        {equipe.map((m) => {
          const minhas = ordens.filter((o) => o.responsavelId === m.usuarioId && o.status !== "concluida" && o.status !== "cancelada");
          const pendente = m.convite === "pendente" || m.usuario?.precisaTrocarSenha;
          return (
            <Linha key={m.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center text-sm font-semibold shrink-0">
                    {iniciais(m.usuario?.nome)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      {m.usuario?.nome}{m.usuarioId === usuarioAtual?.id && <span className="text-slate-400 font-normal"> · você</span>}
                    </p>
                    <p className="text-[13px] text-slate-500 truncate">
                      {m.usuario?.email}{m.usuario?.funcao ? ` · ${m.usuario.funcao}` : ""}
                    </p>
                    <p className="text-[12px] text-slate-400 mt-0.5">
                      {minhas.length > 0 ? `${minhas.length} ordem(ns) em aberto` : "sem ordens em aberto"}
                      {m.usuario?.ultimoAcesso ? ` · último acesso ${dataBR(m.usuario.ultimoAcesso)}` : " · nunca acessou"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <Pill tone={m.papel === "proprietario" ? "marca" : "neutro"}>{m.papel === "proprietario" ? "Proprietário" : "Técnico"}</Pill>
                  {!m.ativo && <Pill tone="erro">Desativado</Pill>}
                  {m.ativo && pendente && m.papel !== "proprietario" && <Pill tone="atencao">Primeiro acesso pendente</Pill>}
                  {m.papel !== "proprietario" && (
                    <>
                      <Btn size="sm" variant="soft" icon={Pencil} onClick={() => setEditando({ ...m.usuario })} ariaLabel="Editar colaborador" title="Editar" />
                      <Btn size="sm" variant="soft" onClick={() => setCredencial({
                        nome: m.usuario?.nome, email: m.usuario?.email, senha: reenviarAcesso(m.usuarioId), reenvio: true,
                      })}>Novo acesso</Btn>
                      <Btn size="sm" variant={m.ativo ? "ghost" : "soft"} onClick={() => pedirConfirmacao({
                        titulo: m.ativo ? `Desativar ${m.usuario?.nome}?` : `Reativar ${m.usuario?.nome}?`,
                        texto: m.ativo
                          ? "A pessoa perde o acesso à empresa imediatamente. As ordens, relatos e fotos que ela registrou continuam pertencendo à empresa e não são apagados."
                          : "A pessoa volta a acessar as ordens atribuídas a ela.",
                        confirmar: m.ativo ? "Desativar" : "Reativar", acao: () => alternarColaborador(m),
                      })}>{m.ativo ? "Desativar" : "Reativar"}</Btn>
                    </>
                  )}
                </div>
              </div>
            </Linha>
          );
        })}
      </Panel>

      <Panel className="p-5 mt-6">
        <p className="text-[13px] text-slate-600 leading-relaxed">
          <span className="font-medium text-slate-800">O que o técnico enxerga:</span> início, agenda e as ordens atribuídas a ele —
          com cliente, endereço, rota, o que precisa ser feito, relato por voz, fotos, materiais e pendências.
          A carteira de clientes, orçamentos, garantias, financeiro, compras, equipe e configurações ficam fora do acesso dele.
        </p>
      </Panel>

      {form && (
        <Modal open onClose={() => setForm(null)} wide title="Adicionar colaborador"
          sub="Você cadastra a pessoa e entrega o acesso. Ela não cria a própria conta."
          footer={<><Btn variant="ghost" onClick={() => setForm(null)}>Cancelar</Btn>
            <Btn disabled={!form.nome.trim() || !form.email.trim()} onClick={convidar}>Criar acesso</Btn></>}>
          <div className="grid sm:grid-cols-2 gap-5">
            <Field label="Nome"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus /></Field>
            <Field label="Telefone" hint="Opcional."><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></Field>
          </div>
          <Field label="E-mail" hint="É por ele que a pessoa entra no ZiisTec.">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Função" hint="Opcional. Ex.: técnico instalador, ajudante.">
            <Input value={form.funcao} onChange={(e) => setForm({ ...form, funcao: e.target.value })} />
          </Field>
          <div>
            <p className="text-[13px] font-medium text-slate-600 mb-2">Papel de acesso</p>
            <div className="flex gap-2">
              {[["tecnico", "Técnico"], ["proprietario", "Proprietário"]].map(([v, label]) => (
                <button key={v} onClick={() => setForm({ ...form, papel: v })} aria-pressed={form.papel === v}
                  className={cx("flex-1 py-3.5 rounded-xl text-[15px] font-medium transition-colors", ring,
                    form.papel === v ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600")}>{label}</button>
              ))}
            </div>
            <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">
              {form.papel === "tecnico"
                ? "Vê apenas as ordens atribuídas a ele e o necessário para executá-las."
                : "Acesso completo à empresa, incluindo financeiro e configurações."}
            </p>
          </div>
        </Modal>
      )}

      {editando && (
        <Modal open onClose={() => setEditando(null)} wide title="Editar colaborador"
          footer={<><Btn variant="ghost" onClick={() => setEditando(null)}>Cancelar</Btn>
            <Btn onClick={async () => { await atualizarColaborador(editando.id, { nome: editando.nome, telefone: editando.telefone, funcao: editando.funcao }); setEditando(null); }}>Salvar</Btn></>}>
          <Field label="Nome"><Input value={editando.nome || ""} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} /></Field>
          <Field label="Telefone"><Input value={editando.telefone || ""} onChange={(e) => setEditando({ ...editando, telefone: e.target.value })} /></Field>
          <Field label="Função"><Input value={editando.funcao || ""} onChange={(e) => setEditando({ ...editando, funcao: e.target.value })} /></Field>
          <p className="text-[12.5px] text-slate-400 leading-relaxed">
            O e-mail identifica o acesso e não é alterado aqui. Para trocar de pessoa, desative este colaborador e cadastre outro —
            as ordens já executadas continuam com a empresa.
          </p>
        </Modal>
      )}

      {credencial && (
        <Modal open onClose={() => setCredencial(null)} title={credencial.reenvio ? "Novo acesso gerado" : "Acesso criado"}
          sub={credencial.nome}
          footer={<Btn onClick={() => setCredencial(null)}>Já entreguei</Btn>}>
          <div className="rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100">
            <div className="px-4 py-3.5 flex justify-between gap-3">
              <span className="text-[14px] text-slate-500">E-mail</span>
              <span className="text-[14px] text-slate-900">{credencial.email}</span>
            </div>
            {credencial.senha && <div className="px-4 py-3.5 flex items-center justify-between gap-3">
              <span className="text-[14px] text-slate-500">Senha temporária</span>
              <div className="flex items-center gap-2"><span className="text-[16px] font-semibold text-slate-900 tracking-wider tabular-nums">{credencial.senha}</span><Btn size="sm" variant="soft" icon={Copy} title="Copiar" ariaLabel="Copiar senha" onClick={() => { navigator.clipboard?.writeText(credencial.senha); aviso("Senha copiada"); }} /></div>
            </div>}
          </div>
          {credencial.convite ? <><p className="text-[13px] text-slate-600 leading-relaxed">Peça para {credencial.nome?.split(" ")[0]} criar ou entrar na conta com este mesmo e-mail. O ZiisTec vincula o acesso à sua empresa automaticamente.</p><div className="rounded-xl bg-teal-50 ring-1 ring-teal-200/70 px-4 py-3 flex gap-2.5"><Lock className="w-4 h-4 text-teal-700 mt-0.5 shrink-0" aria-hidden="true" /><p className="text-[12.5px] text-teal-900 leading-relaxed">Nenhuma senha é criada ou guardada pelo proprietário. Se a pessoa já possui conta, basta entrar. Se esquecer a senha, usa a recuperação na tela de login.</p></div></> : <><p className="text-[13px] text-slate-600 leading-relaxed">Entregue esta senha a {credencial.nome?.split(" ")[0]}. No primeiro acesso o ZiisTec vai pedir que ela crie uma senha pessoal.</p><div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/70 px-4 py-3 flex gap-2.5"><Lock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" aria-hidden="true" /><p className="text-[12.5px] text-amber-900 leading-relaxed">Esta senha aparece uma única vez e não fica guardada no sistema.</p></div></>}
        </Modal>
      )}
    </>
  );
}

/* Administração da plataforma: assinaturas e contas, nunca o conteúdo das empresas. */
function AdminPlataforma({ empresas, usuarios, membresias, assinaturas, mudarAssinatura, sair, toast }) {
  const [aba, setAba] = useState("empresas");
  const [intervencao, setIntervencao] = useState(null);
  /* mudar assinatura à mão é intervenção administrativa: sempre passa por confirmação
     e, quando o gateway existir, ele é que dita o status de pagamento */
  const pedirIntervencao = (empresaAlvo, status, nome) => setIntervencao({ empresaAlvo, status, nome });
  const [busca, setBusca] = useState("");
  const lista = empresas.filter((e) => semAcento(e.nome + e.responsavel).includes(semAcento(busca)));
  const ativas = assinaturas.filter((a) => a.status === "ativa").length;
  const receita = assinaturas.filter((a) => ST_ASSINATURA[a.status].libera).reduce((t, a) => t + a.valor, 0);

  return (
    <div className="min-h-screen bg-slate-50 font-sans antialiased">
      <header className="bg-slate-900 px-4 sm:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-teal-500 flex items-center justify-center"><span className="text-slate-900 font-bold text-sm">Z</span></div>
          <span className="text-white font-semibold tracking-tight">ZiisTec · plataforma</span>
        </div>
        <button onClick={sair} className="text-slate-300 text-[13px] flex items-center gap-2 px-2 py-1.5"><LogOut className="w-4 h-4" />Sair</button>
      </header>

      <div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-8">
        <PageHead title="Administração da plataforma" sub="Contas e assinaturas do ZiisTec. Nada aqui abre o conteúdo das empresas." />
        <Tabs valor={aba} onChange={setAba} className="mb-6"
          opcoes={[{ id: "empresas", label: "Empresas" }, { id: "financeiro", label: "Financeiro da plataforma" }]} />

        {aba === "empresas" && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Panel className="p-5"><p className="text-[12.5px] text-slate-500">Empresas</p><p className="text-[22px] font-semibold mt-1 tabular-nums">{empresas.length}</p></Panel>
          <Panel className="p-5"><p className="text-[12.5px] text-slate-500">Assinaturas ativas</p><p className="text-[22px] font-semibold mt-1 tabular-nums">{ativas}</p></Panel>
          <Panel className="p-5"><p className="text-[12.5px] text-slate-500">Usuários</p><p className="text-[22px] font-semibold mt-1 tabular-nums">{usuarios.filter((u) => !ehPlataforma(u)).length}</p></Panel>
          <Panel className="p-5 bg-slate-900 ring-slate-900"><p className="text-[12.5px] text-slate-400">Receita recorrente</p>
            <p className="text-[22px] font-semibold text-white mt-1 tabular-nums">{brl(receita)}</p></Panel>
        </div>

        <div className="mb-5 max-w-md"><SearchBox value={busca} onChange={setBusca} placeholder="Buscar empresa ou responsável" /></div>

        <Panel className="divide-y divide-slate-100 overflow-hidden">
          {lista.map((e) => {
            const a = assinaturas.find((x) => x.empresaId === e.id);
            const membros = membresias.filter((m) => m.empresaId === e.id);
            const dono = usuarios.find((u) => u.id === membros.find((m) => m.papel === "proprietario")?.usuarioId);
            const st = a ? ST_ASSINATURA[a.status] : null;
            return (
              <Linha key={e.id}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{e.nome}</p>
                    <p className="text-[13px] text-slate-500 truncate">{dono?.nome} · {dono?.email}</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">
                      cliente desde {dataBR(e.criadaEm)} · {membros.length} usuário{membros.length > 1 ? "s" : ""}
                      {dono?.ultimoAcesso ? ` · último acesso ${dataBR(dono.ultimoAcesso)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {a && <span className="text-[13px] text-slate-500 tabular-nums">{brl(a.valor)}/mês</span>}
                    {st && <Pill tone={st.tone}>{st.label}</Pill>}
                    {a && (a.status === "suspensa" || a.status === "cancelada"
                      ? <Btn size="sm" variant="soft" onClick={() => pedirIntervencao(e.id, "ativa", e.nome)}>Reativar</Btn>
                      : <Btn size="sm" variant="ghost" onClick={() => pedirIntervencao(e.id, "suspensa", e.nome)}>Suspender</Btn>)}
                  </div>
                </div>
              </Linha>
            );
          })}
        </Panel>

        </>}

        {aba === "financeiro" && <FinanceiroPlataforma empresas={empresas} assinaturas={assinaturas} mudarAssinatura={mudarAssinatura} pedirIntervencao={pedirIntervencao} />}

        <Panel className="p-5 mt-6">
          <div className="flex gap-3">
            <Lock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <p className="text-[13px] text-slate-600 leading-relaxed">
              Esta área administra contas e assinaturas. Ela não abre clientes, orçamentos, ordens, documentos ou financeiro
              das empresas — acesso de suporte a dados de cliente é outro processo, com regra própria e registro de auditoria,
              e não foi construído.
            </p>
          </div>
        </Panel>
      </div>

      {intervencao && (
        <Modal open onClose={() => setIntervencao(null)}
          title={intervencao.status === "ativa" ? "Reativar assinatura?" : "Suspender assinatura?"}
          sub={intervencao.nome}
          footer={<><Btn variant="ghost" onClick={() => setIntervencao(null)}>Voltar</Btn>
            <Btn variant="dark" onClick={() => { mudarAssinatura(intervencao.empresaAlvo, intervencao.status); setIntervencao(null); }}>
              {intervencao.status === "ativa" ? "Reativar" : "Suspender"}
            </Btn></>}>
          <p className="text-[15px] text-slate-600 leading-relaxed">
            {intervencao.status === "ativa"
              ? "A empresa volta a usar o ZiisTec imediatamente, com todos os dados de antes. Isso não registra pagamento nem quita cobrança em aberto."
              : "A empresa perde o acesso operacional e vê a tela de assinatura pausada. Nenhum dado é apagado e a reativação devolve tudo."}
          </p>
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/70 px-4 py-3 flex gap-2.5">
            <Lock className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-[12.5px] text-amber-900 leading-relaxed">
              Intervenção manual do administrador da plataforma. Quando o provedor de pagamento estiver integrado,
              o status de cobrança passa a vir dele, e esta ação deve ficar restrita a exceções registradas em auditoria.
            </p>
          </div>
        </Modal>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-slate-900 text-white text-[14px] px-4 py-3 rounded-xl shadow-lg flex items-center gap-2.5">
          <CircleCheck className="w-4 h-4 text-teal-400 shrink-0" />{toast}
        </div>
      )}
    </div>
  );
}

/* Técnico registra o trabalho extra; quem precifica é o proprietário. */
function FormAdicionalTecnico({ onAdicionar }) {
  const vazio = { nome: "", qtd: 1, unidade: "hora", obs: "" };
  const [f, setF] = useState(vazio);
  return (
    <div className="space-y-4">
      <Field label="O que foi necessário a mais">
        <CampoVoz rows={2} valor={f.nome} onChange={(v) => setF({ ...f, nome: v })}
          placeholder="Ex.: duas horas adicionais de mão de obra para refazer a passagem de cabo" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantidade"><Input type="number" min="0" step="0.5" value={f.qtd} onChange={(e) => setF({ ...f, qtd: num(e.target.value) })} /></Field>
        <Field label="Unidade">
          <Select value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>
            {UNIDADES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </Select>
        </Field>
      </div>
      <Btn className="w-full" icon={Plus} disabled={!f.nome.trim()} onClick={() => { onAdicionar(f); setF(vazio); }}>
        Registrar trabalho adicional
      </Btn>
      <p className="text-[12.5px] text-slate-400 leading-relaxed">
        Você registra o que foi feito a mais. O valor é definido pelo proprietário na conta administrativa.
      </p>
    </div>
  );
}

/* Financeiro do ZiisTec — assinaturas do SaaS. Não se cruza em nenhum ponto
   com o financeiro das empresas clientes: são estados e telas separados. */
function FinanceiroPlataforma({ empresas, assinaturas, mudarAssinatura, pedirIntervencao }) {
  const nomeEmpresa = (id) => empresas.find((e) => e.id === id)?.nome || "—";
  const ativas = assinaturas.filter((a) => a.status === "ativa");
  const trial = assinaturas.filter((a) => a.status === "trial");
  const mrr = ativas.reduce((t, a) => t + a.valor, 0);
  const inadimplentes = assinaturas.filter((a) => a.status === "pendente" || a.status === "suspensa");
  const emRisco = inadimplentes.reduce((t, a) => t + a.valor, 0);

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Panel className="p-5"><p className="text-[12.5px] text-slate-500">Receita recorrente</p>
          <p className="text-[22px] font-semibold text-slate-900 mt-1 tabular-nums">{brl(mrr)}</p>
          <p className="text-[12px] text-slate-400 mt-1">{ativas.length} assinatura(s) ativa(s)</p></Panel>
        <Panel className="p-5"><p className="text-[12.5px] text-slate-500">Em avaliação</p>
          <p className="text-[22px] font-semibold text-slate-900 mt-1 tabular-nums">{trial.length}</p>
          <p className="text-[12px] text-slate-400 mt-1">ainda sem cobrança</p></Panel>
        <Panel className="p-5"><p className="text-[12.5px] text-slate-500">Em risco</p>
          <p className={cx("text-[22px] font-semibold mt-1 tabular-nums", emRisco > 0 ? "text-rose-700" : "text-slate-900")}>{brl(emRisco)}</p>
          <p className="text-[12px] text-slate-400 mt-1">{inadimplentes.length} com pagamento em aberto</p></Panel>
        <Panel className="p-5 bg-slate-900 ring-slate-900"><p className="text-[12.5px] text-slate-400">Plano</p>
          <p className="text-[22px] font-semibold text-white mt-1 tabular-nums">{brl(PLANO.valor)}</p>
          <p className="text-[12px] text-slate-400 mt-1">{PLANO.nome}</p></Panel>
      </div>

      <Rotulo>Assinaturas</Rotulo>
      <Panel className="divide-y divide-slate-100 overflow-hidden">
        {assinaturas.map((a) => {
          const st = ST_ASSINATURA[a.status];
          const atrasada = a.status === "pendente" && a.proximaCobranca < HOJE;
          return (
            <Linha key={a.id}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{nomeEmpresa(a.empresaId)}</p>
                  <p className="text-[13px] text-slate-500">{a.plano} · início em {dataBR(a.inicio)}</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">
                    {a.status === "trial" ? `avaliação até ${dataBR(a.proximaCobranca)}` : `próxima cobrança ${dataBR(a.proximaCobranca)}`}
                    {atrasada && <span className="text-rose-700 font-medium"> · vencida</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[14px] font-semibold text-slate-900 tabular-nums">{brl(a.valor)}/mês</span>
                  <Pill tone={st.tone}>{st.label}</Pill>
                  {(a.status === "suspensa" || a.status === "cancelada")
                    ? <Btn size="sm" variant="soft" onClick={() => pedirIntervencao(a.empresaId, "ativa", nomeEmpresa(a.empresaId))}>Reativar</Btn>
                    : <Btn size="sm" variant="ghost" onClick={() => pedirIntervencao(a.empresaId, "suspensa", nomeEmpresa(a.empresaId))}>Suspender</Btn>}
                </div>
              </div>
            </Linha>
          );
        })}
      </Panel>

      <Rotulo>Pagamentos</Rotulo>
      <Panel>
        <Empty icon={CreditCard} title="Nenhum pagamento registrado"
          sub="Cobranças, aprovações, falhas, estornos, método e data de pagamento vêm do provedor de pagamento. Enquanto ele não estiver integrado, o ZiisTec não tem essa informação e não vai inventá-la." />
      </Panel>

      <Panel className="p-5 mt-6">
        <div className="flex gap-3">
          <CreditCard className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[13px] text-slate-600 leading-relaxed">
            Suspender e reativar aqui muda apenas o estado do acesso. Quando o gateway for integrado, ele passa a ser a fonte
            da verdade sobre cobrança, aprovação, falha e cancelamento — e a alteração manual de situação de pagamento deve
            exigir regra administrativa própria e ficar registrada.
          </p>
        </div>
      </Panel>
    </>
  );
}
