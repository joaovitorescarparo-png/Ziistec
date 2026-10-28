/* Datas de calendário (AAAA-MM-DD) no fuso do aparelho.
 *
 * Nunca use o corte do `toISOString()` para obter "hoje": esse é o dia em UTC e, no Brasil (UTC-3),
 * vira "amanhã" entre 21h e 24h (vencimento, data de pagamento e início de garantia saíam um dia à frente).
 * As somas de dias/meses usam o meio-dia local para não mudar de dia por horário de verão. */

const dois = (n) => String(n).padStart(2, '0');

/** Dia do calendário local de uma data (AAAA-MM-DD). Data inválida devolve ''. */
export function dataLocalISO(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Hoje, no fuso do aparelho. */
export function hojeISO(agora = new Date()) {
  return dataLocalISO(agora);
}

const meioDiaLocal = (base) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(base || ''))) return null;
  const d = new Date(`${String(base).slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Soma dias a uma data AAAA-MM-DD. Base vazia ou inválida devolve ''. */
export function addDiasISO(base, dias) {
  const d = meioDiaLocal(base);
  if (!d) return '';
  d.setDate(d.getDate() + Number(dias || 0));
  return dataLocalISO(d);
}

/** Soma meses a uma data AAAA-MM-DD (dia 31 + 1 mês cai no mês seguinte, como o Date do JavaScript). */
export function addMesesISO(base, meses) {
  const d = meioDiaLocal(base);
  if (!d) return '';
  d.setMonth(d.getMonth() + Number(meses || 0));
  return dataLocalISO(d);
}

/** AAAA-MM-DD (ou carimbo ISO) para DD/MM/AAAA; `vazio` é o texto quando não há data válida. */
export function dataBR(valor, vazio = '—') {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : vazio;
}
