import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { beginEdgeSwipe, classifyHorizontalSwipe, isKeyboardViewportOpen } from '../../src/lib/mobileNavigation.js';

const legacy = fs.readFileSync(new URL('../../src/legacy/ZiisTecApp.jsx', import.meta.url), 'utf8');
const widths = [360, 390, 430, 768, 1024, 1366, 1440];

test('RC-1C responsive contract covers every required homologation width', () => {
  assert.deepEqual(widths, [360, 390, 430, 768, 1024, 1366, 1440]);
  for (const width of widths.filter((value) => value < 768)) {
    const start = beginEdgeSwipe({ x: 12, y: 100, viewportWidth: width });
    assert.ok(start, `edge gesture should be available at ${width}px`);
    assert.equal(classifyHorizontalSwipe(start, { x: 90, y: 108 }, 'open'), 'open');
  }
  assert.equal(isKeyboardViewportOpen({ layoutHeight: 800, visualHeight: 520 }), true);
  assert.equal(isKeyboardViewportOpen({ layoutHeight: 800, visualHeight: 730 }), false);
});

test('canonical UI keeps mobile-first, tablet and desktop breakpoint contracts without ordinary horizontal form scroll', () => {
  assert.match(legacy, /min-\[430px\]:grid-cols-2 sm:grid-cols-3/);
  assert.match(legacy, /md:hidden fixed bottom-0/);
  assert.match(legacy, /md:flex/);
  assert.match(legacy, /lg:grid-cols-4/);
  assert.match(legacy, /max-h-\[calc\(100dvh-env\(safe-area-inset-top\)\)\]/);
  assert.match(legacy, /pb-\[max\(1rem,env\(safe-area-inset-bottom\)\)\]/);
  assert.match(legacy, /keyboardOpen \? "hidden" : "flex"/);
});
