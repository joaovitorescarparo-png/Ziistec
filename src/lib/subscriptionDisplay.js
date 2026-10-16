/* Texto da assinatura no beta. Plano, valor, status e período vêm do banco; aqui só se decide
   como mostrar. Trial mostra o valor que vale depois do teste, sem sugerir cobrança feita.
   Aceita o status do banco (trial/active/...) e o do app legado (trial/ativa/...). */
const NORMALIZA = {
  trial: "trial", active: "active", ativa: "active", past_due: "past_due", pendente: "past_due",
  suspended: "suspended", suspensa: "suspended", canceled: "canceled", cancelada: "canceled",
};
const CONTATO_RENOVAR = "Entre em contato com a ZiisTec para renovar o acesso.";
const DADOS = "Seus dados permanecem armazenados.";

export const statusAssinatura = (status) => NORMALIZA[status] || status || null;

export function hojeISO(agora = new Date()) {
  const m = String(agora.getMonth() + 1).padStart(2, "0");
  const d = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${m}-${d}`;
}

const dia = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export function diasRestantes(fim, hoje = hojeISO()) {
  const a = dia(hoje), b = dia(fim);
  return a == null || b == null ? null : Math.round((b - a) / 86400000);
}

export const dataBR = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

export const precoMensal = (valor) =>
  `R$ ${Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês`;

export function resumoAssinatura(assinatura, hoje = hojeISO()) {
  if (!assinatura) return null;
  const status = statusAssinatura(assinatura.status);
  const fim = assinatura.fim ?? assinatura.proximaCobranca ?? null;
  const dias = diasRestantes(fim, hoje);
  const encerrado = dias != null && dias < 0;
  const base = {
    status, plano: assinatura.plano || "—", preco: precoMensal(assinatura.valor), fim: dataBR(fim),
    diasRestantes: dias, encerrado, linhas: [], aviso: null, mensagem: null, contato: null,
  };

  if (status === "trial" && !encerrado) {
    return {
      ...base, bloqueado: false, tom: "marca", titulo: "Teste grátis",
      destaque: dias == null ? null : dias === 0 ? "Último dia de teste" : `${dias} ${dias === 1 ? "dia restante" : "dias restantes"}`,
      linhas: [["Depois do teste", base.preco], ["Data de término", base.fim]],
      aviso: "Nenhuma cobrança é feita durante o teste.",
    };
  }
  if (status === "active" && !encerrado) {
    return { ...base, bloqueado: false, tom: "sucesso", titulo: "Assinatura ativa", destaque: base.preco, linhas: [["Período atual até", base.fim]] };
  }
  // Daqui para baixo o acesso está bloqueado no servidor (status ou período); dados nunca são apagados.
  if (status === "trial" || (status === "suspended" && encerrado)) {
    return {
      ...base, bloqueado: true, tom: "atencao", titulo: "Seu período de teste terminou.", destaque: null,
      mensagem: DADOS, contato: "Entre em contato com a ZiisTec para continuar.",
    };
  }
  const bloqueios = {
    active: ["Pagamento pendente", "atencao", "O período da assinatura terminou."],
    past_due: ["Pagamento pendente", "atencao", "O período da assinatura terminou."],
    suspended: ["Acesso suspenso", "erro", "O acesso desta empresa está suspenso."],
    canceled: ["Assinatura cancelada", "neutro", "A assinatura desta empresa foi cancelada."],
  };
  const [titulo, tom, motivo] = bloqueios[status] || [status ? `Situação: ${status}` : "Sem assinatura", "neutro", "A assinatura não libera o uso agora."];
  return { ...base, bloqueado: true, tom, titulo, destaque: null, mensagem: `${motivo} ${DADOS}`, contato: CONTATO_RENOVAR };
}
