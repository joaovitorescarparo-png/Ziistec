import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { SPEECH_STATUS, initialSpeechState, isAppleMobile, isSpeechBusy, speechErrorMessage, speechReducer } from '../lib/speechStateMachine';

const getSpeechCtor=()=>{
  if(typeof window==='undefined') return null;
  return window.SpeechRecognition||window.webkitSpeechRecognition||null;
};

export default function useSpeechInput({language='pt-BR',onText,maxDurationMs=30000,processingTimeoutMs=5000}={}){
  const recognitionRef=useRef(null);
  const onTextRef=useRef(onText);
  const activeRef=useRef(false);
  const cancelledRef=useRef(false);
  const finalRef=useRef('');
  const maxTimerRef=useRef(null);
  const processingTimerRef=useRef(null);
  const resetTimerRef=useRef(null);
  const [supported,setSupported]=useState(false);
  const [state,dispatch]=useReducer(speechReducer,initialSpeechState);

  useEffect(()=>{onTextRef.current=onText;},[onText]);
  useEffect(()=>{setSupported(Boolean(getSpeechCtor()));},[]);

  const clearTimers=useCallback(()=>{
    for(const ref of [maxTimerRef,processingTimerRef,resetTimerRef]){if(ref.current){clearTimeout(ref.current);ref.current=null;}}
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

  const stop=useCallback(()=>{
    if(!activeRef.current) return false;
    dispatch({type:'STOP'});
    if(maxTimerRef.current){clearTimeout(maxTimerRef.current);maxTimerRef.current=null;}
    processingTimerRef.current=setTimeout(()=>{
      const rec=recognitionRef.current;
      try{rec?.abort();}catch{/* noop */}
      finishError('timeout');
    },Math.max(1500,processingTimeoutMs));
    try{recognitionRef.current?.stop();return true;}catch{finishError('Não consegui finalizar o ditado. Tente novamente.');return false;}
  },[finishError,processingTimeoutMs]);

  const start=useCallback(()=>{
    if(activeRef.current||isSpeechBusy(state.status)) return false;
    clearTimers();cancelledRef.current=false;finalRef.current='';
    const SpeechRecognition=getSpeechCtor();
    if(!SpeechRecognition){setSupported(false);dispatch({type:'ERROR',message:'Ditado por voz não é suportado neste navegador. Use a digitação ou o microfone do teclado do celular.'});return false;}
    const recognition=new SpeechRecognition();
    recognitionRef.current=recognition;activeRef.current=true;
    recognition.lang=language;
    recognition.continuous=!isAppleMobile(typeof navigator==='undefined'?'':navigator.userAgent);
    recognition.interimResults=true;
    recognition.maxAlternatives=1;
    recognition.onstart=()=>dispatch({type:'START'});
    recognition.onresult=(event)=>{
      let finalText='';let interimText='';
      for(let i=event.resultIndex;i<event.results.length;i+=1){
        const text=event.results[i]?.[0]?.transcript||'';
        if(event.results[i].isFinal) finalText+=text+' '; else interimText+=text;
      }
      const cleanFinal=finalText.trim();
      if(cleanFinal) finalRef.current=[finalRef.current.trim(),cleanFinal].filter(Boolean).join(' ');
      emit(cleanFinal,interimText);
    };
    recognition.onerror=(event)=>{
      const code=String(event?.error||'');
      if(code==='aborted'&&cancelledRef.current) return;
      finishError(code||'unknown');
    };
    recognition.onend=()=>{
      if(processingTimerRef.current){clearTimeout(processingTimerRef.current);processingTimerRef.current=null;}
      if(maxTimerRef.current){clearTimeout(maxTimerRef.current);maxTimerRef.current=null;}
      recognitionRef.current=null;activeRef.current=false;
      if(cancelledRef.current){cancelledRef.current=false;dispatch({type:'CANCEL'});return;}
      if(finalRef.current.trim()){dispatch({type:'SUCCESS'});scheduleIdle();}
      else dispatch({type:'ERROR',message:speechErrorMessage('no-speech')});
    };
    dispatch({type:'START'});
    maxTimerRef.current=setTimeout(()=>{
      try{recognitionRef.current?.abort();}catch{/* noop */}
      finishError('timeout');
    },Math.max(5000,maxDurationMs));
    try{recognition.start();return true;}catch(error){
      if(String(error?.name||'')==='InvalidStateError') return false;
      finishError('Não consegui iniciar o microfone. Tente novamente.');return false;
    }
  },[clearTimers,emit,finishError,language,maxDurationMs,scheduleIdle,state.status]);

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
