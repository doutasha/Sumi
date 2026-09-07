/**
 * sources.js — catálogo de fontes do motor (espelho de impl/Source.kt).
 *
 * O registry é síncrono e o servidor é remoto: leitura síncrona vem do cache
 * localStorage (`sumi.suwayomi.sources`); `refreshServerSources()` atualiza em
 * background (chamado pelo ServerStatus na UI). Sem servidor = cache vazio,
 * sem erro — modo leve segue normal.
 */

import { suwayomiGet } from './client.js';
import { checkHealth, getSuwayomiConfig } from './connection.js';
import { serverIconUrl } from './images.js';

export const SERVER_SOURCE_PREFIX = 'suwayomi:';
export const SERVER_SOURCES_EVENT = 'sumi:server-sources';

function notifySourcesChanged() {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(SERVER_SOURCES_EVENT));
    }
  } catch {
    /* ambiente sem DOM: ignora */
  }
}
export const SOURCES_CACHE_KEY = 'sumi.suwayomi.sources';

/** Nosso id de fonte a partir do id (string) do servidor. */
export function serverSourceId(serverId) {
  return `${SERVER_SOURCE_PREFIX}${serverId}`;
}

/** Extrai o id do servidor de um id nosso, ou null. */
export function parseServerSourceId(id) {
  if (typeof id !== 'string' || !id.startsWith(SERVER_SOURCE_PREFIX)) return null;
  const rest = id.slice(SERVER_SOURCE_PREFIX.length);
  return rest || null;
}

/** pkg da extensão dona a partir do iconUrl da fonte, ou null. */
export function sourceOwnerPkg(iconUrl) {
  const match = String(iconUrl || '').match(/\/extension\/icon\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Fontes (cache) pertencentes a uma extensão (por pkg). */
export function getExtensionSources(pkg) {
  if (!pkg) return [];
  return getCachedServerSources().filter((s) => sourceOwnerPkg(s.iconUrl) === pkg);
}

/** Espelho de SourceDataClass → entrada do registry. */
export function fromSourceDataClass(s, config = null) {
  return {
    id: serverSourceId(String(s.id)),
    serverId: String(s.id),
    name: s.displayName || s.name,
    url: s.baseUrl || null,
    type: 'extension',
    iconUrl: serverIconUrl(s.iconUrl, config),
    lang: s.lang || 'en',
    enabled: true,
    supportsBrowse: true,
    supportsLatest: s.supportsLatest !== false,
    nsfw: s.isNsfw === true,
    unsupportedReason: null,
    via: 'server',
  };
}

function readCache() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SOURCES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.sources) ? parsed.sources : [];
  } catch {
    return [];
  }
}

function writeCache(sources) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SOURCES_CACHE_KEY, JSON.stringify({ ts: Date.now(), sources }));
  } catch {
    /* armazenamento cheio/bloqueado: segue sem cache */
  }
}

/** Leitura síncrona p/ o registry (cache; [] offline). */
export function getCachedServerSources() {
  return readCache();
}

/** Limpa o cache (logout, troca de servidor). */
export function clearServerSourcesCache() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SOURCES_CACHE_KEY);
  } catch {
    /* ignora */
  }
}

/**
 * Atualiza o cache a partir do servidor.
 * @returns {Promise<{updated: boolean, sources: Array, reason?: string}>}
 */
export async function refreshServerSources(configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  if (config.enabled === false) return { updated: false, sources: readCache(), reason: 'DISABLED' };
  const health = await checkHealth(config);
  if (!health.online) return { updated: false, sources: readCache(), reason: health.code };
  const list = await suwayomiGet('/source/list', { config });
  const sources = (Array.isArray(list) ? list : []).map((s) => fromSourceDataClass(s, config));
  writeCache(sources);
  notifySourcesChanged();
  return { updated: true, sources };
}
