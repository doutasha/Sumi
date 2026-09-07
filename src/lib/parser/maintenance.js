/**
 * maintenance.js — limpeza de cache e apagão de dados (Fase 6).
 *
 * Dois níveis, sem mistério:
 * - `clearCaches()`: seguro e reversível — limpa caches do frontend
 *   (tudo sob `sumi.*` que for cache) + thumbnails do servidor via
 *   `clearCachedImages`. Configs e biblioteca intactos.
 * - `wipeAllAppData()`: ZONA DE PERIGO — para o motor, apaga banco,
 *   downloads, backups, capas e settings do data-dir (mantém JRE+JAR),
 *   limpa TODO o `sumi.*` do navegador. A UI confirma 2x (sem popup
 *   nativo). O chamador reinicia do zero depois.
 */

import { suwayomiRequest } from './client.js';
import { getSuwayomiConfig } from './connection.js';
import { isTauriRuntime } from '../../../desktop/frontend-integration/tauri-env.js';

const SUMI_PREFIX = 'sumi.';

/** Chaves nossas que são cache (apagáveis sem perder conta/biblioteca). */
const CACHE_KEY_HINTS = ['cache', 'sources', 'extensions', 'thumbnails'];

function localKeys() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SUMI_PREFIX)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Limpa caches. @returns {Promise<{frontendKeys: number, serverImages: boolean}>}
 */
export async function clearCaches(configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  let frontendKeys = 0;
  for (const key of localKeys()) {
    const isCache = CACHE_KEY_HINTS.some((hint) => key.toLowerCase().includes(hint));
    if (!isCache) continue;
    try {
      localStorage.removeItem(key);
      frontendKeys += 1;
    } catch {
      /* segue */
    }
  }
  let serverImages = false;
  if (config.enabled !== false) {
    try {
      const data = await suwayomiRequest('/graphql', {
        config,
        method: 'POST',
        apiPrefix: '/api',
        timeout: 120000,
        retries: 0,
        body: { query: 'mutation { clearCachedImages(input: {}) { clientMutationId } }' },
      });
      serverImages = !data?.errors?.length;
    } catch {
      serverImages = false;
    }
  }
  return { frontendKeys, serverImages };
}

/** Mede (sem apagar) o apagão. @returns {Promise<{freedBytes: number}>} */
export async function wipePreview() {
  if (!isTauriRuntime()) return { freedBytes: 0, kept: [] };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('server_wipe_data', { preview: true });
}

/**
 * Apaga TUDO (motor parado + data-dir + sumi.* local). Chamar só após
 * confirmação dupla na UI.
 * @returns {Promise<{freedBytes: number, kept: Array<string>}>}
 */
export async function wipeAllAppData() {
  if (!isTauriRuntime()) {
    throw new Error('Apagão do motor só no app desktop');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  const res = await invoke('server_wipe_data', { preview: false });
  try {
    for (const key of localKeys()) localStorage.removeItem(key);
  } catch {
    /* segue */
  }
  return res;
}

export function formatBytes(bytes) {
  const v = Number(bytes) || 0;
  if (v < 1048576) return `${Math.max(1, Math.round(v / 1024))}KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(0)}MB`;
  return `${(v / 1073741824).toFixed(1)}GB`;
}
