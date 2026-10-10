// One document lock shared by nested forms (for example purchase → product picker).
const locks = new WeakMap();

export function lockModalScroll(win) {
  const doc = win.document;
  let lock = locks.get(doc);
  if (!lock) {
    const body = doc.body;
    const keys = ['overflow', 'position', 'top', 'left', 'width'];
    lock = { count: 0, x: win.scrollX, y: win.scrollY,
      styles: Object.fromEntries(keys.map(key => [key, body.style[key]])),
      htmlOverflow: doc.documentElement.style.overflow };
    locks.set(doc, lock);
    Object.assign(body.style, { overflow: 'hidden', position: 'fixed', top: `${-lock.y}px`, left: `${-lock.x}px`, width: '100%' });
    doc.documentElement.style.overflow = 'hidden';
  }
  lock.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count) return;
    Object.assign(doc.body.style, lock.styles);
    doc.documentElement.style.overflow = lock.htmlOverflow;
    locks.delete(doc);
    win.scrollTo(lock.x, lock.y);
  };
}

export function revealModalField(scroller, target) {
  if (!target || !scroller.contains(target) || !target.matches('input, textarea, select, [contenteditable="true"]')) return;
  const bounds = scroller.getBoundingClientRect();
  const field = target.getBoundingClientRect();
  const gap = 12;
  // A tall textarea cannot fit at both edges: keep its top stable instead of
  // alternating top/bottom alignment on successive keyboard viewport events.
  if (field.bottom - field.top > bounds.bottom - bounds.top - gap * 2) scroller.scrollTop += field.top - bounds.top - gap;
  else if (field.bottom > bounds.bottom - gap) scroller.scrollTop += field.bottom - bounds.bottom + gap;
  else if (field.top < bounds.top + gap) scroller.scrollTop -= bounds.top + gap - field.top;
}

export function observeModalViewport(win, overlay, scroller) {
  const unlock = lockModalScroll(win);
  const viewport = win.visualViewport;
  let frame;
  const update = () => {
    const height = viewport?.height || win.innerHeight;
    overlay.style.setProperty('--modal-viewport-height', `${height}px`);
    overlay.style.height = `${height}px`;
    overlay.style.top = `${viewport?.offsetTop || 0}px`;
    overlay.style.bottom = 'auto';
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => revealModalField(scroller, win.document.activeElement));
  };
  update();
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  win.addEventListener('resize', update);
  scroller.addEventListener('focusin', update);
  return () => {
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    win.removeEventListener('resize', update);
    scroller.removeEventListener('focusin', update);
    win.cancelAnimationFrame(frame);
    unlock();
  };
}
