import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Mic, X } from 'lucide-react';
import useSpeechInput from '../hooks/useSpeechInput';
import { toolsForRole } from '../lib/assistantTools';
import { requestAssistant, createAssistantRequestId, assistantFormInput } from '../lib/assistantApi';

const button = 'min-h-11 rounded-xl px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50';
const fieldClass = 'w-full min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-base';
const suggestions = {
  owner: ['Agenda de hoje', 'Criar orçamento', 'Agendar visita', 'Cadastrar cliente', 'Registrar receita'],
  technician: ['Minhas OS de hoje', 'Registrar relato desta OS', 'Finalizar esta OS'],
};

export default function AssistantPanel({ companyId, role, currentWorkOrder, onOpenRecord, onChanged, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [action, setAction] = useState('');
  const [values, setValues] = useState({});
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState('');
  const [clarification, setClarification] = useState('');
  const conversation = useRef('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [otherDialog, setOtherDialog] = useState(false);
  const panel = useRef(null), trigger = useRef(null), locked = useRef(false);
  const epoch = useRef(0), abort = useRef(null), requestId = useRef(null);
  const allowed = toolsForRole(role);
  const tool = allowed.find(item => item.name === action);
  const reset = () => { epoch.current += 1; abort.current?.abort(); locked.current = false; setBusy(false); requestId.current = null; setAnswer(null); setError(''); setUncertain(false); };
  const edit = () => { reset(); conversation.current = ''; setClarification(''); setErrorKind(''); };
  const speech = useSpeechInput({ onText: ({ text: spoken }) => { if (!locked.current && !answer) { requestId.current = null; setText(spoken); } } });

  useEffect(() => {
    edit(); setOpen(false); setText(''); setAction(''); setValues({});
    return () => { epoch.current += 1; abort.current?.abort(); };
  }, [companyId, role, currentWorkOrder]);

  useEffect(() => {
    const check = () => setOtherDialog(Boolean(document.querySelector('[role="dialog"]:not([data-ziistec-assistant])')));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true }); check();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector('button')?.focus();
    const keys = event => {
      if (event.key === 'Escape' && !locked.current) { setOpen(false); speech.cancel(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(panel.current?.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])];
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keys); (previous?.isConnected ? previous : trigger.current)?.focus(); };
  }, [open]);

  async function send(operation) {
    if (locked.current) return;
    // Execution is only reachable from a reviewed mutation, never from an interpretation.
    if (operation === 'execute' && (!answer?.confirmationRequired || answer.result || !requestId.current)) return;
    locked.current = true; setBusy(true); setError(''); speech.cancel();
    setErrorKind('');
    requestId.current ||= createAssistantRequestId();
    const generation = epoch.current;
    const controller = new AbortController(); abort.current = controller;
    try {
      const payload = { operation, companyId, requestId: requestId.current };
      if (operation === 'plan') {
        const combined = clarification ? `${conversation.current}\nPergunta: ${clarification}\nResposta: ${text}` : text;
        if (combined.length > 10000) throw new Error('Solicitação longa demais. Inicie uma nova solicitação.');
        Object.assign(payload, { text: combined, ...(currentWorkOrder ? { currentWorkOrder } : {}) });
      }
      if (operation === 'preview') Object.assign(payload, { action, input: assistantFormInput(tool, values) });
      const result = await requestAssistant(payload, { signal: controller.signal });
      if (epoch.current !== generation) return;
      if (typeof result.question === 'string' && result.question.trim()) {
        if (operation !== 'plan') throw new Error('Resposta inesperada da API. Nada foi confirmado.');
        conversation.current = payload.text;
        setClarification(result.question); setText(''); setAnswer(null);
        requestId.current = null;
        return;
      }
      setClarification('');
      setAnswer(result); setUncertain(false);
      if (result.action) setAction(result.action);
      if (result.input) setValues(result.input);
      if (operation === 'execute' && result.result) await onChanged?.();
    } catch (failure) {
      if (epoch.current !== generation || failure.name === 'AbortError') return;
      setError(failure.message || 'Não foi possível conectar. Tente novamente.');
      setErrorKind(failure.kind === 'auth' ? 'auth' : 'api');
      if (operation === 'execute') setUncertain(previous => previous || !failure.status || failure.status >= 500);
    } finally {
      if (epoch.current === generation) { locked.current = false; setBusy(false); }
    }
  }

  const close = () => { if (!locked.current) { setOpen(false); speech.cancel(); } };
  const records = answer?.result?.items || (answer?.result?.id ? [answer.result] : []);
  return <>
    {!open && !hidden && !otherDialog && <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label="Abrir Assistente ZiisTec" aria-haspopup="dialog" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg md:bottom-6"><Sparkles className="h-5 w-5" /></button>}
    {open && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6">
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="assistant-title" data-ziistec-assistant className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full min-w-0 flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-xl sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b p-4"><div><h2 id="assistant-title" className="font-semibold">Assistente ZiisTec</h2><p className="text-sm text-slate-600">Como posso ajudar?</p></div><button type="button" disabled={busy} onClick={close} className={button} aria-label="Fechar assistente"><X size={20} /></button></header>
        <div className="min-h-0 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-4 [overflow-wrap:anywhere]">
          {!answer && <><div className="flex flex-wrap gap-2">{(suggestions[role] || []).map(label => <button type="button" disabled={busy} key={label} className={`${button} bg-slate-100`} onClick={() => { edit(); setText(label); }}>{label}</button>)}</div>
            {clarification && <p role="status" className="rounded-xl bg-teal-50 p-3">{clarification}</p>}<form onSubmit={event => { event.preventDefault(); send('plan'); }}><label htmlFor="assistant-text" className="block text-sm font-medium mb-2">{clarification ? 'Sua resposta' : 'Sua solicitação'}</label><textarea id="assistant-text" value={text} disabled={busy} maxLength={2000} rows={3} className={fieldClass} onChange={event => { reset(); setText(event.target.value); }} /><div className="mt-2 flex flex-wrap gap-2"><button type="submit" disabled={busy || !text.trim()} className={`${button} bg-teal-700 text-white`}>{clarification ? 'Responder' : 'Interpretar'}</button><button type="button" disabled={busy || !speech.supported} onClick={() => speech.listening ? speech.stop() : speech.start()} className={`${button} bg-slate-100`} aria-label={speech.listening ? 'Parar ditado' : 'Ditar solicitação'}><Mic size={18} />{speech.listening ? 'Parar' : 'Ditar'}</button></div>{speech.error && <p role="status" className="text-sm text-amber-800">{speech.error}</p>}</form>
            <form onSubmit={event => { event.preventDefault(); send('preview'); }} className="space-y-3 border-t pt-4"><label className="block text-sm font-medium">Ou escolha uma ação<select disabled={busy} value={action} className={`${fieldClass} mt-2`} onChange={event => { edit(); setAction(event.target.value); setValues({}); }}><option value="">Selecionar ação</option>{allowed.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
              {tool && Object.entries(tool.inputSchema.properties).map(([key, field]) => <label key={key} className="block text-sm">{field.title || key}{tool.inputSchema.required?.includes(key) ? ' *' : ''}{field.enum || field.type === 'boolean' ? <select disabled={busy} required={tool.inputSchema.required?.includes(key)} className={`${fieldClass} mt-1`} value={values[key] ?? ''} onChange={event => { edit(); setValues(old => ({ ...old, [key]: event.target.value })); }}><option value="">Selecionar</option>{(field.enum || ['true', 'false']).map(value => <option key={String(value)} value={String(value)}>{value === 'true' ? 'Sim' : value === 'false' ? 'Não' : String(value)}</option>)}</select> : <input disabled={busy} required={tool.inputSchema.required?.includes(key)} className={`${fieldClass} mt-1`} type={field.type === 'number' || field.type === 'integer' ? 'number' : field.format === 'date' ? 'date' : 'text'} min={field.minimum} step={field.type === 'integer' ? '1' : 'any'} maxLength={field.maxLength} value={values[key] ?? ''} onChange={event => { edit(); setValues(old => ({ ...old, [key]: event.target.value })); }} />}</label>)}
              <button type="submit" disabled={busy || !tool} className={`${button} bg-slate-900 text-white`}>Revisar ação</button></form></>}
          {answer && <><h3 className="font-medium">{allowed.find(item => item.name === answer.action)?.label || 'Resultado'}</h3><dl className="space-y-2">{(answer.preview || []).map((item, index) => <div key={index}><dt className="text-sm text-slate-500">{item.label}</dt><dd>{String(item.value ?? '')}</dd></div>)}</dl>{answer.result?.message && <p role="status">{answer.result.message}</p>}{records.map(record => <div key={record.id} className="rounded-xl bg-slate-50 p-3"><p>{record.number || record.title}</p><p className="text-sm">{record.detail}</p><button type="button" onClick={() => { onOpenRecord?.(record); close(); }} className={`${button} text-teal-800`}>Abrir registro</button></div>)}
            {answer.confirmationRequired && !answer.result && <><p role="status">Revise os dados. Aguardando sua confirmação.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => send('execute')} className={`${button} bg-teal-700 text-white`}>{uncertain ? 'Consultar / tentar novamente' : 'Confirmar'}</button><button type="button" disabled={busy || uncertain} onClick={edit} className={`${button} bg-slate-100`}>Editar</button><button type="button" disabled={busy || uncertain} onClick={() => { edit(); setText(''); setAction(''); setValues({}); }} className={button}>Cancelar</button></div></>}
            {(!answer.confirmationRequired || answer.result) && <button type="button" disabled={busy} onClick={() => { edit(); setText(''); setAction(''); setValues({}); }} className={`${button} bg-slate-100`}>Nova solicitação</button>}</>}
          {busy && <p role="status">Processando…</p>}{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{errorKind === 'auth' ? 'Sessão expirada: ' : 'Falha na solicitação: '}{error}{uncertain && ' O resultado pode já ter sido salvo. Consulte novamente antes de iniciar outra ação.'}</p>}
        </div>
      </section>
    </div>}
  </>;
}
