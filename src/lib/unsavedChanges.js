// Bloco 6 · formulário sujo: compara o estado atual com o retrato tirado na abertura do formulário
// e mantém um registro dos formulários abertos com alterações não salvas (navegação do app consulta).

export const DISCARD_TITLE = 'Descartar alterações?';
export const DISCARD_TEXT = 'O que você preencheu ainda não foi salvo.';
export const DISCARD_NAVIGATION_TEXT = 'Há alterações não salvas. Sair desta tela e descartar o que foi preenchido?';

// Arquivo escolhido (foto/vídeo) entra no retrato por nome/tamanho; JSON.stringify de File vira {}.
const replacer = (_key, value) => {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return `[arquivo:${value.name || ''}:${value.size || 0}]`;
  return value;
};

export function formSnapshot(value) {
  try { return JSON.stringify(value ?? null, replacer); } catch { return null; }
}

export function isDirty(baseline, value) {
  if (baseline == null) return false;
  return formSnapshot(value) !== baseline;
}

const dirtyForms = new Set();

export function markUnsaved(token, dirty) {
  if (dirty) dirtyForms.add(token);
  else dirtyForms.delete(token);
}

export function hasUnsavedChanges() {
  return dirtyForms.size > 0;
}

// Navegação que troca a tela inteira (Assistente, workspace) pergunta antes de descartar.
export function confirmDiscardNavigation(confirmImpl = globalThis.confirm) {
  if (!hasUnsavedChanges()) return true;
  if (typeof confirmImpl !== 'function') return true;
  return Boolean(confirmImpl(DISCARD_NAVIGATION_TEXT));
}

export function resetUnsavedChangesForTests() {
  dirtyForms.clear();
}
