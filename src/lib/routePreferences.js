import { supabase } from './supabase';
import { DEFAULT_ROUTE_APP, isRouteApp } from './routeApps';

/* Preferência de aplicativo de rota do USUÁRIO (0106, tabela user_route_preferences, RLS própria).
 *
 * Funciona mesmo sem a tabela (banco 0099): a escolha vale na sessão e a preferência persistente
 * simplesmente não fica disponível, sem erro técnico para quem usa. Um único estado compartilhado pelas
 * telas; ele é zerado quando o usuário da sessão muda. */

const TABELA_AUSENTE = new Set(['PGRST205', 'PGRST202', '42P01', '42703']);
export const preferenciaRotaAusente = (error) => TABELA_AUSENTE.has(String(error?.code || ''))
  || (/user_route_preferences/.test(String(error?.message || '')) && /(schema cache|does not exist|could not find)/i.test(String(error?.message || '')));

export const MENSAGEM_PREFERENCIA_SESSAO = 'Vale somente nesta sessão.';
export const MENSAGEM_PREFERENCIA_FALHOU = 'Não foi possível guardar sua escolha agora. Ela vale nesta sessão.';

export async function carregarPreferenciaRotaDB() {
  const r = await supabase.from('user_route_preferences').select('route_app').maybeSingle();
  if (r.error) {
    if (preferenciaRotaAusente(r.error)) return { disponivel: false, app: null };
    throw r.error;
  }
  return { disponivel: true, app: isRouteApp(r.data?.route_app) ? r.data.route_app : null };
}

export async function salvarPreferenciaRotaDB(userId, app) {
  if (!userId) throw new Error('Sessão inválida.');
  if (!isRouteApp(app)) throw new Error('Aplicativo de rota inválido.');
  const r = await supabase.from('user_route_preferences')
    .upsert({ user_id: userId, route_app: app, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (r.error) {
    if (preferenciaRotaAusente(r.error)) return { disponivel: false };
    throw r.error;
  }
  return { disponivel: true };
}

const inicial = () => ({ userId: null, escolhido: null, persistente: null, erro: '', carregado: false, versao: 0 });
let estado = inicial();
let snapshot = null;
let carregando = null;
let authAssinada = false;
const ouvintes = new Set();

const montarSnapshot = () => ({
  app: estado.escolhido || DEFAULT_ROUTE_APP,
  salvo: Boolean(estado.escolhido),
  persistente: estado.persistente,
  erro: estado.erro,
});
const publicar = () => { snapshot = montarSnapshot(); ouvintes.forEach((fn) => fn()); };

export const lerPreferenciaRota = () => (snapshot ||= montarSnapshot());

/** Zera tudo (troca ou saída de usuário) para a preferência de uma pessoa nunca aparecer para outra. */
export function reiniciarPreferenciaRota(userId = null) {
  estado = { ...inicial(), userId };
  carregando = null;
  publicar();
}

async function usuarioAtual() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id || null;
  } catch { return null; }
}

function acompanharSessao() {
  if (authAssinada) return;
  authAssinada = true;
  try {
    supabase.auth?.onAuthStateChange?.((_evento, sessao) => {
      const id = sessao?.user?.id || null;
      if (id !== estado.userId) reiniciarPreferenciaRota(id);
    });
  } catch { /* sem observador de sessão: a verificação em cada carga cobre a troca de usuário */ }
}

/** Carrega uma vez por usuário. Falha de rede ou tabela ausente nunca vira erro para a tela. */
export function carregarPreferenciaRota() {
  acompanharSessao();
  if (carregando) return carregando;
  if (estado.carregado) return Promise.resolve(); // listas com muitos endereços assinam o estado: uma carga por usuário
  carregando = (async () => {
    const userId = await usuarioAtual();
    if (userId !== estado.userId) reiniciarPreferenciaRota(userId);
    if (!userId || estado.carregado) { carregando = null; return; }
    const versao = estado.versao;
    try {
      const { disponivel, app } = await carregarPreferenciaRotaDB();
      if (estado.userId === userId) {
        // Quem já escolheu enquanto o banco respondia não é sobrescrito pelo valor antigo.
        const houveEscolha = estado.versao !== versao;
        estado = {
          ...estado, carregado: true,
          persistente: houveEscolha ? (estado.persistente ?? disponivel) : disponivel,
          escolhido: houveEscolha ? estado.escolhido : (app || estado.escolhido),
        };
        publicar();
      }
    } catch {
      if (estado.userId === userId) { estado = { ...estado, carregado: true, persistente: null }; publicar(); }
    } finally { carregando = null; }
  })();
  return carregando;
}

/** A escolha vale na hora; guardar no banco é uma segunda etapa que pode falhar sem derrubar nada. */
export async function escolherAppDeRota(app) {
  if (!isRouteApp(app)) return;
  estado = { ...estado, escolhido: app, versao: estado.versao + 1, erro: '' };
  publicar();
  const userId = estado.userId || await usuarioAtual();
  if (!userId) { estado = { ...estado, persistente: false }; publicar(); return; }
  try {
    const { disponivel } = await salvarPreferenciaRotaDB(userId, app);
    if (estado.userId === userId || estado.userId == null) { estado = { ...estado, userId, persistente: disponivel, erro: '' }; publicar(); }
  } catch {
    estado = { ...estado, erro: MENSAGEM_PREFERENCIA_FALHOU }; publicar();
  }
}

export function assinarPreferenciaRota(ouvinte) {
  ouvintes.add(ouvinte);
  carregarPreferenciaRota();
  return () => { ouvintes.delete(ouvinte); };
}
