import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen } from '../../src/lib/mobileNavigation.js';

const legacy = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');

test('mobile edge swipe starts only near the left edge', () => {
  assert.deepEqual(beginEdgeSwipe({ x: 8, y: 120, viewportWidth: 390 }), { x: 8, y: 120 });
  assert.equal(beginEdgeSwipe({ x: 80, y: 120, viewportWidth: 390 }), null);
});

test('predominantly vertical movement never opens the drawer', () => {
  const start = { x: 8, y: 100 };
  assert.equal(classifyHorizontalSwipe(start, { x: 70, y: 190 }, 'open'), null);
  assert.equal(classifyHorizontalSwipe(start, { x: 24, y: 220 }, 'open'), null);
});

test('horizontal swipes open and close in the intended direction only', () => {
  assert.equal(classifyHorizontalSwipe({ x: 8, y: 100 }, { x: 88, y: 110 }, 'open'), 'open');
  assert.equal(classifyHorizontalSwipe({ x: 220, y: 100 }, { x: 130, y: 105 }, 'close'), 'close');
  assert.equal(classifyHorizontalSwipe({ x: 220, y: 100 }, { x: 310, y: 105 }, 'close'), null);
});

test('visualViewport keyboard detection ignores browser chrome changes', () => {
  assert.equal(isKeyboardViewportOpen({ layoutHeight: 844, visualHeight: 520 }), true);
  assert.equal(isKeyboardViewportOpen({ layoutHeight: 844, visualHeight: 770 }), false);
  assert.equal(isKeyboardViewportOpen({ layoutHeight: 844, visualHeight: 844 }), false);
});

test('legacy shell mounts mobile gesture on a real mobile container and keeps explicit close paths', () => {
  assert.match(legacy, /onTouchStart=\{iniciarEdgeSwipe\} onTouchEnd=\{finalizarEdgeSwipe\}/);
  assert.match(legacy, /onClick=\{\(\) => setDrawer\(true\)\} aria-label="Abrir menu"/);
  assert.match(legacy, /absolute inset-0 bg-slate-900\/50" onClick=\{\(\) => setDrawer\(false\)\}/);
  assert.match(legacy, /event\.key === "Escape"/);
  assert.match(legacy, /onTouchStart=\{iniciarDrawerSwipe\} onTouchEnd=\{finalizarDrawerSwipe\}/);
});

test('bottom navigation uses the requested four primary destinations plus Mais and hides for the keyboard', () => {
  assert.match(legacy, /const NAV_MOBILE = \["inicio", "agenda", "orcamentos", "ordens"\]/);
  assert.match(legacy, /<span className="text-\[10px\] font-medium">Mais<\/span>/);
  assert.match(legacy, /keyboardOpen \? "hidden" : "flex"/);
  assert.match(legacy, /pb-\[env\(safe-area-inset-bottom\)\]/);
});
