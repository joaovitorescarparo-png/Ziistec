import React, { useEffect } from "react";
import { LogOut, X } from "lucide-react";
import { resumoAssinatura } from "../lib/subscriptionDisplay";

const anel = "focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const PAPEL = { proprietario: "Proprietário", owner: "Proprietário", tecnico: "Técnico", technician: "Técnico" };
const TOM = {
  marca: "bg-teal-50 text-teal-800 ring-1 ring-teal-200/70",
  sucesso: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/70",
  atencao: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/70",
  erro: "bg-rose-50 text-rose-800 ring-1 ring-rose-200/70",
  neutro: "bg-slate-100 text-slate-600",
};

/* Minha conta: identidade, empresa ativa, papel e (para o proprietário) a assinatura.
   O botão de saída usa o sair() da sessão; nada de dado de plataforma aqui. */
export default function MinhaConta({ nome, email, empresa, papel, assinatura, mostrarAssinatura = false, sair, onFechar }) {
  const resumo = mostrarAssinatura ? resumoAssinatura(assinatura) : null;

  useEffect(() => {
    const fechar = (e) => { if (e.key === "Escape") onFechar?.(); };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [onFechar]);

  const linha = (rotulo, valor) => (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <dt className="text-[13px] text-slate-500 shrink-0">{rotulo}</dt>
      <dd className="text-[14px] font-medium text-slate-900 text-right min-w-0 break-words">{valor || "—"}</dd>
    </div>
  );

  return (
    <div className="zt-nao-imprime fixed inset-0 z-[70] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="zt-minha-conta-titulo">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onFechar} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl max-h-[calc(100dvh-env(safe-area-inset-top))] overflow-y-auto overscroll-contain px-5 pt-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between gap-3">
          <h2 id="zt-minha-conta-titulo" className="text-lg font-semibold text-slate-900">Minha conta</h2>
          <button onClick={onFechar} aria-label="Fechar" className={`min-h-11 min-w-11 -mr-2 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 ${anel}`}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <dl className="mt-3 divide-y divide-slate-100">
          {linha("Nome", nome)}
          {linha("E-mail", email)}
          {linha("Empresa ativa", empresa)}
          {linha("Papel", PAPEL[papel] || papel)}
        </dl>

        {resumo && (
          <section className="mt-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200/70 p-4" aria-label="Assinatura">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-slate-900">{resumo.plano}</p>
                {resumo.destaque && <p className="text-[13px] text-slate-600 mt-0.5 tabular-nums">{resumo.destaque}</p>}
              </div>
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${TOM[resumo.tom] || TOM.neutro}`}>{resumo.titulo}</span>
            </div>
            {resumo.linhas.length > 0 && (
              <dl className="mt-3 space-y-1.5">
                {resumo.linhas.map(([rotulo, valor]) => (
                  <div key={rotulo} className="flex justify-between gap-3 text-[13px]">
                    <dt className="text-slate-500">{rotulo}</dt>
                    <dd className="font-medium text-slate-900 tabular-nums">{valor}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(resumo.aviso || resumo.mensagem) && <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">{resumo.aviso || resumo.mensagem}</p>}
            {resumo.contato && <p className="text-[12.5px] font-medium text-slate-700 mt-1.5">{resumo.contato}</p>}
          </section>
        )}

        <button onClick={sair} className={`mt-5 w-full min-h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 ${anel}`}>
          <LogOut className="w-[18px] h-[18px]" aria-hidden="true" />
          Sair da conta
        </button>
      </div>
    </div>
  );
}
