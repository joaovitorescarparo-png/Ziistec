import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import { toolsForRole } from '../../src/lib/assistantTools.js';

// Run the component's actual focus effect against visible/hidden DOM controls.
function harness() {
  const slots = [], effects = []; let cursor = 0, keyHandler;
  const document = { body: { style: { overflow: '' } }, activeElement: null,
    addEventListener(type, fn) { if (type === 'keydown') keyHandler = fn; },
    removeEventListener() {},
  };
  const node = (name, tag, visible = true) => ({ name, tag, visible,
    getClientRects() { return this.visible ? [{}] : []; },
    focus() { if (this.visible) document.activeElement = this; },
  });
  const controls = [node('close', 'button'), node('text', 'textarea'), node('mic', 'button'),
    node('examples', 'summary'), node('example', 'button', false),
    node('manual', 'summary'), node('action', 'select', false)];
  const panel = { querySelector: () => controls[0],
    querySelectorAll: selector => controls.filter(n => n.tag !== 'summary' || selector.includes('summary')) };
  const hookReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(fn, deps) { effects.push({ fn, deps }); },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(new URL('../../src/components/AssistantPanel.jsx', import.meta.url), 'utf8');
  vm.runInNewContext(transformSync(source, { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports, document, AbortController,
    require(name) {
      if (name === 'react') return hookReact;
      if (name === 'lucide-react') return { Sparkles: 'span', Mic: 'span', X: 'span' };
      if (name === '../lib/assistantTools') return { toolsForRole };
      if (name === '../hooks/useSpeechInput') return { __esModule: true, default: () => ({ cancel() {}, supported: true }) };
      return {};
    },
  });
  const flatten = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
    ? tree.flatMap(flatten) : [tree, ...flatten(tree.props?.children)];
  const render = () => { cursor = 0; effects.length = 0; return module.exports.default({ companyId: 'test', role: 'owner' }); };
  flatten(render()).find(n => n.type === 'button').props.onClick();
  const tree = render();
  flatten(tree).find(n => n.type === 'section').ref.current = panel;
  effects.find(e => e.deps?.length === 1 && e.deps[0] === true).fn();
  return { controls, document, key(shiftKey = false) {
    let prevented = false;
    keyHandler({ key: 'Tab', shiftKey, preventDefault() { prevented = true; } });
    return prevented;
  } };
}

test('Assistant traps Tab and Shift+Tab while optional details are closed', () => {
  const h = harness();
  assert.equal(h.document.activeElement.name, 'close');
  assert.equal(h.key(true), true);
  assert.equal(h.document.activeElement.name, 'manual');
  assert.equal(h.key(), true);
  assert.equal(h.document.activeElement.name, 'close');
});

test('Assistant recalculates keyboard boundary when manual details become visible', () => {
  const h = harness();
  h.controls.find(n => n.name === 'action').visible = true;
  assert.equal(h.key(true), true);
  assert.equal(h.document.activeElement.name, 'action');
  assert.equal(h.key(), true);
  assert.equal(h.document.activeElement.name, 'close');
});
