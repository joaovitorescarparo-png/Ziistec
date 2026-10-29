// Erro do banco que chega ao navegador: só frase de produto conhecida passa.
// O corpo de erro do PostgREST traz message/details/hint/code com nomes de função, tabela, coluna e esquema
// ("Could not find the function ... in the schema cache", "permission denied for ...", "JWT expired").
// As rotas nunca repetem esse corpo: se a mensagem não for exatamente uma das frases abaixo
// (RAISE EXCEPTION próprio das RPCs de quota), o usuário recebe o texto fixo de cada rota.
export const QUOTA_USER_MESSAGES = Object.freeze([
  'Sem acesso a esta empresa',
  'Assinatura sem acesso à IA',
  'Limite temporário de IA atingido. Tente novamente em instantes',
  'Limite diário de IA atingido',
  'Somente o proprietário gera PDF de orçamento',
  'Assinatura inativa',
  'Muitos PDFs em pouco tempo. Aguarde um minuto',
  'Limite diário de PDFs atingido',
]);

export function quotaUserMessage(detail, fallback) {
  const message = typeof detail?.message === 'string' ? detail.message : '';
  return QUOTA_USER_MESSAGES.includes(message) ? message : fallback;
}
