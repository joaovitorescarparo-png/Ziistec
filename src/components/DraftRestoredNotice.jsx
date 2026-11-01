import React from 'react';

// Bloco 7: avisa que o formulário voltou de um rascunho deste aparelho e permite começar do zero.
const hora = (ms) => { try { return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

export default function DraftRestoredNotice({ savedAt, onDiscard, detail = "" }) {
  if (!savedAt) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-xl bg-sky-50 px-3.5 py-3 text-[13px] leading-relaxed text-sky-900 ring-1 ring-sky-200/70 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between">
      <span>Rascunho recuperado deste aparelho{hora(savedAt) ? ` (salvo às ${hora(savedAt)})` : ''}. Confira antes de salvar.{detail ? ` ${detail}` : ''}</span>
      <button type="button" onClick={onDiscard} className="min-h-11 shrink-0 rounded-lg px-3 text-[13px] font-medium text-sky-800 ring-1 ring-sky-300 hover:bg-sky-100">Descartar rascunho</button>
    </div>
  );
}
