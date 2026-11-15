import React, { useState } from 'react';
import { Bot, Check, Loader2, MessageSquare, X } from 'lucide-react';
import { STATUS } from '../lib/operationsCommands';
import { rascunhoDeFrase } from '../lib/operationsCommandDraft';
import { cancelarComando, executarComando, proporComando } from '../lib/operationsCommandEngine';

/*
  Simulador do agente operacional — uso interno do proprietário.

  Serve para exercitar o Command Engine com frases como as que chegarão pelo
  WhatsApp, ANTES de existir qualquer integração. Aqui não há Meta, token,
  número nem transcrição: a frase é digitada e o extrator é determinístico.

  A confirmação executa pela MESMA operação oficial da Central de Operações.
  Não existe caminho privilegiado para o agente.
*/

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500';
const cx = (...c) => c.filter(Boolean).join(' ');

const EXEMPLOS = [
  'Cria uma OS para o Edifício Plaza amanhã às 9 porque o portão da rampa não está abrindo',
  'Agenda a OS-0001 para segunda de manhã',
  'Manda pro João a OS-0001',
  'Anota na OS-0001 que o cliente pediu retorno',
];

export default function OperationsCommandSimulator({ empresaId, usuarioAtual, hoje, aviso, onExecutado }) {
  const [frase, setFrase] = useState('');
  const [origem, setOrigem] = useState('whatsapp');
  const [rascunho, setRascunho] = useState(null);
  const [proposta, setProposta] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const interpretar = async () => {
    if (!frase.trim()) return;
    setOcupado(true);
    setResultado(null);
    try {
      const payload = rascunhoDeFrase(frase, { source: origem });
      setRascunho(payload);
      const p = await proporComando(payload, { companyId: empresaId, usuarioAtual, hoje });
      setProposta(p);
    } catch (e) {
      aviso?.(e?.message || 'Não consegui interpretar o comando.');
      setProposta(null);
    } finally { setOcupado(false); }
  };

  const confirmar = async () => {
    setOcupado(true);
    try {
      const r = await executarComando(proposta, { confirmado: true });
      setResultado(r);
      if (r.status === STATUS.EXECUTADO) {
        aviso?.('Comando executado pela operação oficial.');
        onExecutado?.(r);
        setProposta(null);
      } else {
        aviso?.(r.motivo || 'A proposta não pôde ser executada.');
      }
    } catch (e) {
      aviso?.(e?.message || 'Não consegui executar o comando.');
    } finally { setOcupado(false); }
  };

  const cancelar = () => {
    setResultado(cancelarComando(proposta));
    setProposta(null);
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="h-4 w-4 text-slate-400" aria-hidden="true" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          Simulador do agente · uso interno
        </h2>
      </div>

      <div className="rounded-2xl bg-white p-5 ring-1 ring-slate-200/70">
        <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
          Digite a mensagem como ela chegaria do campo. Nada é enviado para fora: a interpretação é
          local e a execução usa a mesma operação oficial do quadro, com confirmação.
        </p>

        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={frase} onChange={(e) => setFrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') interpretar(); }}
            placeholder="Ex.: cria uma OS para o Plaza amanhã às 9 porque o portão não abre"
            aria-label="Mensagem simulada"
            className={cx('min-w-0 flex-1 rounded-xl bg-white px-3.5 py-3 text-[14px] text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-300', ring)} />
          <select value={origem} onChange={(e) => setOrigem(e.target.value)} aria-label="Origem simulada"
            className={cx('rounded-xl bg-white px-3 py-3 text-[13px] text-slate-700 ring-1 ring-slate-200', ring)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="voice_transcript">Voz (transcrição)</option>
            <option value="assistant">Assistant</option>
            <option value="mobile">App mobile</option>
            <option value="text">Texto</option>
          </select>
          <button onClick={interpretar} disabled={ocupado || !frase.trim()}
            className={cx('inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-[14px] font-medium text-white hover:bg-slate-800 disabled:opacity-40', ring)}>
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MessageSquare className="h-4 w-4" aria-hidden="true" />}
            Interpretar
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXEMPLOS.map((ex) => (
            <button key={ex} onClick={() => setFrase(ex)}
              className={cx('rounded-lg bg-slate-100 px-2.5 py-1 text-left text-[11.5px] text-slate-600 hover:bg-slate-200', ring)}>
              {ex.length > 52 ? `${ex.slice(0, 52)}…` : ex}
            </button>
          ))}
        </div>

        {rascunho ? (
          <details className="mt-4">
            <summary className={cx('cursor-pointer text-[12px] text-slate-400', ring)}>
              Comando estruturado gerado
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-3 text-[11.5px] leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
{JSON.stringify(rascunho, null, 2)}
            </pre>
          </details>
        ) : null}

        {proposta ? <Proposta proposta={proposta} ocupado={ocupado} onConfirmar={confirmar} onCancelar={cancelar} /> : null}

        {resultado ? (
          <div className={cx('mt-4 rounded-xl p-4 ring-1',
            resultado.status === STATUS.EXECUTADO ? 'bg-emerald-50 text-emerald-900 ring-emerald-200/70'
              : resultado.status === STATUS.CANCELADO ? 'bg-slate-50 text-slate-600 ring-slate-200/70'
              : 'bg-amber-50 text-amber-900 ring-amber-200/70')}>
            <p className="text-[13.5px]">
              {resultado.status === STATUS.EXECUTADO ? 'Executado pela operação oficial.'
                : resultado.status === STATUS.CANCELADO ? 'Comando cancelado. Nada foi alterado.'
                : resultado.motivo || 'Não executado.'}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Proposta({ proposta, ocupado, onConfirmar, onCancelar }) {
  if (proposta.status === STATUS.AMBIGUO) {
    return (
      <div className="mt-4 rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200/70">
        <p className="text-[14px] font-medium text-amber-900">{proposta.pergunta || 'Preciso de mais um detalhe.'}</p>
        {(proposta.opcoes || []).length ? (
          <ul className="mt-2 space-y-1">
            {proposta.opcoes.map((o) => (
              <li key={o.id} className="text-[13px] text-amber-900/90">· {o.label}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-[12px] text-amber-900/70">
          Nada foi criado: com mais de uma opção o agente pergunta em vez de escolher.
        </p>
      </div>
    );
  }
  if (proposta.status === STATUS.INVALIDO || proposta.status === STATUS.NEGADO) {
    return (
      <div className="mt-4 rounded-xl bg-rose-50 p-4 text-[13.5px] text-rose-900 ring-1 ring-rose-200/70">
        {proposta.motivo || 'Comando não aceito.'}
      </div>
    );
  }

  const pronto = proposta.status === STATUS.PRONTO;
  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {pronto ? 'Consulta' : 'Proposta'}
      </p>
      <dl className="space-y-1.5">
        {(proposta.resumo || []).map((linha) => (
          <div key={linha.rotulo} className="flex items-baseline justify-between gap-4">
            <dt className="text-[13px] text-slate-500">{linha.rotulo}</dt>
            <dd className="text-right text-[14px] font-medium text-slate-900">{linha.valor}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onCancelar} disabled={ocupado}
          className={cx('inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40', ring)}>
          <X className="h-4 w-4" aria-hidden="true" /> Cancelar
        </button>
        <button onClick={onConfirmar} disabled={ocupado}
          className={cx('inline-flex items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-teal-800 disabled:opacity-40', ring)}>
          {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {pronto ? 'Consultar' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
