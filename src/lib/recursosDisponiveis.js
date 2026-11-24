/* O que a interface oferece em cada ambiente.
 *
 * Em Production o servidor recusa o Assistente (api/assistant.js) e a IA externa está
 * desligada (sem ENABLE_EXTERNAL_AI): botão que leva sempre ao mesmo erro não aparece.
 * O critério de "Production" é a origem que o resolvedor do Supabase já calculou
 * (`env-production` / `production-fallback`), a mesma trava que escolhe o banco.
 * Para ligar a IA em Production no futuro: habilitar no servidor E publicar com
 * VITE_ENABLE_EXTERNAL_AI=true. O backend não muda; isto só decide o que a tela mostra. */
export const emProducao = (origem) => /production/.test(String(origem || ''));

export const assistenteDisponivel = (origem) => !emProducao(origem);

export function iaExternaDisponivel(origem, env = {}) {
  if (!emProducao(origem)) return true;
  return String(env?.VITE_ENABLE_EXTERNAL_AI ?? '').trim().toLowerCase() === 'true';
}
