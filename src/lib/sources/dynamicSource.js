/**
 * dynamicSource.js
 * Creates a working source implementation from a parsed Keiyoushi extension config.
 * This is the bridge between the Kotlin-parsed config and the source interface
 * expected by the rest of the app (browse, search, getMangaDetails, getChapters, getChapterPages).
 *
 * All scraping happens client-side via CORS proxies.
 */

import { fetchDocument, proxyFetch, proxyImageUrl, resolveUrl } from '../proxyFetch.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const MAX_PAGE_URLS = 250;
const BLOCKED_IMAGE_PARTS = [
  'avatar',
  'banner',
  'blank',
  'icon',
  'loading',
  'logo',
  'placeholder',
  'spinner',
  'transparent',
];
const IMAGE_HINT_PARTS = [
  '/chapter',
  '/comic',
  '/images',
  '/img',
  '/manga',
  '/page',
  '/reader',
  '/uploads',
  '/wp-content',
  '/wp-manga',
];

function uniqueUrls(urls) {
  return [...new Set(urls.filter(Boolean))];
}

function sameUrlIgnoringQuery(a, b) {
  try {
    const aa = new URL(a);
    const bb = new URL(b);
    return aa.origin === bb.origin && aa.pathname.replace(/\/$/, '') === bb.pathname.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function looksLikePageImageUrl(url, chapterUrl) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  if (chapterUrl && sameUrlIgnoringQuery(url, chapterUrl)) return false;

  const lower = url.toLowerCase();
  if (BLOCKED_IMAGE_PARTS.some(part => lower.includes(part))) return false;
  if (/\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(lower)) return true;
  return IMAGE_HINT_PARTS.some(part => lower.includes(part));
}

function toProxiedPageUrls(urls, chapterUrl) {
  return uniqueUrls(urls)
    .filter(url => looksLikePageImageUrl(url, chapterUrl))
    .slice(0, MAX_PAGE_URLS)
    .map(pageUrl => proxyImageUrl(pageUrl, chapterUrl));
}

function knownMirrorFallbacks(baseUrl) {
  const normalized = baseUrl?.replace(/\/$/, '');
  switch (normalized) {
    case 'https://www.mangakakalot.gg':
      return ['https://www.mangakakalove.com'];
    default:
      return [];
  }
}

function getRequestHeaders(config) {
  const headers = { ...(config.headers || {}) };

  // Aqua configs installed before header parsing need this compatibility.
  if (config.baseUrl?.includes('aquareader.org') && !headers['X-Requested-With']) {
    headers['X-Requested-With'] = 'org.chromium.chrome';
    headers['Accept-Language'] = headers['Accept-Language'] || 'en-US,en;q=0.5';
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function buildUrlFromPath(baseUrl, path, { page = 1, query = '' } = {}) {
  if (!path) return null;

  const encodedQuery = encodeURIComponent(query);
  const resolvedPath = path
    .replaceAll('{{PAGE}}', String(page))
    .replaceAll('{{QUERY}}', encodedQuery);

  try {
    return new URL(resolvedPath || '/', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return null;
  }
}

function buildSearchUrlFromPath(baseUrl, path, query, page) {
  const url = buildUrlFromPath(baseUrl, path, { page, query });
  if (!url) return null;

  try {
    const next = new URL(url);
    if (!path.includes('{{QUERY}}')) next.searchParams.set('q', query);
    if (!path.includes('{{PAGE}}')) next.searchParams.set('page', String(page));
    return next.toString();
  } catch {
    return url;
  }
}

function buildBrowseUrls(baseUrl, config, page) {
  if (config._popularPath) {
    return uniqueUrls([buildUrlFromPath(baseUrl, config._popularPath, { page })]);
  }

  const urls = [];

  switch (config.multisrc) {
    case 'mangathemesia':
      urls.push(`${baseUrl}/manga/?page=${page}&order=popular`);
      urls.push(`${baseUrl}/manga/page/${page}/`);
      break;
    case 'madara':
      urls.push(`${baseUrl}/manga/page/${page}/?m_orderby=trending`);
      urls.push(`${baseUrl}/manga/?m_orderby=trending&page=${page}`);
      break;
    case 'madtheme':
      urls.push(`${baseUrl}/ranking/week/${page}`);
      urls.push(`${baseUrl}/az-list/page/${page}`);
      break;
    case 'mangabox':
      urls.push(`${baseUrl}/manga-list/hot-manga?page=${page}`);
      break;
    case 'grouple':
      urls.push(`${baseUrl}/list?sortType=rate&offset=${50 * (page - 1)}`);
      break;
    case 'masonry':
      if (page === 1) urls.push(baseUrl);
      else if (page === 2) urls.push(`${baseUrl}/archive/`);
      else urls.push(`${baseUrl}/archive/page/${page - 1}/`);
      break;
    default:
      if (config.searchUrl) urls.push(`${config.searchUrl}?page=${page}`);
      urls.push(baseUrl);
      urls.push(`${baseUrl}/manga/?page=${page}`);
      urls.push(`${baseUrl}/manga/page/${page}/`);
      if (page > 1) urls.push(`${baseUrl}/page/${page}`);
      break;
  }

  return uniqueUrls(urls);
}

function buildLatestUrls(baseUrl, config, page) {
  if (config._latestPath) {
    return uniqueUrls([buildUrlFromPath(baseUrl, config._latestPath, { page })]);
  }

  const urls = [];

  switch (config.multisrc) {
    case 'mangathemesia':
      urls.push(`${baseUrl}/manga/?page=${page}&order=update`);
      break;
    case 'madara':
      urls.push(`${baseUrl}/manga/page/${page}/?m_orderby=latest`);
      urls.push(`${baseUrl}/manga/?m_orderby=latest&page=${page}`);
      break;
    case 'madtheme':
      urls.push(`${baseUrl}/latest/page/${page}`);
      break;
    case 'mangabox':
      urls.push(`${baseUrl}/manga-list/latest-manga?page=${page}`);
      break;
    case 'grouple':
      urls.push(`${baseUrl}/list?sortType=updated&offset=${50 * (page - 1)}`);
      break;
    case 'masonry':
      urls.push(`${baseUrl}/updates/sort/newest/mpage/${page}/`);
      break;
    default:
      urls.push(baseUrl);
      urls.push(`${baseUrl}/manga/?page=${page}&order=latest`);
      urls.push(`${baseUrl}/latest/page/${page}`);
      if (page > 1) urls.push(`${baseUrl}/page/${page}`);
      break;
  }

  return uniqueUrls(urls);
}

function buildSearchUrls(baseUrl, config, query, page) {
  const q = encodeURIComponent(query);
  const urls = [];

  if (config._searchPath) {
    return uniqueUrls([buildSearchUrlFromPath(baseUrl, config._searchPath, query, page)]);
  }

  switch (config.multisrc) {
    case 'mangathemesia':
      urls.push(`${baseUrl}/?s=${q}&page=${page}`);
      urls.push(`${baseUrl}/page/${page}/?s=${q}`);
      break;
    case 'madara':
      urls.push(`${baseUrl}/?s=${q}&post_type=wp-manga&paged=${page}`);
      urls.push(`${baseUrl}/page/${page}/?s=${q}&post_type=wp-manga`);
      break;
    case 'madtheme':
      urls.push(`${baseUrl}/search?q=${q}&page=${page}`);
      break;
    case 'mangabox':
      urls.push(`${baseUrl}/search/story/${q}?page=${page}`);
      break;
    case 'grouple':
      urls.push(`${baseUrl}/search/advancedResults?offset=${50 * (page - 1)}&q=${q}`);
      break;
    case 'masonry':
      urls.push(`${baseUrl}/search/post/${q}/mpage/${page}/`);
      break;
    default:
      if (config.searchUrl) {
        try {
          const u = new URL(config.searchUrl);
          u.searchParams.set('q', query);
          u.searchParams.set('page', String(page));
          urls.push(u.toString());
        } catch {
          urls.push(`${config.searchUrl}?q=${q}&page=${page}`);
        }
      }
      urls.push(`${baseUrl}/search?q=${q}&page=${page}`);
      urls.push(`${baseUrl}/search?keyword=${q}&page=${page}`);
      urls.push(`${baseUrl}/search?word=${q}&page=${page}`);
      urls.push(`${baseUrl}/?s=${q}&page=${page}`);
      break;
  }

  return uniqueUrls(urls);
}

function textOf(el) {
  return el?.textContent?.trim() ?? '';
}

function attrOf(el, attr) {
  if (!el) return '';
  if (attr === 'text') return textOf(el);
  // Handle abs: prefix (Kotlin convention)
  const cleanAttr = attr.replace(/^abs:/, '');
  const value = el.getAttribute(cleanAttr) || el.getAttribute(`data-${cleanAttr}`) || '';
  if (cleanAttr === 'srcset' && value) {
    return value.split(',')[0].trim().split(/\s+/)[0] || '';
  }
  return value;
}

function selectAll(doc, selector) {
  if (!selector) return [];
  try {
    // Handle Kotlin's :contains() pseudo-selector (not standard CSS)
    if (selector.includes(':contains(')) {
      return containsSelect(doc, selector);
    }
    return [...doc.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function selectFirst(doc, selector) {
  if (!selector) return null;
  try {
    if (selector.includes(':contains(')) {
      const results = containsSelect(doc, selector);
      return results[0] || null;
    }
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * Emulate Jsoup's :contains() pseudo-selector.
 * e.g. ".meta > p > strong:contains(Author) ~ a"
 */
function containsSelect(doc, selector) {
  const containsMatch = selector.match(/^(.*?)(\w+):contains\(([^)]+)\)(.*?)$/);
  if (!containsMatch) return [...doc.querySelectorAll(selector.replace(/:contains\([^)]+\)/g, ''))];

  const [, prefix, tag, text, suffix] = containsMatch;
  const baseSelector = prefix + tag;

  try {
    const candidates = [...doc.querySelectorAll(baseSelector.trim() || tag)];
    const matching = candidates.filter(el => el.textContent.includes(text));

    if (!suffix || !suffix.trim()) return matching;

    // Handle ~ (sibling) combinator
    const siblingMatch = suffix.trim().match(/^~\s*(.+)$/);
    if (siblingMatch) {
      const results = [];
      matching.forEach(el => {
        let sibling = el.nextElementSibling;
        while (sibling) {
          if (sibling.matches(siblingMatch[1].trim())) {
            results.push(sibling);
          }
          sibling = sibling.nextElementSibling;
        }
      });
      return results;
    }

    return matching;
  } catch {
    return [];
  }
}

/**
 * Parse a relative date string like "2 hours ago", "yesterday" etc.
 */
function parseRelativeDate(dateStr) {
  if (!dateStr) return null;
  const now = Date.now();
  const lower = dateStr.toLowerCase().trim();

  if (lower.includes('just now') || lower.includes('less than')) return new Date(now);
  if (lower.includes('yesterday')) return new Date(now - 86400000);

  const match = lower.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
  if (match) {
    const n = parseInt(match[1]);
    const unit = match[2];
    const ms = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
    return new Date(now - n * (ms[unit] || 0));
  }

  // Try standard date parse
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function isComixSource(config) {
  return config.baseUrl?.replace(/\/$/, '') === 'https://comix.to';
}

function normalizeComixStatus(status) {
  switch (status) {
    case 'releasing':
      return 'ongoing';
    case 'finished':
      return 'completed';
    case 'on_hiatus':
      return 'hiatus';
    case 'discontinued':
      return 'cancelled';
    default:
      return null;
  }
}

function comixMangaId(value) {
  if (!value) return '';
  try {
    const url = value.startsWith('http') ? new URL(value) : new URL(value, 'https://comix.to');
    const titlePart = url.pathname.split('/').filter(Boolean).find((part, index, parts) => parts[index - 1] === 'title');
    if (titlePart) return titlePart.split('-')[0];
  } catch { /* fall through */ }

  return value
    .replace(/^https?:\/\/(?:www\.)?comix\.to\/title\//, '')
    .replace(/^\/?title\//, '')
    .replace(/^\//, '')
    .split('-')[0];
}

function comixPosterUrl(manga) {
  return manga?.poster?.medium || manga?.poster?.large || '';
}

function comixMangaUrl(manga) {
  const path = manga?.url || `/title/${manga?.hid}`;
  return resolveUrl(path, 'https://comix.to');
}

function mapComixManga(manga, sourceId, sourceName) {
  const mangaUrl = comixMangaUrl(manga);
  const coverUrl = comixPosterUrl(manga);

  return {
    id: mangaUrl,
    sourceId,
    sourceName,
    title: manga.title || 'Unknown',
    coverUrl: coverUrl ? proxyImageUrl(coverUrl, mangaUrl) : '',
    status: normalizeComixStatus(manga.status),
    author: (manga.authors || manga.author || []).map(item => item.title).filter(Boolean).join(', '),
    _mangaUrl: mangaUrl,
  };
}

function mapComixDetails(manga, sourceId, sourceName) {
  const base = mapComixManga(manga, sourceId, sourceName);
  const tags = [
    manga.type,
    ...(manga.genres || []),
    ...(manga.demographics || []),
  ]
    .map(item => typeof item === 'string' ? item : item?.title)
    .filter(Boolean);

  return {
    ...base,
    description: manga.synopsis || '',
    tags: [...new Set(tags)],
    _mangaUrl: comixMangaUrl(manga),
  };
}

async function fetchComixJson(path, params = {}) {
  const url = new URL(path, 'https://comix.to/api/v1/');
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  });

  const res = await proxyFetch(url.toString(), {
    referer: 'https://comix.to/',
    headers: { Accept: 'application/json' },
  });
  return res.json();
}

function comixTotal(result, page, count) {
  const meta = result?.meta || result?.pagination;
  if (meta?.total) return meta.total;
  if (meta?.lastPage || meta?.last_page) return Math.max(0, Number(meta.lastPage || meta.last_page) * count);
  return ((page - 1) * count) + count;
}

function createComixSource(extRecord) {
  const config = extRecord.config;
  const id = extRecord.id;
  const name = extRecord.name || config.name || 'Comix';

  async function listManga(params, page) {
    const json = await fetchComixJson('manga', { limit: 28, page, ...params });
    const result = json.result || {};
    const items = result.items || [];
    return {
      results: items.map(item => mapComixManga(item, id, name)).filter(item => item.title !== 'Unknown'),
      total: comixTotal(result, page, items.length),
      page,
      hasMore: Boolean(result.meta?.hasNext || result.pagination?.hasNext),
    };
  }

  return {
    id,
    name,
    url: config.baseUrl,
    type: 'extension',
    iconUrl: extRecord.iconUrl || null,
    lang: config.lang,
    enabled: true,
    supportsBrowse: true,
    unsupportedReason: null,

    browse(page = 1) {
      return listManga({ 'order[score]': 'desc' }, page);
    },

    search(query, page = 1) {
      return listManga({ keyword: query, 'order[relevance]': 'desc' }, page);
    },

    getLatest(page = 1) {
      return listManga({ 'order[chapter_updated_at]': 'desc' }, page);
    },

    async getMangaDetails(mangaId) {
      const hid = comixMangaId(mangaId);
      const json = await fetchComixJson(`manga/${hid}`);
      return mapComixDetails(json.result || {}, id, name);
    },

    async getChapters() {
      throw new Error('Os capítulos da Comix usam um token protegido do site e ainda não são suportados.');
    },

    async getChapterPages() {
      throw new Error('As páginas da Comix usam um token protegido do site e ainda não são suportadas.');
    },

  };
}

// ── Dynamic Source Factory ────────────────────────────────────────────────

/**
 * Create a source implementation from a parsed extension config.
 * @param {object} extRecord - Installed extension record from extensionManager
 * @returns {object} Source object compatible with the app's source interface
 */
export function createDynamicSource(extRecord) {
  const config = extRecord.config;
  if (isComixSource(config)) return createComixSource(extRecord);

  const baseUrl = config.baseUrl;
  const baseUrls = uniqueUrls([
    baseUrl,
    ...(Array.isArray(config.mirrors) ? config.mirrors : []),
    ...knownMirrorFallbacks(baseUrl),
  ]);
  const id = extRecord.id;
  const name = extRecord.name || config.name;

  // Cache for details/chapters to avoid re-fetching
  const cache = new Map();
  const CACHE_TTL = 5 * 60 * 1000;

  function getCached(key) {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
    return null;
  }

  function setCache(key, data) {
    cache.set(key, { data, ts: Date.now() });
  }

  function fetchSourceDocument(url, refererBase = baseUrl) {
    return fetchDocument(url, {
      referer: config.referer || refererBase,
      headers: getRequestHeaders(config),
    });
  }

  return {
    id,
    name,
    url: baseUrl,
    type: 'extension',
    iconUrl: extRecord.iconUrl || null,
    lang: config.lang,
    enabled: true,
    supportsBrowse: !!config.searchMangaSelector,
    unsupportedReason: config.searchMangaSelector
      ? null
      : 'This extension uses a parser/API format that is not supported yet.',

    /**
     * Browse popular/latest manga from the source.
     */
    async browse(page = 1, _language = config.lang, limit = 24) {
      if (!config.searchMangaSelector) {
        return { results: [], total: 0, page, hasMore: false };
      }

      for (const currentBaseUrl of baseUrls) {
        for (const url of buildBrowseUrls(currentBaseUrl, config, page)) {
          try {
            const { doc } = await fetchSourceDocument(url, currentBaseUrl);
            const result = parseMangaList(doc, config, currentBaseUrl, id, page, limit);
            if (result.results.length > 0) return result;
          } catch (err) {
            console.warn(`[${name}] Browse attempt failed for ${url}:`, err.message);
          }
        }
      }

      return { results: [], total: 0, page, hasMore: false };
    },

    /**
     * Search manga by query.
     */
    async search(query, page = 1, _language = config.lang, limit = 24) {
      if (!config.searchMangaSelector) {
        return { results: [], total: 0, page, hasMore: false };
      }

      for (const currentBaseUrl of baseUrls) {
        for (const tryUrl of buildSearchUrls(currentBaseUrl, config, query, page)) {
          try {
            const { doc } = await fetchSourceDocument(tryUrl, currentBaseUrl);
            const result = parseMangaList(doc, config, currentBaseUrl, id, page, limit);
            if (result.results.length > 0) return result;
          } catch { /* try next */ }
        }
      }

      return { results: [], total: 0, page, hasMore: false };
    },

    /**
     * Get latest updates where the source has a common latest URL pattern.
     */
    async getLatest(page = 1, _language = config.lang, limit = 24) {
      if (!config.searchMangaSelector) {
        return { results: [], total: 0, page, hasMore: false };
      }

      for (const currentBaseUrl of baseUrls) {
        for (const url of buildLatestUrls(currentBaseUrl, config, page)) {
          try {
            const { doc } = await fetchSourceDocument(url, currentBaseUrl);
            const result = parseMangaList(doc, config, currentBaseUrl, id, page, limit);
            if (result.results.length > 0) return result;
          } catch { /* try next */ }
        }
      }

      return { results: [], total: 0, page, hasMore: false };
    },

    /**
     * Get manga details from a manga page URL.
     */
    async getMangaDetails(mangaId) {
      const cached = getCached(`details-${mangaId}`);
      if (cached) return cached;

      // mangaId can be a path like /manga/one-piece.21 or a full URL
      const url = mangaId.startsWith('http') ? mangaId : `${baseUrl}${mangaId}`;

      const { doc } = await fetchSourceDocument(url);
      const d = config.mangaDetails;

      const title = textOf(selectFirst(doc, d.titleSelector)) ||
                    textOf(doc.querySelector('h1')) ||
                    name;

      const author = d.authorSelector
        ? selectAll(doc, d.authorSelector).map(el => textOf(el)).filter(Boolean).join(', ')
        : '';

      const description = d.descriptionSelector
        ? selectAll(doc, d.descriptionSelector).map(el => textOf(el)).filter(Boolean).join('\n')
        : '';

      const genres = d.genreSelector
        ? selectAll(doc, d.genreSelector).map(el => textOf(el)).filter(Boolean)
        : [];

      const statusText = d.statusSelector
        ? textOf(selectFirst(doc, d.statusSelector))
        : '';

      let status = null;
      if (statusText) {
        const lower = statusText.toLowerCase();
        if (lower.includes('ongoing') || lower.includes('publishing')) status = 'ongoing';
        else if (lower.includes('completed') || lower.includes('finished')) status = 'completed';
        else if (lower.includes('hiatus') || lower.includes('on-hold')) status = 'hiatus';
        else if (lower.includes('cancelled') || lower.includes('canceled')) status = 'cancelled';
      }

      let coverUrl = '';
      if (d.thumbnailSelector) {
        const thumbEl = selectFirst(doc, d.thumbnailSelector);
        if (thumbEl) {
          coverUrl = attrOf(thumbEl, d.thumbnailAttr || 'src') ||
                     attrOf(thumbEl, 'src') ||
                     attrOf(thumbEl, 'data-src');
          coverUrl = resolveUrl(coverUrl, url);
        }
      }
      if (!coverUrl) {
        // Fallback: find any og:image meta
        const ogImage = doc.querySelector('meta[property="og:image"]');
        if (ogImage) coverUrl = resolveUrl(ogImage.getAttribute('content') || '', url);
      }

      const result = {
        id: mangaId,
        sourceId: id,
        sourceName: name,
        title,
        description,
        coverUrl: coverUrl ? proxyImageUrl(coverUrl, url) : '',
        author,
        status,
        tags: genres,
        _mangaUrl: url,
      };

      setCache(`details-${mangaId}`, result);
      return result;
    },

    /**
     * Get chapter list for a manga.
     */
    async getChapters(mangaId) {
      const cached = getCached(`chapters-${mangaId}`);
      if (cached) return cached;

      const url = mangaId.startsWith('http') ? mangaId : `${baseUrl}${mangaId}`;
      if (config._singleChapter) {
        return [{
          id: url,
          chapter: null,
          title: 'Gallery',
          volume: null,
          language: config.lang,
          pages: 0,
          publishAt: null,
          group: null,
          _chapterUrl: url,
        }];
      }

      const { doc } = await fetchSourceDocument(url);

      let chapters = [];
      const selector = config.chapterListSelector;
      const cf = config.chapterFromElement;

      if (selector) {
        const elements = selectAll(doc, selector);
        chapters = elements.map((el, idx) => {
          const linkEl = cf.urlSelector
            ? selectFirst(el, cf.urlSelector)
            : (el.matches?.('a[href]') ? el : el.querySelector('a'));
          const chapterUrl = linkEl ? (attrOf(linkEl, cf.urlAttr || 'href') || linkEl.getAttribute('href')) : '';
          const resolvedUrl = resolveUrl(chapterUrl, url);

          const chapterName = cf.nameSelector
            ? textOf(selectFirst(el, cf.nameSelector))
            : textOf(linkEl);

          const dateStr = cf.dateSelector
            ? textOf(selectFirst(el, cf.dateSelector))
            : '';
          const date = parseRelativeDate(dateStr);

          return {
            id: resolvedUrl || `ch-${idx}`,
            chapter: extractChapterNumber(chapterName),
            title: chapterName || `Chapter ${idx + 1}`,
            volume: null,
            language: config.lang,
            pages: 0,
            publishAt: date ? date.toISOString() : null,
            group: null,
            _chapterUrl: resolvedUrl,
          };
        }).filter(ch => ch._chapterUrl);
      }

      // Fallback: try to find chapter links via common patterns
      if (chapters.length === 0) {
        const links = [...doc.querySelectorAll('a[href*="chapter"], a[href*="/c"], a[href*="/ch"]')];
        const seen = new Set();
        chapters = links
          .map((a, idx) => {
            const href = resolveUrl(a.getAttribute('href'), url);
            if (seen.has(href) || !href) return null;
            seen.add(href);
            return {
              id: href,
              chapter: extractChapterNumber(textOf(a)),
              title: textOf(a) || `Chapter ${idx + 1}`,
              volume: null,
              language: config.lang,
              pages: 0,
              publishAt: null,
              group: null,
              _chapterUrl: href,
            };
          })
          .filter(Boolean);
      }

      // MadTheme: check for API-based chapter loading
      if (config._chapImagesPattern || config.multisrc === 'madtheme') {
        const scriptEl = [...doc.querySelectorAll('script')].find(s => s.textContent.includes('bookId'));
        if (scriptEl) {
          const bookIdMatch = scriptEl.textContent.match(/bookId\s*=\s*(\d+)/);
          const bookSlugMatch = scriptEl.textContent.match(/bookSlug\s*=\s*"([^"]+)"/);
          if (bookIdMatch) {
            try {
              const apiUrl = `${baseUrl}/api/manga/${bookIdMatch[1]}/chapters?source=detail`;
              const { doc: apiDoc } = await fetchSourceDocument(apiUrl);
              const apiChapters = selectAll(apiDoc, config.chapterListSelector || '#chapter-list > li');
              if (apiChapters.length > chapters.length) {
                chapters = apiChapters.map((el, idx) => {
                  const linkEl = selectFirst(el, 'a');
                  const chapterUrl = linkEl ? resolveUrl(linkEl.getAttribute('href'), baseUrl) : '';
                  return {
                    id: chapterUrl || `ch-${idx}`,
                    chapter: extractChapterNumber(textOf(selectFirst(el, '.chapter-title') || linkEl)),
                    title: textOf(selectFirst(el, '.chapter-title') || linkEl) || `Chapter ${idx + 1}`,
                    volume: null,
                    language: config.lang,
                    pages: 0,
                    publishAt: null,
                    group: null,
                    _chapterUrl: chapterUrl,
                  };
                }).filter(ch => ch._chapterUrl);
              }
            } catch { /* fallback to HTML chapters */ }
          }
        }
      }

      setCache(`chapters-${mangaId}`, chapters);
      return chapters;
    },

    /**
     * Get page image URLs for a chapter.
     */
    async getChapterPages(chapterId) {
      const url = chapterId.startsWith('http') ? chapterId : `${baseUrl}${chapterId}`;
      const { doc } = await fetchSourceDocument(url);
      const html = doc.documentElement.innerHTML;

      let pages = [];

      // Method 1: MadTheme chapImages JS variable
      if (config._chapImagesPattern || html.includes("var chapImages = '") || html.includes('var mainServer = "')) {
        pages = extractMadThemePages(html, url);
        const proxied = toProxiedPageUrls(pages, url);
        if (proxied.length > 0) return proxied;
      }

      // Method 2: MangaKatana-style JS array extraction
      if (config._jsImageExtraction || html.includes('data-src')) {
        const scripts = [...doc.querySelectorAll('script')];
        for (const script of scripts) {
          const text = script.textContent;
          if (text.includes("data-src") || text.includes("ytaw")) {
            // Extract array of image URLs from JS
            const arrayMatch = text.match(/var\s+\w+\s*=\s*\[([^\]]+)\]/);
            if (arrayMatch) {
              const urls = [...arrayMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
              if (urls.length > 0 && urls[0].startsWith('http')) {
                const proxied = toProxiedPageUrls(urls, url);
                if (proxied.length > 0) return proxied;
              }
            }
          }
        }
      }

      // Method 3: Standard selector-based extraction
      if (config.pageListSelector) {
        const imgEls = selectAll(doc, config.pageListSelector);
        pages = imgEls
          .map(el => {
            const src = attrOf(el, config.pageImageAttr || 'data-src') ||
                        attrOf(el, 'data-src') ||
                        attrOf(el, 'src') ||
                        attrOf(el, 'data-lazy-src');
            return src ? resolveUrl(src, url) : null;
          })
          .filter(Boolean);
      }

      // Method 4: Fallback — find all large images
      if (pages.length === 0) {
        const allImages = [...doc.querySelectorAll('img')];
        pages = allImages
          .map(img => {
            const src = img.getAttribute('data-src') || img.getAttribute('src') || img.getAttribute('data-lazy-src');
            return src ? resolveUrl(src, url) : null;
          })
          .filter(src => {
            if (!src) return false;
            // Filter out small icons, avatars, ads
            const lower = src.toLowerCase();
            return !lower.includes('avatar') &&
                   !lower.includes('icon') &&
                   !lower.includes('logo') &&
                   !lower.includes('banner') &&
                   !lower.includes('ads') &&
                   !lower.includes('loading') &&
                   (lower.includes('/chapter') || lower.includes('/manga') ||
                    lower.includes('/page') || lower.includes('/img') ||
                    lower.match(/\d+\.(jpg|png|webp)/));
          });
      }

      return toProxiedPageUrls(pages, url);
    },

  };
}

// ── Internal helpers ──────────────────────────────────────────────────────

function parseMangaList(doc, config, baseUrl, sourceId, page = 1, limit = 24) {
  const selector = config.searchMangaSelector;
  if (!selector) return { results: [], total: 0, page, hasMore: false };

  const elements = selectAll(doc, selector);
  const mf = config.mangaFromElement;

  const seen = new Set();
  const results = elements.map(el => {
    const linkEl = mf.urlSelector
      ? selectFirst(el, mf.urlSelector)
      : (el.matches?.('a[href]') ? el : el.querySelector('a'));
    const mangaUrl = linkEl ? (attrOf(linkEl, mf.urlAttr || 'href') || linkEl.getAttribute('href')) : '';
    const resolvedUrl = resolveUrl(mangaUrl, baseUrl);

    const title = mf.titleAttr
      ? attrOf(linkEl || el, mf.titleAttr)
      : textOf(mf.titleSelector ? selectFirst(el, mf.titleSelector) : linkEl);

    let coverUrl = '';
    const thumbEl = mf.thumbnailSelector ? selectFirst(el, mf.thumbnailSelector) : el.querySelector('img');
    if (thumbEl) {
      coverUrl = attrOf(thumbEl, mf.thumbnailAttr || 'data-src') ||
                 attrOf(thumbEl, 'src') ||
                 attrOf(thumbEl, 'data-src');
      coverUrl = resolveUrl(coverUrl, baseUrl);
    }

    if (!resolvedUrl || seen.has(resolvedUrl)) return null;
    seen.add(resolvedUrl);

    return {
      id: resolvedUrl || mangaUrl,
      sourceId,
      sourceName: config.name,
      title: title || 'Unknown',
      coverUrl: coverUrl ? proxyImageUrl(coverUrl) : '',
      _mangaUrl: resolvedUrl,
    };
  }).filter(m => m?.title && m.title !== 'Unknown' && m._mangaUrl);

  // Check for next page
  const nextSel = config.searchMangaNextPageSelector;
  const hasMore = nextSel ? !!selectFirst(doc, nextSel) : false;

  return {
    results,
    total: hasMore ? (page * limit) + 1 : ((page - 1) * limit) + results.length,
    page,
    hasMore,
  };
}

function extractMadThemePages(html, baseUrl) {
  const pages = [];

  // Try mainServer + chapImages pattern
  const mainServerMatch = html.match(/var\s+mainServer\s*=\s*"([^"]+)"/);
  const chapImagesMatch = html.match(/var\s+chapImages\s*=\s*'([^']+)'/);

  if (chapImagesMatch) {
    const images = chapImagesMatch[1].split(',').filter(Boolean);

    if (mainServerMatch) {
      let server = mainServerMatch[1];
      if (server.startsWith('//')) server = 'https:' + server;
      return images.map(path => server + path);
    }

    // If images are full URLs
    if (images[0]?.startsWith('http')) {
      return images;
    }
  }

  return pages;
}

function extractChapterNumber(text) {
  if (!text) return null;
  const match = text.match(/(?:chapter|ch\.?|cap\.?|ep\.?)\s*(\d+(?:\.\d+)?)/i);
  if (match) return match[1];
  const numMatch = text.match(/(\d+(?:\.\d+)?)/);
  return numMatch ? numMatch[1] : null;
}
