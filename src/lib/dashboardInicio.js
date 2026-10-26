import { estoqueBaixo } from './estoque';

/* Dados derivados do Início. Funções puras sobre o que o app principal já carregou: nenhuma consulta nova,
 * e a visibilidade de cada bloco continua sendo decidida pelo papel (RLS decide o que cada papel carrega). */

export const DIAS_CONCLUIDAS_RECENTES = 30;
export const LIMITE_CONCLUIDAS_RECENTES = 5;

const somarDias = (iso, dias) => {
  const data = new Date(`${iso}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
};

/** OS concluídas nos últimos `dias` (hoje incluso), da mais recente para a mais antiga. Sem valores financeiros. */
export function concluidasRecentemente(ordens, hoje, { dias = DIAS_CONCLUIDAS_RECENTES, limite = LIMITE_CONCLUIDAS_RECENTES } = {}) {
  if (!Array.isArray(ordens) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hoje || ''))) return [];
  const desde = somarDias(hoje, -dias);
  return ordens
    .filter((os) => os && os.status === 'concluida' && os.concluidaEm && os.concluidaEm >= desde && os.concluidaEm <= hoje)
    .sort((a, b) => b.concluidaEm.localeCompare(a.concluidaEm) || String(b.numero || '').localeCompare(String(a.numero || '')))
    .slice(0, limite);
}

/** Produtos no mínimo ou abaixo dele, pela mesma regra da tela de estoque, do menor saldo para o maior. */
export function produtosComEstoqueBaixo(produtos) {
  if (!Array.isArray(produtos)) return [];
  return produtos.filter(estoqueBaixo).sort((a, b) => (Number(a.estoque) - Number(b.estoque)) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}
