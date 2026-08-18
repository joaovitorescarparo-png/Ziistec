import React, { useState } from "react";
import { supabase, mensagemErro } from "../lib/supabase";

const anel = "focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2";
const campo = "w-full rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-3 text-[15px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-600";

/* Empresa + membresia de owner + assinatura trial nascem juntas, na RPC.
   O frontend não insere em companies/company_members/subscriptions. */
export default function Onboarding({ perfil, aoCriar, sair }) {
  const [passo, setPasso] = useState(0);
  const [f, setF] = useState({ nome: "", atividade: "", temEquipe: false });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  const passos = [
    { chave: "nome", label: "Qual é o nome do seu negócio?", place: "Ex.: JR Serviços Técnicos" },
    { chave: "atividade", label: "O que você faz?", place: "Ex.: elétrica, automação e CFTV" },
  ];

  const criar = async () => {
    setOcupado(true); setErro(null);
    const { data, error } = await supabase.rpc("zt_create_company", {
      p_name: f.nome.trim(),
      p_activity: f.atividade.trim() || null,
      p_has_team: f.temEquipe,
      p_owner_name: perfil?.full_name || null,
      p_phone: perfil?.phone || null,
    });
    if (error) { setErro(mensagemErro(error)); setOcupado(false); return; }
    await aoCriar(data);
    setOcupado(false);
  };

  const atual = passos[passo];
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans antialiased">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-teal-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-slate-900 font-bold text-2xl leading-none">Z</span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Vamos configurar sua empresa</h1>
          <p className="text-[14px] text-slate-500 mt-1.5">Leva menos de um minuto. O resto você completa depois.</p>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200/70 p-6 space-y-5">
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= passo ? "bg-teal-600" : "bg-slate-200"}`} />
            ))}
          </div>

          {atual ? (
            <label className="block">
              <span className="block text-[13px] font-medium text-slate-600 mb-1.5">{atual.label}</span>
              <input className={campo} autoFocus value={f[atual.chave]} placeholder={atual.place}
                onChange={(e) => setF({ ...f, [atual.chave]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && f[atual.chave].trim() && setPasso(passo + 1)} />
            </label>
          ) : (
            <div>
              <p className="text-[13px] font-medium text-slate-600 mb-3">Como você trabalha?</p>
              <div className="flex gap-2">
                {[[false, "Trabalho sozinho"], [true, "Tenho equipe"]].map(([v, label]) => (
                  <button key={label} onClick={() => setF({ ...f, temEquipe: v })}
                    className={`flex-1 py-3.5 rounded-xl text-[15px] font-medium transition-colors ${anel} ${
                      f.temEquipe === v ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200 text-slate-600"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[12.5px] text-slate-500 mt-3 leading-relaxed">
                Trabalhando sozinho, você é o responsável padrão pelas ordens e o ZiisTec não pergunta isso a cada agendamento.
              </p>
            </div>
          )}

          {erro && <p className="text-[13px] text-rose-700 bg-rose-50 ring-1 ring-rose-200/70 rounded-xl px-3.5 py-3">{erro}</p>}

          <div className="flex justify-between gap-3">
            <button onClick={() => (passo === 0 ? sair() : setPasso(passo - 1))}
              className={`text-sm px-4 py-3 rounded-xl text-slate-600 hover:bg-slate-100 ${anel}`}>
              {passo === 0 ? "Sair" : "Voltar"}
            </button>
            {atual ? (
              <button disabled={!f[atual.chave].trim()} onClick={() => setPasso(passo + 1)}
                className={`text-sm px-4 py-3 rounded-xl bg-teal-700 text-white font-medium disabled:opacity-40 ${anel}`}>
                Continuar
              </button>
            ) : (
              <button disabled={ocupado} onClick={criar}
                className={`text-sm px-4 py-3 rounded-xl bg-teal-700 text-white font-medium disabled:opacity-40 ${anel}`}>
                {ocupado ? "Criando…" : "Entrar no ZiisTec"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
