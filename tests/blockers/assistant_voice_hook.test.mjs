import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as speech from '../../src/lib/speechStateMachine.js';

// Execute the production hook body unchanged; only module wiring is replaced.
const source = fs.readFileSync(new URL('../../src/hooks/useSpeechInput.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export default function useSpeechInput', 'function useSpeechInput');

function mount(options = {}, { ua = 'Chrome Linux', supported = true } = {}) {
  const slots = [], effects = [], timers = new Map(), recognitions = [];
  let cursor = 0, dirty = false, result, nextTimer = 0, clock = 0;
  const changed = (before, after) => !before || !after || before.length !== after.length || after.some((value, i) => !Object.is(value, before[i]));
  const hooks = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => {
        const next = typeof value === 'function' ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useReducer(reducer, initial) {
      const [value, set] = hooks.useState(initial);
      return [value, action => set(previous => reducer(previous, action))];
    },
    useCallback(callback, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) slots[i] = { value: callback, deps };
      return slots[i].value;
    },
    useEffect(effect, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: effect() };
      });
    },
  };
  class Recognition {
    constructor() { recognitions.push(this); this.stops = 0; this.aborts = 0; }
    start() { this.onstart?.(); }
    stop() { this.stops++; }
    abort() { this.aborts++; }
    result(text, final = true) {
      const item = [{ transcript: text }]; item.isFinal = final;
      this.onresult?.({ resultIndex: 0, results: [item] });
    }
    results(list, resultIndex = 0) {
      const results = list.map(([text, final]) => { const item = [{ transcript: text }]; item.isFinal = final; return item; });
      this.onresult?.({ resultIndex, results });
    }
    end() { this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
  }
  const context = vm.createContext({ ...hooks, ...speech,
    window: supported ? { SpeechRecognition: Recognition } : {}, navigator: { userAgent: ua },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms, due: clock + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const useSpeechInput = vm.runInContext(`${source}\nuseSpeechInput`, context);
  function render() {
    let attempts = 0;
    do {
      assert.ok(++attempts < 20, 'hook render converges');
      cursor = 0; dirty = false; result = useSpeechInput(options);
      effects.splice(0).forEach(effect => effect());
    } while (dirty);
    return result;
  }
  render();
  return {
    get current() { return result; }, recognitions, timers,
    act(fn) { const value = fn(); render(); return value; },
    timer(ms) { const entry = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `timer ${ms} exists`); timers.delete(entry[0]); this.act(entry[1].fn); },
    // Relógio virtual: dispara, em ordem, só os timers que vencem dentro do intervalo.
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        clock = next[1].due; timers.delete(next[0]); this.act(next[1].fn);
      }
      clock = target;
    },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('real voice hook auto end completes the full final transcript once, never interim text', () => {
  const completed = [], texts = [];
  const host = mount({ continuous: false, onComplete: text => completed.push(text), onText: value => texts.push(value.text) });
  assert.equal(host.current.supported, true);
  assert.equal(host.act(() => host.current.start()), true);
  const rec = host.recognitions[0];
  assert.equal(rec.continuous, false);
  assert.equal(rec.lang, 'pt-BR');
  host.act(() => rec.result('preparando', false));
  assert.deepEqual(completed, []);
  host.act(() => rec.result('Prepare uma OS'));
  host.act(() => rec.result('para amanhã'));
  host.act(() => rec.end());
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Prepare uma OS para amanhã']);
  assert.equal(texts.at(-1), completed[0]);
  assert.equal(host.current.success, true);
  host.timer(900);
  assert.equal(host.current.status, 'idle');
  assert.equal(host.timers.size, 0);
});

test('stop waits in processing for final recognition, blocks restart, then completes once', () => {
  const completed = [];
  const host = mount({ onComplete: text => completed.push(text) });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  assert.equal(host.act(() => host.current.stop()), true);
  assert.equal(rec.stops, 1);
  assert.equal(host.current.processing, true);
  assert.equal(host.act(() => host.current.start()), false);
  assert.deepEqual(completed, []);
  host.act(() => rec.result('Mostre minhas OS'));
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Mostre minhas OS']);
  assert.equal(host.current.success, true);
  host.unmount();
  assert.equal(host.timers.size, 0);
});

test('cancel aborts recognition and never completes even after final text and late callbacks', () => {
  const completed = [];
  const host = mount({ onComplete: text => completed.push(text) });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Texto cancelado'));
  host.act(() => host.current.cancel());
  assert.equal(rec.aborts, 1);
  host.act(() => { rec.result('tardio'); rec.error('aborted'); rec.end(); });
  assert.deepEqual(completed, []);
  assert.equal(host.current.status, 'idle');
  assert.equal(host.timers.size, 0);
});

test('all stale recognition callbacks leave the next recording and its transcript untouched', () => {
  const completed = [], texts = [];
  const host = mount({ onComplete: text => completed.push(text), onText: value => texts.push(value.text) });
  host.act(() => host.current.start());
  const old = host.recognitions[0];
  host.act(() => host.current.cancel());
  host.act(() => host.current.retry());
  const current = host.recognitions[1];
  host.act(() => host.current.stop());
  const count = texts.length;
  host.act(() => { old.onstart(); old.result('contaminação'); old.error('network'); old.end(); });
  assert.equal(host.current.processing, true);
  assert.equal(texts.length, count);
  host.act(() => { current.result('Somente sessão atual'); current.end(); });
  assert.deepEqual(completed, ['Somente sessão atual']);
  host.unmount();
});

test('recognition errors never complete accumulated final text and permit retry', () => {
  for (const code of ['not-allowed', 'audio-capture', 'network', 'no-speech']) {
    const completed = [];
    const host = mount({ onComplete: text => completed.push(text) });
    host.act(() => host.current.start());
    const rec = host.recognitions[0];
    host.act(() => { rec.result('parcial final'); rec.error(code); rec.end(); });
    assert.equal(host.current.status, 'error');
    assert.equal(host.current.error, speech.speechErrorMessage(code));
    assert.deepEqual(completed, []);
    assert.equal(host.act(() => host.current.retry()), true);
    host.unmount();
    assert.equal(host.timers.size, 0);
  }
});

test('empty or interim-only automatic end reports no speech without completion', () => {
  for (const interim of ['', 'somente hipótese']) {
    const completed = [];
    const host = mount({ onComplete: text => completed.push(text) });
    host.act(() => host.current.start());
    const rec = host.recognitions[0];
    if (interim) host.act(() => rec.result(interim, false));
    host.act(() => rec.end());
    assert.equal(host.current.error, speech.speechErrorMessage('no-speech'));
    assert.deepEqual(completed, []);
    assert.equal(host.timers.size, 0);
  }
});

test('unsupported browser fails safely without creating recognition', () => {
  const host = mount({}, { supported: false });
  assert.equal(host.current.supported, false);
  assert.equal(host.act(() => host.current.start()), false);
  assert.equal(host.current.status, 'error');
  assert.match(host.current.error, /não é suportado/);
  assert.equal(host.recognitions.length, 0);
});

test('legacy continuous default remains enabled off Apple mobile, disabled on iPhone and iPad', () => {
  for (const [ua, expected] of [['Chrome Linux', true], ['iPhone', false], ['iPad', false], ['Macintosh Mobile', false]]) {
    const host = mount({}, { ua });
    host.act(() => host.current.start());
    assert.equal(host.recognitions[0].continuous, expected, ua);
    host.unmount();
  }
});

test('processing timeout aborts and never invokes completion on a late end', () => {
  const completed = [];
  const host = mount({ onComplete: text => completed.push(text) });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Texto sem término'));
  host.act(() => host.current.stop());
  host.timer(5000);
  host.act(() => rec.end());
  assert.equal(rec.aborts, 1);
  assert.equal(host.current.error, speech.speechErrorMessage('timeout'));
  assert.deepEqual(completed, []);
  assert.equal(host.timers.size, 0);
});

// Assistant: janela de silêncio para a frase inteira (Android/Chrome) sem quebrar iOS.
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const silenceTimers = host => [...host.timers.values()].filter(timer => timer.ms === 1800).length;

test('pausa entre partes da frase não envia metade: um único onComplete após a janela de silêncio', () => {
  const completed = [], texts = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text), onText: value => texts.push(value.text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  assert.equal(rec.continuous, true);
  host.act(() => rec.result('Agende um atendimento para o Mauro'));
  assert.deepEqual(completed, []);
  assert.equal(host.current.listening, true);
  host.act(() => rec.result('para amanhã', false));
  assert.equal(texts.at(-1), 'Agende um atendimento para o Mauro para amanhã');
  host.act(() => rec.result('para amanhã às duas'));
  assert.equal(silenceTimers(host), 1, 'uma única janela de silêncio ativa');
  host.timer(1800);
  assert.equal(rec.stops, 1);
  assert.equal(host.current.processing, true);
  host.act(() => rec.end());
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Agende um atendimento para o Mauro para amanhã às duas']);
  assert.equal(host.current.success, true);
});

test('motor que encerra sozinho na pausa é retomado e o texto das duas partes sai uma vez', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const first = host.recognitions[0];
  host.act(() => first.result('Agende o Mauro'));
  host.act(() => first.end());
  assert.deepEqual(completed, [], 'pausa curta não conclui');
  assert.equal(host.recognitions.length, 2);
  assert.equal(host.current.listening, true);
  const second = host.recognitions[1];
  host.act(() => { first.result('contaminação'); first.end(); });
  host.act(() => second.result('para amanhã às duas da tarde'));
  host.timer(1800);
  assert.equal(second.stops, 1);
  host.act(() => second.end());
  assert.deepEqual(completed, ['Agende o Mauro para amanhã às duas da tarde']);
  host.unmount();
});

test('múltiplos resultados finais: cumulativos e reentregues não duplicam, segmentos novos acumulam', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.results([['Procure pelo', true], ['Procure pelo telefone', true]]));
  host.act(() => rec.results([['Procure pelo', true], ['Procure pelo telefone', true]]));
  host.act(() => rec.results([['Procure pelo', true], ['Procure pelo telefone', true], ['do Mauro', true]], 2));
  host.act(() => rec.result('do Mauro'));
  host.timer(1800);
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Procure pelo telefone do Mauro']);
});

test('último trecho ainda em hipótese não se perde quando o silêncio encerra o ditado', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Agende o Mauro'));
  host.act(() => rec.result('para amanhã', false));
  host.timer(1800);
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Agende o Mauro para amanhã']);
});

test('Parar conclui uma vez e Cancelar descarta, ambos sem janela de silêncio pendente', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Minhas OS de hoje'));
  assert.equal(host.act(() => host.current.stop()), true);
  assert.equal(host.act(() => host.current.stop()), false, 'segundo toque não reenvia');
  assert.equal(rec.stops, 1);
  assert.equal(silenceTimers(host), 0);
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Minhas OS de hoje']);

  const cancelled = [];
  const other = mount({ silenceMs: 1800, onComplete: text => cancelled.push(text) }, { ua: ANDROID });
  other.act(() => other.current.start());
  const r2 = other.recognitions[0];
  other.act(() => r2.result('Texto descartado'));
  other.act(() => other.current.cancel());
  assert.equal(r2.aborts, 1);
  assert.equal(other.timers.size, 0);
  other.act(() => { r2.result('tardio'); r2.end(); });
  assert.deepEqual(cancelled, []);
  assert.equal(other.recognitions.length, 1, 'cancelado não é retomado');
});

test('limite máximo de gravação conclui o que foi dito em vez de descartar', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Agende o Mauro'));
  host.timer(30000);
  assert.equal(rec.stops, 1);
  assert.equal(rec.aborts, 0);
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Agende o Mauro']);
});

test('reinícios do motor são limitados e a sessão conclui com todas as partes uma vez', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  // Oito reinícios cobrem um pedido com várias pausas; o nono encerramento conclui o que foi dito.
  for (let i = 0; i < 9; i += 1) {
    const rec = host.recognitions[i];
    host.act(() => rec.result(`parte ${i}`));
    host.act(() => rec.end());
  }
  assert.equal(host.recognitions.length, 9);
  assert.deepEqual(completed, [Array.from({ length: 9 }, (_, i) => `parte ${i}`).join(' ')]);
});

test('silêncio sem fala após frase reconhecida conclui; iOS mantém sessão única sem reinício', () => {
  const completed = [];
  const host = mount({ silenceMs: 1800, onComplete: text => completed.push(text) }, { ua: ANDROID });
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Próximo atendimento'));
  host.timer(1800);
  host.act(() => { rec.error('no-speech'); rec.end(); });
  assert.deepEqual(completed, ['Próximo atendimento']);
  assert.equal(host.current.success, true);

  for (const ua of ['iPhone', 'iPad']) {
    const done = [];
    const ios = mount({ silenceMs: 1800, onComplete: text => done.push(text) }, { ua });
    ios.act(() => ios.current.start());
    const r = ios.recognitions[0];
    assert.equal(r.continuous, false, ua);
    ios.act(() => r.result('Qual meu próximo atendimento'));
    ios.act(() => r.end());
    assert.equal(ios.recognitions.length, 1, ua);
    assert.deepEqual(done, ['Qual meu próximo atendimento'], ua);
  }
});

// Wave 2.1 · voz natural: valores reais do painel do Assistente, com relógio virtual.
const panelSource = fs.readFileSync(new URL('../../src/components/AssistantPanel.jsx', import.meta.url), 'utf8');
const SILENCE = Number(panelSource.match(/export const VOICE_SILENCE_MS = (\d+);/)?.[1]);
const MAX_DICTATION = Number(panelSource.match(/export const VOICE_MAX_DURATION_MS = (\d+);/)?.[1]);
const voice = (completed, ua = ANDROID) => mount({ silenceMs: SILENCE, maxDurationMs: MAX_DICTATION, onComplete: text => completed.push(text) }, { ua });

test('painel usa janela de silêncio de ~5,5 s (pausa natural de até 5 s) e ditado de até 60 s, ligados ao hook', () => {
  assert.equal(SILENCE, 5500);
  assert.ok(SILENCE > 5000, 'pausa de 5 s não pode encerrar o ditado');
  assert.equal(MAX_DICTATION, 60000);
  assert.match(panelSource, /useSpeechInput\(\{ silenceMs: VOICE_SILENCE_MS, maxDurationMs: VOICE_MAX_DURATION_MS,/);
});

test('pausa de ~2,5 s no meio do pedido não envia: "Faz um orçamento para o Mauro…" + "…com dois interfones e instalação" vira um pedido', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const first = host.recognitions[0];
  host.act(() => first.result('Faz um orçamento para o Mauro'));
  host.advance(1000);
  // Android encerra o motor na pausa; a janela de silêncio continua aberta e o ditado é retomado.
  host.act(() => first.end());
  assert.equal(host.recognitions.length, 2);
  host.advance(1500);
  assert.deepEqual(completed, [], '2,5 s de pausa não envia');
  assert.equal(host.current.listening, true);
  const second = host.recognitions[1];
  host.act(() => second.result('com dois interfones', false));
  host.act(() => second.result('com dois interfones e instalação'));
  host.advance(SILENCE - 1);
  assert.equal(second.stops, 0, 'fala recente mantém a janela aberta');
  host.advance(1);
  assert.equal(second.stops, 1);
  host.act(() => second.end());
  host.act(() => second.end());
  assert.deepEqual(completed, ['Faz um orçamento para o Mauro com dois interfones e instalação']);
});

test('silêncio maior que o limite envia uma única vez; hipótese recente adia o envio', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Qual meu próximo atendimento'));
  host.advance(SILENCE - 500);
  host.act(() => rec.result('amanhã', false));
  host.advance(SILENCE - 500);
  assert.equal(rec.stops, 0, 'hipótese nova reinicia a janela');
  host.advance(500);
  assert.equal(rec.stops, 1);
  host.act(() => rec.end());
  host.advance(10000);
  assert.deepEqual(completed, ['Qual meu próximo atendimento amanhã']);
});

test('botão Parar envia imediatamente, sem esperar a janela de silêncio', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Minhas OS de hoje'));
  assert.equal(host.act(() => host.current.stop()), true);
  assert.equal(rec.stops, 1);
  assert.equal([...host.timers.values()].some(t => t.ms === SILENCE), false, 'janela cancelada');
  host.act(() => rec.end());
  assert.deepEqual(completed, ['Minhas OS de hoje']);
});

test('Android: reinício no meio da palavra, eco da frase inteira e reentrega cumulativa não duplicam texto', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const first = host.recognitions[0];
  host.act(() => first.result('Faz um orçamento para o Mauro'));
  host.act(() => first.result('com dois', false));
  // O motor encerra no meio da fala: a hipótese "com dois" é guardada antes do reinício.
  host.act(() => first.end());
  const second = host.recognitions[1];
  // A nova sessão ouve de novo a última palavra cortada: "dois" não pode aparecer duas vezes.
  host.act(() => second.results([['dois interfones', true]]));
  host.act(() => second.results([['dois interfones', true]]));
  host.act(() => second.end());
  const third = host.recognitions[2];
  // Algumas versões ecoam a frase inteira no primeiro resultado da sessão nova.
  host.act(() => third.results([['Faz um orçamento para o Mauro com dois interfones', true]]));
  host.act(() => third.results([['Faz um orçamento para o Mauro com dois interfones', true], ['e instalação', true]]));
  host.advance(SILENCE);
  host.act(() => third.end());
  assert.deepEqual(completed, ['Faz um orçamento para o Mauro com dois interfones e instalação']);
});

test('palavras repetidas de propósito dentro da mesma sessão continuam no texto', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.results([['duas câmeras e duas', true], ['fechaduras', true]]));
  host.advance(SILENCE);
  host.act(() => rec.end());
  assert.deepEqual(completed, ['duas câmeras e duas fechaduras']);
});

test('cancelamento durante a pausa não envia nem retoma o motor', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Cancela a OS do Mauro'));
  host.advance(2000);
  host.act(() => host.current.cancel());
  host.act(() => { rec.result('tardio'); rec.end(); });
  host.advance(SILENCE * 2);
  assert.deepEqual(completed, []);
  assert.equal(host.recognitions.length, 1);
  assert.equal(host.timers.size, 0);
});

test('transcrição final conclui uma vez mesmo com encerramentos e erros tardios', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('Procure Residencial Carmelo'));
  host.advance(SILENCE);
  host.act(() => { rec.end(); rec.end(); rec.error('no-speech'); rec.result('eco tardio'); });
  host.advance(SILENCE * 2);
  assert.deepEqual(completed, ['Procure Residencial Carmelo']);
});

test('limite de 60 s conclui o que foi dito; iOS continua com sessão única', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  for (let i = 0; i < 25; i += 1) { host.act(() => rec.result(`parte ${i}`, false)); host.advance(2400); }
  assert.equal(rec.stops, 1, 'fala contínua termina no limite máximo');
  host.act(() => rec.end());
  assert.equal(completed.length, 0, 'só hipóteses: nada final para enviar');
  const done = [];
  const ios = voice(done, 'iPhone');
  ios.act(() => ios.current.start());
  const r = ios.recognitions[0];
  ios.act(() => r.result('Qual meu próximo atendimento'));
  ios.act(() => r.end());
  assert.equal(ios.recognitions.length, 1);
  assert.deepEqual(done, ['Qual meu próximo atendimento']);
});

// Homologação Universal Owner V1: pausa natural de até ~5 s no meio da frase não envia metade do pedido.
const MAURO = 'procure o cliente Mauro e me mostre o histórico dele';

test('pausas de 2, 3, 4 e 5 s no meio do pedido não enviam; a frase chega inteira ao onComplete uma única vez', () => {
  for (const pause of [2000, 3000, 4000, 5000]) {
    const completed = [];
    const host = voice(completed);
    host.act(() => host.current.start());
    const rec = host.recognitions[0];
    host.act(() => rec.result('procure o cliente Mauro e me mostre o'));
    host.advance(pause);
    assert.equal(rec.stops, 0, pause + ' ms de pausa não encerra o ditado');
    assert.deepEqual(completed, [], pause + ' ms de pausa não envia');
    assert.equal(host.current.listening, true, pause + ' ms');
    host.act(() => rec.result('histórico dele'));
    host.advance(SILENCE - 1);
    assert.equal(rec.stops, 0, 'fala retomada reabre a janela inteira');
    host.advance(1);
    assert.equal(rec.stops, 1, 'passado o limite, encerra');
    host.act(() => rec.end());
    host.act(() => rec.end());
    host.advance(SILENCE * 2);
    assert.deepEqual(completed, [MAURO], pause + ' ms');
  }
});

test('silêncio acima do novo limite envia exatamente uma vez o que foi dito', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result(MAURO));
  host.advance(5000);
  assert.equal(rec.stops, 0, '5 s de silêncio ainda é pausa');
  host.advance(SILENCE - 5000);
  assert.equal(rec.stops, 1);
  host.act(() => { rec.end(); rec.end(); rec.error('no-speech'); });
  host.advance(SILENCE * 2);
  assert.equal(rec.stops, 1);
  assert.deepEqual(completed, [MAURO]);
});

test('Parar durante a pausa envia na hora, sem esperar o restante da janela', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const rec = host.recognitions[0];
  host.act(() => rec.result('procure o cliente Mauro'));
  host.advance(4000);
  assert.equal(host.act(() => host.current.stop()), true);
  assert.equal(rec.stops, 1);
  assert.equal([...host.timers.values()].some(t => t.ms === SILENCE), false, 'janela cancelada');
  host.act(() => rec.end());
  assert.deepEqual(completed, ['procure o cliente Mauro']);
});

test('Android: reinícios do motor durante a pausa de 5 s mantêm o texto, não enviam antes e não duplicam', () => {
  const completed = [];
  const host = voice(completed);
  host.act(() => host.current.start());
  const first = host.recognitions[0];
  host.act(() => first.result('procure o cliente Mauro e me mostre o'));
  host.advance(1000);
  // Android encerra o motor no início da pausa; a sessão nova sem fala também encerra (no-speech).
  host.act(() => first.end());
  assert.equal(host.recognitions.length, 2);
  host.advance(2500);
  const second = host.recognitions[1];
  host.act(() => { second.error('no-speech'); second.end(); });
  assert.equal(host.recognitions.length, 3);
  host.advance(1500);
  assert.deepEqual(completed, [], '5 s de pausa com dois reinícios não envia');
  assert.equal(host.current.listening, true);
  const third = host.recognitions[2];
  // A sessão retomada repete o trecho cortado antes de continuar: "me mostre o" não pode duplicar.
  host.act(() => third.results([['me mostre o histórico dele', true]]));
  host.act(() => third.results([['me mostre o histórico dele', true]]));
  host.advance(SILENCE);
  assert.equal(third.stops, 1);
  host.act(() => third.end());
  assert.deepEqual(completed, [MAURO]);
});
