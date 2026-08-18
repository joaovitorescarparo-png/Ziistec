import React, { Suspense, lazy, useEffect, useState } from "react";
import { supabase, mensagemErro } from "../lib/supabase";
import Carregando from "./Carregando";

const PlatformAdmin = lazy(() => import("./PlatformAdmin"));

const campo = "w-full rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-3 text-[15px] text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600";
const botao = "w-full rounded-xl bg-teal-700 text-white px-4 py-3 text-sm font-medium hover:bg-teal-800 disabled:opacity-40 disabled:pointer-events-none";

export default function PlatformAdminGate({ perfil, sair }) {
  const [estado, setEstado] = useState("checando");
  const [factorId, setFactorId] = useState(null);
  const [challengeId, setChallengeId] = useState(null);
  const [qrCode, setQrCode] = useState(null);
  const [secret, setSecret] = useState(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const iniciarDesafio = async (id) => {
    const { data, error } = await supabase.auth.mfa.challenge({ factorId: id });
    if (error) throw error;
    setFactorId(id);
    setChallengeId(data.id);
    setEstado("desafio");
  };

  const checar = async () => {
    setErro(null);
    const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) throw aalError;
    if (aal.currentLevel === "aal2") {
      setEstado("liberado");
      return;
    }

    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verificado = [...(factors.totp || []), ...(factors.phone || [])]
      .find((f) => f.status === "verified");

    if (verificado) {
      await iniciarDesafio(verificado.id);
      return;
    }

    const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "ZiisTec Administração",
    });
    if (enrollError) throw enrollError;
    setFactorId(enrolled.id);
    setQrCode(enrolled.totp?.qr_code || null);
    setSecret(enrolled.totp?.secret || null);
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrolled.id });
    if (challengeError) throw challengeError;
    setChallengeId(challenge.id);
    setEstado("enrolar");
  };

  useEffect(() => {
    checar().catch((e) => {
      setErro(mensagemErro(e));
      setEstado("erro");
    });
  }, []);

  const verificar = async () => {
    if (!factorId || !challengeId || codigo.trim().length < 6) return;
    setOcupado(true); setErro(null);
    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: codigo.trim(),
      });
      if (error) throw error;
      await supabase.auth.refreshSession();
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal.currentLevel !== "aal2") throw new Error("Não foi possível elevar a segurança da sessão.");
      setEstado("liberado");
    } catch (e) {
      setErro(mensagemErro(e));
      setCodigo("");
      try { await iniciarDesafio(factorId); } catch { /* mantém mensagem original */ }
    } finally {
      setOcupado(false);
    }
  };

  if (estado === "checando") return <Carregando texto="Verificando segurança administrativa" />;

  if (estado === "liberado") {
    return (
      <Suspense fallback={<Carregando texto="Abrindo administração" />}>
        <PlatformAdmin perfil={perfil} sair={sair} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10 font-sans">
      <div className="w-full max-w-md bg-white rounded-2xl ring-1 ring-slate-200/70 p-6">
        <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold mb-5">Z</div>
        <h1 className="text-xl font-semibold text-slate-900">Proteção da administração</h1>
        <p className="text-sm text-slate-500 mt-2 leading-relaxed">
          O painel central exige autenticação em dois fatores. Uma senha sozinha não libera funções administrativas.
        </p>

        {estado === "enrolar" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-700">Adicione o ZiisTec ao seu aplicativo autenticador e informe o código de 6 dígitos.</p>
            {qrCode && /^data:image\//.test(qrCode) && (
              <div className="bg-white ring-1 ring-slate-200 rounded-xl p-4 flex justify-center">
                <img src={qrCode} alt="QR Code do autenticador" className="w-48 h-48" />
              </div>
            )}
            {secret && (
              <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
                <p className="text-xs text-slate-500">Código manual</p>
                <p className="font-mono text-sm text-slate-800 break-all mt-1 select-all">{secret}</p>
              </div>
            )}
          </div>
        )}

        {(estado === "enrolar" || estado === "desafio") && (
          <div className="mt-5 space-y-3">
            <input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              className={campo}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && verificar()}
              placeholder="000000"
              aria-label="Código de autenticação"
            />
            <button className={botao} disabled={ocupado || codigo.length < 6} onClick={verificar}>
              {ocupado ? "Verificando…" : "Confirmar segundo fator"}
            </button>
          </div>
        )}

        {erro && <p className="mt-4 text-[13px] text-rose-700 bg-rose-50 ring-1 ring-rose-200 rounded-xl px-3.5 py-3">{erro}</p>}

        {estado === "erro" && (
          <button className={`${botao} mt-5`} onClick={() => { setEstado("checando"); checar().catch((e) => { setErro(mensagemErro(e)); setEstado("erro"); }); }}>
            Tentar novamente
          </button>
        )}

        <button onClick={sair} className="w-full mt-3 px-4 py-3 text-sm text-slate-500 hover:text-slate-800">Sair da conta</button>
      </div>
    </div>
  );
}
