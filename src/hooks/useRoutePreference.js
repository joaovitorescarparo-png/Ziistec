import { useSyncExternalStore } from 'react';
import { assinarPreferenciaRota, escolherAppDeRota, lerPreferenciaRota } from '../lib/routePreferences';

/** Aplicativo de rota do usuário logado: { app, salvo, persistente, erro, escolher }. */
export function useRoutePreference() {
  const estado = useSyncExternalStore(assinarPreferenciaRota, lerPreferenciaRota, lerPreferenciaRota);
  return { ...estado, escolher: escolherAppDeRota };
}

export default useRoutePreference;
