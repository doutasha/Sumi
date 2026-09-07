/**
 * extensions.js — gestão de extensões no motor (espelho de
 * impl/extension/ + ExtensionStoreService).
 *
 * O servidor baixa os APKs, instala, atualiza e lista. Aqui só traduzimos
 * ExtensionDataClass → registros nossos e guardamos cache + disabled-set
 * locais. Instalação é por pkgName (ex. eu.kanade.tachiyomi.extension.en.mangapill).
 */

import { suwayomiGet, suwayomiRequest } from './client.js';
import { getSuwayomiConfig } from './connection.js';
import { serverIconUrl } from './images.js';

export const EXTENSIONS_CACHE_KEY = 'sumi.suwayomi.extensions';
export const DISABLED_EXT_KEY = 'sumi.suwayomi.disabledExt';

/** Espelho de ExtensionDataClass → registro nosso (id = pkgName, único global). */
export function fromExtensionDataClass(e, config = null) {
  const pkg = e.pkgName;
  return {
    id: pkg,
    pkg,
    name: e.name || pkg,
    lang: e.lang || 'en',
    version: e.versionName || null,
    versionCode: e.versionCode ?? null,
    iconUrl: serverIconUrl(e.iconUrl, config),
    nsfw: e.isNsfw === true,
    installed: e.installed === true,
    hasUpdate: e.hasUpdate === true,
    obsolete: e.obsolete === true,
    repo: e.repo || null,
    apkName: e.apkName || null,
    enabled: true,
  };
}

function readCache() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(EXTENSIONS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed?.extensions) ? parsed.extensions : [];
  } catch {
    return [];
  }
}

function writeCache(extensions) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(EXTENSIONS_CACHE_KEY, JSON.stringify({ ts: Date.now(), extensions }));
  } catch {
    /* segue sem cache */
  }
}

export function getDisabledExtensionPkgs() {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(DISABLED_EXT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function applyDisabled(records) {
  const disabled = getDisabledExtensionPkgs();
  return records.map((r) => ({ ...r, enabled: !disabled.has(r.pkg) }));
}

/** Leitura síncrona (cache). */
export function getCachedExtensions() {
  return applyDisabled(readCache());
}

/**
 * Atualiza o cache a partir do servidor (GET /extension/list).
 * @returns {Promise<{updated: boolean, extensions: Array, reason?: string}>}
 */
export async function refreshServerExtensions(configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  if (config.enabled === false) return { updated: false, extensions: getCachedExtensions(), reason: 'DISABLED' };
  const list = await suwayomiGet('/extension/list', { config, timeout: 30000 });
  const extensions = (Array.isArray(list) ? list : []).map((e) => fromExtensionDataClass(e, config));
  writeCache(extensions);
  return { updated: true, extensions: applyDisabled(extensions) };
}

/** Liga/desliga local (o servidor não tem enable/disable; filtro é nosso). */
export function setExtensionEnabled(pkgName, enabled) {
  const disabled = getDisabledExtensionPkgs();
  if (enabled) disabled.delete(pkgName);
  else disabled.add(pkgName);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DISABLED_EXT_KEY, JSON.stringify([...disabled]));
    }
  } catch {
    /* ignora */
  }
  return enabled;
}

/** Instala pelo servidor (ele baixa o APK do repo). */
export async function installServerExtension(pkgName, configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  await suwayomiGet(`/extension/install/${encodeURIComponent(pkgName)}`, {
    config,
    timeout: 120000,
    retries: 0,
  });
  const res = await refreshServerExtensions(config);
  return res.extensions.find((e) => e.pkg === pkgName) ?? null;
}

/** Atualiza pelo servidor. */
export async function updateServerExtension(pkgName, configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  await suwayomiGet(`/extension/update/${encodeURIComponent(pkgName)}`, {
    config,
    timeout: 120000,
    retries: 0,
  });
  const res = await refreshServerExtensions(config);
  return res.extensions.find((e) => e.pkg === pkgName) ?? null;
}

/** Desinstala pelo servidor. */
export async function uninstallServerExtension(pkgName, configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  await suwayomiGet(`/extension/uninstall/${encodeURIComponent(pkgName)}`, { config, timeout: 30000 });
  await refreshServerExtensions(config);
}

/**
 * Adiciona repositório de extensões (espelho de ExtensionStoreMutation).
 * indexUrl ex. https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json
 */
export async function addExtensionRepo(indexUrl, configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  const data = await suwayomiRequest('/graphql', {
    config,
    method: 'POST',
    apiPrefix: '/api',
    timeout: 120000,
    retries: 0,
    body: {
      query:
        'mutation AddRepo($indexUrl: String!) { addExtensionStore(input: {indexUrl: $indexUrl}) { extensionStore { name indexUrl } } }',
      variables: { indexUrl },
    },
  });
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'Falha ao adicionar repositório');
  }
  await refreshServerExtensions(config);
  return data?.data?.addExtensionStore?.extensionStore ?? null;
}

/** Repo Keiyoushi padrão. */
export const KEIYOUSHI_INDEX_URL = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json';

/**
 * Lista repositórios de extensões (GraphQL extensionStores).
 * @returns {Promise<Array<{name: string, indexUrl: string}>>}
 */
export async function listRepos(configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  const data = await suwayomiRequest('/graphql', {
    config,
    method: 'POST',
    apiPrefix: '/api',
    timeout: 30000,
    retries: 0,
    body: { query: 'query { extensionStores(first: 100) { nodes { name indexUrl } totalCount } }' },
  });
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'Falha ao listar repositórios');
  }
  const nodes = data?.data?.extensionStores?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}

/** Remove repositório (espelho de ExtensionStoreMutation). */
export async function removeRepo(indexUrl, configOverride = null) {
  const config = configOverride ?? getSuwayomiConfig();
  const data = await suwayomiRequest('/graphql', {
    config,
    method: 'POST',
    apiPrefix: '/api',
    timeout: 60000,
    retries: 0,
    body: {
      query:
        'mutation RmRepo($indexUrl: String!) { removeExtensionStore(input: {indexUrl: $indexUrl}) { extensionStore { name indexUrl } } }',
      variables: { indexUrl },
    },
  });
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'Falha ao remover repositório');
  }
  await refreshServerExtensions(config);
  return data?.data?.removeExtensionStore?.extensionStore ?? null;
}
