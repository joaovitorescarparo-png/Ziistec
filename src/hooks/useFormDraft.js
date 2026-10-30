import { useEffect, useRef, useState } from 'react';
import { clearDraft, readDraft, sanitizeDraft, writeDraft } from '../lib/formDrafts';

// Bloco 7: rascunho do formulário enquanto ele está aberto e com alteração. Restaura ao abrir,
// grava a cada mudança e quando a página vai para segundo plano (pagehide/visibilitychange — o
// iOS não deixa impedir o fechamento, só gravar antes), e apaga ao fechar por qualquer caminho:
// salvar, descartar, cancelar ou navegar. Se a página morrer sem fechar o formulário, o rascunho
// fica para a próxima abertura (TTL curto, mesma aba, mesmo usuário e empresa).
export function useFormDraft({ formType, enabled, value, dirty, onRestore,
  win = typeof window === 'undefined' ? null : window, doc = typeof document === 'undefined' ? null : document }) {
  const [restoredAt, setRestoredAt] = useState(null);
  const live = useRef(null);
  live.current = { value, dirty: Boolean(dirty), onRestore };
  const armed = useRef(false);
  const initial = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    initial.current = live.current.value;
    const draft = readDraft(formType);
    if (draft) live.current.onRestore?.(draft.data);
    setRestoredAt(draft ? draft.savedAt : null);
    armed.current = true;
    const flush = () => {
      if (!armed.current) return;
      if (live.current.dirty) writeDraft(formType, live.current.value);
      else clearDraft(formType);
    };
    const onVisibility = () => { if (doc?.visibilityState === 'hidden') flush(); };
    win?.addEventListener?.('pagehide', flush);
    doc?.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      armed.current = false;
      win?.removeEventListener?.('pagehide', flush);
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      clearDraft(formType);
    };
  }, [enabled, formType, win, doc]);

  const signature = enabled ? JSON.stringify(sanitizeDraft(formType, value)) : '';
  useEffect(() => {
    if (!enabled || !armed.current) return;
    if (dirty) writeDraft(formType, live.current.value);
    else clearDraft(formType);
  }, [enabled, formType, dirty, signature]);

  // Descartar o rascunho recuperado: apaga e devolve o formulário como ele abriu.
  const discardDraft = () => { clearDraft(formType); setRestoredAt(null); return initial.current; };
  return { restoredAt, discardDraft };
}
