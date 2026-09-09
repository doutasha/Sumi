/**
 * extensionManager.js — fachada de extensões sobre o motor Suwayomi.
 *
 * Fase 4c: o fluxo antigo (baixar .kt do GitHub + parse estático) foi removido.
 * Instalar/atualizar/desinstalar = chamadas REST ao servidor, que baixa os APKs,
 * executa as extensões e expõe as fontes (ver src/lib/parser/).
 *
 * Mantidos os mesmos exports para a UI não quebrar. IDs agora são pkgName
 * (ex. eu.kanade.tachiyomi.extension.en.mangapill).
 */

import {
  getCachedExtensions,
  installServerExtension,
  refreshServerExtensions,
  setExtensionEnabled,
  uninstallServerExtension,
  updateServerExtension,
} from './parser/extensions.js';

function pkgOf(entryOrId) {
  if (typeof entryOrId === 'string') return entryOrId;
  return entryOrId?.pkg || entryOrId?.pkgName || entryOrId?.id || null;
}

function toMap(records) {
  const map = {};
  for (const record of records) {
    if (record?.id) map[record.id] = record;
  }
  return map;
}

/**
 * Catálogo = extensões do(s) repo(s) ainda NÃO instaladas.
 * @param {boolean} _forceRefresh - reservado (sempre busca do servidor)
 */
export async function fetchCatalog(_forceRefresh = false) {
  const res = await refreshServerExtensions();
  return res.extensions.filter((ext) => !ext.installed && !ext.obsolete);
}

/**
 * Instala via servidor (ele baixa o APK).
 * @param {object|string} catalogEntry - entrada do catálogo ou pkgName
 */
export async function installExtension(catalogEntry) {
  const pkg = pkgOf(catalogEntry);
  if (!pkg) throw new Error('Extensão inválida para instalar.');
  const record = await installServerExtension(pkg);
  if (!record) throw new Error('Instalação não confirmada pelo servidor.');
  return record;
}

/** Desinstala via servidor. */
export async function uninstallExtension(extId) {
  const pkg = pkgOf(extId);
  if (!pkg) throw new Error('Extensão inválida para desinstalar.');
  await uninstallServerExtension(pkg);
}

/** Atualiza via servidor. */
export async function updateExtension(extId, catalogEntryOverride = null) {
  const pkg = pkgOf(catalogEntryOverride ?? extId);
  if (!pkg) throw new Error('Extensão inválida para atualizar.');
  const record = await updateServerExtension(pkg);
  if (!record) throw new Error('Atualização não confirmada pelo servidor.');
  return record;
}

/** Instaladas (leitura síncrona do cache; atualize via refreshServerExtensions). */
export function getInstalledExtensions() {
  return toMap(getCachedExtensions().filter((ext) => ext.installed));
}

/** Uma instalada por id (pkgName), ou null. */
export function getInstalledExtension(extId) {
  return getInstalledExtensions()[extId] ?? null;
}

/** Liga/desliga local (filtro nosso; o servidor não tem enable/disable). */
export function toggleExtension(extId) {
  const pkg = pkgOf(extId);
  const currently = getInstalledExtension(pkg);
  const next = !(currently?.enabled !== false);
  setExtensionEnabled(pkg, next);
}

/** Ids com update pendente (leitura síncrona do cache). */
export function checkForUpdates(_catalog = null) {
  return getCachedExtensions()
    .filter((ext) => ext.installed && ext.hasUpdate)
    .map((ext) => ext.id);
}

/** Ícone (registros do servidor já trazem URL absoluta). */
export function getExtensionIconUrl(ext) {
  return ext?.iconUrl || null;
}

/** Instaladas + habilitadas, formato de fonte p/ o registry. */
export function getEnabledExtensionSources() {
  return getCachedExtensions()
    .filter((ext) => ext.installed && ext.enabled !== false)
    .map((ext) => ({
      id: ext.id,
      name: ext.name,
      url: null,
      lang: ext.lang,
      type: 'extension',
      iconUrl: ext.iconUrl || null,
      enabled: true,
      via: 'server',
    }));
}
