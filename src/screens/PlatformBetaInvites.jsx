import React, { useEffect, useState } from "react";
import { criarConviteBetaDB, listarConvitesBetaDB, revogarConviteBetaDB } from "../lib/platformApi";
import { mensagemErro } from "../lib/supabase";
import { dataBR } from "../lib/subscriptionDisplay";

const STATUS = {
  pending: ["Pendente", "bg-sky-50 text-sky-800"],
  used: ["Utilizado", "bg-emerald-50 text-emerald-800"],
  revoked: ["Revogado", "bg-slate-100 text-slate-600"],
  expired: ["Expirado", "bg-amber-50 text-amber-800"],
};
const ASSINATURA = { trial: "Teste grátis", active: "Ativa", past_due: "Pagamento pendente", suspended: "Suspensa", canceled: "Cancelada" };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const dataHora = (v) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
// As mensagens das RPCs de convite são de produto (sem detalhe interno); as demais seguem o tradutor padrão.
const mensagem = (e) => (["22023", "P0002", "42501"].includes(e?.code) && e?.message ? e.message : mensagemErro(e));

/* Beta fechado: o administrador da plataforma (MFA) convida, acompanha e revoga.
   Nada é enviado por e-mail: o operador passa https://beta.ziistec.com para a pessoa convidada. */
export default function PlatformBetaInvites() {
  const [convites, setConvites] = useState([]);
  const [email, setEmail] = useState("");
  const [dias, setDias] = useState(7);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [revogando, setRevogando] = useState(null);

  const carregar = async () => {
    try { setErro(null); setConvites(await listarConvitesBetaDB()); }
    catch (e) { setErro(mensagem(e)); }
  };
  useEffect(() => { carregar(); }, []);

  const criar = async (e) => {
    e.preventDefault();
    const alvo = email.trim().toLowerCase();
    if (!EMAIL.test(alvo)) { setErro("Informe um e-mail válido."); return; }
    setOcupado("novo"); setErro(null); setAviso(null);
    try {
      const r = await criarConviteBetaDB(alvo, Number(dias));
      setAviso(r?.created
        ? `Convite criado para ${r.email}, válido até ${dataHora(r.expires_at)}. Envie o link https://beta.ziistec.com para a pessoa.`
        : `Já existe um convite pendente para ${r?.email || alvo}, válido até ${dataHora(r?.expires_at)}.`);
      setEmail("");
      await carregar();
    } catch (err) { setErro(mensagem(err)); }
    finally { setOcupado(null); }
  };

  const revogar = async (convite) => {
    setOcupado(convite.id); setErro(null); setAviso(null);
    try {
      await revogarConviteBetaDB(convite.id);
      setAviso(`Convite de ${convite.email} revogado.`);
      setRevogando(null);
      await carregar();
    } catch (err) { setErro(mensagem(err)); }
    finally { setOcupado(null); }
  };

  const pendentes = convites.filter((c) => c.status === "pending").length;
  const usados = convites.filter((c) => c.status === "used").length;

  return (
    <section aria-label="Convites do beta">
      <div className="mb-5">
        <h2 className="text-lg font-semibold">Beta fechado</h2>
        <p className="text-sm text-slate-500 mt-1">Só e-mails convidados criam uma empresa nova. Técnicos convidados por uma empresa não precisam de convite beta.</p>
      </div>

      <form onSubmit={criar} className="bg-white rounded-2xl ring-1 ring-slate-200/70 p-5 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1.5">E-mail do proprietário convidado</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} placeholder="cliente@empresa.com.br"
            className="w-full rounded-xl bg-white ring-1 ring-slate-200 px-3.5 py-3 text-sm outline-none focus:ring-2 focus:ring-teal-600" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1.5">Validade</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            className="min-h-11 w-full rounded-xl bg-white ring-1 ring-slate-200 px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-teal-600">
            {[7, 14, 30].map((d) => <option key={d} value={d}>{d} dias</option>)}
          </select>
        </label>
        <button type="submit" disabled={ocupado === "novo" || !email.trim()}
          className="min-h-11 rounded-xl bg-teal-700 text-white px-4 py-3 text-sm font-medium hover:bg-teal-800 disabled:opacity-40">
          {ocupado === "novo" ? "Criando…" : "Adicionar convite"}
        </button>
      </form>

      {erro && <div role="alert" className="mt-4 rounded-xl bg-rose-50 ring-1 ring-rose-200 text-rose-800 px-4 py-3 text-sm">{erro}</div>}
      {aviso && <div role="status" className="mt-4 rounded-xl bg-teal-50 ring-1 ring-teal-200 text-teal-900 px-4 py-3 text-sm break-words">{aviso}</div>}

      <p className="mt-5 mb-3 text-xs text-slate-500">{convites.length} convite{convites.length === 1 ? "" : "s"} · {pendentes} pendente{pendentes === 1 ? "" : "s"} · {usados} utilizado{usados === 1 ? "" : "s"}</p>
      <div className="bg-white rounded-2xl ring-1 ring-slate-200/70 overflow-hidden divide-y divide-slate-100">
        {convites.length === 0 ? <p className="p-6 text-sm text-slate-500">Nenhum convite criado.</p> : convites.map((c) => {
          const [rotulo, cor] = STATUS[c.status] || [c.status, "bg-slate-100 text-slate-600"];
          return (
            <div key={c.id} className="p-5 flex flex-col md:flex-row md:items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium break-all">{c.email}</p>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cor}`}>{rotulo}</span>
                </div>
                <p className="text-xs text-slate-500">Criado em {dataHora(c.created_at)} · expira em {dataHora(c.expires_at)}</p>
                {c.used_at && <p className="text-xs text-slate-500">Utilizado em {dataHora(c.used_at)}{c.company_name ? ` · empresa ${c.company_name}` : ""}</p>}
                {c.company_id && (
                  <p className="text-xs text-slate-500">
                    Assinatura: {ASSINATURA[c.subscription_status] || c.subscription_status || "—"} · período {dataBR(c.period_start)} – {dataBR(c.period_end)}
                  </p>
                )}
                {c.revoked_at && <p className="text-xs text-slate-500">Revogado em {dataHora(c.revoked_at)}</p>}
              </div>
              {c.status === "pending" && (revogando === c.id ? (
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <button disabled={ocupado === c.id} onClick={() => revogar(c)} className="min-h-11 rounded-lg bg-rose-600 text-white px-3 text-xs font-medium disabled:opacity-50">Confirmar revogação</button>
                  <button disabled={ocupado === c.id} onClick={() => setRevogando(null)} className="min-h-11 rounded-lg bg-slate-100 text-slate-700 px-3 text-xs font-medium">Voltar</button>
                </div>
              ) : (
                <button onClick={() => setRevogando(c.id)} className="min-h-11 self-start rounded-lg bg-slate-100 text-slate-700 px-3 text-xs font-medium hover:bg-slate-200">Revogar</button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
