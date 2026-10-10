import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, mensagemErro } from "./supabase";

/* Fonte de verdade da sessão é o Supabase Auth.
   Papel e empresa vêm de company_members — nunca de constante local. */
export function useSessao() {
  const [carregando, setCarregando] = useState(true);
  const [trocandoEmpresa, setTrocandoEmpresa] = useState(false);
  const [sessaoAuth, setSessaoAuth] = useState(null);
  const [recuperandoSenha, setRecuperandoSenha] = useState(false);
  const [perfil, setPerfil] = useState(null);
  const [membresias, setMembresias] = useState([]);
  const [empresaId, setEmpresaId] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [assinatura, setAssinatura] = useState(null);
  const [erro, setErro] = useState(null);
  const usuarioAnterior = useRef(null);
  const ultimaRevalidacao = useRef(0);

  const limpar = useCallback(() => {
    setPerfil(null); setMembresias([]); setEmpresaId(null);
    setEmpresa(null); setAssinatura(null); setErro(null);
    setTrocandoEmpresa(false);
  }, []);

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

  const carregarTenant = useCallback(async (membresia, { persistir = true } = {}) => {
    if (!membresia) {
      setEmpresaId(null); setEmpresa(null); setAssinatura(null);
      return;
    }

    const alvo = membresia.company_id;
    const { error: refreshError } = await supabase.rpc("zt_refresh_subscription_status", { p_company: alvo });
    if (refreshError) throw refreshError;

    const { data: sub, error: e3 } = await supabase
      .from("subscriptions").select("*")
      .eq("company_id", alvo).maybeSingle();
    if (e3) throw e3;

    if (persistir) localStorage.setItem("ziistec_empresa_id", alvo);
    /* React 18 agrupa estes updates; nunca expõe papel de um tenant com dados de outro. */
    setEmpresa(membresia.companies || null);
    setAssinatura(sub || null);
    setEmpresaId(alvo);
  }, []);

  const carregarContexto = useCallback(async () => {
    if (!supabase || !sessaoAuth?.user || recuperandoSenha) return;
    setErro(null);
    try {
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
        .select("id, company_id, role, status, job_title, created_at, companies(*)")
        .eq("user_id", sessaoAuth.user.id)
        .eq("status", "active");
      if (e2) throw e2;
      const lista = ms || [];
      setMembresias(lista);

      const salvo = localStorage.getItem("ziistec_empresa_id");
      const escolhida = lista.find((m) => m.company_id === empresaId)
        || lista.find((m) => m.company_id === salvo)
        || lista[0]
        || null;
      await carregarTenant(escolhida, { persistir: Boolean(escolhida) });

      await supabase.from("profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", sessaoAuth.user.id);
    } catch (e) {
      setErro(mensagemErro(e));
    }
  }, [sessaoAuth?.user?.id, recuperandoSenha, carregarTenant, empresaId]);

  useEffect(() => {
    if (sessaoAuth?.user && !recuperandoSenha) carregarContexto();
  }, [sessaoAuth?.user?.id, recuperandoSenha, carregarContexto]);

  /*
    Revogação de acesso:
    - RLS já bloqueia imediatamente toda NOVA requisição quando status deixa de ser active.
    - ao voltar ao app/foco, também limpamos a visão antiga que poderia estar em memória.
    Não fazemos polling contínuo: evitamos carga desnecessária e revalidamos no momento em
    que o usuário volta a interagir com a aplicação.
  */
  const revalidarAcesso = useCallback(async () => {
    if (!supabase || !sessaoAuth?.user || recuperandoSenha) return;
    const agora = Date.now();
    if (agora - ultimaRevalidacao.current < 3000) return;
    ultimaRevalidacao.current = agora;

    try {
      const { data: ms, error } = await supabase
        .from("company_members")
        .select("id, company_id, role, status, job_title, created_at, companies(*)")
        .eq("user_id", sessaoAuth.user.id)
        .eq("status", "active");
      if (error) throw error;

      const lista = ms || [];
      setMembresias(lista);
      const atual = lista.find((m) => m.company_id === empresaId) || null;

      if (!atual) {
        const salvo = localStorage.getItem("ziistec_empresa_id");
        const alternativa = lista.find((m) => m.company_id === salvo) || lista[0] || null;
        if (!alternativa) {
          setEmpresaId(null);
          setEmpresa(null);
          setAssinatura(null);
          setErro("Seu acesso ativo a esta empresa não está mais disponível.");
          return;
        }
        await carregarTenant(alternativa, { persistir: true });
        setErro(null);
        return;
      }

      // Também atualiza mudança de papel e status de assinatura sem manter contexto antigo.
      await carregarTenant(atual, { persistir: false });
      setErro(null);
    } catch (e) {
      // Falha de rede ao retomar o app não deve apagar uma sessão válida localmente.
      // O RLS continua sendo a autoridade para qualquer operação subsequente.
      if (navigator.onLine) setErro(mensagemErro(e));
    }
  }, [sessaoAuth?.user?.id, recuperandoSenha, empresaId, carregarTenant]);

  useEffect(() => {
    if (!sessaoAuth?.user || recuperandoSenha) return;
    const aoFocar = () => revalidarAcesso();
    const aoVisibilizar = () => {
      if (document.visibilityState === "visible") revalidarAcesso();
    };
    window.addEventListener("focus", aoFocar);
    document.addEventListener("visibilitychange", aoVisibilizar);
    return () => {
      window.removeEventListener("focus", aoFocar);
      document.removeEventListener("visibilitychange", aoVisibilizar);
    };
  }, [sessaoAuth?.user?.id, recuperandoSenha, revalidarAcesso]);

  const trocarEmpresa = useCallback(async (novoId) => {
    if (!novoId || novoId === empresaId || trocandoEmpresa) return;
    const destino = membresias.find((m) => m.company_id === novoId);
    if (!destino) {
      setErro("Você não possui acesso ativo a esta empresa.");
      return;
    }
    setTrocandoEmpresa(true);
    setErro(null);
    try {
      await carregarTenant(destino);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setTrocandoEmpresa(false);
    }
  }, [empresaId, membresias, trocandoEmpresa, carregarTenant]);

  const membresiaAtual = membresias.find((m) => m.company_id === empresaId) || null;

  const sair = useCallback(async () => {
    await supabase?.auth.signOut();
    localStorage.removeItem("ziistec_empresa_id");
    setRecuperandoSenha(false);
    limpar();
  }, [limpar]);

  const finalizarRecuperacaoSenha = useCallback(async () => {
    await supabase?.auth.signOut();
    localStorage.removeItem("ziistec_empresa_id");
    setRecuperandoSenha(false);
    limpar();
    window.history.replaceState({}, "", "/");
  }, [limpar]);

  return {
    carregando, trocandoEmpresa, sessaoAuth, recuperandoSenha, perfil, membresias, membresiaAtual,
    empresa, empresaId, assinatura, erro,
    papel: membresiaAtual?.role || null,
    ehPlataforma: Boolean(perfil?.is_platform_admin),
    precisaEmpresa: Boolean(sessaoAuth?.user && perfil && membresias.length === 0),
    trocarEmpresa,
    recarregar: carregarContexto,
    finalizarRecuperacaoSenha,
    sair,
  };
}
