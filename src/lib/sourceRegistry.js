/**
 * Source Registry
 * Maps sourceId to source implementations.
 * Visible sources: MangaDex builtin + server sources (Suwayomi).
 *
 * Fase 4c: o caminho dinâmico via .kt (createDynamicSource) foi removido.
 * Fontes de extensão vêm do motor; o refresh assíncrono é disparado pela UI.
 */

import { MangaDexSource } from './sources/mangadex.js';
import { getCachedServerSources } from './parser/sources.js';
import { createSuwayomiSource } from './parser/manga.js';
import { getDisabledExtensionPkgs } from './parser/extensions.js';

// ── Static built-in sources ───────────────────────────────────────────────

const BUILTIN_REGISTRY = {
  [MangaDexSource.id]: MangaDexSource,
};

const VISIBLE_BUILTINS = [MangaDexSource];

// ── Server (Suwayomi) source cache ────────────────────────────────────────
// Leitura síncrona do cache localStorage (ver parser/sources.js). O refresh
// assíncrono é disparado pela UI (ServerStatus); aqui só instanciamos impls.

const serverSourceCache = new Map();

/** pkg da extensão dona da fonte (extraído do iconUrl), ou null. */
function sourceOwnerPkg(entry) {
  const match = String(entry?.iconUrl || '').match(/\/extension\/icon\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getServerSources() {
  const disabled = getDisabledExtensionPkgs();
  const entries = getCachedServerSources();
  const sources = {};

  for (const entry of entries) {
    if (!entry?.id) continue;
    const owner = sourceOwnerPkg(entry);
    if (owner && disabled.has(owner)) continue;

    if (serverSourceCache.has(entry.id)) {
      sources[entry.id] = serverSourceCache.get(entry.id);
    } else {
      try {
        const source = createSuwayomiSource(entry);
        serverSourceCache.set(entry.id, source);
        sources[entry.id] = source;
      } catch {
        /* entrada inválida no cache: ignora */
      }
    }
  }

  // Drop impls de fontes que saíram do cache
  for (const id of [...serverSourceCache.keys()]) {
    if (!sources[id]) serverSourceCache.delete(id);
  }

  return sources;
}

// ── Public API ────────────────────────────────────────────────────────────

/** Get the implementation for a given sourceId, or null */
export function getSourceImpl(sourceId) {
  // Check builtins first
  if (BUILTIN_REGISTRY[sourceId]) return BUILTIN_REGISTRY[sourceId];

  // Check server sources (Suwayomi)
  const server = getServerSources();
  return server[sourceId] ?? null;
}

/** User-visible built-in sources. */
export const BUILTIN_SOURCES = VISIBLE_BUILTINS.map(s => ({
  id: s.id,
  name: s.name,
  url: s.url,
  type: s.type,
  iconUrl: s.iconUrl ?? null,
  enabled: true,
  native: s.id === MangaDexSource.id,
}));

/** Get all available sources (builtins + server) */
export function getAllSources() {
  const builtins = BUILTIN_SOURCES;
  const server = Object.values(getServerSources()).map(s => ({
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

  return [...builtins, ...server];
}

/** Clear the server source cache (call after refreshServerSources) */
export function clearServerSourceCache() {
  serverSourceCache.clear();
}
