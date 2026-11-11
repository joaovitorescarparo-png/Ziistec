import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, BookOpen, ChevronRight, ClipboardList, ExternalLink,
  FileText, Layers, Link2, Loader2, Pencil, Plus, Search, Star, Trash2, Upload, WifiOff, Wrench,
} from 'lucide-react';
import {
  DIFICULDADE, TIPOS_DOC, TIPOS_SECAO, abrirEquipamentoCT, alternarFavoritoCT,
  arquivarDocumentoCT, buscarEquipamentosCT, carregarHomeCT, casosEquipamentoCT,
  enviarDocumentoArquivoCT, guardarFichaCache, lerFichaCache, listarFabricantesCT,
  listarModelosCategoriaCT, salvarDocumentoUrlCT, salvarFabricanteCT, salvarFichaCT,
  salvarModeloCT, urlDocumentoCT,
} from '../lib/centralTecnicaApi';

/*
  Central Técnica — biblioteca operacional de campo.
  Leitura para qualquer membro; gestão do acervo privado só para quem tem a
  permissão de gerir. Conteúdo global da ZiisTec chega somente leitura: a escrita
  é administrativa (platform admin AAL2), nunca um botão escondido aqui.
*/

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const cx = (...c) => c.filter(Boolean).join(' ');
const dataBR = (v) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—');
const SECAO_LABEL = Object.fromEntries(TIPOS_SECAO.map((s) => [s.id, s.label]));
const DOC_LABEL = Object.fromEntries(TIPOS_DOC.map((d) => [d.id, d.label]));
const ehEsquema = (d) => d.tipo === 'diagram' || d.tipo === 'installation';

const Card = ({ children, className }) => (
  <div className={cx('rounded-2xl bg-white ring-1 ring-slate-200/70', className)}>{children}</div>
);
const Pill = ({ children, tom = 'neutro' }) => (
  <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
    tom === 'marca' ? 'bg-teal-50 text-teal-800 ring-1 ring-teal-200/70'
      : tom === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/70'
      : tom === 'atencao' ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/70'
      : 'bg-slate-100 text-slate-600')}>{children}</span>
);
function Btn({ children, onClick, icon: Icon, variant = 'primary', size = 'md', disabled, title, type = 'button' }) {
  const variants = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800',
    soft: 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
    quiet: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} aria-label={title}
      className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' ? 'px-3 py-2 text-[13px]' : 'px-4 py-2.5 text-[14px]', variants[variant], ring)}>
      {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
const Vazio = ({ icon: Icon, titulo, texto, acao }) => (
  <div className="px-6 py-12 text-center">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-300 ring-1 ring-slate-200/70">
      <Icon className="h-5 w-5" aria-hidden="true" />
    </div>
    <p className="mt-4 font-medium text-slate-800">{titulo}</p>
    {texto ? <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-slate-500">{texto}</p> : null}
    {acao ? <div className="mt-5 flex justify-center">{acao}</div> : null}
  </div>
);
const Busca = ({ valor, onChange, placeholder, autoFocus }) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
    <input value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      aria-label={placeholder} autoFocus={autoFocus} inputMode="search"
      className={cx('w-full rounded-xl bg-white py-3 pl-11 pr-3.5 text-[15px] text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-300', ring)} />
  </div>
);
const Abas = ({ valor, onChange, opcoes }) => (
  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
    {opcoes.map((o) => (
      <button key={o.id} onClick={() => onChange(o.id)} aria-pressed={valor === o.id}
        className={cx('whitespace-nowrap rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors', ring,
          valor === o.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>
        {o.label}
      </button>
    ))}
  </div>
);
const Campo = ({ label, hint, children, className }) => (
  <label className={cx('block', className)}>
    <span className="mb-1.5 block text-[13px] font-medium text-slate-600">{label}</span>
    {children}
    {hint ? <span className="mt-1.5 block text-[12px] leading-relaxed text-slate-400">{hint}</span> : null}
  </label>
);
const inputCls = 'w-full rounded-xl bg-white px-3.5 py-3 text-[15px] text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-300';
const Input = (p) => <input {...p} className={cx(inputCls, ring, p.className)} />;
const Area = (p) => <textarea {...p} className={cx(inputCls, 'resize-none leading-relaxed', ring, p.className)} />;
const Select = ({ children, ...p }) => <select {...p} className={cx(inputCls, 'appearance-none', ring, p.className)}>{children}</select>;

function Modal({ titulo, sub, onClose, children, rodape, largo }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className={cx('relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-h-[88vh] sm:rounded-3xl',
        largo ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="px-5 pb-4 pt-6 sm:px-7">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">{titulo}</h3>
          {sub ? <p className="mt-0.5 text-[13.5px] text-slate-500">{sub}</p> : null}
        </div>
        <div className="space-y-4 overflow-y-auto px-5 pb-6 sm:px-7">{children}</div>
        {rodape ? <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4 sm:px-7">{rodape}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- tela */
export default function CentralTecnicaScreen({
  empresaId, usuarioAtual, real, aviso, podeGerir = false, foco, onFocoConsumido,
}) {
  const [visao, setVisao] = useState({ tipo: 'home' });
  const [home, setHome] = useState(null);
  const [erroHome, setErroHome] = useState(null);
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [novoModelo, setNovoModelo] = useState(false);

  const recarregarHome = () => {
    if (!real || !empresaId || !usuarioAtual?.id) return;
    carregarHomeCT(empresaId, usuarioAtual.id)
      .then((d) => { setHome(d); setErroHome(null); })
      .catch((e) => setErroHome(e?.message || 'Não consegui carregar a Central Técnica.'));
  };
  useEffect(() => { setHome(null); setVisao({ tipo: 'home' }); setTermo(''); recarregarHome(); }, [real, empresaId]);

  // A OS abre a Ajuda Técnica direto no equipamento.
  useEffect(() => {
    if (foco) { setVisao({ tipo: 'equipamento', id: foco }); onFocoConsumido?.(); window.scrollTo?.({ top: 0 }); }
  }, [foco]);

  useEffect(() => {
    if (!real || !empresaId) return undefined;
    const q = termo.trim();
    if (q.length < 2) { setResultados(null); setBuscando(false); return undefined; }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarEquipamentosCT(empresaId, q)
        .then(setResultados)
        .catch((e) => { setResultados([]); aviso?.(e?.message || 'A busca falhou.'); })
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [termo, real, empresaId]);

  const categorias = useMemo(() => {
    const areas = new Set(home?.areas || []);
    return (home?.categorias || []).slice().sort((a, b) => (
      (areas.has(b.id) ? 1 : 0) - (areas.has(a.id) ? 1 : 0) || a.nome.localeCompare(b.nome, 'pt-BR')
    ));
  }, [home]);

  if (!real) {
    return (
      <>
        <Cabecalho titulo="Central Técnica" sub="Fichas rápidas, manuais, esquemas e casos resolvidos pela sua equipe." />
        <Card><Vazio icon={BookOpen} titulo="Disponível com a conta conectada"
          texto="A Central Técnica usa a biblioteca da sua empresa no servidor. Entre com a sua conta para consultar." /></Card>
      </>
    );
  }

  const abrirEquipamento = (id) => { setVisao({ tipo: 'equipamento', id }); window.scrollTo?.({ top: 0 }); };

  if (visao.tipo === 'equipamento') {
    return (
      <EquipamentoCT key={visao.id} modeloId={visao.id} empresaId={empresaId} usuarioAtual={usuarioAtual}
        podeGerir={podeGerir} aviso={aviso}
        onVoltar={() => { setVisao({ tipo: 'home' }); recarregarHome(); }} />
    );
  }
  if (visao.tipo === 'categoria') {
    return (
      <CategoriaCT cat={visao.cat} empresaId={empresaId} aviso={aviso}
        onVoltar={() => setVisao({ tipo: 'home' })} onAbrir={abrirEquipamento} />
    );
  }

  const emBusca = termo.trim().length >= 2;
  const areas = new Set(home?.areas || []);

  return (
    <>
      <Cabecalho titulo="Central Técnica" sub="Fichas rápidas, manuais, esquemas e casos resolvidos pela sua equipe."
        acao={podeGerir ? <Btn icon={Plus} onClick={() => setNovoModelo(true)}>Novo equipamento</Btn> : null} />

      <div className="mb-7 max-w-2xl">
        <Busca valor={termo} onChange={setTermo} placeholder="Buscar equipamento, modelo, manual ou problema" />
        <p className="mt-2 text-[12px] text-slate-400">Ex.: “FR 101”, “erro E4”, “reset”, “motor não fecha”.</p>
      </div>

      {erroHome ? (
        <Card className="mb-6 p-5">
          <div className="flex flex-wrap items-center gap-3 text-[14px] text-slate-600">
            <WifiOff className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span className="min-w-0 flex-1">{erroHome}</span>
            <Btn variant="soft" size="sm" onClick={recarregarHome}>Tentar de novo</Btn>
          </div>
        </Card>
      ) : null}

      {emBusca ? (
        <section>
          <Rotulo>{buscando ? 'Buscando…' : `Resultados · ${resultados?.length ?? 0}`}</Rotulo>
          {buscando && !resultados ? (
            <Card className="p-6 text-[14px] text-slate-400">Buscando…</Card>
          ) : (resultados || []).length === 0 ? (
            <Card><Vazio icon={Search} titulo="Nada encontrado"
              texto="Tente o modelo (ex.: FR 101), o fabricante, uma tag ou um código de erro." /></Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {resultados.map((m) => <ModeloCard key={m.id} m={m} onAbrir={() => abrirEquipamento(m.id)} />)}
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-8">
          {(home?.favoritos?.length || 0) > 0 ? (
            <section>
              <Rotulo>Favoritos</Rotulo>
              <div className="grid gap-3 sm:grid-cols-2">
                {home.favoritos.map((m) => <ModeloCard key={m.id} m={m} favorito onAbrir={() => abrirEquipamento(m.id)} />)}
              </div>
            </section>
          ) : null}
          {(home?.recentes?.length || 0) > 0 ? (
            <section>
              <Rotulo>Vistos recentemente</Rotulo>
              <div className="grid gap-3 sm:grid-cols-2">
                {home.recentes.map((m) => <ModeloCard key={m.id} m={m} onAbrir={() => abrirEquipamento(m.id)} />)}
              </div>
            </section>
          ) : null}
          <section>
            <Rotulo>Categorias</Rotulo>
            {!home ? <Card className="p-6 text-[14px] text-slate-400">Carregando…</Card> : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {categorias.map((c) => (
                  <button key={c.id} onClick={() => setVisao({ tipo: 'categoria', cat: c })}
                    className={cx('rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200/70 transition-colors hover:bg-slate-50', ring)}>
                    <Layers className="mb-2.5 h-5 w-5 text-teal-700" aria-hidden="true" />
                    <p className="text-[14px] font-medium leading-tight text-slate-800">{c.nome}</p>
                    {areas.has(c.id) ? <p className="mt-1 text-[11px] text-teal-700">Área da empresa</p> : null}
                  </button>
                ))}
              </div>
            )}
          </section>
          {home && (home.favoritos?.length || 0) === 0 && (home.recentes?.length || 0) === 0 ? (
            <Card><Vazio icon={BookOpen} titulo="Comece pela busca ou por uma categoria"
              texto={podeGerir
                ? 'Cadastre os equipamentos que a equipe mais atende: modelo, ficha rápida e manual. O técnico acha tudo em campo.'
                : 'Os equipamentos que você consultar aparecem aqui. Toque na estrela para favoritar os que mais usa.'} /></Card>
          ) : null}
        </div>
      )}

      {novoModelo ? (
        <NovoModeloCT empresaId={empresaId} usuarioAtual={usuarioAtual} categorias={home?.categorias || []}
          aviso={aviso} onClose={() => setNovoModelo(false)}
          onCriado={(m) => { setNovoModelo(false); recarregarHome(); abrirEquipamento(m.id); }} />
      ) : null}
    </>
  );
}

const Cabecalho = ({ titulo, sub, acao }) => (
  <div className="mb-7 flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-slate-900 sm:text-3xl">{titulo}</h1>
      {sub ? <p className="mt-1.5 text-[15px] text-slate-500">{sub}</p> : null}
    </div>
    {acao ? <div className="shrink-0">{acao}</div> : null}
  </div>
);
const Rotulo = ({ children, acao }) => (
  <div className="mb-3 flex items-end justify-between gap-4">
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{children}</h2>
    {acao}
  </div>
);
const Voltar = ({ onClick }) => (
  <button onClick={onClick} className={cx('-ml-1 mb-5 inline-flex items-center gap-2 rounded-lg px-1 py-0.5 text-[14px] text-slate-500 hover:text-slate-800', ring)}>
    <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Central Técnica
  </button>
);

function ModeloCard({ m, onAbrir, favorito }) {
  return (
    <button onClick={onAbrir}
      className={cx('flex items-start gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-slate-200/70 transition-colors hover:bg-slate-50', ring)}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800 ring-1 ring-teal-200/70">
        <Wrench className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-slate-900">{m.nome}</span>
        <span className="block truncate text-[13px] text-slate-500">{[m.fabricante, m.categoria].filter(Boolean).join(' · ')}</span>
        {m.descricao ? <span className="mt-0.5 block truncate text-[12.5px] text-slate-400">{m.descricao}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {favorito ? <Star className="h-4 w-4 fill-amber-400 text-amber-500" aria-hidden="true" /> : null}
        {m.global ? <Pill tom="marca">ZiisTec</Pill> : null}
        <ChevronRight className="h-4 w-4 text-slate-300" aria-hidden="true" />
      </span>
    </button>
  );
}

function CategoriaCT({ cat, empresaId, aviso, onVoltar, onAbrir }) {
  const [lista, setLista] = useState(null);
  const [fim, setFim] = useState(false);
  const [mais, setMais] = useState(false);
  useEffect(() => {
    let ativo = true;
    listarModelosCategoriaCT(empresaId, cat.id, 0)
      .then((r) => { if (ativo) { setLista(r); setFim(r.length < 30); } })
      .catch((e) => { if (ativo) { setLista([]); aviso?.(e?.message || 'Não consegui listar a categoria.'); } });
    return () => { ativo = false; };
  }, [cat.id, empresaId]);
  return (
    <>
      <Voltar onClick={onVoltar} />
      <Cabecalho titulo={cat.nome} sub="Equipamentos desta categoria disponíveis para a sua empresa." />
      {!lista ? <Card className="p-6 text-[14px] text-slate-400">Carregando…</Card>
        : lista.length === 0 ? (
          <Card><Vazio icon={Layers} titulo="Nenhum equipamento nesta categoria"
            texto="Use a busca da Central Técnica ou cadastre um novo equipamento." /></Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {lista.map((m) => <ModeloCard key={m.id} m={m} onAbrir={() => onAbrir(m.id)} />)}
            </div>
            {!fim ? (
              <div className="mt-5 flex justify-center">
                <Btn variant="soft" disabled={mais} onClick={() => {
                  setMais(true);
                  listarModelosCategoriaCT(empresaId, cat.id, lista.length)
                    .then((r) => { setLista((l) => [...l, ...r]); setFim(r.length < 30); })
                    .catch((e) => aviso?.(e?.message || 'Não consegui carregar mais.'))
                    .finally(() => setMais(false));
                }}>{mais ? 'Carregando…' : 'Carregar mais'}</Btn>
              </div>
            ) : null}
          </>
        )}
    </>
  );
}

/* ------------------------------------------------- tela do equipamento */
function EquipamentoCT({ modeloId, empresaId, usuarioAtual, podeGerir, aviso, onVoltar }) {
  const [dados, setDados] = useState(null);
  const [offline, setOffline] = useState(false);
  const [erro, setErro] = useState(null);
  const [aba, setAba] = useState('ficha');
  const [editandoFicha, setEditandoFicha] = useState(false);
  const [novoDoc, setNovoDoc] = useState(null);
  const [mudandoFav, setMudandoFav] = useState(false);

  const recarregar = () => {
    abrirEquipamentoCT(empresaId, usuarioAtual.id, modeloId)
      .then((d) => { setDados(d); setOffline(false); setErro(null); guardarFichaCache(empresaId, modeloId, d); })
      .catch((e) => {
        const cache = lerFichaCache(empresaId, modeloId);
        if (cache) { setDados(cache); setOffline(true); setErro(null); }
        else setErro(e?.message || 'Não consegui abrir o equipamento.');
      });
  };
  useEffect(() => { recarregar(); }, [modeloId, empresaId]);

  if (erro) {
    return (
      <>
        <Voltar onClick={onVoltar} />
        <Card><Vazio icon={WifiOff} titulo="Não foi possível abrir o equipamento" texto={erro}
          acao={<Btn variant="soft" onClick={recarregar}>Tentar de novo</Btn>} /></Card>
      </>
    );
  }
  if (!dados) return <><Voltar onClick={onVoltar} /><Card className="p-6 text-[14px] text-slate-400">Carregando…</Card></>;

  const { modelo, ficha, fichaEmpresa, documentos, favorito, totalCasos } = dados;
  const manuais = (documentos || []).filter((d) => !ehEsquema(d));
  const esquemas = (documentos || []).filter(ehEsquema);

  const alternarFav = async () => {
    if (mudandoFav || offline) return;
    setMudandoFav(true);
    try {
      await alternarFavoritoCT(usuarioAtual.id, empresaId, modeloId, !favorito);
      setDados((d) => ({ ...d, favorito: !favorito }));
    } catch (e) { aviso?.(e?.message || 'Não consegui mudar o favorito.'); }
    finally { setMudandoFav(false); }
  };

  return (
    <>
      <Voltar onClick={onVoltar} />

      {offline ? (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-800 ring-1 ring-amber-200/70">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sem conexão — mostrando a última versão salva neste aparelho.
        </div>
      ) : null}

      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13px] text-slate-500">{[modelo.fabricante, modelo.categoria].filter(Boolean).join(' · ')}</p>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-slate-900 sm:text-3xl">{modelo.nome}</h1>
          {modelo.descricao ? <p className="mt-1.5 text-[15px] text-slate-500">{modelo.descricao}</p> : null}
          {modelo.global ? <div className="mt-2"><Pill tom="marca">Biblioteca ZiisTec</Pill></div> : null}
        </div>
        <button onClick={alternarFav} disabled={mudandoFav || offline} aria-pressed={favorito}
          title={favorito ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          className={cx('shrink-0 rounded-xl bg-white p-3 ring-1 ring-slate-200 hover:bg-slate-50', ring, (mudandoFav || offline) && 'opacity-50')}>
          <Star className={cx('h-5 w-5', favorito ? 'fill-amber-400 text-amber-500' : 'text-slate-400')} aria-hidden="true" />
        </button>
      </div>

      <div className="mb-6">
        <Abas valor={aba} onChange={setAba} opcoes={[
          { id: 'ficha', label: 'Ficha rápida' },
          { id: 'manuais', label: `Manuais · ${manuais.length}` },
          { id: 'esquemas', label: `Esquemas · ${esquemas.length}` },
          { id: 'casos', label: `Casos da empresa · ${totalCasos}` },
        ]} />
      </div>

      {aba === 'ficha' ? (
        <>
          {podeGerir && !offline ? (
            <div className="mb-4 flex justify-end">
              <Btn variant="soft" size="sm" icon={Pencil} onClick={() => setEditandoFicha(true)}>
                {fichaEmpresa ? 'Editar ficha da empresa' : ficha ? 'Criar versão da empresa' : 'Criar ficha rápida'}
              </Btn>
            </div>
          ) : null}
          {ficha ? <FichaCT ficha={ficha} /> : (
            <Card><Vazio icon={BookOpen} titulo="Este equipamento ainda não tem ficha rápida"
              texto={podeGerir
                ? 'Monte a ficha com alimentação, bornes, reset e códigos de erro. É o que o técnico consulta em campo.'
                : 'Peça ao responsável da empresa para cadastrar a ficha deste equipamento.'} /></Card>
          )}
        </>
      ) : null}

      {aba === 'manuais' ? (
        <DocsCT docs={manuais} vazio="Nenhum manual cadastrado" podeGerir={podeGerir && !offline}
          aviso={aviso} onNovo={() => setNovoDoc('manual')} onMudou={recarregar} />
      ) : null}
      {aba === 'esquemas' ? (
        <DocsCT docs={esquemas} vazio="Nenhum esquema cadastrado" esquema podeGerir={podeGerir && !offline}
          aviso={aviso} onNovo={() => setNovoDoc('diagram')} onMudou={recarregar} />
      ) : null}
      {aba === 'casos' ? (
        offline
          ? <Card><Vazio icon={WifiOff} titulo="Casos indisponíveis offline"
              texto="Conecte-se para consultar os atendimentos anteriores da empresa." /></Card>
          : <CasosCT empresaId={empresaId} modeloId={modeloId} aviso={aviso} />
      ) : null}

      {editandoFicha ? (
        <EditorFichaCT base={fichaEmpresa || ficha} fichaEmpresaId={fichaEmpresa?.id || null}
          empresaId={empresaId} modeloId={modeloId} usuarioAtual={usuarioAtual} aviso={aviso}
          onClose={() => setEditandoFicha(false)}
          onSalvo={() => { setEditandoFicha(false); recarregar(); }} />
      ) : null}
      {novoDoc ? (
        <NovoDocumentoCT tipoInicial={novoDoc} empresaId={empresaId} modeloId={modeloId}
          usuarioAtual={usuarioAtual} aviso={aviso} onClose={() => setNovoDoc(null)}
          onCriado={() => { setNovoDoc(null); recarregar(); }} />
      ) : null}
    </>
  );
}

/* ---- ficha rápida: cartões grandes, leitura de campo com uma mão ---- */
function FichaCT({ ficha }) {
  const secoes = ficha.secoes || [];
  if (!secoes.length) {
    return <Card><Vazio icon={BookOpen} titulo="Ficha sem seções" texto="O conteúdo desta ficha ainda não foi preenchido." /></Card>;
  }
  return (
    <div className="space-y-4">
      {!ficha.global ? (
        <p className="text-[12px] text-slate-400">
          Ficha da empresa · versão {ficha.versao}{ficha.atualizadoEm ? ` · atualizada em ${dataBR(ficha.atualizadoEm)}` : ''}
        </p>
      ) : null}
      {secoes.map((s, i) => <SecaoCT key={`${s.kind}-${i}`} s={s} />)}
    </div>
  );
}

function SecaoCT({ s }) {
  const itens = s.items || [];
  const alerta = s.kind === 'alerts';
  return (
    <Card className={cx('p-5', alerta && 'bg-amber-50 ring-amber-200/70')}>
      <h3 className={cx('mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em]',
        alerta ? 'text-amber-800' : 'text-slate-400')}>
        {alerta ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : null}
        {s.title || SECAO_LABEL[s.kind] || 'Seção'}
      </h3>
      <div className="space-y-3">
        {itens.map((it, i) => {
          if (Array.isArray(it.steps) && it.steps.length) {
            return (
              <div key={i}>
                {it.label ? <p className="mb-1.5 text-[14px] font-medium text-slate-800">{it.label}</p> : null}
                <ol className="list-none space-y-1.5">
                  {it.steps.map((passo, j) => (
                    <li key={j} className="flex gap-2.5 text-[15px] leading-relaxed text-slate-700">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[12px] font-semibold text-slate-600">{j + 1}</span>
                      <span className="min-w-0 break-words">{passo}</span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          }
          if (it.code || it.meaning) {
            return (
              <div key={i} className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200/70">
                <div className="flex flex-wrap items-center gap-2.5">
                  {it.code ? <span className="rounded-lg bg-slate-900 px-2 py-0.5 font-mono text-[14px] font-semibold text-white">{it.code}</span> : null}
                  <p className="text-[14.5px] font-medium text-slate-800">{it.meaning || it.name || ''}</p>
                </div>
                {it.action ? <p className="mt-1.5 text-[13.5px] text-slate-600">O que fazer: {it.action}</p> : null}
              </div>
            );
          }
          if (it.symptom || it.cause || it.solution || it.test) {
            return (
              <div key={i} className="space-y-1 rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200/70">
                {it.symptom ? <p className="text-[14.5px] font-medium text-slate-800">{it.symptom}</p> : null}
                {it.cause ? <p className="text-[13.5px] text-slate-600">Causa provável: {it.cause}</p> : null}
                {it.test ? <p className="text-[13.5px] text-slate-600">Teste: {it.test}</p> : null}
                {it.solution ? <p className="text-[13.5px] text-teal-800">Solução: {it.solution}</p> : null}
              </div>
            );
          }
          if (it.risk || it.note) {
            return <p key={i} className="text-[14.5px] leading-relaxed text-amber-900">{it.risk || it.note}</p>;
          }
          return (
            <div key={i} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <span className="text-[14px] text-slate-500">{it.label || it.name || '—'}</span>
              <span className="text-right text-[15px] font-medium text-slate-900">{it.value || '—'}</span>
            </div>
          );
        })}
        {!itens.length ? <p className="text-[13px] text-slate-400">Sem itens nesta seção.</p> : null}
      </div>
    </Card>
  );
}

function DocsCT({ docs, vazio, esquema, podeGerir, aviso, onNovo, onMudou }) {
  const [abrindo, setAbrindo] = useState(null);
  const abrir = async (d) => {
    setAbrindo(d.id);
    try {
      const url = await urlDocumentoCT(d);
      if (!url) { aviso?.('Documento indisponível no momento.'); return; }
      window.open(url,'_blank','noopener,noreferrer');
    } catch (e) { aviso?.(e?.message || 'Não consegui abrir o documento.'); }
    finally { setAbrindo(null); }
  };
  return (
    <>
      {podeGerir ? (
        <div className="mb-4 flex justify-end">
          <Btn variant="soft" size="sm" icon={Plus} onClick={onNovo}>
            {esquema ? 'Adicionar esquema' : 'Adicionar documento'}
          </Btn>
        </div>
      ) : null}
      {!docs.length ? (
        <Card><Vazio icon={esquema ? Layers : FileText} titulo={vazio}
          texto={podeGerir
            ? 'Use o link oficial do fabricante ou envie um arquivo da empresa (PDF ou imagem).'
            : 'Quando a empresa cadastrar, o documento aparece aqui.'} /></Card>
      ) : (
        <div className="space-y-3">
          {docs.map((d) => (
            <Card key={d.id} className="flex items-center gap-3.5 p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                {d.origem === 'official_url' ? <Link2 className="h-5 w-5" aria-hidden="true" /> : <FileText className="h-5 w-5" aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-medium text-slate-900">{d.titulo}</p>
                <p className="truncate text-[12.5px] text-slate-500">
                  {[DOC_LABEL[d.tipo] || d.tipo, d.versao ? `v. ${d.versao}` : null, d.idioma].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {d.oficial ? <Pill tom="ok">Fonte oficial</Pill> : null}
                  {d.origem === 'official_url' && !d.oficial ? <Pill>Link do fabricante</Pill> : null}
                  {d.origem === 'company_upload' ? <Pill>Arquivo da empresa</Pill> : null}
                  {d.global ? <Pill tom="marca">ZiisTec</Pill> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Btn variant="soft" size="sm" icon={abrindo === d.id ? Loader2 : ExternalLink}
                  disabled={abrindo === d.id} onClick={() => abrir(d)}>Abrir</Btn>
                {podeGerir && !d.global ? (
                  <Btn variant="ghost" size="sm" icon={Trash2} title="Arquivar documento"
                    onClick={async () => {
                      try { await arquivarDocumentoCT(d.id); onMudou?.(); }
                      catch (e) { aviso?.(e?.message || 'Não consegui arquivar.'); }
                    }} />
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function CasosCT({ empresaId, modeloId, aviso }) {
  const [casos, setCasos] = useState(null);
  const [fim, setFim] = useState(false);
  const [mais, setMais] = useState(false);
  useEffect(() => {
    let ativo = true;
    casosEquipamentoCT(empresaId, modeloId, 0)
      .then((r) => { if (ativo) { setCasos(r); setFim(r.length < 10); } })
      .catch((e) => { if (ativo) { setCasos([]); aviso?.(e?.message || 'Não consegui carregar os casos.'); } });
    return () => { ativo = false; };
  }, [empresaId, modeloId]);

  if (!casos) return <Card className="p-6 text-[14px] text-slate-400">Carregando…</Card>;
  if (!casos.length) {
    return (
      <Card><Vazio icon={ClipboardList} titulo="Nenhum caso registrado para este equipamento"
        texto="Quando uma OS com este equipamento for concluída com a Base Técnica preenchida, o atendimento aparece aqui como caso técnico — sem dados do cliente e sem valores." /></Card>
    );
  }
  return (
    <>
      <p className="mb-3 text-[12.5px] text-slate-400">
        Conhecimento técnico da sua empresa, vindo da Base Técnica das OS concluídas. Sem nome de cliente, endereço ou valores.
      </p>
      <div className="space-y-3">
        {casos.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <Pill tom="ok">Caso resolvido</Pill>
              <span className="text-[12px] text-slate-400">
                {c.numero}{c.concluidoEm ? ` · ${dataBR(c.concluidoEm)}` : ''}
              </span>
            </div>
            {c.sintoma ? <Bloco titulo="Sintoma" texto={c.sintoma} /> : null}
            {c.causa ? <Bloco titulo="Causa encontrada" texto={c.causa} /> : null}
            {c.solucao ? <Bloco titulo="Solução aplicada" texto={c.solucao} destaque /> : null}
            {c.aprendizado ? <Bloco titulo="Aprendizado" texto={c.aprendizado} /> : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.dificuldade ? <Pill>Dificuldade: {DIFICULDADE[c.dificuldade] || c.dificuldade}</Pill> : null}
              {c.unidadeIdentificada ? <Pill>Equipamento identificado</Pill> : null}
              {c.precisouRetorno ? <Pill tom="atencao">Precisou de retorno</Pill> : null}
              {c.obsVinculo ? <Pill>{c.obsVinculo}</Pill> : null}
            </div>
          </Card>
        ))}
      </div>
      {!fim ? (
        <div className="mt-5 flex justify-center">
          <Btn variant="soft" disabled={mais} onClick={() => {
            setMais(true);
            casosEquipamentoCT(empresaId, modeloId, casos.length)
              .then((r) => { setCasos((l) => [...l, ...r]); setFim(r.length < 10); })
              .catch((e) => aviso?.(e?.message || 'Não consegui carregar mais casos.'))
              .finally(() => setMais(false));
          }}>{mais ? 'Carregando…' : 'Ver mais casos'}</Btn>
        </div>
      ) : null}
    </>
  );
}

const Bloco = ({ titulo, texto, destaque }) => (
  <div className="mb-2.5">
    <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{titulo}</p>
    <p className={cx('whitespace-pre-line break-words text-[14px] leading-relaxed', destaque ? 'text-teal-900' : 'text-slate-700')}>{texto}</p>
  </div>
);

/* --------------------------- gestão do acervo privado (owner) --------------------------- */
function NovoModeloCT({ empresaId, usuarioAtual, categorias, aviso, onClose, onCriado }) {
  const [f, setF] = useState({ nome: '', codigo: '', categoriaId: '', fabricanteId: '', descricao: '', tags: '' });
  const [fabricantes, setFabricantes] = useState(null);
  const [novoFab, setNovoFab] = useState('');
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    listarFabricantesCT(empresaId).then(setFabricantes)
      .catch((e) => { setFabricantes([]); aviso?.(e?.message || 'Não consegui listar fabricantes.'); });
  }, [empresaId]);

  const salvar = async () => {
    if (!f.nome.trim()) { aviso?.('Informe o modelo.'); return; }
    if (!f.categoriaId) { aviso?.('Escolha a categoria.'); return; }
    if (!f.fabricanteId && !novoFab.trim()) { aviso?.('Escolha ou cadastre o fabricante.'); return; }
    setSalvando(true);
    try {
      let fabricanteId = f.fabricanteId;
      if (!fabricanteId) {
        const fab = await salvarFabricanteCT(empresaId, { nome: novoFab }, usuarioAtual?.id);
        fabricanteId = fab.id;
      }
      const m = await salvarModeloCT(empresaId, {
        nome: f.nome, codigo: f.codigo, categoriaId: f.categoriaId, fabricanteId,
        descricao: f.descricao, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      }, usuarioAtual?.id);
      aviso?.('Equipamento cadastrado.');
      onCriado(m);
    } catch (e) { aviso?.(e?.message || 'Não consegui cadastrar o equipamento.'); }
    finally { setSalvando(false); }
  };

  return (
    <Modal titulo="Novo equipamento" sub="Entra na biblioteca privada da sua empresa." onClose={onClose}
      rodape={<>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn disabled={salvando} icon={salvando ? Loader2 : undefined} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Cadastrar'}
        </Btn>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo label="Modelo" className="sm:col-span-2">
          <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: FR 101" />
        </Campo>
        <Campo label="Código do modelo" hint="Opcional. Como aparece na etiqueta.">
          <Input value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} placeholder="Ex.: FR-101" />
        </Campo>
        <Campo label="Categoria">
          <Select value={f.categoriaId} onChange={(e) => setF({ ...f, categoriaId: e.target.value })}>
            <option value="">Escolher…</option>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Campo>
        <Campo label="Fabricante" className="sm:col-span-2">
          <Select value={f.fabricanteId} onChange={(e) => setF({ ...f, fabricanteId: e.target.value })}>
            <option value="">{fabricantes ? 'Cadastrar novo…' : 'Carregando…'}</option>
            {(fabricantes || []).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
          </Select>
        </Campo>
        {!f.fabricanteId ? (
          <Campo label="Nome do novo fabricante" className="sm:col-span-2">
            <Input value={novoFab} onChange={(e) => setNovoFab(e.target.value)} placeholder="Ex.: Intelbras" />
          </Campo>
        ) : null}
        <Campo label="Descrição curta" className="sm:col-span-2">
          <Input value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })}
            placeholder="Ex.: fechadura eletrônica de embutir" />
        </Campo>
        <Campo label="Tags" hint="Separadas por vírgula. Ajudam a busca em campo." className="sm:col-span-2">
          <Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} placeholder="fechadura, tag, senha" />
        </Campo>
      </div>
    </Modal>
  );
}

function NovoDocumentoCT({ tipoInicial, empresaId, modeloId, usuarioAtual, aviso, onClose, onCriado }) {
  const [modo, setModo] = useState('url');
  const [f, setF] = useState({ titulo: '', tipo: tipoInicial || 'manual', url: '', versao: '' });
  const [arquivo, setArquivo] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!f.titulo.trim()) { aviso?.('Dê um título ao documento.'); return; }
    setSalvando(true);
    try {
      if (modo === 'url') {
        if (!/^https:\/\//i.test(f.url.trim())) { aviso?.('O link precisa começar com https://'); setSalvando(false); return; }
        await salvarDocumentoUrlCT(empresaId, modeloId, f, usuarioAtual?.id);
      } else {
        if (!arquivo) { aviso?.('Selecione o arquivo.'); setSalvando(false); return; }
        await enviarDocumentoArquivoCT(empresaId, modeloId, arquivo, f, usuarioAtual?.id);
      }
      aviso?.('Documento adicionado.');
      onCriado();
    } catch (e) { aviso?.(e?.message || 'Não consegui adicionar o documento.'); }
    finally { setSalvando(false); }
  };

  return (
    <Modal titulo="Adicionar documento"
      sub="Prefira o link oficial do fabricante. Arquivo enviado fica privado da empresa, com link temporário."
      onClose={onClose}
      rodape={<>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn disabled={salvando} icon={salvando ? Loader2 : undefined} onClick={salvar}>
          {salvando ? 'Enviando…' : 'Adicionar'}
        </Btn>
      </>}>
      <Abas valor={modo} onChange={setModo} opcoes={[{ id: 'url', label: 'Link oficial' }, { id: 'arquivo', label: 'Enviar arquivo' }]} />
      <Campo label="Título">
        <Input value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Manual de instalação" />
      </Campo>
      <div className="grid grid-cols-2 gap-4">
        <Campo label="Tipo">
          <Select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}>
            {TIPOS_DOC.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Campo>
        <Campo label="Versão" hint="Opcional">
          <Input value={f.versao} onChange={(e) => setF({ ...f, versao: e.target.value })} placeholder="Ex.: 1.2" />
        </Campo>
      </div>
      {modo === 'url' ? (
        <Campo label="Link oficial (https)" hint="O documento continua no site do fabricante; aqui fica a referência.">
          <Input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://..." inputMode="url" />
        </Campo>
      ) : (
        <Campo label="Arquivo (PDF ou imagem, até 50 MB)" hint="Envie apenas material que a empresa pode guardar.">
          <label className={cx('flex cursor-pointer items-center gap-3 rounded-xl bg-white px-3.5 py-3 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>
            <Upload className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate text-[14px] text-slate-600">{arquivo ? arquivo.name : 'Escolher arquivo…'}</span>
            <input type="file" className="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)} />
          </label>
        </Campo>
      )}
    </Modal>
  );
}

function EditorFichaCT({ base, fichaEmpresaId, empresaId, modeloId, usuarioAtual, aviso, onClose, onSalvo }) {
  const [secoes, setSecoes] = useState(() => {
    try { return JSON.parse(JSON.stringify(base?.secoes || [])); } catch { return []; }
  });
  const [tipoNovo, setTipoNovo] = useState('power');
  const [salvando, setSalvando] = useState(false);

  const upSec = (i, patch) => setSecoes((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const upItem = (i, k, patch) => setSecoes((l) => l.map((s, j) => (
    j === i ? { ...s, items: (s.items || []).map((it, m) => (m === k ? { ...it, ...patch } : it)) } : s
  )));
  const itemNovo = (kind) => (
    kind === 'codes' ? { code: '', meaning: '', action: '' }
      : kind === 'diagnostics' ? { symptom: '', cause: '', test: '', solution: '' }
      : kind === 'alerts' ? { risk: '' }
      : (kind === 'reset' || kind === 'programming') ? { label: '', steps: [''] }
      : { label: '', value: '' }
  );

  const salvar = async () => {
    const limpas = secoes
      .map((s) => ({
        kind: s.kind,
        title: String(s.title || SECAO_LABEL[s.kind] || 'Seção').slice(0, 120),
        items: (s.items || [])
          .map((it) => (Array.isArray(it.steps) ? { ...it, steps: it.steps.map((x) => String(x).trim()).filter(Boolean) } : it))
          .filter((it) => Object.values(it).some((v) => (Array.isArray(v) ? v.length : String(v || '').trim()))),
      }))
      .filter((s) => s.items.length);
    if (!limpas.length) { aviso?.('Adicione ao menos uma seção com conteúdo.'); return; }
    setSalvando(true);
    try {
      await salvarFichaCT(empresaId, modeloId, fichaEmpresaId, limpas, usuarioAtual?.id);
      aviso?.('Ficha salva.');
      onSalvo();
    } catch (e) { aviso?.(e?.message || 'Não consegui salvar a ficha.'); }
    finally { setSalvando(false); }
  };

  return (
    <Modal largo titulo={fichaEmpresaId ? 'Editar ficha da empresa' : 'Nova ficha rápida'}
      sub="Registre apenas o que está confirmado no manual ou na prática da equipe. Nada de suposição."
      onClose={onClose}
      rodape={<>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn disabled={salvando} icon={salvando ? Loader2 : undefined} onClick={salvar}>
          {salvando ? 'Salvando…' : 'Salvar ficha'}
        </Btn>
      </>}>
      {secoes.map((s, i) => (
        <Card key={i} className="space-y-3 p-4">
          <div className="flex items-center gap-3">
            <Input value={s.title || ''} onChange={(e) => upSec(i, { title: e.target.value })}
              placeholder={SECAO_LABEL[s.kind]} className="font-medium" />
            <Btn variant="ghost" size="sm" icon={Trash2} title="Remover seção"
              onClick={() => setSecoes((l) => l.filter((_, j) => j !== i))} />
          </div>
          {(s.items || []).map((it, k) => (
            <div key={k} className="space-y-2 rounded-xl p-3 ring-1 ring-slate-200/70">
              {Array.isArray(it.steps) ? (
                <>
                  <Input value={it.label || ''} onChange={(e) => upItem(i, k, { label: e.target.value })}
                    placeholder="Nome do procedimento (ex.: Reset total)" />
                  <Area rows={3} value={(it.steps || []).join('\n')}
                    onChange={(e) => upItem(i, k, { steps: e.target.value.split('\n') })}
                    placeholder={'Um passo por linha\nEx.: desligue a alimentação'} />
                </>
              ) : 'code' in it ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input value={it.code || ''} onChange={(e) => upItem(i, k, { code: e.target.value })} placeholder="Código (E4)" />
                  <Input value={it.meaning || ''} onChange={(e) => upItem(i, k, { meaning: e.target.value })} placeholder="Significado" />
                  <Input value={it.action || ''} onChange={(e) => upItem(i, k, { action: e.target.value })} placeholder="O que fazer" />
                </div>
              ) : 'symptom' in it ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input value={it.symptom || ''} onChange={(e) => upItem(i, k, { symptom: e.target.value })} placeholder="Sintoma" />
                  <Input value={it.cause || ''} onChange={(e) => upItem(i, k, { cause: e.target.value })} placeholder="Causa provável" />
                  <Input value={it.test || ''} onChange={(e) => upItem(i, k, { test: e.target.value })} placeholder="Teste" />
                  <Input value={it.solution || ''} onChange={(e) => upItem(i, k, { solution: e.target.value })} placeholder="Solução" />
                </div>
              ) : 'risk' in it ? (
                <Area rows={2} value={it.risk || ''} onChange={(e) => upItem(i, k, { risk: e.target.value })}
                  placeholder="Risco ou cuidado importante" />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Input value={it.label || ''} onChange={(e) => upItem(i, k, { label: e.target.value })} placeholder="Campo (ex.: Tensão)" />
                  <Input value={it.value || ''} onChange={(e) => upItem(i, k, { value: e.target.value })} placeholder="Valor (ex.: 12 VDC)" />
                </div>
              )}
              <div className="flex justify-end">
                <Btn variant="ghost" size="sm" icon={Trash2} title="Remover item"
                  onClick={() => upSec(i, { items: (s.items || []).filter((_, m) => m !== k) })} />
              </div>
            </div>
          ))}
          <Btn variant="quiet" size="sm" icon={Plus}
            onClick={() => upSec(i, { items: [...(s.items || []), itemNovo(s.kind)] })}>Adicionar item</Btn>
        </Card>
      ))}
      <div className="flex items-center gap-2">
        <Select value={tipoNovo} onChange={(e) => setTipoNovo(e.target.value)} className="max-w-[240px]">
          {TIPOS_SECAO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </Select>
        <Btn variant="soft" size="sm" icon={Plus}
          onClick={() => setSecoes((l) => [...l, { kind: tipoNovo, title: SECAO_LABEL[tipoNovo], items: [itemNovo(tipoNovo)] }])}>
          Adicionar seção
        </Btn>
      </div>
    </Modal>
  );
}
