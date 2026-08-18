import React, { useState } from "react";
import { supabase, mensagemErro } from "../lib/supabase";

const campo = "w-full rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-3 text-[15px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-600";

export default function NovaSenha({ aoConcluir }) {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);

  const salvar = async () => {
    setErro(null);
    if (senha.length < 6) { setErro("A nova senha precisa ter ao menos 6 caracteres."); return; }
    if (senha !== confirmacao) { setErro("As duas senhas precisam ser iguais."); return; }
    setOcupado(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) { setErro(mensagemErro(error)); setOcupado(false); return; }
    await aoConcluir?.();
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans antialiased">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-teal-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-slate-900 font-bold text-2xl leading-none">Z</span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Crie uma nova senha</h1>
          <p className="text-[14px] text-slate-500 mt-1.5">Escolha uma senha nova para sua conta ZiisTec.</p>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200/70 p-6 space-y-4">
          <label className="block">
            <span className="block text-[13px] font-medium text-slate-600 mb-1.5">Nova senha</span>
            <input className={campo} type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo de 6 caracteres" />
          </label>
          <label className="block">
            <span className="block text-[13px] font-medium text-slate-600 mb-1.5">Confirme a nova senha</span>
            <input className={campo} type="password" autoComplete="new-password" value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} onKeyDown={(e) => e.key === "Enter" && salvar()} placeholder="Digite novamente" />
          </label>
          {erro && <p className="text-[13px] text-rose-700 bg-rose-50 ring-1 ring-rose-200/70 rounded-xl px-3.5 py-3">{erro}</p>}
          <button type="button" disabled={ocupado || !senha || !confirmacao} onClick={salvar}
            className="w-full inline-flex items-center justify-center rounded-xl bg-teal-700 text-white font-medium text-sm px-4 py-3 hover:bg-teal-800 disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
            {ocupado ? "Salvando…" : "Salvar nova senha"}
          </button>
        </div>
      </div>
    </div>
  );
}
