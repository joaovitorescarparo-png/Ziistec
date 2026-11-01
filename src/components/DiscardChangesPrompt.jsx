import React from 'react';
import { DISCARD_TEXT, DISCARD_TITLE } from '../lib/unsavedChanges';

// Bloco 6: confirmação ao fechar formulário com alterações. Tocar fora mantém a edição.
export default function DiscardChangesPrompt({ open, onKeepEditing, onDiscard, text = DISCARD_TEXT }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
      role="alertdialog" aria-modal="true" aria-labelledby="zt-discard-title" aria-describedby="zt-discard-text"
      onClick={(event) => { if (event.target === event.currentTarget) onKeepEditing?.(); }}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h4 id="zt-discard-title" className="text-base font-semibold text-slate-900">{DISCARD_TITLE}</h4>
        <p id="zt-discard-text" className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 min-[390px]:flex-row min-[390px]:justify-end">
          <button type="button" onClick={onDiscard}
            className="min-h-11 rounded-xl px-4 text-sm font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">Descartar</button>
          <button type="button" autoFocus onClick={onKeepEditing}
            className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">Continuar editando</button>
        </div>
      </div>
    </div>
  );
}
