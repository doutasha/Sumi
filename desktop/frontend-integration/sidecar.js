/**
 * sidecar.js — ponte do frontend com o sidecar Suwayomi (Tauri 2, fase 4d-2).
 *
 * Seguro de importar no navegador: fora do Tauri, `isSidecarAvailable()`
 * retorna false e `@tauri-apps/api/core` nunca é carregado (import dinâmico).
 * O backend Rust está em `desktop/src-tauri/src/server.rs`.
 *
 * Health + relançamento: `ensureServerOnline()` pergunta o status ao Rust,
 * dá `server_start` (idempotente) se parado e espera `checkHealth()` do
 * parser/ ficar online — reusa o único ponto HTTP (`client.js`).
 */

import { isTauriRuntime } from './tauri-env.js';

let corePromise = null;

function loadCore() {
  if (!corePromise) {
    corePromise = import('@tauri-apps/api/core');
  }
  return corePromise;
}

/** true só dentro do app desktop (no browser sempre false). */
export function isSidecarAvailable() {
  return isTauriRuntime();
}

async function invoke(cmd, args) {
  const { invoke } = await loadCore();
  return invoke(cmd, args);
}

/**
 * @returns {Promise<{running: boolean, needsDownload: boolean, info: object|null,
 *   dataDir: string, port: number, serverVersion: string}>}
 */
export function sidecarStatus() {
  return invoke('server_status');
}

/**
 * Sobe o motor oculto (idempotente: se já vivo, devolve o atual).
 * @param {object} [opts] - { port?: number, javaPath?: string, jarPath?: string,
 *   kcef?: boolean|null } (`kcef: null` = usa o marcador em disco.)
 *   (`javaPath`/`jarPath` são override de dev/prova; o padrão é o layout
 *   sob demanda dentro do data-dir fixo. Sem os arquivos, rejeita com
 *   `NEEDS_DOWNLOAD: ...`.)
 */
export function sidecarStart(opts = {}) {
  return invoke('server_start', {
    port: opts.port ?? null,
    javaPath: opts.javaPath ?? null,
    jarPath: opts.jarPath ?? null,
    kcef: opts.kcef ?? null,
  });
}

/**
 * Opt-in do WebView KCEF (Cloudflare): persiste o marcador em disco.
 * Exige restart do motor para valer (o chamador reinicia).
 * @param {boolean} enabled
 * @returns {Promise<{kcef: boolean}>}
 */
export function sidecarSetKcef(enabled) {
  return invoke('server_set_kcef', { enabled: Boolean(enabled) });
}

/** Para o motor (mata só o PID filho). @returns {Promise<boolean>} tinha vivo? */
export function sidecarStop() {
  return invoke('server_stop');
}

/**
 * Baixa JRE slim + JAR (~220MB) para o data-dir fixo, com progresso.
 * @param {object} [opts] - { force?: boolean, onProgress?: (ev) => void }
 *   `onProgress` recebe {phase: 'jar'|'jre'|'extract'|'done', received, total}.
 *   Sem `force` e com tudo presente, resolve `{cached: true, ...}` sem baixar.
 * @returns {Promise<object>} caminhos + tamanhos + `javaVersion`.
 */
export async function sidecarDownload(opts = {}) {
  const { force = false, onProgress = null } = opts;
  let unlisten = null;
  if (typeof onProgress === 'function') {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen('server-download', (event) => onProgress(event.payload));
  }
  try {
    return await invoke('server_download', { force: force ?? null });
  } finally {
    if (unlisten) unlisten();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Relançamento automático (4d-2 item 2): vigia silencioso do motor.
 * A cada `intervalMs` (padrão 30s; override de prova via
 * `VITE_SUMI_WATCH_MS`), se o modo servidor estiver ligado nas configs,
 * o health estiver offline, o filho não estiver subindo e os arquivos
 * existirem — dá `server_start` de novo (o java morre sozinho às vezes).
 * Servidor manual de outro dono na mesma porta responde ao health, então
 * o vigia nem encosta. Nunca faz download sozinho e nunca reclama na UI
 * (só `onEvent`).
 *
 * @param {object} opts - { checkHealth, getConfig, intervalMs?, onEvent? }
 * @returns {() => void} pare o vigia.
 */
export function watchServer(opts = {}) {
  const { checkHealth, getConfig, onEvent = null } = opts;
  const intervalMs = opts.intervalMs
    ?? (typeof import.meta !== 'undefined' && Number(import.meta.env?.VITE_SUMI_WATCH_MS))
    ?? 30_000;
  if (!isSidecarAvailable() || typeof checkHealth !== 'function' || typeof getConfig !== 'function') {
    return () => {};
  }
  let stopped = false;
  let busy = false;
  const emit = (ev) => { try { onEvent?.(ev); } catch { /* observador não quebra o vigia */ } };
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const cfg = getConfig();
      if (cfg?.enabled === false) return; // modo leve forçado: mãos quietas
      const health = await checkHealth(cfg).catch((err) => ({ online: false, message: err?.message }));
      if (health?.online) return;
      const st = await sidecarStatus().catch(() => null);
      if (!st || st.running || st.needsDownload) return; // subindo, ou sem arquivos
      await sidecarStart().catch(() => null);
      const back = await checkHealth(cfg).catch(() => ({ online: false }));
      emit({ type: 'relaunch', online: back?.online === true });
    } finally {
      busy = false;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}

/**
 * Garante o motor online: start (se preciso) + espera o health.
 * Falha com `NEEDS_DOWNLOAD` quando JRE/JAR ainda não foram baixados.
 *
 * @param {object} [opts] - { port?, javaPath?, jarPath?, timeoutMs? (padrão 60s),
 *   checkHealth?: fn } — `checkHealth` injetável para não puxar parser/ aqui.
 */
export async function ensureServerOnline(opts = {}) {
  const { port, javaPath, jarPath, timeoutMs = 60_000, checkHealth } = opts;
  if (!isSidecarAvailable()) {
    throw new Error('Sidecar indisponível fora do app desktop');
  }
  if (typeof checkHealth !== 'function') {
    throw new Error('ensureServerOnline exige checkHealth do parser/');
  }
  await sidecarStart({ port, javaPath, jarPath });
  const started = Date.now();
  let last = null;
  for (;;) {
    last = await checkHealth().catch((err) => ({ online: false, message: err?.message }));
    if (last?.online) return last;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Motor não ficou online em ${Math.round(timeoutMs / 1000)}s (${last?.code ?? last?.message ?? 'sem resposta'})`);
    }
    await sleep(1000);
  }
}
