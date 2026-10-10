import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEECH_STATUS, appendSpeechText, initialSpeechState, isAppleMobile, isSpeechBusy, speechErrorMessage, speechReducer } from '../../src/lib/speechStateMachine.js';

test('voice state machine follows idle -> listening -> processing -> success -> idle',()=>{
  let state=initialSpeechState;
  state=speechReducer(state,{type:'START'}); assert.equal(state.status,SPEECH_STATUS.LISTENING);
  assert.equal(isSpeechBusy(state.status),true);
  state=speechReducer(state,{type:'STOP'}); assert.equal(state.status,SPEECH_STATUS.PROCESSING);
  state=speechReducer(state,{type:'SUCCESS'}); assert.equal(state.status,SPEECH_STATUS.SUCCESS);
  state=speechReducer(state,{type:'RESET'}); assert.equal(state.status,SPEECH_STATUS.IDLE);
});

test('voice error is recoverable by a new START and cancel returns idle',()=>{
  let state=speechReducer(initialSpeechState,{type:'ERROR',message:'falhou'});
  assert.equal(state.status,SPEECH_STATUS.ERROR);assert.equal(state.error,'falhou');
  state=speechReducer(state,{type:'START'});assert.equal(state.status,SPEECH_STATUS.LISTENING);assert.equal(state.error,'');
  state=speechReducer(state,{type:'CANCEL'});assert.equal(state.status,SPEECH_STATUS.IDLE);
});

test('dictation appends without erasing existing manual text',()=>{
  assert.equal(appendSpeechText('Texto existente','novo trecho'),'Texto existente novo trecho');
  assert.equal(appendSpeechText('','novo trecho'),'novo trecho');
  assert.equal(appendSpeechText('Texto existente   ','  novo trecho  '),'Texto existente novo trecho');
});

test('speech errors provide actionable fallback and Apple mobile is detected',()=>{
  assert.match(speechErrorMessage('not-allowed'),/microfone/i);
  assert.match(speechErrorMessage('timeout'),/encerrado/i);
  assert.equal(isAppleMobile('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'),true);
  assert.equal(isAppleMobile('Mozilla/5.0 (Linux; Android 16)'),false);
});
