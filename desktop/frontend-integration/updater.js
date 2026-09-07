/**
 * updater.js — verificação e instalação de atualizações (Tauri 2, Fase 5).
 *
 * Seguro de importar no navegador: fora do Tauri tudo vira no-op
 * (`isUpdaterAvailable()` false; `checkForUpdates()` devolve null).
 * No Windows o instalador reinicia o app sozinho após instalar.
 */

import { isTauriRuntime } from './tauri-env.js';

let updaterPromise = null;
let appPromise = null;

function loadUpdater() {
  if (!updaterPromise) {
    updaterPromise = import('@tauri-apps/plugin-updater');
  }
  return updaterPromise;
}

function loadApp() {
  if (!appPromise) {
    appPromise = import('@tauri-apps/api/app');
  }
  return appPromise;
}

/** true só dentro do app desktop. */
export function isUpdaterAvailable() {
  return isTauriRuntime();
}

/** Versão atual do app (ou null fora do desktop). */
export async function currentVersion() {
  if (!isUpdaterAvailable()) return null;
  try {
    const { getVersion } = await loadApp();
    return await getVersion();
  } catch {
    return null;
  }
}

/**
 * Verifica se há release nova no endpoint do updater.
 * @returns {Promise<null | {version: string, date?: string, body?: string}>}
 */
export async function checkForUpdates() {
  if (!isUpdaterAvailable()) return null;
  const { check } = await loadUpdater();
  const update = await check({ timeout: 20000 });
  if (!update) return null;
  return { version: update.version, date: update.date, body: update.body };
}

/**
 * Baixa + instala com progresso. No Windows o app reinicia sozinho.
 * @param {object} [opts] - { onProgress?: ({phase, received, total}) => void }
 *   phases: 'download' (received bytes) | 'install'.
 */
export async function installUpdate(opts = {}) {
  const { onProgress = null } = opts;
  if (!isUpdaterAvailable()) {
    throw new Error('Atualização indisponível fora do app desktop');
  }
  const { check } = await loadUpdater();
  const update = await check({ timeout: 20000 });
  if (!update) return { updated: false };
  let contentLength = 0;
  let downloaded = 0;
  const emit = (payload) => {
    try {
      onProgress?.(payload);
    } catch {
      /* observador não quebra a instalação */
    }
  };
  await update.downloadAndInstall(
    (event) => {
      if (event.event === 'Started') {
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
        emit({ phase: 'download', received: 0, total: contentLength });
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        emit({ phase: 'download', received: downloaded, total: contentLength });
      } else if (event.event === 'Finished') {
        emit({ phase: 'install', received: 1, total: 1 });
      }
    },
    { restartAfterInstall: true },
  );
  return { updated: true, version: update.version };
}
