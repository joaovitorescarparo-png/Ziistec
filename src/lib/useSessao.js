import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, mensagemErro } from "./supabase";

/* Fonte de verdade da sessão é o Supabase Auth.
   Papel e empresa vêm de company_members — nunca de constante local. */
export function useSessao() {
  const [carregando, setCarregando] = useState(true);
  const [sessaoAuth, setSessaoAuth] = useState(null);
  const [recuperandoSenha, setRecuperandoSenha] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [membresias, setMembresias] = useState([]);
  const [empresaId, setEmpresaId] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [assinatura, setAssinatura] = useState(null);
  const [erro, setErro] = useState(null);
  const usuarioAnterior = useRef(null);

  const limpar = useCallback(() => {
    setPerfil(null); setMembresias([]); setEmpresaId(null);
    setEmpresa(null); setAssinatura(null); setErro(null);
  }, []);

  /* troca de usuário nunca herda estado do anterior */
  useEffect(() => {
    const uid = sessaoAuth?.user?.id || null;
    if (usuarioAnterior.current && usuarioAnterior.current !== uid) limpar();
    usuarioAnterior.current = uid;
  }, [sessaoAuth, limpar]);

  useEffect(() => {
    if (!supabase) { setCarregando(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSessaoAuth(data.session || null);
      setCarregando(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (evento === "PASSWORD_RECOVERY") setRecuperandoSenha(true);
      setSessaoAuth(sessao || null);
      if (!sessao) { setRecuperandoSenha(false); limpar(); }
    });
    return () => sub.subscription.unsubscribe();
  }, [limpar]);

  const carregarContexto = useCallback(async () => {
    if (!supabase || !sessaoAuth?.user || recuperandoSenha) return;
    setErro(null);
    try {
      /* convites pendentes viram membresia antes de qualquer leitura */
      await supabase.rpc("zt_accept_invites");

      const { data: p, error: e1 } = await supabase
        .from("profiles")
        .select("id, full_name, email, phone, is_platform_admin, last_seen_at")
        .eq("id", sessaoAuth.user.id)
        .maybeSingle();
      if (e1) throw e1;
      setPerfil(p);

      const { data: ms, error: e2 } = await supabase
        .from("company_members")
        .select("id, company_id, role, status, job_title, companies(*)")
        .eq("user_id", sessaoAuth.user.id)
        .eq("status", "active");
      if (e2) throw e2;
      setMembresias(ms || []);

      /* uma empresa: entra direto. Várias: o seletor usa este mesmo estado. */
      const escolhida = (ms || []).find((m) => m.company_id === empresaId) || (ms || [])[0] || null;
      if (escolhida) {
        setEmpresaId(escolhida.company_id);
        setEmpresa(escolhida.companies);

        /* Trial/assinatura vencida é recalculada no servidor antes de liberar o app. */
        const { error: refreshError } = await supabase.rpc("zt_refresh_subscription_status", { p_company: escolhida.company_id });
        if (refreshError) throw refreshError;

        const { data: sub, error: e3 } = await supabase
          .from("subscriptions").select("*")
          .eq("company_id", escolhida.company_id).maybeSingle();
        if (e3) throw e3;
        setAssinatura(sub);
      } else {
        setEmpresaId(null); setEmpresa(null); setAssinatura(null);
      }

      await supabase.from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", sessaoAuth.user.id);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, [sessaoAuth, empresaId, recuperandoSenha]);

  useEffect(() => {
    if (sessaoAuth?.user && !recuperandoSenha) carregarContexto();
  }, [sessaoAuth?.user?.id, recuperandoSenha]);

  const membresiaAtual = membresias.find((m) => m.company_id === empresaId) || null;

  const sair = useCallback(async () => {
    await supabase?.auth.signOut();
    setRecuperandoSenha(false);
    limpar();
  }, [limpar]);

  const finalizarRecuperacaoSenha = useCallback(async () => {
    await supabase?.auth.signOut();
    setRecuperandoSenha(false);
    limpar();
    window.history.replaceState({}, "", "/");
  }, [limpar]);

  return {
    carregando, sessaoAuth, recuperandoSenha, perfil, membresias, membresiaAtual,
    empresa, empresaId, assinatura, erro,
    papel: membresiaAtual?.role || null,
    ehPlataforma: Boolean(perfil?.is_platform_admin),
    precisaEmpresa: Boolean(sessaoAuth?.user && perfil && membresias.length === 0),
    trocarEmpresa: setEmpresaId,
    recarregar: carregarContexto,
    finalizarRecuperacaoSenha,
    sair,
  };
}
