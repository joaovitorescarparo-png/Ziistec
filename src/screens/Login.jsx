import React, { useState } from "react";
import { supabase, mensagemErro, configurado } from "../lib/supabase";

const anel = "focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50";
const campo = "w-full rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-3 text-[15px] text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-600";

function Botao({ children, onClick, variante = "primary", className = "", disabled, tipo = "button" }) {
  const estilos = {
    primary: "bg-teal-700 text-white hover:bg-teal-800",
    soft: "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
  };
  return (
    <button type={tipo} onClick={onClick} disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium text-sm px-4 py-3 transition-colors disabled:opacity-40 disabled:pointer-events-none ${estilos[variante]} ${anel} ${className}`}>
      {children}
    </button>
  );
}

const Campo = ({ label, children, dica }) => (
  <label className="block">
    <span className="block text-[13px] font-medium text-slate-600 mb-1.5">{label}</span>
    {children}
    {dica && <span className="block text-xs text-slate-400 mt-1.5">{dica}</span>}
  </label>
);

export default function Login() {
  const [modo, setModo] = useState("entrar");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [nome, setNome] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);

  const entrar = async () => {
    if (!email.trim() || !senha) return;
    setOcupado(true); setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) setErro(mensagemErro(error));
    setOcupado(false);
  };

  const criarConta = async () => {
    if (senha.length < 8) { setErro("Use uma senha com pelo menos 8 caracteres."); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password: senha,
      options: { data: { full_name: nome.trim() } },
    });
    if (error) setErro(mensagemErro(error));
    else if (!data.session) setAviso("Conta criada. Confirme o e-mail que enviamos e entre em seguida.");
    setOcupado(false);
  };

  const google = async () => {
    setOcupado(true); setErro(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google", options: { redirectTo: window.location.origin },
    });
    if (error) setErro(mensagemErro(error));
    setOcupado(false);
  };

  const recuperar = async () => {
    if (!email.trim()) { setErro("Informe seu e-mail para receber o link."); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) setErro(mensagemErro(error));
    else setAviso("Se existir uma conta com esse e-mail, enviaremos as instruções de recuperação.");
  };

  if (!configurado) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 font-sans">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold text-slate-900">Configuração pendente</h1>
          <p className="text-[15px] text-slate-600 mt-3 leading-relaxed">
            Crie um arquivo <span className="font-medium">.env</span> na raiz do projeto com
            <span className="font-medium"> VITE_SUPABASE_URL</span> e
            <span className="font-medium"> VITE_SUPABASE_ANON_KEY</span>, e reinicie o servidor.
          </p>
        </div>
      </div>
    );
  }

  const criando = modo === "criar";
  const pronto = email.trim() && (criando ? senha.length >= 8 && nome.trim() : Boolean(senha));

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans antialiased">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-teal-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-slate-900 font-bold text-2xl leading-none">Z</span>
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {criando ? "Criar conta no ZiisTec" : "Entre na sua conta"}
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5">Gestão de serviços para quem trabalha em campo.</p>
        </div>

        <div className="bg-white rounded-2xl ring-1 ring-slate-200/70 p-6 space-y-4">
          {criando && (
            <Campo label="Seu nome">
              <input className={campo} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" maxLength={200} />
            </Campo>
          )}
          <Campo label="E-mail">
            <input className={campo} type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" maxLength={320} />
          </Campo>
          <Campo label="Senha" dica={criando ? "Use pelo menos 8 caracteres. Uma senha única e longa é mais segura." : undefined}>
            <input className={campo} type="password" value={senha}
              autoComplete={criando ? "new-password" : "current-password"}
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && pronto && (criando ? criarConta() : entrar())}
              placeholder="Sua senha" />
          </Campo>

          {erro && <p className="text-[13px] text-rose-700 bg-rose-50 ring-1 ring-rose-200/70 rounded-xl px-3.5 py-3">{erro}</p>}
          {aviso && <p className="text-[13px] text-teal-900 bg-teal-50 ring-1 ring-teal-200/70 rounded-xl px-3.5 py-3">{aviso}</p>}

          <Botao className="w-full" disabled={!pronto || ocupado} onClick={criando ? criarConta : entrar}>
            {ocupado ? "Aguarde…" : criando ? "Criar conta" : "Entrar"}
          </Botao>

          <div className="flex items-center gap-3">
            <span className="h-px bg-slate-200 flex-1" /><span className="text-[12px] text-slate-400">ou</span><span className="h-px bg-slate-200 flex-1" />
          </div>
          <Botao variante="soft" className="w-full" disabled={ocupado} onClick={google}>Entrar com Google</Botao>

          <div className="flex justify-between text-[13px] pt-1">
            {!criando
              ? <button onClick={recuperar} className={`text-slate-500 hover:text-slate-800 ${anel}`}>Esqueci minha senha</button>
              : <span />}
            <button onClick={() => { setModo(criando ? "entrar" : "criar"); setErro(null); setAviso(null); }}
              className={`font-medium text-teal-800 hover:underline ${anel}`}>
              {criando ? "Já tenho conta" : "Criar conta"}
            </button>
          </div>
        </div>

        <p className="text-[12px] text-slate-400 text-center mt-5 leading-relaxed">
          Se você foi convidado por uma empresa, entre com o mesmo e-mail do convite:
          o acesso é liberado automaticamente.
        </p>
      </div>
    </div>
  );
}
