/*
  Pendências operacionais — uma regra só para o Início e para a tela Serviços.

  O problema que isto resolve: a tela Serviços dizia "1 Atrasados" e o Início
  dizia "Tudo em dia", na mesma empresa e no mesmo dia. Eram duas contas
  diferentes sobre os mesmos dados. Agora é esta.

  As duas telas trabalham com formatos diferentes do mesmo serviço — o Início lê
  a ordem do estado do app (`data`, `responsavelId`, status em português) e a
  tela Serviços lê o cartão de zt_operations_board (`scheduled_date`,
  `assignee_id`, status do banco). Os acessores abaixo aceitam os dois, então a
  regra é literalmente a mesma função, não duas parecidas.

  Nada aqui olha dinheiro: a pergunta é o que precisa de atenção hoje.
*/

const dia = (v) => String(v || '').slice(0, 10);

/* Status que encerram o serviço, nos dois formatos. */
const ENCERRADO = new Set(['concluida', 'cancelada', 'done', 'canceled']);
/* Status de serviço que já tem data e deveria estar acontecendo. */
const EM_ROTA = new Set(['agendada', 'andamento', 'scheduled', 'in_progress']);

export const diaDoServico = (s) => dia(s?.data ?? s?.scheduled_date);
export const statusDoServico = (s) => String(s?.status || '');
export const responsavelDoServico = (s) => s?.responsavelId ?? s?.assignee_id ?? null;

export const servicoAtivo = (s) => Boolean(s) && !ENCERRADO.has(statusDoServico(s));

/* Atrasado é serviço ativo com data no passado que já estava em rota. Serviço
   sem data não está atrasado: está aguardando agendamento, que é outra coisa. */
export const servicoAtrasado = (s, hoje) => {
  if (!servicoAtivo(s)) return false;
  const d = diaDoServico(s);
  return Boolean(d) && d < dia(hoje) && EM_ROTA.has(statusDoServico(s));
};

export const servicoSemResponsavel = (s) => servicoAtivo(s) && !responsavelDoServico(s);

/* As duas contagens que as duas telas precisam dar iguais. */
export function contarPendencias(servicos = [], hoje) {
  const lista = (servicos || []).filter(servicoAtivo);
  return {
    atrasados: lista.filter((s) => servicoAtrasado(s, hoje)).length,
    semResponsavel: lista.filter(servicoSemResponsavel).length,
  };
}

/* Aviso de pendência que o filtro atual esconde.
   Mostrar um número no topo e uma lista vazia embaixo, sem explicar, parece
   erro do sistema. Então quando a pendência existe mas não está à vista, a tela
   diz onde ela está e oferece o toque que muda o próprio filtro. */
export function avisosDePendencia({
  atrasados = 0, semResponsavel = 0,
  atrasadosVisiveis = 0, semResponsavelVisiveis = 0,
} = {}) {
  const avisos = [];
  if (atrasados > 0 && atrasadosVisiveis === 0) {
    avisos.push({
      id: 'atrasados',
      tom: 'erro',
      texto: atrasados === 1
        ? '1 serviço atrasado precisa de atenção'
        : `${atrasados} serviços atrasados precisam de atenção`,
      acao: 'Ver agora',
      filtro: 'atrasadas',
    });
  }
  if (semResponsavel > 0 && semResponsavelVisiveis === 0) {
    avisos.push({
      id: 'semresponsavel',
      tom: 'atencao',
      texto: semResponsavel === 1
        ? '1 serviço sem responsável'
        : `${semResponsavel} serviços sem responsável`,
      acao: 'Organizar',
      filtro: 'semresponsavel',
    });
  }
  return avisos;
}

/* Pendências do Início, no formato que aquela tela já usa. A ação é sempre
   levar para a tela Serviços: é lá que se resolve. */
export function pendenciasDoInicio(ordens = [], hoje) {
  const { atrasados, semResponsavel } = contarPendencias(ordens, hoje);
  const itens = [];
  if (atrasados > 0) {
    itens.push({
      id: 'os-atrasada',
      tom: 'erro',
      titulo: atrasados === 1 ? '1 serviço atrasado' : `${atrasados} serviços atrasados`,
      detalhe: 'A data marcada já passou e o atendimento não foi concluído',
      acao: 'Ver serviços',
    });
  }
  if (semResponsavel > 0) {
    itens.push({
      id: 'os-sem-responsavel',
      tom: 'atencao',
      titulo: semResponsavel === 1 ? '1 serviço sem responsável' : `${semResponsavel} serviços sem responsável`,
      detalhe: 'Ninguém foi escolhido para fazer o atendimento',
      acao: 'Ver serviços',
    });
  }
  return itens;
}
