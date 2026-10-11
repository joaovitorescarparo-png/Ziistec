import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { SPEECH_STATUS, initialSpeechState, isAppleMobile, isSpeechBusy, speechErrorMessage, speechReducer } from '../lib/speechStateMachine';

const getSpeechCtor=()=>{
  if(typeof window==='undefined') return null;
  return window.SpeechRecognition||window.webkitSpeechRecognition||null;
};
const currentUserAgent=()=>typeof navigator==='undefined'?'':navigator.userAgent;

// Limite de reinícios quando o motor encerra sozinho numa pausa curta (Android ignora `continuous`).
const MAX_ENGINE_RESTARTS=3;
const comparable=(value)=>String(value||'').toLowerCase().replace(/[.,!?;:]+/g,' ').replace(/\s+/g,' ').trim();

// Junta um trecho final sem duplicar: o Chrome reenvia finais já entregues e, no Android,
// cada final pode repetir todo o texto anterior da sessão.
function mergeSpeechText(current,next){
  const left=String(current||'').trim();
  const right=String(next||'').trim();
  if(!right) return left;
  if(!left) return right;
  const a=comparable(left),b=comparable(right);
  if(b===a||b.startsWith(`${a} `)) return right;
  if(a.endsWith(` ${b}`)) return left;
  return `${left} ${right}`;
}

export default function useSpeechInput({language='pt-BR',onText,onComplete,continuous,maxDurationMs=30000,processingTimeoutMs=5000,silenceMs=0}={}){
  const recognitionRef=useRef(null);
  const onTextRef=useRef(onText);
  const onCompleteRef=useRef(onComplete);
  const activeRef=useRef(false);
  const cancelledRef=useRef(false);
  const stoppingRef=useRef(false);
  const finalRef=useRef('');
  const baseRef=useRef('');
  const sessionRef=useRef('');
  const interimRef=useRef('');
  const restartsRef=useRef(0);
  const maxTimerRef=useRef(null);
  const processingTimerRef=useRef(null);
  const resetTimerRef=useRef(null);
  const silenceTimerRef=useRef(null);
  const [supported,setSupported]=useState(false);
  const [state,dispatch]=useReducer(speechReducer,initialSpeechState);
  // Com janela de silêncio, a frase só termina depois de `silenceMs` sem fala nova.
  const graceMode=Number(silenceMs)>0;

  useEffect(()=>{onTextRef.current=onText;onCompleteRef.current=onComplete;},[onText,onComplete]);
  useEffect(()=>{setSupported(Boolean(getSpeechCtor()));},[]);

  const clearTimers=useCallback(()=>{
    for(const ref of [maxTimerRef,processingTimerRef,resetTimerRef,silenceTimerRef]){if(ref.current){clearTimeout(ref.current);ref.current=null;}}
  },[]);
  const emit=useCallback((finalText='',interimText='')=>{
    const committed=finalRef.current.trim();
    const interim=String(interimText||'').trim();
    onTextRef.current?.({finalText:String(finalText||'').trim(),interimText:interim,text:[committed,interim].filter(Boolean).join(' ').trim()});
  },[]);
  const scheduleIdle=useCallback(()=>{
    if(resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current=setTimeout(()=>dispatch({type:'RESET'}),900);
  },[]);

  const finishError=useCallback((codeOrMessage)=>{
    clearTimers();activeRef.current=false;recognitionRef.current=null;
    const message=String(codeOrMessage||'').includes(' ') ? String(codeOrMessage) : speechErrorMessage(codeOrMessage);
    dispatch({type:'ERROR',message:message||'Ditado interrompido.'});
  },[clearTimers]);

  const cancel=useCallback(()=>{
    cancelledRef.current=true;clearTimers();
    const rec=recognitionRef.current;recognitionRef.current=null;activeRef.current=false;
    try{rec?.abort();}catch{/* noop */}
    emit('', '');dispatch({type:'CANCEL'});
  },[clearTimers,emit]);

  // Encerramento gracioso: o motor entrega o último trecho final antes do `onend`.
  const requestStop=useCallback(()=>{
    if(!activeRef.current||stoppingRef.current) return false;
    stoppingRef.current=true;
    dispatch({type:'STOP'});
    for(const ref of [maxTimerRef,silenceTimerRef]){if(ref.current){clearTimeout(ref.current);ref.current=null;}}
    processingTimerRef.current=setTimeout(()=>{
      const rec=recognitionRef.current;
      try{rec?.abort();}catch{/* noop */}
      finishError('timeout');
    },Math.max(1500,processingTimeoutMs));
    try{recognitionRef.current?.stop();return true;}catch{finishError('Não consegui finalizar o ditado. Tente novamente.');return false;}
  },[finishError,processingTimeoutMs]);

  const stop=useCallback(()=>requestStop(),[requestStop]);

  const complete=useCallback(()=>{
    clearTimers();recognitionRef.current=null;activeRef.current=false;
    // O último trecho ainda em hipótese só entra quando já há frase final reconhecida.
    if(graceMode&&finalRef.current.trim()&&interimRef.current) finalRef.current=mergeSpeechText(finalRef.current,interimRef.current);
    const text=finalRef.current.trim();
    if(text){dispatch({type:'SUCCESS'});scheduleIdle();onCompleteRef.current?.(text);}
    else dispatch({type:'ERROR',message:speechErrorMessage('no-speech')});
  },[clearTimers,graceMode,scheduleIdle]);

  const listen=useCallback(()=>{
    const SpeechRecognition=getSpeechCtor();
    const recognition=new SpeechRecognition();
    recognitionRef.current=recognition;activeRef.current=true;
    sessionRef.current='';interimRef.current='';
    recognition.lang=language;
    recognition.continuous=continuous ?? !isAppleMobile(currentUserAgent());
    recognition.interimResults=true;
    recognition.maxAlternatives=1;
    recognition.onstart=()=>{if(recognitionRef.current===recognition) dispatch({type:'START'});};
    recognition.onresult=(event)=>{
      if(recognitionRef.current!==recognition) return;
      // Reconstrói os finais da sessão a partir da lista inteira: entregas repetidas não duplicam.
      let sessionText='';let interimText='';
      for(let i=0;i<event.results.length;i+=1){
        const text=event.results[i]?.[0]?.transcript||'';
        if(event.results[i].isFinal) sessionText=mergeSpeechText(sessionText,text); else if(i>=event.resultIndex) interimText+=text;
      }
      sessionRef.current=mergeSpeechText(sessionRef.current,sessionText);
      interimRef.current=interimText.trim();
      const previous=finalRef.current;
      finalRef.current=[baseRef.current,sessionRef.current].filter(Boolean).join(' ').trim();
      const added=finalRef.current===previous?'':finalRef.current.startsWith(previous)?finalRef.current.slice(previous.length):'';
      emit(added,interimText);
      if(graceMode&&!stoppingRef.current&&(sessionText||interimRef.current)){
        if(silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current=setTimeout(()=>{silenceTimerRef.current=null;requestStop();},Number(silenceMs));
      }
    };
    recognition.onerror=(event)=>{
      if(recognitionRef.current!==recognition) return;
      const code=String(event?.error||'');
      if(code==='aborted'&&cancelledRef.current) return;
      // Silêncio depois de uma frase já reconhecida encerra normalmente no `onend`.
      if(graceMode&&code==='no-speech'&&finalRef.current.trim()) return;
      finishError(code||'unknown');
    };
    recognition.onend=()=>{
      if(recognitionRef.current!==recognition) return;
      if(cancelledRef.current){
        clearTimers();recognitionRef.current=null;activeRef.current=false;cancelledRef.current=false;dispatch({type:'CANCEL'});return;
      }
      // Pausa curta: o motor encerrou sozinho, mas a janela de silêncio ainda está aberta.
      const pausedMidSentence=graceMode&&!stoppingRef.current&&silenceTimerRef.current&&maxTimerRef.current
        &&restartsRef.current<MAX_ENGINE_RESTARTS&&!isAppleMobile(currentUserAgent());
      if(pausedMidSentence){
        if(interimRef.current) finalRef.current=mergeSpeechText(finalRef.current,interimRef.current);
        baseRef.current=finalRef.current;restartsRef.current+=1;
        try{listen().start();return;}catch{/* conclui com o que já foi reconhecido */}
      }
      complete();
    };
    return recognition;
  },[clearTimers,complete,continuous,emit,finishError,graceMode,language,requestStop,silenceMs]);

  const start=useCallback(()=>{
    if(activeRef.current||isSpeechBusy(state.status)) return false;
    clearTimers();cancelledRef.current=false;stoppingRef.current=false;
    finalRef.current='';baseRef.current='';sessionRef.current='';interimRef.current='';restartsRef.current=0;
    if(!getSpeechCtor()){setSupported(false);dispatch({type:'ERROR',message:'Ditado por voz não é suportado neste navegador. Use a digitação ou o microfone do teclado do celular.'});return false;}
    const recognition=listen();
    dispatch({type:'START'});
    maxTimerRef.current=setTimeout(()=>{
      maxTimerRef.current=null;
      // Limite máximo: com janela de silêncio conclui o que foi dito; sem ela mantém o erro.
      if(graceMode){requestStop();return;}
      try{recognitionRef.current?.abort();}catch{/* noop */}
      finishError('timeout');
    },Math.max(5000,maxDurationMs));
    try{recognition.start();return true;}catch(error){
      if(String(error?.name||'')==='InvalidStateError') return false;
      finishError('Não consegui iniciar o microfone. Tente novamente.');return false;
    }
  },[clearTimers,finishError,graceMode,listen,maxDurationMs,requestStop,state.status]);

  useEffect(()=>()=>cancel(),[cancel]);

  return {
    supported, status:state.status, error:state.error,
    listening:state.status===SPEECH_STATUS.LISTENING,
    processing:state.status===SPEECH_STATUS.PROCESSING,
    success:state.status===SPEECH_STATUS.SUCCESS,
    busy:isSpeechBusy(state.status),
    start,stop,cancel,retry:start,
  };
}
