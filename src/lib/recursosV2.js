/* Recursos V2 abertos de dentro do app principal.
 *
 * As telas `?v2=` continuam sendo a rota técnica; este módulo só diz quais delas têm entrada em cada aba do
 * app principal, para quem, e como Voltar/Fechar retorna à aba de origem. Funções puras: a autoridade de
 * acesso continua sendo o owner gate do App.jsx e o RLS/RPC no banco. */

export const SHELL_V2_STATE = 'ziistecShellV2';
export const SHELL_V2_ORIGIN = 'ziistecShellOrigin';

const ABAS_COM_ENTRADA = ['inicio', 'catalogo', 'clientes', 'garantias', 'financeiro'];

export const RECURSOS_V2_OWNER = Object.freeze({
  produtos: Object.freeze({ rotulo: 'Estoque e movimentações', aba: 'catalogo' }),
  'clientes-locais': Object.freeze({ rotulo: 'Locais no mapa', aba: 'clientes' }),
  garantias: Object.freeze({ rotulo: 'Garantia manual', aba: 'garantias' }),
  'pos-venda': Object.freeze({ rotulo: 'Pós-venda', aba: 'garantias' }),
  contratos: Object.freeze({ rotulo: 'Contratos e preventivas', aba: 'garantias' }),
  financeiro: Object.freeze({ rotulo: 'Visão gerencial', aba: 'financeiro' }),
});

export const recursoV2ExigeOwner = (chave) => Object.prototype.hasOwnProperty.call(RECURSOS_V2_OWNER, chave);

/** Entradas que a aba mostra. Técnico (ou papel desconhecido) nunca recebe entrada administrativa. */
export function recursosV2DaAba(aba, papel) {
  if (papel !== 'proprietario') return [];
  return Object.entries(RECURSOS_V2_OWNER)
    .filter(([, recurso]) => recurso.aba === aba)
    .map(([chave, recurso]) => ({ chave, rotulo: recurso.rotulo }));
}

/** Aba de origem gravada na entrada de histórico do app principal; só aceita abas conhecidas. */
export function abaDeOrigemV2(state) {
  const aba = state && typeof state === 'object' ? state[SHELL_V2_ORIGIN] : null;
  return ABAS_COM_ENTRADA.includes(aba) ? aba : null;
}

/** Estado das duas entradas de histórico: a do app principal (guarda a origem) e a da tela V2 aberta. */
export function estadosDeAberturaV2(estadoAtual, origem) {
  const base = estadoAtual && typeof estadoAtual === 'object' ? { ...estadoAtual } : {};
  const aba = ABAS_COM_ENTRADA.includes(origem) ? origem : null;
  const origemState = aba ? { ...base, [SHELL_V2_ORIGIN]: aba } : base;
  return { origemState, telaState: { [SHELL_V2_STATE]: true } };
}

/** Tela V2 aberta pelo app principal volta pelo histórico; a aberta por URL segue para o destino dado. */
export const voltaPeloHistorico = (state) => Boolean(state && typeof state === 'object' && state[SHELL_V2_STATE]);

/** Remove a origem já consumida, preservando o restante do estado (por exemplo, a pilha de modais). */
export function semOrigemV2(state) {
  if (!state || typeof state !== 'object' || !(SHELL_V2_ORIGIN in state)) return null;
  const { [SHELL_V2_ORIGIN]: _origem, ...resto } = state;
  return resto;
}

const PARAMETROS_PERMITIDOS = ['client', 'product', 'wo'];

/** URL da tela V2: troca `v2` e os parâmetros de registro conhecidos, mantendo o restante da URL. */
export function urlRecursoV2(href, chave, params = {}) {
  const url = new URL(href);
  for (const nome of PARAMETROS_PERMITIDOS) url.searchParams.delete(nome);
  url.searchParams.set('v2', chave);
  for (const nome of PARAMETROS_PERMITIDOS) {
    const valor = params?.[nome];
    if (valor) url.searchParams.set(nome, String(valor));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
