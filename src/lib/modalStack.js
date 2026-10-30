// Bloco 7 · pilha de modais abertos: só o modal do topo responde a Esc e ao Voltar (botão/gesto do
// Android, Voltar do navegador). Cada modal aberto ganha UMA entrada de histórico na mesma URL; o
// Voltar consome essa entrada em vez de abandonar a tela. Fechar por X/fundo/salvar remove a entrada
// com um único history.back(), cujo popstate é ignorado aqui. Sem loop: só há novo pushState quando o
// próprio modal decide continuar aberto depois de um Voltar (formulário com alteração ou salvando).

export const MODAL_HISTORY_KEY = 'ztModals';

const stacks = new WeakMap();
let sequence = 0;

function currentIds(win) {
  const ids = win.history?.state?.[MODAL_HISTORY_KEY];
  return Array.isArray(ids) ? ids : [];
}

export function createModalStack(win) {
  const entries = [];
  let ignorePops = 0;

  const push = () => {
    const state = { ...(win.history.state || {}), [MODAL_HISTORY_KEY]: entries.map((e) => e.id) };
    win.history.pushState(state, '', win.location.href);
  };

  win.addEventListener('popstate', (event) => {
    if (ignorePops > 0) { ignorePops -= 1; return; }
    const ids = Array.isArray(event?.state?.[MODAL_HISTORY_KEY]) ? event.state[MODAL_HISTORY_KEY] : [];
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (!ids.includes(entries[i].id)) { entries[i].handlers.onBack?.(); return; }
    }
  });

  win.addEventListener('keydown', (event) => {
    if (event?.key !== 'Escape' || !entries.length) return;
    entries[entries.length - 1].handlers.onEscape?.(event);
  });

  return {
    open(handlers) {
      sequence += 1;
      const entry = { id: `m${sequence}`, handlers };
      entries.push(entry);
      push();
      return {
        id: entry.id,
        isTop: () => entries[entries.length - 1] === entry,
        // O modal continua aberto depois de um Voltar: devolve a entrada que o Voltar consumiu.
        rearm() { if (entries.includes(entry) && !currentIds(win).includes(entry.id)) push(); },
        close() {
          const index = entries.indexOf(entry);
          if (index < 0) return;
          entries.splice(index, 1);
          const ids = currentIds(win);
          // Só volta se a entrada deste modal é a do topo; se outra navegação empilhou depois, não mexe.
          if (ids[ids.length - 1] === entry.id) { ignorePops += 1; win.history.back(); }
        },
      };
    },
    size: () => entries.length,
  };
}

export function modalStack(win = globalThis.window) {
  if (!win?.history || typeof win.addEventListener !== 'function') return null;
  if (!stacks.has(win)) stacks.set(win, createModalStack(win));
  return stacks.get(win);
}
