/* Rotas até o atendimento: Google Maps, Waze e Apple Maps.
 *
 * Funções puras. Os links são sempre montados aqui, com origem fixa (https) e parâmetros codificados; nada
 * que veio do cliente ou do banco vira esquema, host ou código. Coordenadas só existem quando o cadastro as
 * tem para o MESMO endereço do atendimento: nunca se inventa coordenada. Ordem de preferência do destino:
 * coordenadas, depois o endereço completo (com o place id do Google quando útil) e, por último, o local do
 * serviço (apto, bloco etc.) quando não houver endereço. */

export const ROUTE_APPS = Object.freeze(['google', 'waze', 'apple']);
export const DEFAULT_ROUTE_APP = 'google';
export const ROUTE_APP_LABELS = Object.freeze({ google: 'Google Maps', waze: 'Waze', apple: 'Apple Maps' });
export const MENSAGEM_SEM_ENDERECO = 'Este atendimento ainda não possui um endereço disponível para abrir a rota.';

const HOSTS = Object.freeze({ google: 'www.google.com', waze: 'waze.com', apple: 'maps.apple.com' });
const MAX_TEXTO = 500;

export const isRouteApp = (valor) => ROUTE_APPS.includes(valor);

/** Texto livre saneado: sem caracteres de controle, espaços colapsados, limitado; vazio vira null. */
export function limparTextoRota(valor, max = MAX_TEXTO) {
  if (valor == null) return null;
  const texto = String(valor).replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return texto || null;
}

const dobrar = (valor) => (limparTextoRota(valor) || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const mesmoEndereco = (a, b) => Boolean(dobrar(a)) && dobrar(a) === dobrar(b);

/** {latitude, longitude} válidos (finitos, dentro da faixa, par completo e fora de 0,0) ou null. */
export function normalizarCoordenadas(latitude, longitude) {
  if (latitude == null || longitude == null || latitude === '' || longitude === '') return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { latitude: Number(lat.toFixed(7)), longitude: Number(lng.toFixed(7)) };
}

const limparPlaceId = (valor) => {
  const texto = String(valor ?? '').trim();
  return /^[A-Za-z0-9_-]{10,300}$/.test(texto) ? texto : null;
};

/** Destino da rota de um atendimento; null quando não há informação suficiente. */
export function resolverDestinoRota({ endereco = null, localServico = null, cliente = null } = {}) {
  const enderecoLimpo = limparTextoRota(endereco);
  const texto = enderecoLimpo || limparTextoRota(localServico);
  if (!texto) return null;
  // O cadastro do cliente só empresta coordenadas e place id quando o endereço do atendimento é o dele.
  const noEnderecoDoCliente = Boolean(enderecoLimpo && cliente && mesmoEndereco(enderecoLimpo, cliente.endereco));
  const coordenadas = noEnderecoDoCliente ? normalizarCoordenadas(cliente.latitude, cliente.longitude) : null;
  const placeId = noEnderecoDoCliente ? limparPlaceId(cliente.googlePlaceId) : null;
  return { latitude: coordenadas?.latitude ?? null, longitude: coordenadas?.longitude ?? null, endereco: texto, placeId };
}

// Espaço sempre como %20 (um '+' literal já saiu como %2B): vale igual para qualquer leitor da query.
const espacoComoPercent = (url) => url.toString().replace(/\+/g, '%20');

const temCoordenadas = (destino) => Number.isFinite(destino?.latitude) && Number.isFinite(destino?.longitude);

/** Link de rota no app escolhido; null se o app for desconhecido ou o destino for insuficiente. */
export function construirUrlRota(app, destino) {
  if (!isRouteApp(app) || !destino) return null;
  const coordenadas = temCoordenadas(destino) ? normalizarCoordenadas(destino.latitude, destino.longitude) : null;
  const texto = limparTextoRota(destino.endereco);
  if (!coordenadas && !texto) return null;
  const par = coordenadas ? `${coordenadas.latitude},${coordenadas.longitude}` : null;

  if (app === 'google') {
    const url = new URL(`https://${HOSTS.google}/maps/dir/`);
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', par || texto);
    const placeId = limparPlaceId(destino.placeId);
    if (placeId) url.searchParams.set('destination_place_id', placeId);
    return espacoComoPercent(url);
  }
  if (app === 'waze') {
    return par
      ? `https://${HOSTS.waze}/ul?ll=${par}&navigate=yes`
      : `https://${HOSTS.waze}/ul?q=${encodeURIComponent(texto)}&navigate=yes`;
  }
  const url = new URL(`https://${HOSTS.apple}/`);
  url.searchParams.set('daddr', par || texto);
  url.searchParams.set('dirflg', 'd');
  return espacoComoPercent(url);
}

/** Link pronto para href: montado e validado, ou null. */
export function linkDeRota(app, destino) {
  const url = construirUrlRota(app, destino);
  return url && urlDeRotaSegura(url) ? url : null;
}

/** Só https, host conhecido, sem credenciais: nada além disso chega a um href. */
export function urlDeRotaSegura(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && Object.values(HOSTS).includes(parsed.hostname);
  } catch { return false; }
}

/** Plataforma do aparelho sem depender só do userAgent: usa userAgentData, platform e multitoque. */
export function detectarPlataforma(nav = globalThis.navigator) {
  if (!nav) return 'desktop';
  const dados = String(nav.userAgentData?.platform || '');
  const plataforma = String(nav.platform || '');
  const agente = String(nav.userAgent || '');
  const toques = Number(nav.maxTouchPoints || 0);
  if (/android/i.test(dados) || /android/i.test(agente)) return 'android';
  if (/iphone|ipad|ipod/i.test(plataforma) || /iphone|ipad|ipod/i.test(agente)) return 'ios';
  // iPadOS se apresenta como Mac; o multitoque o distingue de um Mac de verdade.
  if (/mac/i.test(plataforma || dados) && toques > 1) return 'ios';
  return /mac/i.test(plataforma || dados) ? 'macos' : 'desktop';
}

export const appleMapsNativo = (plataforma) => plataforma === 'ios' || plataforma === 'macos';

/** Outros apps além do usado por "Abrir rota"; o Apple Maps vai por último fora do ecossistema Apple. */
export function alternativasDeRota(appAtual, plataforma = 'desktop') {
  const restantes = ROUTE_APPS.filter((app) => app !== appAtual);
  const ordenadas = appleMapsNativo(plataforma) ? restantes : [...restantes.filter((app) => app !== 'apple'), ...restantes.filter((app) => app === 'apple')];
  return ordenadas.map((app) => ({
    app,
    label: ROUTE_APP_LABELS[app],
    dica: app === 'apple' && !appleMapsNativo(plataforma) ? 'abre no navegador' : null,
  }));
}
