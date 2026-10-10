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
  let cursor = 0, dirty = false, result, nextTimer = 0;
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
    end() { this.onend?.(); }
    error(error) { this.onerror?.({ error }); }
  }
  const context = vm.createContext({ ...hooks, ...speech,
    window: supported ? { SpeechRecognition: Recognition } : {}, navigator: { userAgent: ua },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
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
