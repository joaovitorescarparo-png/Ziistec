/* Leitura completa da Data API.
 *
 * O PostgREST corta toda resposta no `max_rows` do projeto (1000 no Supabase) e devolve
 * HTTP 206 sem erro: o supabase-js entrega a lista parcial como se fosse a lista inteira.
 * Total financeiro, checklist ou histórico calculados sobre essa lista ficam errados em
 * silêncio. Este helper lê página por página até a última e devolve o mesmo formato
 * `{ data, error }` da consulta original, para o chamador continuar usando `check()`.
 *
 * - `montar` devolve uma consulta NOVA a cada chamada (o builder do supabase-js é
 *   consumido pelo await). A consulta precisa ter ordem determinística; use uma coluna
 *   única (normalmente `id`) como desempate.
 * - Linhas repetidas entre páginas (inserção concorrente deslocando o offset) são
 *   descartadas pela chave.
 * - Acima de `maxLinhas` o helper FALHA em vez de truncar: lista parcial nunca volta
 *   como completa.
 */
export const PAGINA_PADRAO = 1000;
export const MAX_LINHAS_PADRAO = 200000;

export class LeituraIncompletaError extends Error {
  constructor(message) { super(message); this.name = 'LeituraIncompletaError'; this.code = 'ZT_READ_INCOMPLETE'; }
}

export async function lerTodas(montar, { tamanho = PAGINA_PADRAO, maxLinhas = MAX_LINHAS_PADRAO, chave = 'id' } = {}) {
  if (typeof montar !== 'function') throw new TypeError('lerTodas precisa de uma função que monte a consulta.');
  const linhas = [];
  const vistas = new Set();
  for (let inicio = 0; ; inicio += tamanho) {
    if (inicio >= maxLinhas) {
      return { data: null, error: new LeituraIncompletaError('Há registros demais para carregar de uma vez. Use os filtros para reduzir a lista.') };
    }
    const r = await montar().range(inicio, inicio + tamanho - 1);
    if (r?.error) return { data: null, error: r.error };
    const pagina = Array.isArray(r?.data) ? r.data : [];
    for (const linha of pagina) {
      const k = chave && linha && typeof linha === 'object' ? linha[chave] : undefined;
      if (k !== undefined && k !== null) {
        if (vistas.has(k)) continue;
        vistas.add(k);
      }
      linhas.push(linha);
    }
    if (pagina.length < tamanho) return { data: linhas, error: null };
  }
}

/* Divide uma lista de ids em blocos para filtros `.in(...)`: cada bloco vira uma URL de
   tamanho seguro (uuid ≈ 37 caracteres). */
export function emBlocos(lista, tamanho = 150) {
  const unicos = [...new Set((lista || []).filter(Boolean))];
  const blocos = [];
  for (let i = 0; i < unicos.length; i += tamanho) blocos.push(unicos.slice(i, i + tamanho));
  return blocos;
}

/* `lerTodas` aplicado a cada bloco de ids; junta tudo no formato `{ data, error }`. */
export async function lerTodasPorIds(ids, montarPorBloco, opcoes = {}) {
  const resultado = [];
  for (const bloco of emBlocos(ids, opcoes.bloco || 150)) {
    const r = await lerTodas(() => montarPorBloco(bloco), opcoes);
    if (r.error) return r;
    resultado.push(...r.data);
  }
  return { data: resultado, error: null };
}
