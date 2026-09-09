/**
 * Local storage for Sumi.
 * Manages visible sources, favorites, categories, and reader settings.
 */
import { BUILTIN_SOURCES } from './sourceRegistry.js';

const STORAGE_KEYS = {
  SOURCES: 'online_reader_sources',
  FAVORITES: 'online_reader_favorites',
  CATEGORIES: 'online_reader_categories',
  SETTINGS: 'online_reader_settings',
  PROGRESS: 'sumi_reader_progress',
  SOURCE_HEALTH: 'sumi_source_health',
  CHAPTER_SNAPSHOT: 'sumi_chapter_snapshot',
  CHAPTER_COUNTS: 'sumi_chapter_counts',
  CHAPTER_LISTS: 'sumi_chapter_lists',
  UPDATES_SCOPE: 'sumi.updates.scope',
  CHAPTER_UPDATES: 'sumi_chapter_updates',
};

const EXTENSION_STORAGE_KEYS = {
  INSTALLED: 'ext_installed'
};

const BACKUP_VERSION = 1;

/** Todas as chaves locais do Sumi (wipe total passa por aqui). */
export function clearAllLocalData() {
  const keys = [...Object.values(STORAGE_KEYS), ...Object.values(EXTENSION_STORAGE_KEYS)];
  let removed = 0;
  try {
    if (typeof localStorage === 'undefined') return 0;
    for (const key of keys) {
      localStorage.removeItem(key);
      removed += 1;
    }
  } catch {
    /* segue */
  }
  return removed;
}

function readJson(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getMangaStorageKey(manga) {
  if (!manga) return '';
  const id = manga._mangaUrl || manga.id || manga.url || manga.title;
  return `${manga.sourceId || 'unknown'}::${id || 'unknown'}`;
}

export function getChapterStorageKey(chapter) {
  if (!chapter) return '';
  return chapter._chapterUrl || chapter.id || chapter.url || chapter.chapter || chapter.title || 'unknown';
}

function snapshotManga(manga) {
  return {
    id: manga.id,
    sourceId: manga.sourceId,
    sourceName: manga.sourceName,
    title: manga.title,
    author: manga.author,
    artist: manga.artist,
    coverUrl: manga.coverUrl,
    status: manga.status,
    _mangaUrl: manga._mangaUrl,
  };
}

function readObject(key) {
  const value = readJson(key, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function assertArrayField(data, field) {
  if (!(field in data)) return null;
  if (!Array.isArray(data[field])) throw new Error(`Campo invalido no backup: ${field}`);
  return data[field];
}

function assertObjectField(data, field) {
  if (!(field in data)) return null;
  if (!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) {
    throw new Error(`Campo invalido no backup: ${field}`);
  }
  return data[field];
}

function backupPayload(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('Arquivo de backup invalido.');
  }

  if (backup.app === 'sumi-online-reader' && backup.data && typeof backup.data === 'object') {
    return backup.data;
  }

  const supportedFields = ['sources', 'favorites', 'categories', 'settings', 'progress', 'extensions', 'sourceHealth'];
  if (supportedFields.some(field => field in backup)) return backup;

  throw new Error('Este arquivo nao parece ser um backup do Sumi.');
}

function snapshotChapter(chapter) {
  return {
    id: chapter.id,
    title: chapter.title,
    chapter: chapter.chapter,
    volume: chapter.volume,
    group: chapter.group,
    pages: chapter.pages,
    publishAt: chapter.publishAt,
    date: chapter.date,
    _chapterUrl: chapter._chapterUrl,
  };
}

// === SOURCES ===
export function getSources() {
  try {
    const stored = readJson(STORAGE_KEYS.SOURCES, []);

    // Keep builtins first and drop legacy mirror entries from old localStorage.
    const builtinIds = new Set(BUILTIN_SOURCES.map(b => b.id));
    const customs = stored.filter(s => !builtinIds.has(s.id) && s.id !== 'mirror');
    const merged = BUILTIN_SOURCES.map(b => {
      const saved = stored.find(s => s.id === b.id);
      return saved ? { ...b, enabled: saved.enabled } : b;
    });
    return [...merged, ...customs];
  } catch {
    return BUILTIN_SOURCES;
  }
}

export function saveSources(sources) {
  return writeJson(STORAGE_KEYS.SOURCES, sources);
}

export function getDefaultSources() {
  return BUILTIN_SOURCES;
}

// === CATEGORIES ===
export function getCategories() {
  const data = readJson(STORAGE_KEYS.CATEGORIES, null);
  return Array.isArray(data) ? data : getDefaultCategories();
}

export function saveCategories(categories) {
  return writeJson(STORAGE_KEYS.CATEGORIES, categories);
}

export function getDefaultCategories() {
  return [
    { id: 'reading', name: 'Lendo', order: 0 },
    { id: 'completed', name: 'Completo', order: 1 },
    { id: 'plan-to-read', name: 'Planejado', order: 2 },
    { id: 'on-hold', name: 'Em pausa', order: 3 },
    { id: 'dropped', name: 'Dropado', order: 4 }
  ];
}

export function addCategory(name) {
  const categories = getCategories();
  const newCategory = {
    id: `category-${Date.now()}`,
    name,
    order: categories.length
  };
  categories.push(newCategory);
  saveCategories(categories);
  return newCategory;
}

export function deleteCategory(categoryId) {
  const categories = getCategories().filter(c => c.id !== categoryId);
  saveCategories(categories);
  
  // Remove category from all favorites
  const favorites = getFavorites();
  favorites.forEach(fav => {
    if (fav.categories) {
      fav.categories = fav.categories.filter(c => c !== categoryId);
    }
  });
  saveFavorites(favorites);
}

// === FAVORITES ===
export function getFavorites() {
  const data = readJson(STORAGE_KEYS.FAVORITES, null);
  return Array.isArray(data) ? data : [];
}

export function saveFavorites(favorites) {
  return writeJson(STORAGE_KEYS.FAVORITES, favorites);
}

export function addFavorite(manga, categories = []) {
  const favorites = getFavorites();
  const existing = favorites.find(f => f.id === manga.id && f.sourceId === manga.sourceId);
  
  if (existing) {
    return false; // Already exists
  }
  
  favorites.push({
    ...manga,
    categories,
    addedAt: Date.now()
  });
  
  saveFavorites(favorites);
  return true;
}

export function removeFavorite(mangaId, sourceId) {
  const favorites = getFavorites().filter(
    f => !(f.id === mangaId && f.sourceId === sourceId)
  );
  saveFavorites(favorites);
}

export function isFavorite(mangaId, sourceId) {
  const favorites = getFavorites();
  return favorites.some(f => f.id === mangaId && f.sourceId === sourceId);
}

export function updateFavoriteCategories(mangaId, sourceId, categories) {
  const favorites = getFavorites();
  const favorite = favorites.find(f => f.id === mangaId && f.sourceId === sourceId);
  
  if (favorite) {
    favorite.categories = categories;
    saveFavorites(favorites);
    return true;
  }
  
  return false;
}

// === SETTINGS ===
export function getOnlineSettings() {
  const data = readJson(STORAGE_KEYS.SETTINGS, null);
  return data && typeof data === 'object' ? data : getDefaultOnlineSettings();
}

export function saveOnlineSettings(settings) {
  return writeJson(STORAGE_KEYS.SETTINGS, settings);
}

export function getDefaultOnlineSettings() {
  return {
    readingMode: 'vertical', // 'vertical' | 'horizontal' | 'webtoon'
    imageQuality: 'high', // 'low' | 'medium' | 'high'
    autoMarkAsRead: true,
    showOnlyFavorites: false
  };
}

// === SNAPSHOT DE CAPÍTULOS (aba Atualizações) ===
// Mapa mangaKey -> array de ids de capítulo já vistos.
export function getChapterSnapshot() {
  const data = readJson(STORAGE_KEYS.CHAPTER_SNAPSHOT, null);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export function saveChapterSnapshot(map) {
  return writeJson(STORAGE_KEYS.CHAPTER_SNAPSHOT, map || {});
}

// === TOTAIS DE CAPÍTULOS (badge + ordenação) ===
// Preenchido ao abrir detalhes ou rodar Novidades; faltando = desconhecido.
export function getChapterCounts() {
  const data = readJson(STORAGE_KEYS.CHAPTER_COUNTS, null);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export function recordChapterCount(manga, total) {
  try {
    const key = getMangaStorageKey(manga);
    if (!key || !Number.isFinite(Number(total))) return false;
    const map = getChapterCounts();
    map[key] = { total: Number(total), at: Date.now() };
    return writeJson(STORAGE_KEYS.CHAPTER_COUNTS, map);
  } catch {
    return false;
  }
}

// === LISTAS DE CAPÍTULOS (cache Mihon-style) ===
// { [mangaKey]: { chapters: [...], fetchedAt } } — detalhe mostra na hora,
// atualiza em fundo quando online.
export function getCachedChapterList(manga) {
  try {
    const key = getMangaStorageKey(manga);
    if (!key) return null;
    const map = readJson(STORAGE_KEYS.CHAPTER_LISTS, null);
    const entry = map && typeof map === 'object' ? map[key] : null;
    return Array.isArray(entry?.chapters) ? entry : null;
  } catch {
    return null;
  }
}

export function saveCachedChapterList(manga, chapters) {
  try {
    const key = getMangaStorageKey(manga);
    if (!key || !Array.isArray(chapters)) return false;
    const map = readJson(STORAGE_KEYS.CHAPTER_LISTS, null);
    const next = map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    next[key] = { chapters, fetchedAt: Date.now() };
    return writeJson(STORAGE_KEYS.CHAPTER_LISTS, next);
  } catch {
    return false;
  }
}

// === FEED DE NOVIDADES (persiste até o usuário limpar) ===
// [{ mangaKey, manga: {id, sourceId, title, coverUrl, sourceName},
//    chapters: [{id, chapter, title}], foundAt }]
export function getUpdateFeed() {
  const data = readJson(STORAGE_KEYS.CHAPTER_UPDATES, null);
  return Array.isArray(data) ? data : [];
}

export function saveUpdateFeed(feed) {
  return writeJson(STORAGE_KEYS.CHAPTER_UPDATES, Array.isArray(feed) ? feed : []);
}

/** Mescla novidades (dedupe por capítulo). @returns feed atualizado */
export function appendUpdateFeed(items) {
  const feed = getUpdateFeed();
  const byManga = new Map(feed.map((e) => [e.mangaKey, e]));
  for (const item of items) {
    const prev = byManga.get(item.mangaKey);
    if (!prev) {
      byManga.set(item.mangaKey, item);
      continue;
    }
    const known = new Set(prev.chapters.map((c) => String(c.id)));
    for (const ch of item.chapters) {
      if (!known.has(String(ch.id))) {
        known.add(String(ch.id));
        prev.chapters.push(ch);
      }
    }
    prev.foundAt = Math.max(prev.foundAt || 0, item.foundAt || 0);
  }
  const next = [...byManga.values()];
  saveUpdateFeed(next);
  return next;
}

export function clearUpdateFeed() {
  return writeJson(STORAGE_KEYS.CHAPTER_UPDATES, []);
}

// === ESCOPO DA ABA NOVIDADES ===
export function getUpdatesScope() {
  const v = readJson(STORAGE_KEYS.UPDATES_SCOPE, null);
  return v && typeof v === 'object' ? v : { kind: 'all', id: null };
}

export function saveUpdatesScope(scope) {
  return writeJson(STORAGE_KEYS.UPDATES_SCOPE, scope && typeof scope === 'object' ? scope : { kind: 'all', id: null });
}

// === READING PROGRESS ===
export function getProgressStore() {
  const store = readJson(STORAGE_KEYS.PROGRESS, {});
  return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
}

export function saveProgressStore(store) {
  return writeJson(STORAGE_KEYS.PROGRESS, store);
}

export function getReadingProgress(manga) {
  const key = getMangaStorageKey(manga);
  if (!key) return null;
  return getProgressStore()[key] ?? null;
}

export function getChapterProgress(manga, chapter) {
  const mangaProgress = getReadingProgress(manga);
  const chapterKey = getChapterStorageKey(chapter);
  return mangaProgress?.readChapters?.[chapterKey] ?? (
    mangaProgress?.chapterKey === chapterKey ? mangaProgress : null
  );
}

export function isChapterRead(manga, chapter) {
  return !!getChapterProgress(manga, chapter)?.completed;
}

export function saveReadingProgress({ manga, chapter, pageIndex = 0, totalPages = 0, completed = false }) {
  if (!manga || !chapter) return null;

  const mangaKey = getMangaStorageKey(manga);
  const chapterKey = getChapterStorageKey(chapter);
  if (!mangaKey || !chapterKey) return null;

  const now = Date.now();
  const safeTotal = Math.max(0, Number(totalPages) || 0);
  const safePage = Math.max(0, Math.min(Number(pageIndex) || 0, Math.max(0, safeTotal - 1)));
  const isCompleted = completed || (safeTotal > 0 && safePage >= safeTotal - 1);
  const store = getProgressStore();
  const previous = store[mangaKey] ?? {};
  const readChapters = { ...(previous.readChapters ?? {}) };
  const chapterRecord = {
    ...(readChapters[chapterKey] ?? {}),
    chapterKey,
    chapter: snapshotChapter(chapter),
    pageIndex: safePage,
    totalPages: safeTotal,
    completed: isCompleted,
    updatedAt: now,
    completedAt: isCompleted ? (readChapters[chapterKey]?.completedAt ?? now) : null,
  };

  readChapters[chapterKey] = chapterRecord;

  const record = {
    ...previous,
    mangaKey,
    sourceId: manga.sourceId,
    mangaId: manga.id,
    manga: snapshotManga(manga),
    chapterKey,
    lastChapter: snapshotChapter(chapter),
    pageIndex: safePage,
    totalPages: safeTotal,
    completed: isCompleted,
    updatedAt: now,
    readChapters,
  };

  store[mangaKey] = record;
  saveProgressStore(store);
  return record;
}

function latestChapterRecord(readChapters) {
  return Object.values(readChapters ?? {})
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
}

export function setChapterReadStatus(manga, chapter, completed) {
  if (!manga || !chapter) return null;
  if (completed) {
    const totalPages = Number(chapter.pages) || getChapterProgress(manga, chapter)?.totalPages || 1;
    return saveReadingProgress({
      manga,
      chapter,
      pageIndex: Math.max(0, totalPages - 1),
      totalPages,
      completed: true,
    });
  }

  const mangaKey = getMangaStorageKey(manga);
  const chapterKey = getChapterStorageKey(chapter);
  if (!mangaKey || !chapterKey) return null;

  const store = getProgressStore();
  const previous = store[mangaKey];
  if (!previous?.readChapters?.[chapterKey]) return previous ?? null;

  const now = Date.now();
  const readChapters = { ...previous.readChapters };
  delete readChapters[chapterKey];

  const latest = latestChapterRecord(readChapters);
  if (!latest) {
    delete store[mangaKey];
    saveProgressStore(store);
    return null;
  }

  const record = {
    ...previous,
    chapterKey: latest.chapterKey,
    lastChapter: latest.chapter,
    pageIndex: latest.pageIndex ?? 0,
    totalPages: latest.totalPages ?? 0,
    completed: latest.completed ?? false,
    updatedAt: now,
    readChapters,
  };

  store[mangaKey] = record;
  saveProgressStore(store);
  return record;
}

export function setChaptersReadStatus(manga, chapters, completed) {
  let record = null;
  for (const chapter of chapters ?? []) {
    record = setChapterReadStatus(manga, chapter, completed);
  }
  return record;
}

export function getReadingHistory(limit = 100) {
  return Object.values(getProgressStore())
    .filter(record => record?.manga && record?.lastChapter)
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, limit);
}

export function clearReadingHistory() {
  return saveProgressStore({});
}

// === BACKUP ===
export function getBackupSummary() {
  const extensions = readObject(EXTENSION_STORAGE_KEYS.INSTALLED);

  return {
    sources: getSources().length,
    favorites: getFavorites().length,
    categories: getCategories().length,
    history: getReadingHistory(Number.POSITIVE_INFINITY).length,
    extensions: Object.keys(extensions).length,
  };
}

export function createSumiBackup() {
  const extensions = readObject(EXTENSION_STORAGE_KEYS.INSTALLED);
  const data = {
    sources: getSources(),
    favorites: getFavorites(),
    categories: getCategories(),
    settings: getOnlineSettings(),
    progress: getProgressStore(),
    extensions,
    sourceHealth: readObject(STORAGE_KEYS.SOURCE_HEALTH),
  };

  return {
    app: 'sumi-online-reader',
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    data,
    summary: getBackupSummary(),
  };
}

export function importSumiBackup(backup) {
  const data = backupPayload(backup);
  let imported = 0;

  const sources = assertArrayField(data, 'sources');
  if (sources) {
    writeJson(STORAGE_KEYS.SOURCES, sources);
    imported += 1;
  }

  const favorites = assertArrayField(data, 'favorites');
  if (favorites) {
    writeJson(STORAGE_KEYS.FAVORITES, favorites);
    imported += 1;
  }

  const categories = assertArrayField(data, 'categories');
  if (categories) {
    writeJson(STORAGE_KEYS.CATEGORIES, categories);
    imported += 1;
  }

  const settings = assertObjectField(data, 'settings');
  if (settings) {
    writeJson(STORAGE_KEYS.SETTINGS, settings);
    imported += 1;
  }

  const progress = assertObjectField(data, 'progress');
  if (progress) {
    writeJson(STORAGE_KEYS.PROGRESS, progress);
    imported += 1;
  }

  const extensions = assertObjectField(data, 'extensions');
  if (extensions) {
    writeJson(EXTENSION_STORAGE_KEYS.INSTALLED, extensions);
    imported += 1;
  }

  const sourceHealth = assertObjectField(data, 'sourceHealth');
  if (sourceHealth) {
    writeJson(STORAGE_KEYS.SOURCE_HEALTH, sourceHealth);
    imported += 1;
  }

  if (!imported) throw new Error('Nenhum dado compativel encontrado no backup.');
  return getBackupSummary();
}
