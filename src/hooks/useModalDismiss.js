import { useEffect, useRef } from 'react';
import { useDiscardGuard } from './useUnsavedChanges';
import { modalStack } from '../lib/modalStack';

// Bloco 7: Esc e Voltar (Android/navegador) passam pelo MESMO fluxo do fundo/X do Bloco 6.
// Sem alteração: fecha. Com alteração: "Continuar editando" ou "Descartar". Salvando: não fecha.
// Esc só vale para o modal do topo e quando o foco está nele (ou no body), não em outro painel.
const focusIsInside = (overlayRef, event) => {
  const target = event?.target;
  const overlay = overlayRef?.current;
  if (!overlay || !target) return true;
  const doc = target.ownerDocument;
  return overlay.contains?.(target) || target === doc?.body || target === doc?.documentElement;
};

export function useModalDismiss({ open, dirty = false, busy = false, onClose, overlayRef = null, win = typeof window === 'undefined' ? null : window }) {
  const guard = useDiscardGuard({ dirty: Boolean(open && dirty), onClose });
  const live = useRef(null);
  live.current = { guard, busy: Boolean(busy), dirty: Boolean(open && dirty), onClose, overlayRef };

  useEffect(() => {
    const stack = open ? modalStack(win) : null;
    if (!stack) return undefined;
    const entry = stack.open({
      onEscape(event) {
        const s = live.current;
        if (!focusIsInside(s.overlayRef, event)) return;
        event?.preventDefault?.();
        if (s.busy) return;
        if (s.guard.confirming) s.guard.keepEditing();
        else s.guard.requestClose();
      },
      onBack() {
        const s = live.current;
        if (s.busy) { entry.rearm(); return; }
        if (s.guard.confirming) { s.guard.keepEditing(); entry.rearm(); return; }
        if (s.dirty) { entry.rearm(); s.guard.requestClose(); return; }
        s.onClose?.();
      },
    });
    return () => entry.close();
  }, [open, win]);

  const requestClose = () => { if (!live.current.busy) guard.requestClose(); };
  return { ...guard, requestClose };
}
