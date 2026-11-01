import { useEffect, useState } from 'react';
import { hojeISO } from '../lib/dates';

/* Dia do calendário do aparelho (AAAA-MM-DD) que se atualiza quando o app volta a ser usado.
 * Sem polling: a aba que ficou aberta durante a noite recalcula o dia ao voltar a ficar visível ou
 * receber foco, e isso re-renderiza quem usa o hook. As operações (salvar, concluir, baixar) leem
 * `hojeISO()` na hora em que rodam, então nunca dependem desta atualização para acertar o dia. */
export default function useDiaLocal() {
  const [dia, setDia] = useState(() => hojeISO());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const atualizar = () => setDia((atual) => {
      const agora = hojeISO();
      return agora === atual ? atual : agora;
    });
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    window.addEventListener('pageshow', atualizar);
    return () => {
      document.removeEventListener('visibilitychange', atualizar);
      window.removeEventListener('focus', atualizar);
      window.removeEventListener('pageshow', atualizar);
    };
  }, []);
  return dia;
}
