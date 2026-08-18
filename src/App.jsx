import React, { Suspense, lazy, useMemo } from "react";
import { useSessao } from "./lib/useSessao";
import { supabase, mensagemErro, configurado } from "./lib/supabase";
import Login from "./screens/Login";
import NovaSenha from "./screens/NovaSenha";
import Onboarding from "./screens/Onboarding";
import Carregando from "./screens/Carregando";

const ZiisTecApp = lazy(() => import("./legacy/ZiisTecApp"));
const PlatformAdmin = lazy(() => import("./screens/PlatformAdmin"));

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

export default function App() {
  const s = useSessao();

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

  if (!configurado) return <Login />;
  if (s.carregando) return <Carregando texto="Abrindo o ZiisTec" />;
  if (s.recuperandoSenha && s.sessaoAuth) return <NovaSenha aoConcluir={s.finalizarRecuperacaoSenha} />;
  if (!s.sessaoAuth) return <Login />;

  if (s.erro) {
    return (
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
    return (
      <Suspense fallback={<Carregando texto="Abrindo administração" />}>
        <PlatformAdmin perfil={s.perfil} sair={s.sair} />
      </Suspense>
    );
  }

  if (s.precisaEmpresa) {
    return <Onboarding perfil={s.perfil} sair={s.sair} aoCriar={async () => { await s.recarregar(); }} />;
  }

  if (!contexto || s.trocandoEmpresa) return <Carregando texto={s.trocandoEmpresa ? "Trocando de empresa" : "Carregando sua empresa"} />;

  return (
    <>
      <SeletorEmpresa sessao={s} />
      <Suspense fallback={<Carregando texto="Carregando seu ambiente" />}>
        <ZiisTecApp key={contexto.chave} contexto={contexto} />
      </Suspense>
    </>
  );
}
