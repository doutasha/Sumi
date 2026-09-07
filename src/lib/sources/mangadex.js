/**
 * MangaDex API Source
 * Public API — CORS-friendly, no key needed
 * Docs: https://api.mangadex.org/docs/
 */
import { isTauriRuntime } from '../../../desktop/frontend-integration/tauri-env.js';

const MANGADEX_API = 'https://api.mangadex.org';
const UPLOADS = 'https://uploads.mangadex.org';
const DEFAULT_CONTENT_RATING = ['safe', 'suggestive'];
const ORIGINAL_LANGUAGE_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'ja', label: 'Japonês' },
  { value: 'ko', label: 'Coreano' },
  { value: 'zh', label: 'Chinês' },
  { value: 'en', label: 'Inglês' },
  { value: 'pt-br', label: 'Português (BR)' },
  { value: 'es', label: 'Espanhol' },
  { value: 'fr', label: 'Francês' },
];

// Em dev usa o proxy do Vite (/mdx-api); em prod usa corsproxy.io para contornar CORS.
// No app desktop (Tauri) usa a URL direta: a API ja e CORS-friendly e o
// WebView do Tauri nao passa pelo proxy do Vite em producao.
function buildApiUrl(path, params = {}) {
  const apiUrl = new URL(`${MANGADEX_API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(item => apiUrl.searchParams.append(k, item));
    else apiUrl.searchParams.set(k, v);
  });

  if (isTauriRuntime()) {
    return apiUrl.toString();
  }
  if (import.meta.env.DEV) {
    return `/mdx-api${path}${apiUrl.search}`;
  }
  return `https://corsproxy.io/?url=${encodeURIComponent(apiUrl.toString())}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCoverUrl(manga, size = 256) {
  const rel = manga.relationships?.find(r => r.type === 'cover_art');
  if (!rel?.attributes?.fileName) return null;
  return `${UPLOADS}/covers/${manga.id}/${rel.attributes.fileName}.${size}.jpg`;
}

function getAuthor(manga) {
  const rel = manga.relationships?.find(r => r.type === 'author');
  return rel?.attributes?.name ?? null;
}

function parseManga(raw) {
  const attr = raw.attributes ?? {};
  return {
    id: raw.id,
    sourceId: 'mangadex',
    sourceName: 'MangaDex',
    title:
      attr.title?.en ??
      Object.values(attr.title ?? {})[0] ??
      'Unknown Title',
    description:
      attr.description?.en ??
      Object.values(attr.description ?? {})[0] ??
      '',
    coverUrl: getCoverUrl(raw),
    author: getAuthor(raw),
    status: attr.status ?? null,
    tags: (attr.tags ?? []).map(t => t.attributes?.name?.en).filter(Boolean),
    year: attr.year ?? null,
    contentRating: attr.contentRating ?? 'safe',
    originalLanguage: attr.originalLanguage ?? null,
  };
}

function parseChapter(raw) {
  const attr = raw.attributes ?? {};
  const groupRel = raw.relationships?.find(r => r.type === 'scanlation_group');
  return {
    id: raw.id,
    chapter: attr.chapter ?? null,
    title: attr.title ?? null,
    volume: attr.volume ?? null,
    language: attr.translatedLanguage,
    pages: attr.pages ?? 0,
    publishAt: attr.publishAt,
    group: groupRel?.attributes?.name ?? null,
    externalUrl: attr.externalUrl ?? null,
  };
}

// ── API calls ──────────────────────────────────────────────────────────────

function withMangaFilters(params, language, filters = {}) {
  const contentRating = Array.isArray(filters.contentRating) && filters.contentRating.length > 0
    ? filters.contentRating
    : DEFAULT_CONTENT_RATING;
  const next = {
    ...params,
    'contentRating[]': contentRating,
  };

  if (language) next['availableTranslatedLanguage[]'] = [language];
  if (filters.status && filters.status !== 'all') next['status[]'] = [filters.status];
  if (filters.originalLanguage && filters.originalLanguage !== 'all') {
    next['originalLanguage[]'] = [filters.originalLanguage];
  }

  return next;
}

const RETRY_DELAYS = [1000, 2500, 5000]; // ms between retries

async function fetchJson(path, params = {}) {
  const finalUrl = buildApiUrl(path, params);

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await fetch(finalUrl, {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      // Retry on 429 (rate limit) and 503 (Cloudflare / overload)
      if (res.status === 429 || res.status === 503) {
        const retryAfter = res.headers.get('Retry-After');
        const wait = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_DELAYS[attempt] ?? 5000;
        lastErr = new Error(`HTTP ${res.status} — aguardando ${Math.round(wait / 1000)}s`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.errors?.[0]?.detail ?? `HTTP ${res.status}`);
      }

      return res.json();
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        lastErr = new Error('Tempo de resposta esgotado. Verifique sua conexão.');
      } else if (lastErr && e.message === lastErr.message) {
        lastErr = e; // keep it
      } else {
        lastErr = e;
      }

      // Don't retry on non-transient errors
      if (!e.message?.startsWith('HTTP 5') && e.name !== 'AbortError' && !e.message?.startsWith('HTTP 429')) {
        throw lastErr;
      }
    }
  }

  throw lastErr ?? new Error('Falha ao conectar ao MangaDex. Tente novamente.');
}

// ── Source API ─────────────────────────────────────────────────────────────

export const MangaDexSource = {
  id: 'mangadex',
  name: 'MangaDex',
  url: 'https://mangadex.org',
  type: 'api',
  iconUrl: 'https://mangadex.org/favicon.ico',
  enabled: true,
  languages: ['en', 'pt-br', 'es', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'zh'],
  filters: [
    {
      key: 'status',
      label: 'Status',
      type: 'select',
      defaultValue: 'all',
      options: [
        { value: 'all', label: 'Todos' },
        { value: 'ongoing', label: 'Em andamento' },
        { value: 'completed', label: 'Completo' },
        { value: 'hiatus', label: 'Hiato' },
        { value: 'cancelled', label: 'Cancelado' },
      ],
    },
    {
      key: 'contentRating',
      label: 'Classificação',
      type: 'multi',
      defaultValue: DEFAULT_CONTENT_RATING,
      options: [
        { value: 'safe', label: 'Seguro' },
        { value: 'suggestive', label: 'Sugestivo' },
        { value: 'erotica', label: 'Erótico' },
        { value: 'pornographic', label: 'Pornográfico' },
      ],
    },
    {
      key: 'originalLanguage',
      label: 'Idioma original',
      type: 'select',
      defaultValue: 'all',
      options: ORIGINAL_LANGUAGE_OPTIONS,
    },
  ],

  /** Browse popular manga */
  async browse(page = 1, language = 'en', limit = 24, filters = {}) {
    const offset = (page - 1) * limit;
    const data = await fetchJson('/manga', withMangaFilters({
      limit,
      offset,
      'includes[]': ['cover_art', 'author'],
      'order[followedCount]': 'desc',
    }, language, filters));
    return {
      results: (data.data ?? []).map(parseManga),
      total: data.total ?? 0,
      page,
      hasMore: offset + limit < (data.total ?? 0),
    };
  },

  /** Browse recently updated manga */
  async getLatest(page = 1, language = 'en', limit = 24, filters = {}) {
    const offset = (page - 1) * limit;
    const data = await fetchJson('/manga', withMangaFilters({
      limit,
      offset,
      'includes[]': ['cover_art', 'author'],
      'order[updatedAt]': 'desc',
    }, language, filters));
    return {
      results: (data.data ?? []).map(parseManga),
      total: data.total ?? 0,
      page,
      hasMore: offset + limit < (data.total ?? 0),
    };
  },

  /** Browse top rated manga */
  async getTopRated(page = 1, language = 'en', limit = 24, filters = {}) {
    const offset = (page - 1) * limit;
    const data = await fetchJson('/manga', withMangaFilters({
      limit,
      offset,
      'includes[]': ['cover_art', 'author'],
      'order[rating]': 'desc',
    }, language, filters));
    return {
      results: (data.data ?? []).map(parseManga),
      total: data.total ?? 0,
      page,
      hasMore: offset + limit < (data.total ?? 0),
    };
  },

  /** Browse newly added manga */
  async getNew(page = 1, language = 'en', limit = 24, filters = {}) {
    const offset = (page - 1) * limit;
    const data = await fetchJson('/manga', withMangaFilters({
      limit,
      offset,
      'includes[]': ['cover_art', 'author'],
      'order[createdAt]': 'desc',
    }, language, filters));
    return {
      results: (data.data ?? []).map(parseManga),
      total: data.total ?? 0,
      page,
      hasMore: offset + limit < (data.total ?? 0),
    };
  },

  /** Search manga by title */
  async search(query, page = 1, language = 'en', limit = 24, filters = {}) {
    const offset = (page - 1) * limit;
    const data = await fetchJson('/manga', withMangaFilters({
      title: query,
      limit,
      offset,
      'includes[]': ['cover_art', 'author'],
    }, language, filters));
    return {
      results: (data.data ?? []).map(parseManga),
      total: data.total ?? 0,
      page,
      hasMore: offset + limit < (data.total ?? 0),
    };
  },

  /** Get full manga details */
  async getMangaDetails(mangaId) {
    const data = await fetchJson(`/manga/${mangaId}`, {
      'includes[]': ['cover_art', 'author', 'artist', 'tag'],
    });
    return parseManga(data.data);
  },

  /** Get chapter list (English by default) */
  async getChapters(mangaId, language = 'en') {
    const limit = 500;
    let offset = 0;
    let allChapters = [];

    while (true) {
      const data = await fetchJson(`/manga/${mangaId}/feed`, {
        'translatedLanguage[]': [language],
        'order[volume]': 'asc',
        'order[chapter]': 'asc',
        limit,
        offset,
        'includes[]': ['scanlation_group'],
        'contentRating[]': ['safe', 'suggestive', 'erotica'],
      });

      const chapters = (data.data ?? [])
        .map(parseChapter)
        .filter(c => !c.externalUrl); // skip external links

      allChapters = allChapters.concat(chapters);
      offset += limit;
      if (offset >= (data.total ?? 0)) break;
    }

    return allChapters;
  },

  /** Get page image URLs for a chapter */
  async getChapterPages(chapterId) {
    const data = await fetchJson(`/at-home/server/${chapterId}`);
    const { baseUrl, chapter } = data;
    if (!baseUrl || !chapter) throw new Error('Invalid chapter data from server.');

    return chapter.data.map(
      fname => `${baseUrl}/data/${chapter.hash}/${fname}`
    );
  },
};
