import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import { lockModalScroll, observeModalViewport, revealModalField } from '../../src/lib/modalViewport.js';

function events(extra = {}) {
  const listeners = new Map();
  return { ...extra, listeners,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
    emit(name) { listeners.get(name)?.(); } };
}
function browser(height = 800) {
  const frames = new Map();
  let next = 0;
  const body = { style: { overflow: 'auto', position: '', top: '', left: '', width: '' } };
  const win = events({ innerHeight: height, scrollX: 0, scrollY: 200,
    document: { body, documentElement: { style: { overflow: '' } }, activeElement: null },
    visualViewport: events({ height, offsetTop: 0 }),
    requestAnimationFrame(fn) { frames.set(++next, fn); return next; },
    cancelAnimationFrame(id) { frames.delete(id); },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    scrollTo(x, y) { this.restored = [x, y]; },
  });
  const field = { matches: () => true, getBoundingClientRect: () => ({ top: 500, bottom: 550 }) };
  const scroller = events({ scrollTop: 0, contains: target => target === field,
    getBoundingClientRect: () => ({ top: 80, bottom: 350 }) });
  const overlay = { style: { setProperty(key, value) { this[key] = value; } } };
  return { win, field, scroller, overlay, frames };
}

test('nested modals retain the scroll lock until the final close and restore original page position/styles', () => {
  const { win } = browser();
  const initial = { ...win.document.body.style };
  const outer = lockModalScroll(win), inner = lockModalScroll(win);
  assert.equal(win.document.body.style.position, 'fixed');
  assert.equal(win.document.body.style.top, '-200px');
  outer(); outer();
  assert.equal(win.document.body.style.overflow, 'hidden');
  assert.equal(win.restored, undefined);
  inner();
  assert.deepEqual(win.document.body.style, initial);
  assert.equal(win.document.documentElement.style.overflow, '');
  assert.deepEqual(win.restored, [0, 200]);
});

test('keyboard resize and viewport pan resize the modal and reveal the focused field inside its scroller', () => {
  const { win, field, scroller, overlay } = browser();
  const stop = observeModalViewport(win, overlay, scroller);
  assert.equal(overlay.style.height, '800px');
  win.document.activeElement = field;
  win.visualViewport.height = 400;
  win.visualViewport.offsetTop = 40;
  win.visualViewport.emit('resize'); win.flush();
  assert.equal(overlay.style.height, '400px');
  assert.equal(overlay.style['--modal-viewport-height'], '400px');
  assert.equal(overlay.style.top, '40px');
  assert.equal(scroller.scrollTop, 212);
  stop();
});

test('next field focus is revealed without scrolling the body; already visible and outside controls remain untouched', () => {
  const { win, field, scroller, overlay } = browser();
  const stop = observeModalViewport(win, overlay, scroller);
  win.document.activeElement = field;
  scroller.emit('focusin'); win.flush();
  assert.equal(scroller.scrollTop, 212);
  field.getBoundingClientRect = () => ({ top: 100, bottom: 150 });
  revealModalField(scroller, field);
  revealModalField(scroller, {});
  assert.equal(scroller.scrollTop, 212);
  field.getBoundingClientRect = () => ({ top: 20, bottom: 60 });
  revealModalField(scroller, field);
  assert.equal(scroller.scrollTop, 140);
  assert.equal(win.restored, undefined);
  stop();
});

test('desktop fallback and orientation resize work without visualViewport, with complete cleanup', () => {
  const { win, scroller, overlay, frames } = browser(900);
  delete win.visualViewport;
  const stop = observeModalViewport(win, overlay, scroller);
  assert.equal(overlay.style.height, '900px');
  win.innerHeight = 640; win.emit('resize');
  assert.equal(overlay.style.height, '640px');
  assert.equal(overlay.style.top, '0px');
  stop();
  assert.equal(win.listeners.size, 0);
  assert.equal(scroller.listeners.size, 0);
  assert.equal(frames.size, 0);
});

test('visual viewport subscriptions are removed and pending focus work cancelled on close', () => {
  const { win, scroller, overlay, frames } = browser();
  const stop = observeModalViewport(win, overlay, scroller);
  assert.equal(win.visualViewport.listeners.size, 2);
  stop();
  assert.equal(win.visualViewport.listeners.size, 0);
  assert.equal(frames.size, 0);
});

test('a textarea taller than the available area remains stable over repeated keyboard events', () => {
  const { field, scroller } = browser();
  scroller.getBoundingClientRect = () => ({ top: 80, bottom: 180 });
  field.getBoundingClientRect = () => ({ top: 150 - scroller.scrollTop, bottom: 350 - scroller.scrollTop });
  revealModalField(scroller, field);
  assert.equal(scroller.scrollTop, 58);
  for (let i = 0; i < 5; i++) revealModalField(scroller, field);
  assert.equal(scroller.scrollTop, 58);
});

test('compiled Tailwind cascade preserves visual viewport limits at mobile, tablet and desktop widths', async () => {
  const source = fs.readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
  const { root } = await postcss([tailwind]).process(source, { from: 'src/index.css' });
  // These are the max-height classes actually mounted by the shared Modal.
  const selectors = new Map([
    ['.ziistec-modal-panel.ziistec-modal-panel', 2],
    ['.max-h-\\[calc\\(100dvh-env\\(safe-area-inset-top\\)\\)\\]', 1],
    ['.sm\\:max-h-\\[88dvh\\]', 1],
  ]);
  for (const width of [375, 768, 1024, 1440]) {
    let winner;
    root.walkRules(rule => {
      const specificity = selectors.get(rule.selector);
      if (!specificity) return;
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type !== 'atrule' || parent.name !== 'media') continue;
        const min = parent.params.match(/min-width:\s*(\d+)px/);
        const max = parent.params.match(/max-width:\s*(\d+)px/);
        if ((min && width < Number(min[1])) || (max && width > Number(max[1]))) return;
      }
      rule.walkDecls('max-height', declaration => {
        if (!winner || specificity >= winner.specificity) winner = { specificity, value: declaration.value };
      });
    });
    assert.match(winner?.value || '', /var\(--modal-viewport-height/, `${width}px must honor the visual viewport`);
    assert.match(winner.value, width < 640 ? /safe-area-inset-top/ : /88dvh/, `${width}px keeps its original sizing cap`);
  }
});
