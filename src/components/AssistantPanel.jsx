import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Mic, X } from 'lucide-react';
import useSpeechInput from '../hooks/useSpeechInput';
import { toolsForRole } from '../lib/assistantTools';
import { requestAssistant, createAssistantRequestId, assistantFormInput } from '../lib/assistantApi';

const button = 'min-h-11 rounded-xl px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 disabled:opacity-50';
// Pausas de fala natural ("Faz um orçamento para o Mauro…" … "com dois interfones") não encerram o
// ditado: o envio automático só ocorre após este silêncio sem fala nem hipótese nova. Parar envia na hora.
export const VOICE_SILENCE_MS = 3500;
// Pedido longo com pausas cabe no ditado; ao atingir o limite, o que foi dito é concluído, não descartado.
export const VOICE_MAX_DURATION_MS = 60000;
const FREE_INTERPRETATION_DISABLED = 'FREE_INTERPRETATION_DISABLED';
const SENSITIVE = ['create_financial_entry', 'finalize_assigned_work_order', 'owner_adjust_stock', 'owner_archive_quote', 'owner_cancel_work_order'];
// Entidades que viram "referência ativa": o navegador guarda só tipo + id; a API revalida tudo no banco.
const REFERENCE_TYPES = ['quote', 'work_order', 'client', 'product', 'service'];
const REFERENCE_FALLBACK = { quote: 'orçamento', work_order: 'OS', client: 'cliente cadastrado', product: 'produto cadastrado', service: 'serviço cadastrado' };
const referenceOf = (record) => (record?.id && REFERENCE_TYPES.includes(record.entityType)
  ? { type: record.entityType, id: record.id, label: record.number || record.title || REFERENCE_FALLBACK[record.entityType] } : null);
// Registros que o shell sabe abrir (App.jsx openAssistantRecord); linhas de relatório não têm botão.
const OPENABLE = ['client', 'product', 'work_order', 'quote', 'financial_entry'];
const MAX_MESSAGES = 12;
const fieldClass = 'w-full min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-base';
const suggestions = {
  owner: ['Qual meu próximo atendimento?', 'Faz um orçamento pro Mauro com duas câmeras e instalação.', 'Procura o telefone do cliente Mauro.'],
  technician: ['Qual meu próximo atendimento?', 'Minhas OS de hoje'],
};

// Respostas curtas a uma prévia pendente. Confirmar por texto equivale ao botão Confirmar da mesma prévia.
const fold = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const CONFIRM_REPLY = /^(?:(?:sim|ok|isso) )?(?:sim|ok|isso|isso mesmo|certo|fechado|pode|pode sim|pode criar|pode fazer|pode salvar|pode gravar|pode confirmar|confirma|confirmar|confirmo|confirmado|cria|crie|salva|salve|grava|grave)(?: por favor)?$/;
const CANCEL_REPLY = /^(?:nao|cancela|cancelar|cancele|deixa|deixa pra la|esquece|esqueca|desisto|nao precisa)(?: por favor)?$/;
export const previewReply = text => CONFIRM_REPLY.test(fold(text)) ? 'confirm' : CANCEL_REPLY.test(fold(text)) ? 'cancel' : null;

// Escolha tocada pelo usuário numa pergunta do banco: só acrescenta a referência ao rascunho devolvido.
function applyChoice(draft, option) {
  const next = JSON.parse(JSON.stringify(draft || {}));
  if (option.slot === 'client') next.clientRef = option.ref;
  else if (next.items?.[Number(option.slot.slice(5))]) next.items[Number(option.slot.slice(5))].ref = option.ref;
  return next;
}
function whatsappLink(record) {
  const digits = String(record.whatsapp || record.phone || '').replace(/\D/g, '');
  const number = digits.length === 10 || digits.length === 11 ? `55${digits}` : /^55\d{10,11}$/.test(digits) ? digits : '';
  return number ? `https://wa.me/${number}` : '';
}

export default function AssistantPanel({ companyId, role, currentWorkOrder, onOpenRecord, onChanged, hidden = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [action, setAction] = useState('');
  const [values, setValues] = useState({});
  const [answer, setAnswer] = useState(null);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState('');
  const [notice, setNotice] = useState('');
  const [clarification, setClarification] = useState('');
  const [choices, setChoices] = useState(null);
  const [messages, setMessages] = useState([]);
  const [activeRef, setActiveRef] = useState(null);
  const conversation = useRef('');
  const lastRequest = useRef('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [otherDialog, setOtherDialog] = useState(false);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const voiceActive = useRef(false);
  const panel = useRef(null), trigger = useRef(null), locked = useRef(false);
  const epoch = useRef(0), abort = useRef(null), requestId = useRef(null), previewRequest = useRef(null);
  const allowed = toolsForRole(role);
  const tool = allowed.find(item => item.name === action);
  const pending = answer?.confirmationRequired && !answer.result ? answer : null;
  const say = (from, said) => setMessages(list => [...list, { from, text: String(said).slice(0, 600) }].slice(-MAX_MESSAGES));
  const clearStatus = () => { setError(''); setNotice(''); setErrorKind(''); };
  const reset = () => { epoch.current += 1; abort.current?.abort(); locked.current = false; setBusy(false); requestId.current = null; previewRequest.current = null; setAnswer(null); setError(''); setNotice(''); setUncertain(false); setSensitiveConfirmed(false); };
  const edit = () => { reset(); conversation.current = ''; setClarification(''); setChoices(null); setErrorKind(''); };
  const restart = () => { edit(); setText(''); setAction(''); setValues({}); setMessages([]); setActiveRef(null); };
  const speech = useSpeechInput({ silenceMs: VOICE_SILENCE_MS, maxDurationMs: VOICE_MAX_DURATION_MS,
    onText: ({ text: spoken, finalText, interimText }) => { if (voiceActive.current && (finalText || interimText) && spoken && !locked.current) { requestId.current = null; setText(spoken); } },
    onComplete: spoken => { if (voiceActive.current && open && !locked.current) { voiceActive.current = false; send('plan', spoken); } },
  });
  const cancelVoice = () => { voiceActive.current = false; speech.cancel(); };
  // Ditado também serve para ajustar uma prévia pendente: não descarta a prévia ao começar.
  const startVoice = () => { clearStatus(); requestId.current = null; voiceActive.current = true; if (speech.start() === false) voiceActive.current = false; };

  // A conversa sobrevive a abrir um registro e voltar; só troca de empresa ou papel a reinicia.
  useEffect(() => {
    cancelVoice(); restart(); setOpen(false);
    return () => { epoch.current += 1; abort.current?.abort(); };
  }, [companyId, role]);

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
      if (event.key === 'Escape' && !locked.current) { setOpen(false); cancelVoice(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(panel.current?.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]') || [])]
        .filter(node => node.getClientRects().length > 0);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keys); (previous?.isConnected ? previous : trigger.current)?.focus(); };
  }, [open]);

  async function send(operation, spokenText, option) {
    if (locked.current) return;
    const prompt = spokenText ?? text;
    if (operation === 'plan' && !prompt.trim()) return;
    if (operation === 'choose' && !(option && choices)) return;
    // Resposta curta a uma prévia pendente: cancelar descarta localmente; confirmar usa a mesma confirmação do botão.
    if (operation === 'plan' && pending && !clarification) {
      const reply = previewReply(prompt);
      if (reply === 'cancel') { cancelVoice(); say('user', prompt); restartPreview('Prévia descartada. Nada foi gravado.'); return; }
      if (reply === 'confirm') {
        if (SENSITIVE.includes(pending.action) && !sensitiveConfirmed) { cancelVoice(); setText(''); setNotice('Marque a confirmação reforçada abaixo da prévia para continuar.'); return; }
        say('user', prompt); setText(''); operation = 'execute';
      }
    }
    // Execution is only reachable from a reviewed mutation, never from an interpretation.
    if (operation === 'execute' && (!pending || !previewRequest.current)) return;
    if (operation === 'execute' && SENSITIVE.includes(pending.action) && !sensitiveConfirmed) return;
    locked.current = true; setBusy(true); clearStatus(); cancelVoice();
    // Uma nova tentativa do mesmo texto reaproveita o requestId; uma escolha sempre é outra solicitação.
    const retry = operation === 'plan' && Boolean(requestId.current);
    if (operation === 'choose') requestId.current = createAssistantRequestId();
    if (operation !== 'execute') requestId.current ||= createAssistantRequestId();
    const generation = epoch.current;
    const controller = new AbortController(); abort.current = controller;
    // Ajustes e escolhas sobre uma prévia pendente geram outra solicitação; a anterior é só referência.
    const context = operation !== 'execute' && pending && previewRequest.current !== requestId.current ? { contextRequestId: previewRequest.current } : {};
    try {
      const payload = operation === 'execute' ? { operation, companyId, requestId: previewRequest.current }
        : { operation: operation === 'choose' ? 'preview' : operation, companyId, requestId: requestId.current, ...context };
      if (operation === 'plan') {
        const combined = clarification ? `${conversation.current}\nPergunta: ${clarification}\nResposta: ${prompt}` : prompt;
        if (combined.length > 10000) throw new Error('Solicitação longa demais. Inicie uma nova solicitação.');
        Object.assign(payload, { text: combined, ...(currentWorkOrder ? { currentWorkOrder } : {}), ...(activeRef ? { activeReference: { type: activeRef.type, id: activeRef.id } } : {}) });
        if (!retry) say('user', prompt);
        lastRequest.current = prompt;
      }
      if (operation === 'preview') Object.assign(payload, { action, input: assistantFormInput(tool, values) });
      if (operation === 'choose') { Object.assign(payload, { action: choices.action, input: applyChoice(choices.draft, option) }); say('user', option.label); }
      const result = await requestAssistant(payload, { signal: controller.signal });
      if (epoch.current !== generation) return;
      // A API não conseguiu revalidar a referência (outra empresa, arquivada, sem acesso): esquecer.
      if (result.referenceCleared) setActiveRef(null);
      if (typeof result.question === 'string' && result.question.trim()) {
        if (operation === 'execute') throw new Error('Resposta inesperada da API. Nada foi confirmado.');
        if (operation === 'plan') conversation.current = payload.text;
        else conversation.current ||= lastRequest.current;
        setClarification(result.question); setText('');
        setChoices(Array.isArray(result.options) && result.options.length && result.draft ? { options: result.options, action: result.action, draft: result.draft } : null);
        // Pergunta sobre um ajuste mantém a prévia vigente, que continua valendo como está.
        if (!context.contextRequestId) setAnswer(null);
        requestId.current = null; say('assistant', result.question);
        return;
      }
      setClarification(''); setChoices(null); conversation.current = '';
      setAnswer(result); setUncertain(false); setSensitiveConfirmed(false);
      if (result.action) setAction(result.action);
      if (result.input) setValues(result.input);
      if (operation !== 'execute') setText('');
      if (operation !== 'execute' && result.confirmationRequired && !result.result) {
        previewRequest.current = requestId.current; requestId.current = null;
        say('assistant', context.contextRequestId ? 'Atualizei a prévia. Revise e confirme; a prévia anterior não vale mais.' : 'Preparei a prévia. Revise e confirme para gravar.');
      } else {
        requestId.current = null;
        if (operation === 'execute') previewRequest.current = null;
        if (result.result?.message) say('assistant', `${result.result.message}${result.result.number ? ` ${result.result.number}` : ''}`);
        // O registro recém-criado/alterado ou o único encontrado vira o assunto da conversa; arquivado sai.
        // Consulta sobre um cliente (histórico, garantias, saldo) mantém esse cliente como assunto.
        const single = operation === 'execute' ? result.result : (result.result?.items?.length === 1 ? result.result.items[0] : null);
        if (operation === 'execute' && pending?.action === 'owner_archive_quote') setActiveRef(null);
        else if (referenceOf(single)) setActiveRef(referenceOf(single));
        else if (referenceOf(result.result?.subject)) setActiveRef(referenceOf(result.result.subject));
      }
      if (operation === 'execute' && result.result) await onChanged?.();
    } catch (failure) {
      if (epoch.current !== generation || failure.name === 'AbortError') return;
      // Interpretação livre desligada não é falha: o texto continua editável para uma consulta simples.
      if (failure.code === FREE_INTERPRETATION_DISABLED) { setNotice(failure.message); requestId.current = null; return; }
      // A prévia de referência expirou ou já foi usada: ela não pode mais ser confirmada nem ajustada.
      if (context.contextRequestId && failure.code === 'PLAN_EXPIRED') { previewRequest.current = null; setAnswer(null); requestId.current = null; }
      setError(failure.message || 'Não foi possível conectar. Tente novamente.');
      setErrorKind(failure.kind === 'auth' ? 'auth' : 'api');
      if (operation === 'execute') setUncertain(previous => previous || !failure.status || failure.status >= 500);
    } finally {
      if (epoch.current === generation) { locked.current = false; setBusy(false); }
    }
  }
  function restartPreview(message) { edit(); setText(''); say('assistant', message); }

  const close = () => { if (!locked.current) { setOpen(false); cancelVoice(); } };
  const copyPhone = async value => {
    try { await globalThis.navigator?.clipboard?.writeText(value); setNotice('Telefone copiado.'); }
    catch { setNotice('Não foi possível copiar. Selecione o número e copie manualmente.'); }
  };
  const sensitive = SENSITIVE.includes(pending?.action);
  const records = answer?.result?.items || (answer?.result?.id ? [answer.result] : []);
  const label = pending ? 'Quer ajustar algo? Fale ou digite' : clarification ? 'Sua resposta' : 'Sua solicitação';
  return <>
    {!open && !hidden && !otherDialog && <button ref={trigger} type="button" onClick={() => setOpen(true)} aria-label="Abrir Assistente ZiisTec" aria-haspopup="dialog" className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg md:bottom-6"><Sparkles className="h-5 w-5" /></button>}
    {open && <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-6">
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="assistant-title" data-ziistec-assistant className="flex max-h-[calc(100dvh-env(safe-area-inset-top))] w-full min-w-0 flex-col rounded-t-3xl bg-white shadow-xl sm:max-w-xl sm:rounded-3xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b p-4"><div><h2 id="assistant-title" className="font-semibold">Assistente ZiisTec</h2><p className="text-sm text-slate-600">{speech.listening ? 'Ouvindo… O que você precisa?' : 'O que você precisa? Fale ou digite.'}</p></div><button type="button" disabled={busy} onClick={close} className={button} aria-label="Fechar assistente"><X size={20} /></button></header>
        <div className="min-h-0 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-4 [overflow-wrap:anywhere]">
          {activeRef && <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">Falando sobre: <span className="font-medium text-slate-800">{activeRef.label}</span><button type="button" disabled={busy} onClick={() => setActiveRef(null)} className="min-h-11 rounded-lg px-2 text-teal-800 underline">Esquecer</button></p>}
          {messages.length > 0 && <ol role="log" aria-live="polite" aria-label="Conversa com o assistente" className="space-y-2">{messages.map((message, index) => <li key={index} className={message.from === 'user' ? 'ml-8 rounded-2xl bg-teal-50 p-3 text-right' : 'mr-8 rounded-2xl bg-slate-100 p-3'}><span className="sr-only">{message.from === 'user' ? 'Você: ' : 'Assistente: '}</span>{message.text}</li>)}</ol>}
          {answer && <><h3 className="font-medium">{pending ? 'Prévia aguardando confirmação' : allowed.find(item => item.name === answer.action)?.label || 'Resultado'}</h3><dl className="space-y-2">{(answer.preview || []).map((item, index) => <div key={index}><dt className="text-sm text-slate-500">{item.label}</dt><dd>{String(item.value ?? '')}</dd></div>)}</dl>{answer.result?.message && <p role="status">{answer.result.message}</p>}
            {records.map(record => record.entityType === 'client' && (record.phone || record.whatsapp)
              ? <div key={record.id} className="rounded-xl bg-slate-50 p-3 space-y-1"><p className="font-medium">{record.title}</p>{record.detail && <p className="text-sm whitespace-pre-line">{record.detail}</p>}{record.phone && <p className="text-sm">Telefone: <a className="text-teal-800 underline" href={`tel:${String(record.phone).replace(/[^\d+]/g, '')}`}>{record.phone}</a></p>}{record.whatsapp && <p className="text-sm">WhatsApp: {record.whatsapp}</p>}<div className="flex flex-wrap gap-2 pt-1"><button type="button" onClick={() => copyPhone(record.phone || record.whatsapp)} className={`${button} bg-white`}>Copiar telefone</button>{whatsappLink(record) && <a href={whatsappLink(record)} target="_blank" rel="noopener noreferrer" className={`${button} inline-flex items-center bg-white text-teal-800`}>Abrir WhatsApp</a>}<button type="button" onClick={() => { onOpenRecord?.(record); close(); }} className={`${button} text-teal-800`}>Abrir cliente</button></div></div>
              : <div key={record.id || `${record.title}:${record.detail}`} className="rounded-xl bg-slate-50 p-3"><p className="font-medium">{record.number || record.title}</p>{record.number && record.title && record.title !== record.number && <p className="text-sm text-slate-600">{record.title}</p>}<p className="text-sm whitespace-pre-line">{record.detail}</p>{record.id && OPENABLE.includes(record.entityType) && <button type="button" onClick={() => { onOpenRecord?.(record); close(); }} className={`${button} text-teal-800`}>Abrir registro</button>}</div>)}
            {pending && <><p role="status">Revise os dados. Aguardando sua confirmação.</p>{sensitive && <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={sensitiveConfirmed} onChange={event => setSensitiveConfirmed(event.target.checked)} />Revisei o impacto desta ação e autorizo sua execução.</label>}<div className="flex flex-wrap gap-2"><button type="button" disabled={busy || (sensitive && !sensitiveConfirmed)} onClick={() => send('execute')} className={`${button} bg-teal-700 text-white`}>{uncertain ? 'Consultar / tentar novamente' : 'Confirmar'}</button><button type="button" disabled={busy || uncertain} onClick={() => { const previous = lastRequest.current; edit(); setText(previous); }} className={`${button} bg-slate-100`}>Editar</button><button type="button" disabled={busy || uncertain} onClick={() => { setAction(''); setValues({}); restartPreview('Prévia cancelada. Nada foi gravado.'); }} className={button}>Cancelar</button></div></>}
            {!pending && <button type="button" disabled={busy} onClick={restart} className={`${button} bg-slate-100`}>Nova solicitação</button>}</>}
          {clarification && <div className="space-y-2"><p role="status" className="rounded-xl bg-teal-50 p-3">{clarification}</p>{choices && <div className="flex flex-col gap-2" role="group" aria-label="Opções encontradas">{choices.options.map(option => <button type="button" key={`${option.slot}:${option.ref}`} disabled={busy} onClick={() => send('choose', undefined, option)} className={`${button} bg-slate-100 text-left`}>{option.label}</button>)}</div>}</div>}
          <form onSubmit={event => { event.preventDefault(); send('plan'); }}><label htmlFor="assistant-text" className="block text-sm font-medium mb-2">{label}</label><textarea id="assistant-text" value={text} disabled={busy || uncertain} maxLength={2000} rows={pending ? 2 : 3} className={fieldClass} onChange={event => { cancelVoice(); clearStatus(); requestId.current = null; setText(event.target.value); }} /><div className="mt-2 flex flex-wrap gap-2"><button type="submit" disabled={busy || uncertain || !text.trim()} className={`${button} bg-teal-700 text-white`}>{clarification ? 'Responder' : pending ? 'Enviar ajuste' : 'Enviar'}</button><button type="button" disabled={busy || uncertain || speech.processing || !speech.supported} onClick={() => speech.listening ? speech.stop() : startVoice()} className={`${button} bg-slate-100`} aria-label={speech.listening ? 'Parar ditado' : 'Ditar solicitação'}><Mic size={18} />{speech.listening ? 'Parar' : 'Ditar'}</button></div>{speech.busy && <button type="button" onClick={cancelVoice} className={button}>Cancelar ditado / editar texto</button>}{speech.processing && <p role="status">Transcrevendo…</p>}{speech.error && <p role="status" className="text-sm text-amber-800">{speech.error}</p>}{!speech.supported && <p className="mt-2 text-sm text-slate-600">Este navegador não oferece reconhecimento de voz. Digite sua solicitação ou use o microfone do teclado.</p>}</form>
          {!pending && <>
            <details className="text-sm text-slate-600"><summary>Exemplos de solicitações</summary><div className="mt-2 flex flex-wrap gap-2">{(suggestions[role] || []).map(example => <button type="button" disabled={busy} key={example} className={`${button} bg-slate-100`} onClick={() => { cancelVoice(); edit(); setText(example); }}>{example}</button>)}</div></details>
            <details><summary className="cursor-pointer text-sm text-slate-600">Preencher ação manualmente</summary><form onSubmit={event => { event.preventDefault(); send('preview'); }} className="space-y-3 border-t pt-4"><label className="block text-sm font-medium">Ação<select disabled={busy} value={action} className={`${fieldClass} mt-2`} onChange={event => { edit(); setAction(event.target.value); setValues({}); }}><option value="">Selecionar ação</option>{allowed.map(item => <option key={item.name} value={item.name}>{item.label}</option>)}</select></label>
              {tool && Object.entries(tool.inputSchema.properties).filter(([, field]) => !field.hidden).map(([key, field]) => <label key={key} className="block text-sm">{field.title || key}{tool.inputSchema.required?.includes(key) ? ' *' : ''}{field.enum || field.type === 'boolean' ? <select disabled={busy} required={tool.inputSchema.required?.includes(key)} className={`${fieldClass} mt-1`} value={values[key] ?? ''} onChange={event => { edit(); setValues(old => ({ ...old, [key]: event.target.value })); }}><option value="">Selecionar</option>{(field.enum || ['true', 'false']).map(value => <option key={String(value)} value={String(value)}>{value === 'true' ? 'Sim' : value === 'false' ? 'Não' : String(value)}</option>)}</select> : <input disabled={busy} required={tool.inputSchema.required?.includes(key)} className={`${fieldClass} mt-1`} type={field.type === 'number' || field.type === 'integer' ? 'number' : field.format === 'date' ? 'date' : 'text'} min={field.minimum} step={field.type === 'integer' ? '1' : 'any'} maxLength={field.maxLength} value={typeof values[key] === 'object' ? '' : values[key] ?? ''} onChange={event => { edit(); setValues(old => ({ ...old, [key]: event.target.value })); }} />}</label>)}
              <button type="submit" disabled={busy || !tool} className={`${button} bg-slate-900 text-white`}>Revisar ação</button></form></details></>}
          {busy && <p role="status">Processando…</p>}{notice && <p role="status" className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{notice}</p>}{error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{errorKind === 'auth' ? 'Sessão expirada: ' : 'Falha na solicitação: '}{error}{uncertain && ' O resultado pode já ter sido salvo. Consulte novamente antes de iniciar outra ação.'}</p>}
        </div>
      </section>
    </div>}
  </>;
}
