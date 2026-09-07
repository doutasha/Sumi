/**
 * connection.js — configuração e saúde da conexão com o motor Suwayomi.
 *
 * O Sumi nunca assume que o servidor existe: todo uso passa por checkHealth()
 * e a UI alterna modo full (servidor) / leve (MangaDex + fallback) a partir daí.
 * Config persiste em localStorage sob chave própria (sem colidir com o resto).
 */

import { DEFAULT_BASE_URL, suwayomiGet } from './client.js';

export const CONFIG_KEY = 'sumi.suwayomi.config';

const DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,
  username: '',
  password: '',
  /** Se false, o Sumi nem tenta falar com o servidor (modo leve forçado). */
  enabled: true,
};

function readJson(key) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Config atual (defaults + salvo). */
export function getSuwayomiConfig() {
  return { ...DEFAULTS, ...(readJson(CONFIG_KEY) || {}) };
}

/** Salva parcial ou total da config. */
export function saveSuwayomiConfig(patch) {
  const next = { ...getSuwayomiConfig(), ...(patch || {}) };
  writeJson(CONFIG_KEY, next);
  return next;
}

/**
 * Health-check: GET /source/list como ping.
 * @param {object} [configOverride]
 * @returns {Promise<{online: true, latencyMs: number, sourceCount: number} |
 *                    {online: false, code: string, message: string}>}
 */
export async function checkHealth(configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  if (config.enabled === false) {
    return { online: false, code: 'DISABLED', message: 'Modo servidor desligado nas configurações' };
  }
  const started = Date.now();
  try {
    const list = await suwayomiGet('/source/list', { config, timeout: 8000, retries: 0 });
    return {
      online: true,
      latencyMs: Date.now() - started,
      sourceCount: Array.isArray(list) ? list.length : 0,
    };
  } catch (err) {
    return { online: false, code: err?.code ?? 'UNKNOWN', message: err?.message ?? String(err) };
  }
}
