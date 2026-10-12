export const SPEECH_STATUS = Object.freeze({
  IDLE:'idle', LISTENING:'listening', PROCESSING:'processing', SUCCESS:'success', ERROR:'error',
});

export const initialSpeechState={status:SPEECH_STATUS.IDLE,error:'',lastSuccessAt:0};

export function speechReducer(state=initialSpeechState,action={}){
  switch(action.type){
    case 'START': return {status:SPEECH_STATUS.LISTENING,error:'',lastSuccessAt:state.lastSuccessAt||0};
    case 'STOP': return {...state,status:SPEECH_STATUS.PROCESSING,error:''};
    case 'SUCCESS': return {status:SPEECH_STATUS.SUCCESS,error:'',lastSuccessAt:Date.now()};
    case 'ERROR': return {...state,status:SPEECH_STATUS.ERROR,error:String(action.message||'Não consegui usar o ditado agora.')};
    case 'CANCEL':
    case 'RESET': return {...initialSpeechState,lastSuccessAt:state.lastSuccessAt||0};
    default: return state;
  }
}

export function appendSpeechText(base,addition){
  const left=String(base||'').trimEnd();
  const right=String(addition||'').trim();
  if(!right) return String(base||'');
  return left ? left + ' ' + right : right;
}

export function speechErrorMessage(code){
  const key=String(code||'').toLowerCase();
  if(key==='not-allowed'||key==='service-not-allowed') return 'Permita o acesso ao microfone para usar o ditado.';
  if(key==='audio-capture') return 'Não encontrei um microfone disponível. Você pode continuar digitando.';
  if(key==='network') return 'Sem conexão para o reconhecimento de voz agora. Você pode continuar digitando.';
  if(key==='no-speech') return 'Não ouvi nenhuma fala. Tente novamente quando estiver pronto.';
  if(key==='timeout') return 'O ditado demorou demais e foi encerrado. Tente novamente.';
  if(key==='aborted') return '';
  return 'Não consegui usar o microfone agora. Você pode continuar digitando.';
}

export function isAppleMobile(userAgent=''){
  const ua=String(userAgent||'');
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua)&&/Mobile/i.test(ua));
}

export function isSpeechBusy(status){
  return status===SPEECH_STATUS.LISTENING||status===SPEECH_STATUS.PROCESSING;
}
