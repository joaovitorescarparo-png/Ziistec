import React, { useId, useMemo } from 'react';
import { ChevronDown, Navigation } from 'lucide-react';
import useRoutePreference from '../hooks/useRoutePreference';
import {
  MENSAGEM_SEM_ENDERECO, ROUTE_APPS, ROUTE_APP_LABELS, alternativasDeRota, detectarPlataforma, linkDeRota,
} from '../lib/routeApps';
import { MENSAGEM_PREFERENCIA_SESSAO } from '../lib/routePreferences';

// Rota até o atendimento no app que a pessoa prefere, com os outros apps a um toque. A preferência é
// do usuário (não da empresa). Os links são âncoras comuns (nada de window.open depois de await), montadas
// por routeApps.js; sem endereço, o botão fica desligado e explica o motivo em linguagem simples.
const foco = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-1';

export default function RouteButton({ destino, className = '' }) {
  const { app, persistente, erro, escolher } = useRoutePreference();
  const plataforma = useMemo(() => detectarPlataforma(), []);
  const grupo = useId();
  const principal = destino ? linkDeRota(app, destino) : null;

  if (!principal) {
    return (
      <div className={className}>
        <button type="button" disabled
          className="flex w-full min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-200 py-3 text-[14px] font-medium text-slate-500">
          <Navigation className="h-[18px] w-[18px]" aria-hidden="true" />Abrir rota
        </button>
        <p role="status" className="mt-2 text-[13px] leading-relaxed text-slate-500">{MENSAGEM_SEM_ENDERECO}</p>
      </div>
    );
  }

  const alternativas = alternativasDeRota(app, plataforma)
    .map((item) => ({ ...item, url: linkDeRota(item.app, destino) }))
    .filter((item) => item.url);

  return (
    <div className={className}>
      <a href={principal} target="_blank" rel="noopener noreferrer" aria-label={`Abrir rota no ${ROUTE_APP_LABELS[app]}`}
        className={`flex w-full min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-[14px] font-medium text-white hover:bg-slate-800 ${foco}`}>
        <Navigation className="h-[18px] w-[18px]" aria-hidden="true" />
        <span>Abrir rota</span>
        <span className="text-[12px] font-normal text-white/70">· {ROUTE_APP_LABELS[app]}</span>
      </a>
      <details className="mt-2 rounded-xl ring-1 ring-slate-200">
        <summary className={`flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 text-[13px] font-medium text-slate-700 ${foco}`}>
          Abrir com outro app<ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </summary>
        <div className="border-t border-slate-100 px-1.5 py-1.5">
          <ul className="space-y-0.5">
            {alternativas.map((item) => (
              <li key={item.app}>
                <a href={item.url} target="_blank" rel="noopener noreferrer"
                  className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-[14px] text-teal-800 hover:bg-slate-50 ${foco}`}>
                  {item.label}{item.dica && <span className="text-[12px] text-slate-400">· {item.dica}</span>}
                </a>
              </li>
            ))}
          </ul>
          <fieldset className="mt-1 border-t border-slate-100 px-2 pb-2 pt-2">
            <legend className="px-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">Usar sempre</legend>
            <div className="flex flex-wrap gap-x-4">
              {ROUTE_APPS.map((item) => (
                <label key={item} className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-slate-700">
                  <input type="radio" name={`rota-padrao-${grupo}`} value={item} checked={app === item} onChange={() => escolher(item)}
                    className="h-4 w-4 accent-teal-700" />
                  {ROUTE_APP_LABELS[item]}
                </label>
              ))}
            </div>
            {(erro || persistente === false) && (
              <p role="status" className="mt-1 text-[12px] leading-relaxed text-slate-500">{erro || MENSAGEM_PREFERENCIA_SESSAO}</p>
            )}
          </fieldset>
        </div>
      </details>
    </div>
  );
}
