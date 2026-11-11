import React, { useEffect, useState } from 'react';
import { BookOpen, Loader2, PackageSearch, Plus, Search, Trash2, Wrench } from 'lucide-react';
import {
  buscarEquipamentosCT, desvincularEquipamentoOSCT, identificarModeloUnidadeCT,
  listarEquipamentosOSCT, listarUnidadesClienteCT, vincularEquipamentoOSCT,
} from '../lib/centralTecnicaApi';

/*
  OS <-> Central Técnica.

  Dois cenários de campo, sem confundir os conceitos:
    manutenção  — o cliente já tem a peça: escolhe-se a UNIDADE FÍSICA
                  (installed_equipment, 0083) e o modelo técnico vem com ela;
    diagnóstico — ainda não há unidade registrada: vincula-se só o MODELO.

  O vínculo é o que faz a Base Técnica daquela OS virar caso consultável para os
  próximos atendimentos do mesmo modelo.
*/

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const cx = (...c) => c.filter(Boolean).join(' ');
const dataBR = (v) => (v ? new Date(`${String(v).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');

export default function WorkOrderEquipmentPanel({
  workOrderId, clientId, empresaId, usuarioAtual, real, aviso, podeEditar, onAjudaTecnica,
}) {
  const [lista, setLista] = useState(null);
  const [vinculando, setVinculando] = useState(false);
  const [removendo, setRemovendo] = useState(null);

  const recarregar = () => {
    if (!real || !workOrderId || !empresaId) { setLista([]); return; }
    listarEquipamentosOSCT(workOrderId, empresaId).then(setLista).catch(() => setLista([]));
  };
  useEffect(() => { recarregar(); }, [workOrderId, empresaId, real]);

  if (!real) return null;

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Equipamento</h2>
        {podeEditar ? (
          <button onClick={() => setVinculando(true)}
            className={cx('inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Vincular equipamento
          </button>
        ) : null}
      </div>

      <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/70">
        {!lista ? (
          <p className="text-[13px] text-slate-400">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            Vincule o equipamento atendido para abrir a ficha rápida, o manual e os casos já resolvidos pela
            equipe — e para que este atendimento vire conhecimento da empresa.
          </p>
        ) : (
          <div className="space-y-3">
            {lista.map((m) => (
              <div key={m.vinculoId} className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-800 ring-1 ring-teal-200/70">
                  <Wrench className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-medium text-slate-900">{m.nome}</p>
                  <p className="truncate text-[12.5px] text-slate-500">
                    {[m.fabricante, m.categoria].filter(Boolean).join(' · ')}
                  </p>
                  {m.unidade ? (
                    <p className="mt-0.5 truncate text-[12.5px] text-slate-500">
                      {[
                        m.unidade.serie ? `S/N ${m.unidade.serie}` : null,
                        m.unidade.local || null,
                        m.unidade.instaladoEm ? `instalado em ${dataBR(m.unidade.instaladoEm)}` : null,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[12px] text-slate-400">Sem equipamento instalado vinculado</p>
                  )}
                  {m.obs ? <p className="mt-0.5 truncate text-[12px] text-slate-400">{m.obs}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button onClick={() => onAjudaTecnica?.(m.id)}
                    className={cx('inline-flex items-center gap-2 rounded-xl bg-teal-700 px-3 py-2 text-[13px] font-medium text-white hover:bg-teal-800', ring)}>
                    <BookOpen className="h-4 w-4" aria-hidden="true" /> Ajuda técnica
                  </button>
                  {podeEditar ? (
                    <button title="Remover vínculo" aria-label="Remover vínculo" disabled={removendo === m.vinculoId}
                      onClick={async () => {
                        setRemovendo(m.vinculoId);
                        try { await desvincularEquipamentoOSCT(m.vinculoId); recarregar(); }
                        catch (e) { aviso?.(e?.message || 'Não consegui remover o vínculo.'); }
                        finally { setRemovendo(null); }
                      }}
                      className={cx('rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40', ring)}>
                      {removendo === m.vinculoId
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {vinculando ? (
        <VincularEquipamento workOrderId={workOrderId} clientId={clientId} empresaId={empresaId}
          usuarioAtual={usuarioAtual} aviso={aviso} onClose={() => setVinculando(false)}
          onVinculado={() => { setVinculando(false); recarregar(); }} />
      ) : null}
    </section>
  );
}

function VincularEquipamento({ workOrderId, clientId, empresaId, usuarioAtual, aviso, onClose, onVinculado }) {
  const [modo, setModo] = useState('unidade');
  const [unidades, setUnidades] = useState(null);
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [unidadeSel, setUnidadeSel] = useState(null);
  const [salvando, setSalvando] = useState(null);

  useEffect(() => {
    if (!clientId) { setUnidades([]); return; }
    listarUnidadesClienteCT(empresaId, clientId).then((r) => {
      setUnidades(r);
      if (!r.length) setModo('modelo');
    }).catch(() => { setUnidades([]); setModo('modelo'); });
  }, [empresaId, clientId]);

  useEffect(() => {
    const q = termo.trim();
    if (q.length < 2) { setResultados(null); return undefined; }
    setBuscando(true);
    const t = setTimeout(() => {
      buscarEquipamentosCT(empresaId, q)
        .then(setResultados)
        .catch((e) => { setResultados([]); aviso?.(e?.message || 'A busca falhou.'); })
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [termo, empresaId]);

  // Vincula o modelo; quando há unidade selecionada, identifica o modelo dela
  // (se ainda não estava identificado) e amarra as duas coisas no vínculo.
  const vincular = async (modelo) => {
    setSalvando(modelo.id);
    try {
      if (unidadeSel) {
        if (!unidadeSel.modeloTecnicoId) await identificarModeloUnidadeCT(unidadeSel.id, modelo.id);
        await vincularEquipamentoOSCT(empresaId, workOrderId, modelo.id, {
          unidadeId: unidadeSel.id, userId: usuarioAtual?.id,
          obs: unidadeSel.local ? `Equipamento em ${unidadeSel.local}` : null,
        });
      } else {
        await vincularEquipamentoOSCT(empresaId, workOrderId, modelo.id, { userId: usuarioAtual?.id });
      }
      aviso?.(`${modelo.nome} vinculado ao atendimento.`);
      onVinculado();
    } catch (e) { aviso?.(e?.message || 'Não consegui vincular o equipamento.'); }
    finally { setSalvando(null); }
  };

  const usarUnidade = async (u) => {
    setUnidadeSel(u);
    // Unidade já identificada: vincula direto, sem pedir o modelo de novo.
    if (u.modeloTecnicoId) {
      setSalvando(u.id);
      try {
        await vincularEquipamentoOSCT(empresaId, workOrderId, u.modeloTecnicoId, {
          unidadeId: u.id, userId: usuarioAtual?.id,
          obs: u.local ? `Equipamento em ${u.local}` : null,
        });
        aviso?.(`${u.nome} vinculado ao atendimento.`);
        onVinculado();
      } catch (e) { aviso?.(e?.message || 'Não consegui vincular o equipamento.'); }
      finally { setSalvando(null); }
      return;
    }
    setModo('modelo');
    setTermo(u.modelo || u.nome || '');
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Vincular equipamento">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:max-h-[88vh] sm:max-w-lg sm:rounded-3xl">
        <div className="px-5 pb-4 pt-6 sm:px-7">
          <h3 className="text-lg font-semibold tracking-tight text-slate-900">Vincular equipamento</h3>
          <p className="mt-0.5 text-[13.5px] text-slate-500">
            {unidadeSel
              ? `Identificando o modelo técnico de ${unidadeSel.nome}.`
              : 'Escolha o equipamento já instalado no cliente ou busque o modelo atendido.'}
          </p>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 pb-6 sm:px-7">
          {!unidadeSel ? (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[{ id: 'unidade', label: `Instalados no cliente${unidades ? ` · ${unidades.length}` : ''}` },
                { id: 'modelo', label: 'Buscar modelo' }].map((o) => (
                <button key={o.id} onClick={() => setModo(o.id)} aria-pressed={modo === o.id}
                  className={cx('whitespace-nowrap rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors', ring,
                    modo === o.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}>
                  {o.label}
                </button>
              ))}
            </div>
          ) : null}

          {modo === 'unidade' && !unidadeSel ? (
            !unidades ? <p className="text-[13px] text-slate-400">Carregando…</p>
              : unidades.length === 0 ? (
                <div className="rounded-xl bg-slate-50 p-4 text-[13.5px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
                  <PackageSearch className="mb-2 h-5 w-5 text-slate-400" aria-hidden="true" />
                  Este cliente ainda não tem equipamento instalado registrado. Busque o modelo atendido —
                  o equipamento instalado é registrado no fechamento da OS.
                </div>
              ) : (
                <div className="space-y-2">
                  {unidades.map((u) => (
                    <button key={u.id} disabled={salvando === u.id} onClick={() => usarUnidade(u)}
                      className={cx('flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50', ring)}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14.5px] font-medium text-slate-900">{u.nome}</p>
                        <p className="truncate text-[12.5px] text-slate-500">
                          {[u.marca, u.modelo, u.serie ? `S/N ${u.serie}` : null, u.local].filter(Boolean).join(' · ')}
                        </p>
                        {!u.modeloTecnicoId ? (
                          <p className="mt-0.5 text-[12px] text-amber-700">Sem modelo técnico identificado</p>
                        ) : null}
                      </div>
                      {salvando === u.id
                        ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
                        : <Plus className="h-4 w-4 text-teal-700" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )
          ) : null}

          {modo === 'modelo' || unidadeSel ? (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input value={termo} onChange={(e) => setTermo(e.target.value)} autoFocus inputMode="search"
                  placeholder="Modelo, fabricante ou código (ex.: FR 101)" aria-label="Buscar modelo"
                  className={cx('w-full rounded-xl bg-white py-3 pl-11 pr-3.5 text-[15px] text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-300', ring)} />
              </div>
              {buscando ? <p className="text-[13px] text-slate-400">Buscando…</p> : null}
              {resultados && !buscando && resultados.length === 0 ? (
                <p className="text-[13.5px] text-slate-500">
                  Nada encontrado. O responsável pode cadastrar o modelo na Central Técnica.
                </p>
              ) : null}
              <div className="space-y-2">
                {(resultados || []).map((m) => (
                  <button key={m.id} disabled={salvando === m.id} onClick={() => vincular(m)}
                    className={cx('flex w-full items-center gap-3 rounded-xl bg-white p-3.5 text-left ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50', ring)}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14.5px] font-medium text-slate-900">{m.nome}</p>
                      <p className="truncate text-[12.5px] text-slate-500">{[m.fabricante, m.categoria].filter(Boolean).join(' · ')}</p>
                    </div>
                    {salvando === m.id
                      ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden="true" />
                      : <Plus className="h-4 w-4 text-teal-700" aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4 sm:px-7">
          {unidadeSel ? (
            <button onClick={() => { setUnidadeSel(null); setModo('unidade'); setTermo(''); setResultados(null); }}
              className={cx('rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate-600 hover:bg-slate-100', ring)}>
              Voltar
            </button>
          ) : null}
          <button onClick={onClose}
            className={cx('rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate-600 hover:bg-slate-100', ring)}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
