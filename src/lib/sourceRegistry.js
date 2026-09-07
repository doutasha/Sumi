/**
 * Source Registry
 * Maps sourceId to source implementations.
 * Visible sources are MangaDex and installed Keiyoushi extensions.
 */

import { MangaDexSource } from './sources/mangadex.js';
import { getExtensionIconUrl, getInstalledExtensions } from './extensionManager.js';
import { createDynamicSource } from './sources/dynamicSource.js';

// ── Static built-in sources ───────────────────────────────────────────────

const BUILTIN_REGISTRY = {
  [MangaDexSource.id]: MangaDexSource,
};

const VISIBLE_BUILTINS = [MangaDexSource];

// ── Dynamic extension source cache ────────────────────────────────────────

const dynamicSourceCache = new Map();

function getDynamicSources() {
  const installed = getInstalledExtensions();
  const sources = {};

  for (const [extId, record] of Object.entries(installed)) {
    if (record.enabled === false || !record.config?.baseUrl) continue;

    const recordWithIcon = {
      ...record,
      iconUrl: record.iconUrl || getExtensionIconUrl(record),
    };

    // Use cached instance if available and same version
    if (dynamicSourceCache.has(extId) && dynamicSourceCache.get(extId)._updatedAt === record.updatedAt) {
      sources[extId] = dynamicSourceCache.get(extId);
    } else {
      const source = createDynamicSource(recordWithIcon);
      source._updatedAt = record.updatedAt;
      dynamicSourceCache.set(extId, source);
      sources[extId] = source;
    }
  }

  return sources;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Get the implementation for a given sourceId, or null */
export function getSourceImpl(sourceId) {
  // Check builtins first
  if (BUILTIN_REGISTRY[sourceId]) return BUILTIN_REGISTRY[sourceId];

  // Check dynamic extensions
  const dynamic = getDynamicSources();
  return dynamic[sourceId] ?? null;
}

/** User-visible built-in sources. */
export const BUILTIN_SOURCES = VISIBLE_BUILTINS.map(s => ({
  id: s.id,
  name: s.name,
  url: s.url,
  type: s.type,
  iconUrl: s.iconUrl ?? null,
  enabled: true,
}));

/** Get all available sources (builtins + installed extensions) */
export function getAllSources() {
  const builtins = BUILTIN_SOURCES;
  const dynamic = getDynamicSources();

  const extensionSources = Object.values(dynamic).map(s => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: 'extension',
    iconUrl: s.iconUrl ?? null,
    lang: s.lang ?? 'en',
    enabled: true,
    supportsBrowse: s.supportsBrowse !== false,
    unsupportedReason: s.unsupportedReason ?? null,
  }));

  return [...builtins, ...extensionSources];
}

/** Clear the dynamic source cache (call after install/uninstall/update) */
export function clearDynamicSourceCache() {
  dynamicSourceCache.clear();
}
