import { useEffect, useRef, useState } from 'react';
import { formSnapshot, isDirty, markUnsaved } from '../lib/unsavedChanges';

// Sujo = estado atual diferente do retrato tirado quando o formulário ficou ativo. Voltar ao valor
// original deixa de ser sujo; markClean() rebaseia depois de salvar quando a tela continua aberta.
export function useFormDirty(value, active = true) {
  const baseline = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  if (!active) baseline.current = null;
  else if (baseline.current === null) baseline.current = formSnapshot(value);
  const markClean = () => { baseline.current = formSnapshot(latest.current); };
  return { dirty: active && isDirty(baseline.current, value), markClean };
}

// Enquanto houver alteração: recarregar/fechar a aba pede confirmação do navegador e a navegação do
// app (Assistente, troca de tela) sabe que existe formulário a perder.
export function useUnsavedChangesGuard(dirty) {
  const token = useRef(null);
  if (!token.current) token.current = {};
  useEffect(() => {
    const id = token.current;
    markUnsaved(id, dirty);
    if (!dirty || typeof window === 'undefined') return () => markUnsaved(id, false);
    const onBeforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; return ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => { window.removeEventListener('beforeunload', onBeforeUnload); markUnsaved(id, false); };
  }, [dirty]);
}

// Fechamento acidental (fundo, X, Voltar da tela) com alterações pergunta "continuar editando ou
// descartar"; sem alteração fecha direto. Salvar continua fechando pelo próprio fluxo, sem pergunta.
export function useDiscardGuard({ dirty, onClose }) {
  const [confirming, setConfirming] = useState(false);
  useUnsavedChangesGuard(dirty);
  const requestClose = () => { if (dirty) setConfirming(true); else onClose?.(); };
  const keepEditing = () => setConfirming(false);
  const discard = () => { setConfirming(false); onClose?.(); };
  return { confirming: Boolean(confirming && dirty), requestClose, keepEditing, discard };
}
