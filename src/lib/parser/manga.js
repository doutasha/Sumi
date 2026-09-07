/**
 * manga.js — leitura via motor (espelho de impl/MangaList.kt, Search.kt,
 * Manga.kt, Chapter.kt e Page.kt + dataclasses).
 *
 * Conversores `from*` traduzem os objetos do servidor p/ a interface de
 * source do Sumi; `createSuwayomiSource()` monta o impl plugável no registry.
 */

import { suwayomiGet } from './client.js';
import { getSuwayomiConfig } from './connection.js';
import { serverPageUrl, serverThumbnailUrl } from './images.js';
import { parseServerSourceId } from './sources.js';

export const MANGA_ID_PREFIX = 'suwayomi:';

/** Nosso id de mangá a partir do id (int) do servidor. */
export function serverMangaId(serverId) {
  return `${MANGA_ID_PREFIX}${serverId}`;
}

/** Extrai o id do servidor do nosso id de mangá, ou null. */
export function parseServerMangaId(id) {
  if (typeof id !== 'string' || !id.startsWith(MANGA_ID_PREFIX)) return null;
  const rest = id.slice(MANGA_ID_PREFIX.length).split(':')[0];
  return rest || null;
}

/** Extrai { mangaId, index } do nosso id de capítulo. */
export function parseServerChapterRef(id) {
  if (typeof id !== 'string' || !id.startsWith(MANGA_ID_PREFIX)) return null;
  const [, mangaId, index] = id.split(':');
  if (!mangaId || index === undefined) return null;
  return { mangaId, index: Number(index) };
}

/** MangaStatus do servidor → nosso status. */
export function mapMangaStatus(status) {
  if (!status) return null;
  const upper = String(status).toUpperCase();
  switch (upper) {
    case 'ONGOING':
    case 'PUBLISHING':
      return 'ongoing';
    case 'COMPLETED':
    case 'LICENSED':
    case 'PUBLISHING_FINISHED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'ON_HIATUS':
      return 'hiatus';
    default:
      return null;
  }
}

/** Espelho de MangaDataClass (item de lista) → resultado nosso. */
export function fromMangaListItem(m, { sourceId, sourceName }) {
  const serverId = m.id;
  return {
    id: serverMangaId(serverId),
    sourceId,
    sourceName,
    title: m.title || 'Unknown',
    coverUrl: serverThumbnailUrl(serverId),
    _mangaUrl: serverMangaId(serverId),
  };
}

/** Espelho de PagedMangaListDataClass → página nossa. */
export function fromPagedMangaList(paged, { sourceId, sourceName, page = 1, limit = 24 }) {
  const list = Array.isArray(paged?.mangaList) ? paged.mangaList : [];
  const results = list.map((m) => fromMangaListItem(m, { sourceId, sourceName }));
  const hasMore = paged?.hasNextPage === true;
  return {
    results,
    total: hasMore ? page * limit + 1 : (page - 1) * limit + results.length,
    page,
    hasMore,
  };
}

/** Espelho de MangaDataClass (full) → detalhes nossos. */
export function fromMangaDataClass(d, { sourceId, sourceName }) {
  const authors = [d.author, d.artist].filter(Boolean).join(', ');
  return {
    id: serverMangaId(d.id),
    sourceId,
    sourceName,
    title: d.title || 'Unknown',
    description: d.description || '',
    coverUrl: serverThumbnailUrl(d.id),
    author: authors,
    status: mapMangaStatus(d.status),
    tags: Array.isArray(d.genre) ? d.genre : [],
    _mangaUrl: serverMangaId(d.id),
  };
}

/** Espelho de ChapterDataClass → capítulo nosso (index 1-based do servidor). */
export function fromChapterDataClass(c, { sourceId, sourceName, serverMangaId: mangaId, lang }) {
  const index = Number(c.index);
  return {
    id: `${MANGA_ID_PREFIX}${mangaId}:${index}`,
    chapter: c.chapterNumber != null ? String(c.chapterNumber) : null,
    title: c.name || `Chapter ${index}`,
    volume: null,
    language: lang,
    pages: c.pageCount > 0 ? c.pageCount : 0,
    publishAt: c.uploadDate ? new Date(c.uploadDate).toISOString() : null,
    group: c.scanlator || null,
    sourceId,
    sourceName,
    _chapterUrl: `${MANGA_ID_PREFIX}${mangaId}:${index}`,
  };
}

/**
 * Monta o impl de source plugável no registry a partir de uma entrada
 * de `fromSourceDataClass`.
 */
export function createSuwayomiSource(serverEntry, config = null) {
  const cfg = () => config ?? getSuwayomiConfig();
  const id = serverEntry.id;
  const name = serverEntry.name;
  const lang = serverEntry.lang || 'en';
  const sid = serverEntry.serverId;

  async function listPaged(kind, page, limit) {
    const paged = await suwayomiGet(`/source/${sid}/${kind}/${page}`, { config: cfg() });
    return fromPagedMangaList(paged, { sourceId: id, sourceName: name, page, limit });
  }

  return {
    id,
    name,
    url: serverEntry.url,
    type: 'extension',
    iconUrl: serverEntry.iconUrl || null,
    lang,
    enabled: true,
    supportsBrowse: true,
    unsupportedReason: null,
    via: 'server',

    browse(page = 1, _language = lang, limit = 24) {
      return listPaged('popular', page, limit);
    },

    getLatest(page = 1, _language = lang, limit = 24) {
      return listPaged('latest', page, limit);
    },

    async search(query, page = 1, _language = lang, limit = 24) {
      const paged = await suwayomiGet(`/source/${sid}/search`, {
        config: cfg(),
        query: { searchTerm: query, pageNum: page },
      });
      return fromPagedMangaList(paged, { sourceId: id, sourceName: name, page, limit });
    },

    async getMangaDetails(mangaId) {
      const serverId = parseServerMangaId(mangaId);
      if (!serverId) throw new Error('ID de mangá inválido para o motor');
      const d = await suwayomiGet(`/manga/${serverId}/full`, { config: cfg() });
      return fromMangaDataClass(d, { sourceId: id, sourceName: name });
    },

    async getChapters(mangaId) {
      const serverId = parseServerMangaId(mangaId);
      if (!serverId) throw new Error('ID de mangá inválido para o motor');
      const list = await suwayomiGet(`/manga/${serverId}/chapters`, { config: cfg() });
      const chapters = Array.isArray(list) ? list : [];
      return chapters.map((c) =>
        fromChapterDataClass(c, { sourceId: id, sourceName: name, serverMangaId: serverId, lang }),
      );
    },

    async getChapterPages(chapterId) {
      const ref = parseServerChapterRef(chapterId);
      if (!ref) throw new Error('ID de capítulo inválido para o motor');
      // Aquece o capítulo no servidor (inicializa pageCount) antes de montar as URLs.
      const chapter = await suwayomiGet(`/manga/${ref.mangaId}/chapter/${ref.index}`, { config: cfg() });
      const count = Number(chapter?.pageCount) || 0;
      const urls = [];
      for (let i = 0; i < count; i++) {
        urls.push(serverPageUrl(ref.mangaId, ref.index, i, cfg()));
      }
      return urls;
    },
  };
}

/** Valida que um id de fonte pertence ao motor. */
export function isServerSourceId(sourceId) {
  return parseServerSourceId(sourceId) !== null;
}
