import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, ShieldAlert } from 'lucide-react';
import {
  LIMITE_CASO, carregarPublicacaoCasoCT, publicarCasoTecnicoCT, retirarCasoTecnicoCT,
} from '../lib/centralTecnicaApi';
import { createContentRequestIds } from '../lib/fieldExecution.js';

/*
  Publicação do caso técnico (owner) — Central Técnica, migration 0115.

  A Base Técnica da OS é o registro interno original: o técnico escreve em campo e
  pode citar nome, telefone, endereço ou valor. Ela NÃO é compartilhada com a
  equipe. O caso é outro texto: o proprietário revisa, escreve o que é técnico e
  publica. Só esse texto chega aos demais técnicos.

  Por isso o formulário começa VAZIO. Copiar a Base Técnica é um gesto explícito do
  proprietário ("Usar a Base Técnica como rascunho"), seguido de revisão — nunca
  automático. O banco confere empresa, ownership, OS concluída e assinatura.
*/

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const cx = (...c) => c.filter(Boolean).join(' ');
const VAZIO = { sintoma: '', causa: '', solucao: '', aprendizado: '' };
const CAMPOS = [
  ['sintoma', 'Sintoma', LIMITE_CASO.sintoma, 2, 'Ex.: fechadura não abre com tag cadastrada'],
  ['causa', 'Causa encontrada', LIMITE_CASO.texto, 3, 'O que estava errado, em termos técnicos'],
  ['solucao', 'Solução aplicada', LIMITE_CASO.texto, 3, 'O que resolveu'],
  ['aprendizado', 'Aprendizado', LIMITE_CASO.texto, 3, 'O que o próximo técnico deve conferir primeiro'],
];

export default function TechnicalCasePublishPanel({ workOrderId, concluida, podePublicar, real, aviso, recarregar }) {
  const [estado, setEstado] = useState(null);
  const [form, setForm] = useState(VAZIO);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ids = useRef(createContentRequestIds());

  const ativo = Boolean(real && podePublicar && concluida && workOrderId);
  useEffect(() => {
    if (!ativo) { setEstado(null); return undefined; }
    let vivo = true;
    carregarPublicacaoCasoCT(workOrderId)
      .then((r) => { if (vivo) setEstado(r); })
      .catch(() => { if (vivo) setEstado({ indisponivel: true }); });
    return () => { vivo = false; };
  }, [ativo, workOrderId, recarregar]);

  if (!ativo || !estado || estado.indisponivel || !estado.temBase) return null;
  const { publicacao, base } = estado;

  const abrir = () => {
    setForm(publicacao.publicado
      ? { sintoma: publicacao.sintoma, causa: publicacao.causa, solucao: publicacao.solucao, aprendizado: publicacao.aprendizado }
      : VAZIO);
    setEditando(true);
  };
  const usarRascunho = () => setForm((f) => ({
    ...f, causa: base?.causa || '', solucao: base?.solucao || '', aprendizado: base?.aprendizado || '',
  }));
  const temConteudo = [form.causa, form.solucao, form.aprendizado].some((v) => String(v || '').trim());

  const publicar = async () => {
    if (!temConteudo) { aviso?.('Informe a causa, a solução ou o aprendizado do caso.'); return; }
    setOcupado(true);
    try {
      const limpo = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v || '').trim()]));
      const r = await publicarCasoTecnicoCT(workOrderId, limpo, ids.current.idFor(limpo));
      setEstado((e) => ({ ...e, publicacao: r }));
      setEditando(false);
      aviso?.('Caso técnico publicado na Central Técnica.');
    } catch (e) {
      aviso?.(e?.message || 'Não consegui publicar o caso técnico.');
    } finally { setOcupado(false); }
  };
  const retirar = async () => {
    setOcupado(true);
    try {
      const r = await retirarCasoTecnicoCT(workOrderId);
      setEstado((e) => ({ ...e, publicacao: r }));
      setEditando(false);
      aviso?.('Caso técnico retirado da Central Técnica.');
    } catch (e) {
      aviso?.(e?.message || 'Não consegui retirar o caso técnico.');
    } finally { setOcupado(false); }
  };

  const btn = 'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium disabled:opacity-50';
  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Caso técnico na Central</h2>
        <span className="text-[12px] text-slate-400">{publicacao.publicado ? `Publicado · revisão ${publicacao.revisao}` : 'Não publicado'}</span>
      </div>
      <div className="space-y-4 rounded-2xl bg-white p-5 ring-1 ring-slate-200/70">
        {!editando ? (
          <>
            {publicacao.publicado ? (
              <div className="space-y-3">
                {[['Sintoma', publicacao.sintoma], ['Causa encontrada', publicacao.causa], ['Solução aplicada', publicacao.solucao], ['Aprendizado', publicacao.aprendizado]]
                  .filter(([, t]) => t).map(([titulo, texto]) => (
                    <div key={titulo}>
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{titulo}</p>
                      <p className="whitespace-pre-line break-words text-[14px] leading-relaxed text-slate-700">{texto}</p>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-[13.5px] leading-relaxed text-slate-500">
                A Base Técnica desta OS é interna e não é compartilhada com a equipe. Para que este atendimento
                ajude outros técnicos, publique um caso técnico revisado — só o texto que você publicar aparece
                na Central Técnica.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={abrir} disabled={ocupado}
                className={cx(btn, 'bg-teal-700 text-white hover:bg-teal-800', ring)}>
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                {publicacao.publicado ? 'Revisar caso publicado' : 'Publicar caso técnico'}
              </button>
              {publicacao.publicado ? (
                <button onClick={retirar} disabled={ocupado}
                  className={cx(btn, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>
                  {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  Retirar da Central
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-200/70">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Este texto será visto por <strong className="font-semibold">toda a equipe</strong>. Escreva só o que é técnico:
                não inclua nome, telefone, e-mail, endereço ou documento do cliente, nem preços e valores.
              </p>
            </div>
            {CAMPOS.map(([chave, rotulo, max, linhas, dica]) => (
              <label key={chave} className="block">
                <span className="mb-1 flex items-center justify-between text-[12px] font-medium text-slate-600">
                  {rotulo}
                  <span className="font-normal text-slate-400">{String(form[chave] || '').length}/{max}</span>
                </span>
                <textarea value={form[chave]} rows={linhas} maxLength={max} placeholder={dica}
                  onChange={(e) => setForm((f) => ({ ...f, [chave]: e.target.value }))}
                  className={cx('w-full rounded-xl bg-white px-3 py-2 text-[14px] text-slate-800 ring-1 ring-slate-200 placeholder:text-slate-400', ring)} />
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={publicar} disabled={ocupado || !temConteudo}
                className={cx(btn, 'bg-teal-700 text-white hover:bg-teal-800', ring)}>
                {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {publicacao.publicado ? 'Publicar revisão' : 'Publicar na Central'}
              </button>
              <button onClick={() => setEditando(false)} disabled={ocupado}
                className={cx(btn, 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50', ring)}>Cancelar</button>
              {base && (base.causa || base.solucao || base.aprendizado) ? (
                <button onClick={usarRascunho} disabled={ocupado}
                  className={cx(btn, 'text-teal-800 hover:bg-teal-50', ring)}
                  title="Copia a Base Técnica interna para os campos acima. Revise e remova dados do cliente antes de publicar.">
                  Usar a Base Técnica como rascunho
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
