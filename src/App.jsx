import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useSessao } from "./lib/useSessao";
import { supabase, mensagemErro, configurado } from "./lib/supabase";
import Login from "./screens/Login";
import NovaSenha from "./screens/NovaSenha";
import Onboarding from "./screens/Onboarding";
import Carregando from "./screens/Carregando";

const ZiisTecApp = lazy(() => import("./legacy/ZiisTecApp"));
const PlatformAdminGate = lazy(() => import("./screens/PlatformAdminGate"));
const WorkspaceV2Home = lazy(() => import("./screens/v2/WorkspaceV2Home"));
const ProductStockV2 = lazy(() => import("./screens/v2/ProductStockV2"));
const PurchasesV2 = lazy(() => import("./screens/v2/PurchasesV2"));
const QuoteAIV2 = lazy(() => import("./screens/v2/QuoteAIV2"));
const QuotesManagementV2 = lazy(() => import("./screens/v2/QuotesManagementV2"));
const WorkOrderSaleV2 = lazy(() => import("./screens/v2/WorkOrderSaleV2"));
const WorkOrderMemoryV2 = lazy(() => import("./screens/v2/WorkOrderMemoryV2"));
const ManualWarrantyV2 = lazy(() => import("./screens/v2/ManualWarrantyV2"));
const MaintenanceContractsV2 = lazy(() => import("./screens/v2/MaintenanceContractsV2"));
const FinanceV2 = lazy(() => import("./screens/v2/FinanceV2"));

const PAPEL = { owner: "proprietario", technician: "tecnico" };
const STATUS_ASSINATURA = {
  trial: "trial", active: "ativa", past_due: "pendente",
  suspended: "suspensa", canceled: "cancelada",
};

function paraEmpresaApp(c) {
  return {
    id: c.id,
    nome: c.name || "",
    fantasia: c.trade_name || "",
    documento: c.tax_id || "",
    atividade: c.activity || "",
    telefone: c.phone || "",
    whatsapp: c.whatsapp || "",
    email: c.email || "",
    endereco: c.address || "",
    responsavel: c.owner_name || "",
    temEquipe: Boolean(c.has_team),
    validadePadrao: c.default_validity_days ?? 15,
    condicaoPadrao: c.default_payment_terms || "",
    observacaoPadrao: c.default_notes || "",
    logoPath: c.logo_path || null,
    criadaEm: (c.created_at || "").slice(0, 10),
  };
}

function paraEmpresaBanco(d) {
  return {
    name: d.nome, trade_name: d.fantasia || null, tax_id: d.documento || null,
    activity: d.atividade || null, phone: d.telefone || null, whatsapp: d.whatsapp || null,
    email: d.email || null, address: d.endereco || null, owner_name: d.responsavel || null,
    has_team: Boolean(d.temEquipe), default_validity_days: d.validadePadrao ?? 15,
    default_payment_terms: d.condicaoPadrao || null, default_notes: d.observacaoPadrao || null,
  };
}

function EstadoConexao() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [voltou, setVoltou] = useState(false);
  useEffect(() => {
    let timer;
    const on = () => {
      setOnline(true); setVoltou(true);
      clearTimeout(timer); timer = setTimeout(() => setVoltou(false), 3500);
    };
    const off = () => { clearTimeout(timer); setVoltou(false); setOnline(false); };
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { clearTimeout(timer); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (online && !voltou) return null;
  return (
    <div role="status" className={`fixed left-1/2 top-3 z-[10000] -translate-x-1/2 rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg ${online ? "bg-emerald-700 text-white" : "bg-amber-500 text-slate-950"}`}>
      {online ? "Conexão restabelecida" : "Sem internet — aguarde a conexão voltar antes de salvar"}
    </div>
  );
}

function SeletorEmpresa({ sessao }) {
  if (sessao.membresias.length < 2) return null;
  return (
    <div className="fixed top-3 right-3 z-[9999] rounded-xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur px-2 py-1.5">
      <select
        aria-label="Empresa ativa"
        disabled={sessao.trocandoEmpresa}
        value={sessao.empresaId || ""}
        onChange={(e) => sessao.trocarEmpresa(e.target.value)}
        className="max-w-[220px] bg-transparent text-xs font-medium text-slate-700 outline-none disabled:opacity-60"
      >
        {sessao.membresias.map((m) => (
          <option key={m.company_id} value={m.company_id}>
            {m.companies?.trade_name || m.companies?.name || "Empresa"}
          </option>
        ))}
      </select>
    </div>
  );
}

function AtalhoV2({ onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen("home")}
      className="fixed bottom-5 right-5 z-[9500] rounded-2xl border border-emerald-200 bg-emerald-700 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-800"
      title="Abrir a nova Stack V2"
    >
      Abrir Stack V2
    </button>
  );
}

const workspaceInicial = () => {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("v2") || null;
};

export default function App() {
  const s = useSessao();
  const [workspaceV2, setWorkspaceV2] = useState(workspaceInicial);

  const navegarV2 = (valor) => {
    setWorkspaceV2(valor || null);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (valor) url.searchParams.set("v2", valor);
    else url.searchParams.delete("v2");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const contexto = useMemo(() => {
    if (!s.empresa || !s.membresiaAtual || !s.perfil) return null;
    const empresa = paraEmpresaApp(s.empresa);
    const usuarios = [{
      id: s.perfil.id, nome: s.perfil.full_name || s.perfil.email, email: s.perfil.email,
      papelPlataforma: s.perfil.is_platform_admin ? "platform_admin" : undefined,
      ultimoAcesso: (s.perfil.last_seen_at || "").slice(0, 10) || null,
    }];
    const membresias = s.membresias.map((m) => ({
      id: m.id, usuarioId: s.perfil.id, empresaId: m.company_id,
      papel: PAPEL[m.role] || "tecnico", ativo: m.status === "active",
      desde: (m.created_at || "").slice(0, 10),
    }));
    const assinatura = s.assinatura
      ? {
          id: s.assinatura.id, empresaId: s.assinatura.company_id,
          plano: s.assinatura.plan, valor: Number(s.assinatura.amount),
          status: STATUS_ASSINATURA[s.assinatura.status] || "ativa",
          inicio: s.assinatura.current_period_start,
          proximaCobranca: s.assinatura.current_period_end,
        }
      : null;

    return {
      chave: `${s.perfil.id}:${s.empresaId}:${s.membresiaAtual.role}:${s.assinatura?.status}`,
      empresa, usuarios, membresias, assinatura,
      sessao: { usuarioId: s.perfil.id, membresiaId: s.membresiaAtual.id },
      sair: s.sair,
      recarregar: s.recarregar,
      salvarEmpresa: async (dados) => {
        const { error } = await supabase.from("companies")
          .update(paraEmpresaBanco(dados)).eq("id", s.empresaId);
        return error ? mensagemErro(error) : null;
      },
    };
  }, [s.perfil, s.empresa, s.membresiaAtual, s.assinatura, s.membresias, s.empresaId, s.sair, s.recarregar]);

  const comConexao = (conteudo) => <><EstadoConexao />{conteudo}</>;

  if (!configurado) return comConexao(<Login />);
  if (s.carregando) return comConexao(<Carregando texto="Abrindo o ZiisTec" />);
  if (s.recuperandoSenha && s.sessaoAuth) return comConexao(<NovaSenha aoConcluir={s.finalizarRecuperacaoSenha} />);
  if (!s.sessaoAuth) return comConexao(<Login />);

  if (s.erro) {
    return comConexao(
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 font-sans">
        <div className="max-w-md text-center">
          <p className="text-[15px] text-slate-800 font-medium">Não consegui carregar sua conta</p>
          <p className="text-[14px] text-slate-500 mt-2 leading-relaxed">{s.erro}</p>
          <div className="flex gap-3 justify-center mt-6">
            <button onClick={s.recarregar} className="rounded-xl bg-teal-700 text-white text-sm px-4 py-3 font-medium">Tentar de novo</button>
            <button onClick={s.sair} className="rounded-xl text-slate-600 text-sm px-4 py-3 hover:bg-slate-100">Sair</button>
          </div>
        </div>
      </div>
    );
  }

  if (s.ehPlataforma && s.perfil) {
    return comConexao(
      <Suspense fallback={<Carregando texto="Verificando administração" />}>
        <PlatformAdminGate perfil={s.perfil} sair={s.sair} />
      </Suspense>
    );
  }

  if (s.precisaEmpresa) {
    return comConexao(<Onboarding perfil={s.perfil} sair={s.sair} aoCriar={async () => { await s.recarregar(); }} />);
  }

  if (!contexto || s.trocandoEmpresa) return comConexao(<Carregando texto={s.trocandoEmpresa ? "Trocando de empresa" : "Carregando sua empresa"} />);

  const owner = s.membresiaAtual?.role === "owner";
  const companyName = contexto.empresa.fantasia || contexto.empresa.nome;
  const workspaceProps = { companyId:s.empresaId, companyName, userId:s.perfil.id, onClose:() => navegarV2("home") };

  if (workspaceV2 === "home") return comConexao(<Suspense fallback={<Carregando texto="Abrindo a nova Stack"/>}><WorkspaceV2Home companyName={companyName} owner={owner} onOpen={navegarV2} onClose={() => navegarV2(null)}/></Suspense>);
  if (workspaceV2 === "produtos" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo produtos e estoque"/>}><ProductStockV2 {...workspaceProps}/></Suspense>);
  if (workspaceV2 === "compras" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo compras"/>}><PurchasesV2 {...workspaceProps}/></Suspense>);
  if (workspaceV2 === "orcamentos" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo gestão de orçamentos"/>}><QuotesManagementV2 {...workspaceProps} onNew={() => navegarV2("orcamento-ia")}/></Suspense>);
  if (workspaceV2 === "orcamento-ia" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo orçamento com IA"/>}><QuoteAIV2 {...workspaceProps} onClose={() => navegarV2("orcamentos")}/></Suspense>);
  if (workspaceV2 === "garantias" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo garantias"/>}><ManualWarrantyV2 {...workspaceProps}/></Suspense>);
  if (workspaceV2 === "contratos" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo preventivas e contratos"/>}><MaintenanceContractsV2 {...workspaceProps}/></Suspense>);
  if (workspaceV2 === "financeiro" && owner) return comConexao(<Suspense fallback={<Carregando texto="Abrindo financeiro"/>}><FinanceV2 {...workspaceProps}/></Suspense>);
  if (workspaceV2 === "venda-os") return comConexao(<Suspense fallback={<Carregando texto="Abrindo venda na ordem de serviço"/>}><WorkOrderSaleV2 {...workspaceProps}/></Suspense>);
  if (workspaceV2 === "memoria-os") return comConexao(<Suspense fallback={<Carregando texto="Abrindo memória técnica"/>}><WorkOrderMemoryV2 {...workspaceProps} owner={owner}/></Suspense>);

  return comConexao(
    <>
      <SeletorEmpresa sessao={s} />
      <Suspense fallback={<Carregando texto="Carregando seu ambiente" />}>
        <ZiisTecApp key={contexto.chave} contexto={contexto} />
      </Suspense>
      <AtalhoV2 onOpen={navegarV2} />
    </>
  );
}