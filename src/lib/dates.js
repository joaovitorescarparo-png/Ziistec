/* Datas de calendário (AAAA-MM-DD) no fuso do aparelho.
 *
 * Nunca use o corte do `toISOString()` para obter "hoje": esse é o dia em UTC e, no Brasil (UTC-3),
 * vira "amanhã" entre 21h e 24h (vencimento, data de pagamento e início de garantia saíam um dia à frente).
 * As somas de dias usam o meio-dia local para não mudar de dia por horário de verão; a de meses é
 * aritmética de calendário. "Hoje" lê o relógio a cada chamada: nunca guarde o resultado em constante de módulo. */

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

/** Soma meses a uma data AAAA-MM-DD. Se o mês de destino é mais curto, fica no último dia dele
 * (31/01 + 1 mês = 28/02 ou 29/02; 31/03 + 1 mês = 30/04), igual a `data + interval 'N months'` do Postgres,
 * que calcula as garantias e os ciclos de contrato no banco. Fração de mês é descartada; quantidade
 * não numérica devolve ''. */
export function addMesesISO(base, meses) {
  const d = meioDiaLocal(base);
  const n = Number(meses || 0);
  if (!d || !Number.isFinite(n)) return '';
  const total = d.getFullYear() * 12 + d.getMonth() + Math.trunc(n);
  const ano = Math.floor(total / 12);
  const mes = total - ano * 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${String(ano).padStart(4, '0')}-${dois(mes + 1)}-${dois(Math.min(d.getDate(), ultimoDia))}`;
}

/** AAAA-MM-DD (ou carimbo ISO) para DD/MM/AAAA; `vazio` é o texto quando não há data válida. */
export function dataBR(valor, vazio = '—') {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : vazio;
}
