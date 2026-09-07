/**
 * extensionManager.js
 * Manages the lifecycle of Keiyoushi-based extensions:
 * - Fetches the catalog from GitHub
 * - Installs / uninstalls / updates extensions
 * - Persists installed extensions + configs in localStorage
 * - Provides installed extensions to the source registry
 *
 * Everything runs 100% client-side in the browser.
 */

import { parseKotlinExtension, mergeWithDefaults } from './kotlinParser.js';

// ── Constants ─────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';
const GITHUB_RAW = 'https://raw.githubusercontent.com';
const REPO_OWNER = 'keiyoushi';
const REPO_NAME = 'extensions-source';
const BRANCH = 'main';
// index.min.json (formato v1) foi descontinuado pelo Keiyoushi e agora retorna
// apenas 2 stubs ("Outdated App" / "Update to Mihon 0.20.1+"). O catalogo real
// v2 esta em index.json (JSON) e index.pb (protobuf). O Sumi nao e o Mihon,
// entao ignora os stubs e le o index.json.
const REPO_INDEX_URL = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json';
const REPO_INDEX_FALLBACK_URL = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json';

const STORAGE_KEYS = {
  INSTALLED: 'ext_installed',       // { [extId]: ExtensionRecord }
  CATALOG_CACHE: 'ext_catalog',     // { timestamp, data: ExtensionCatalogEntry[] }
  CATALOG_SHA: 'ext_catalog_sha',   // last commit SHA used for catalog
};

const CATALOG_CACHE_VERSION = 3;
const CATALOG_TTL = 6 * 60 * 60 * 1000; // 6 hours cache

// Languages to scan (most popular)
const SCAN_LANGS = ['en', 'all', 'pt', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'tr', 'id', 'vi', 'th', 'pl'];

// ── Storage helpers ───────────────────────────────────────────────────────

function loadInstalled() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INSTALLED);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveInstalled(data) {
  localStorage.setItem(STORAGE_KEYS.INSTALLED, JSON.stringify(data));
}

function loadCatalogCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CATALOG_CACHE);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (cache.version !== CATALOG_CACHE_VERSION) return null;
    if (Date.now() - cache.timestamp > CATALOG_TTL) return null;
    return cache.data;
  } catch { return null; }
}

function saveCatalogCache(data) {
  localStorage.setItem(STORAGE_KEYS.CATALOG_CACHE, JSON.stringify({
    version: CATALOG_CACHE_VERSION,
    timestamp: Date.now(),
    data,
  }));
}

// ── GitHub API helpers ────────────────────────────────────────────────────

async function githubFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    if (res.status === 403) throw new Error('Limite da API do GitHub excedido. Tente novamente mais tarde.');
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch the list of extension directories for a given language.
 * Uses the Git Trees API to avoid per-directory requests.
 */
async function fetchExtensionList(lang) {
  try {
    const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/src/${lang}`;
    const data = await githubFetch(url);
    return data
      .filter(item => item.type === 'dir')
      .map(item => ({
        id: `keiyoushi-${lang}-${item.name}`,
        name: formatName(item.name),
        pkg: item.name,
        lang,
        path: `src/${lang}/${item.name}`,
        sha: item.sha,
      }));
  } catch {
    return [];
  }
}

function formatName(pkg) {
  // mangapill → MangaPill, mangakatana → MangaKatana
  return pkg.replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, c => c.toUpperCase())
    .replace(/manga/gi, 'Manga')
    .replace(/manhua/gi, 'Manhua')
    .replace(/manhwa/gi, 'Manhwa')
    .replace(/comic/gi, 'Comic')
    .replace(/scans/gi, 'Scans')
    .replace(/toon/gi, 'Toon');
}

function getRepoFolderName(entry) {
  const apkName = typeof entry.apk === 'string'
    ? entry.apk
    : typeof entry.apkUrl === 'string'
      ? entry.apkUrl.split('/').pop()
      : typeof entry.resources?.apkUrl === 'string'
        ? entry.resources.apkUrl.split('/').pop()
        : null;
  if (apkName) {
    const match = apkName.match(/^tachiyomi-[^.]+\.([^-]+)-v/i);
    if (match?.[1]) return match[1];
  }
  const packageName = entry.packageName || entry.pkg;
  if (typeof packageName === 'string' && packageName.includes('.')) {
    return packageName.split('.').pop();
  }
  return entry.pkg?.split('.').pop() ?? '';
}

function parsePackageName(packageName) {
  // eu.kanade.tachiyomi.extension.{lang}.{pkg}
  if (typeof packageName !== 'string') return {};
  const parts = packageName.split('.');
  const extIndex = parts.findIndex((part, i) =>
    part === 'extension' && parts[i - 1] === 'tachiyomi');
  if (extIndex < 0 || extIndex + 2 >= parts.length) return {};
  return {
    lang: parts[extIndex + 1],
    pkg: parts.slice(extIndex + 2).join('.'),
  };
}

function isStubEntry(entry) {
  const name = String(entry?.name ?? '').toLowerCase();
  if (/outdated(\s+app)?/.test(name)) return true;
  if (/update to mihon/.test(name)) return true;
  const pkg = String(entry?.packageName || entry?.pkg || '').toLowerCase();
  if (/(^|\.)(keiyoushi|mihon)$/.test(pkg)) return true;
  const apk = String(entry?.apk || entry?.apkUrl || entry?.resources?.apkUrl || '').toLowerCase();
  if (/tachiyomi-all\.(keiyoushi|mihon)-v/i.test(apk)) return true;
  return false;
}

function formatIndexName(entry, folderName) {
  return (entry.name || entry.sources?.[0]?.name || formatName(folderName))
    .replace(/^Tachiyomi:\s*/i, '')
    .trim();
}

function normalizeIndexEntry(entry) {
  if (!entry || typeof entry !== 'object' || isStubEntry(entry)) return null;

  // Formato v2 (index.json atual): { name, packageName, resources, versionCode,
  // versionName, contentWarning, sources: [{ language, homeUrl }] }
  if (entry.packageName || entry.resources || entry.versionCode !== undefined) {
    const parsed = parsePackageName(entry.packageName);
    const lang = entry.lang || parsed.lang;
    const folderName = getRepoFolderName(entry) || parsed.pkg;
    if (!lang || !folderName) return null;

    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    const firstSource = sources[0] ?? {};
    const baseUrl = firstSource.homeUrl || firstSource.baseUrl || entry.baseUrl || null;
    const iconUrl = entry.iconUrl || entry.resources?.iconUrl || null;
    const version = entry.versionName ?? entry.version ?? null;
    const code = entry.versionCode ?? entry.code ?? null;
    const apk = entry.apkUrl || entry.resources?.apkUrl || entry.apk || null;

    return {
      id: `keiyoushi-${lang}-${folderName}`,
      name: formatIndexName(entry, folderName),
      pkg: folderName,
      packageName: entry.packageName,
      lang,
      path: `src/${lang}/${folderName}`,
      sha: String(code ?? version ?? apk ?? ''),
      version,
      code,
      apk,
      apkUrl: typeof apk === 'string' && apk.startsWith('http') ? apk : null,
      iconUrl,
      nsfw: entry.contentWarning ? entry.contentWarning !== 'CONTENT_WARNING_SAFE' : Boolean(entry.nsfw),
      contentWarning: entry.contentWarning ?? null,
      sources,
      baseUrl,
    };
  }

  // Formato v1 legado (index.min.json antigo): { lang, pkg, apk, code, version, sources[].baseUrl }
  const folderName = getRepoFolderName(entry);
  if (!entry.lang || !folderName) return null;

  return {
    id: `keiyoushi-${entry.lang}-${folderName}`,
    name: formatIndexName(entry, folderName),
    pkg: folderName,
    packageName: entry.pkg,
    lang: entry.lang,
    path: `src/${entry.lang}/${folderName}`,
    sha: String(entry.code ?? entry.version ?? entry.apk ?? ''),
    version: entry.version,
    code: entry.code,
    apk: entry.apk,
    apkUrl: null,
    iconUrl: null,
    nsfw: Boolean(entry.nsfw),
    sources: entry.sources ?? [],
    baseUrl: entry.sources?.[0]?.baseUrl ?? entry.sources?.[0]?.homeUrl ?? null,
  };
}

function toKotlinClassName(value) {
  const cleaned = String(value || '')
    .replace(/^Tachiyomi:\s*/i, '')
    .replace(/[^a-zA-Z0-9]/g, '');
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : '';
}

function buildRawUrl(path) {
  return `${GITHUB_RAW}/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${path}`;
}

async function fetchRawText(path) {
  const res = await fetch(buildRawUrl(path));
  if (!res.ok) return null;
  return res.text();
}

async function rawFileExists(path) {
  const url = buildRawUrl(path);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return true;
    if (res.status !== 405) return false;
  } catch {
    // Some hosts/proxies are flaky with HEAD. Try GET below.
  }

  const res = await fetch(url);
  return res.ok;
}

function parseGradleValue(code, key) {
  const patterns = [
    new RegExp(`${key}\\s*=\\s*['"]([^'"]+)['"]`),
    new RegExp(`${key}\\.set\\(\\s*['"]([^'"]+)['"]\\s*\\)`),
  ];
  for (const pattern of patterns) {
    const match = code.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function buildKtPathsFromExtClass(ext, extClass) {
  const sourceRoot = `src/${ext.lang}/${ext.pkg}/src`;
  const defaultPackage = `eu/kanade/tachiyomi/extension/${ext.lang}/${ext.pkg}`;
  const paths = [];

  if (extClass.startsWith('.')) {
    const relativePath = extClass.replace(/\./g, '/');
    paths.push(`${sourceRoot}/${defaultPackage}${relativePath}.kt`);

    const segments = extClass.slice(1).split('.').filter(Boolean);
    if (segments.length === 1) {
      const className = segments[0];
      paths.push(`${sourceRoot}/eu/kanade/tachiyomi/extension/${ext.lang}/${className}/${className}.kt`);
    }
  } else if (extClass.includes('.')) {
    paths.push(`${sourceRoot}/${extClass.replace(/\./g, '/')}.kt`);
  } else {
    paths.push(`${sourceRoot}/${defaultPackage}/${extClass}.kt`);
    paths.push(`${sourceRoot}/eu/kanade/tachiyomi/extension/${ext.lang}/${extClass}/${extClass}.kt`);
  }

  return [...new Set(paths)];
}

async function fetchOfficialCatalog() {
  let lastError = null;

  for (const url of [REPO_INDEX_URL, REPO_INDEX_FALLBACK_URL]) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Keiyoushi catalog error: ${res.status}`);

      const data = await res.json();
      // v2: { extensionList: { extensions: [...] } } | v1 legado: [...]
      const rawList = Array.isArray(data)
        ? data
        : Array.isArray(data?.extensionList?.extensions)
          ? data.extensionList.extensions
          : Array.isArray(data?.extensions)
            ? data.extensions
            : null;
      if (!rawList) throw new Error('Keiyoushi catalog error: formato inesperado');

      const normalized = rawList.map(normalizeIndexEntry).filter(Boolean);
      // Se o endpoint retornou apenas stubs (caso do index.min.json atual),
      // tenta o proximo URL em vez de entregar um catalogo vazio.
      if (normalized.length === 0 && rawList.length > 0) continue;
      return normalized;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('Keiyoushi catalog error: catalogo vazio');
}

async function listKotlinFiles(path, depth = 0) {
  if (depth > 8) return [];

  try {
    const url = `${GITHUB_API}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    const entries = await githubFetch(url);
    const files = [];

    for (const entry of entries) {
      if (entry.type === 'file' && entry.name.endsWith('.kt')) {
        files.push({
          name: entry.name,
          path: entry.path,
          downloadUrl: entry.download_url,
        });
      } else if (entry.type === 'dir') {
        files.push(...await listKotlinFiles(entry.path, depth + 1));
      }
    }

    return files;
  } catch (error) {
    if (/rate limit|GitHub API/i.test(error.message)) throw error;
    return [];
  }
}

async function findGradleKtFile(ext) {
  const gradlePaths = [
    `src/${ext.lang}/${ext.pkg}/build.gradle`,
    `src/${ext.lang}/${ext.pkg}/build.gradle.kts`,
  ];

  for (const gradlePath of gradlePaths) {
    const gradleCode = await fetchRawText(gradlePath);
    if (!gradleCode) continue;

    const extClass = parseGradleValue(gradleCode, 'extClass');
    if (!extClass) continue;

    for (const path of buildKtPathsFromExtClass(ext, extClass)) {
      if (await rawFileExists(path)) {
        return {
          name: `${extClass.split('.').filter(Boolean).pop()}.kt`,
          path,
          downloadUrl: buildRawUrl(path),
          baseUrl: parseGradleValue(gradleCode, 'baseUrl'),
        };
      }
    }
  }

  return null;
}

async function findLikelyKtFile(ext) {
  const classNames = new Set([
    toKotlinClassName(ext.name),
    toKotlinClassName(ext.pkg),
    ...((ext.sources ?? []).map(source => toKotlinClassName(source.name))),
  ].filter(Boolean));

  for (const className of classNames) {
    const paths = [
      `src/${ext.lang}/${ext.pkg}/src/eu/kanade/tachiyomi/extension/${ext.lang}/${ext.pkg}/${className}.kt`,
      `src/${ext.lang}/${ext.pkg}/src/eu/kanade/tachiyomi/extension/${ext.lang}/${className}/${className}.kt`,
    ];

    for (const path of paths) {
      if (await rawFileExists(path)) {
        return {
          name: `${className}.kt`,
          path,
          downloadUrl: buildRawUrl(path),
        };
      }
    }
  }

  return null;
}

function scoreKtFile(file, ext) {
  const normalizedName = file.name.replace(/\.kt$/i, '').toLowerCase();
  const normalizedPkg = ext.pkg.toLowerCase().replace(/[^a-z0-9]/g, '');
  let score = 0;

  if (normalizedName === normalizedPkg) score += 100;
  if (normalizedName.includes(normalizedPkg) || normalizedPkg.includes(normalizedName)) score += 40;
  if (/source$/i.test(normalizedName)) score += 15;
  if (/(filter|filters|dto|model|models|data|interceptor|helper|util|utils)$/i.test(normalizedName)) score -= 100;
  if (/(filter|filters|dto|model|models|data|interceptor|helper|util|utils)/i.test(file.path)) score -= 30;

  return score;
}

/**
 * Find the main .kt file for an extension.
 * The package folder layout is not consistent across all Keiyoushi extensions,
 * so scan under src/{lang}/{pkg}/src instead of assuming the final package path.
 */
async function findMainKtFile(ext) {
  const gradleFile = await findGradleKtFile(ext);
  if (gradleFile) return gradleFile;

  const likelyFile = await findLikelyKtFile(ext);
  if (likelyFile) return likelyFile;

  const roots = [
    `src/${ext.lang}/${ext.pkg}/src`,
    `src/${ext.lang}/${ext.pkg}`,
  ];

  for (const root of roots) {
    const files = await listKotlinFiles(root);
    if (files.length === 0) continue;

    const sorted = files
      .map(file => ({ ...file, score: scoreKtFile(file, ext) }))
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    return sorted[0];
  }

  return null;
}

/**
 * Fetch and parse the Kotlin source code for an extension.
 */
async function fetchAndParseExtension(ext) {
  const ktFile = await findMainKtFile(ext);
  if (!ktFile) throw new Error(`Não foi possível encontrar o arquivo .kt de ${ext.name}`);

  const rawUrl = ktFile.downloadUrl || `${GITHUB_RAW}/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${ktFile.path}`;

  const res = await fetch(rawUrl);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Não foi possível baixar ${ktFile.name} do Keiyoushi (404). Atualize o catálogo; se persistir, a extensão pode ter sido movida ou removida no repositório.`);
    }
    throw new Error(`Não foi possível buscar ${ktFile.name}: ${res.status}`);
  }
  const kotlinCode = await res.text();

  // PARSE KOTLIN
  let config = parseKotlinExtension(kotlinCode, ext.name);
  config = mergeWithDefaults(config);
  if (!config.baseUrl && (ktFile.baseUrl || ext.baseUrl)) {
    config.baseUrl = ktFile.baseUrl || ext.baseUrl;
  }

  return {
    ...config,
    _ktFileName: ktFile.name,
    _ktPath: ktFile.path,
    _rawUrl: rawUrl,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Fetch the full catalog of available extensions.
 * Uses cache if available and not expired.
 * @param {boolean} forceRefresh - Skip cache
 * @returns {Promise<Array>} List of available extensions
 */
export async function fetchCatalog(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadCatalogCache();
    if (cached) return cached;
  }

  let allExtensions = [];

  try {
    allExtensions = await fetchOfficialCatalog();
  } catch {
    // Fallback for development/offline changes in extensions-source.
    const results = await Promise.allSettled(
      SCAN_LANGS.map(lang => fetchExtensionList(lang))
    );

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        allExtensions.push(...result.value);
      }
    });
  }

  // Sort alphabetically
  allExtensions.sort((a, b) => a.name.localeCompare(b.name));

  saveCatalogCache(allExtensions);
  return allExtensions;
}

/**
 * Install an extension: fetch its .kt, parse it, save config to localStorage.
 * @param {object} catalogEntry - Entry from fetchCatalog()
 * @returns {Promise<object>} The installed extension record
 */
export async function installExtension(catalogEntry) {
  const config = await fetchAndParseExtension(catalogEntry);
  if (!config.baseUrl) {
    throw new Error('This extension does not expose a base URL that can be parsed in the browser.');
  }

  const record = {
    id: catalogEntry.id,
    pkg: catalogEntry.pkg,
    name: config.name || catalogEntry.name,
    lang: catalogEntry.lang,
    baseUrl: config.baseUrl,
    iconUrl: catalogEntry.iconUrl || getExtensionIconUrl(catalogEntry),
    config,
    installedAt: Date.now(),
    updatedAt: Date.now(),
    sha: catalogEntry.sha,
    enabled: true,
  };

  const installed = loadInstalled();
  installed[record.id] = record;
  saveInstalled(installed);

  return record;
}

/**
 * Uninstall an extension.
 */
export function uninstallExtension(extId) {
  const installed = loadInstalled();
  delete installed[extId];
  saveInstalled(installed);
}

/**
 * Update an extension (re-fetch and re-parse).
 */
export async function updateExtension(extId, catalogEntryOverride = null) {
  const installed = loadInstalled();
  const record = installed[extId];
  if (!record) throw new Error('Extension not installed');

  const catalogEntry = catalogEntryOverride ?? {
    id: record.id,
    name: record.name,
    pkg: record.pkg,
    lang: record.lang,
    path: `src/${record.lang}/${record.pkg}`,
    sha: record.sha,
  };

  const config = await fetchAndParseExtension(catalogEntry);
  if (!config.baseUrl) {
    throw new Error('This extension does not expose a base URL that can be parsed in the browser.');
  }

  record.config = config;
  record.name = config.name || catalogEntry.name || record.name;
  record.baseUrl = config.baseUrl;
  record.iconUrl = catalogEntry.iconUrl || getExtensionIconUrl(catalogEntry) || record.iconUrl;
  record.updatedAt = Date.now();
  record.sha = catalogEntry.sha || record.sha;
  record.enabled = record.enabled !== false;

  installed[extId] = record;
  saveInstalled(installed);

  return record;
}

/**
 * Get all installed extensions.
 * @returns {object} Map of extId → record
 */
export function getInstalledExtensions() {
  return loadInstalled();
}

/**
 * Get a single installed extension by ID.
 */
export function getInstalledExtension(extId) {
  return loadInstalled()[extId] ?? null;
}

/**
 * Toggle extension enabled/disabled.
 */
export function toggleExtension(extId) {
  const installed = loadInstalled();
  if (installed[extId]) {
    installed[extId].enabled = installed[extId].enabled === false;
    saveInstalled(installed);
  }
}

/**
 * Check which installed extensions have updates available.
 * Compares stored SHA with catalog SHA.
 * @param {Array} catalog - Current catalog from fetchCatalog()
 * @returns {Array} List of extension IDs that have updates
 */
export function checkForUpdates(catalog) {
  const installed = loadInstalled();
  const updates = [];

  for (const [extId, record] of Object.entries(installed)) {
    const catalogEntry = catalog.find(c => c.id === extId);
    if (catalogEntry && catalogEntry.sha !== record.sha) {
      updates.push(extId);
    }
  }

  return updates;
}

/**
 * Get extension icon URL (from the res/ directory).
 * Prefere o iconUrl do catalogo v2 (jsdelivr) quando disponivel.
 */
export function getExtensionIconUrl(ext) {
  if (ext?.iconUrl) return ext.iconUrl;
  if (ext?.resources?.iconUrl) return ext.resources.iconUrl;
  return `${GITHUB_RAW}/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/src/${ext.lang}/${ext.pkg}/res/mipmap-xxxhdpi/ic_launcher.png`;
}

/**
 * Get all installed & enabled extensions as source-compatible objects.
 * These can be used by the source registry.
 */
export function getEnabledExtensionSources() {
  const installed = loadInstalled();
  return Object.values(installed)
    .filter(ext => ext.enabled !== false && ext.config?.baseUrl)
    .map(ext => ({
      id: ext.id,
      name: ext.name,
      url: ext.config.baseUrl,
      lang: ext.lang,
      type: 'extension',
      iconUrl: ext.iconUrl || getExtensionIconUrl(ext),
      enabled: true,
      config: ext.config,
    }));
}
