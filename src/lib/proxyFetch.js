/**
 * proxyFetch.js
 * CORS proxy wrapper for fetching external HTML/images.
 * Uses the local Vite proxy in development, then public proxies in static builds.
 * Inside the Tauri desktop app (see desktop/) downloads run natively in Rust,
 * with no CORS and no public proxy needed.
 */
import { isTauriRuntime, tauriFetch } from '../../desktop/frontend-integration/tauri-env.js';

const PUBLIC_CORS_PROXIES = [
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

function isLocalHost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
}

function buildLocalProxyUrl(url, opts = {}) {
  const params = new URLSearchParams({ url });
  if (opts.referer) params.set('referer', opts.referer);
  return `/cors-proxy?${params.toString()}`;
}

function getProxyBuilders() {
  return isLocalHost() ? [buildLocalProxyUrl] : PUBLIC_CORS_PROXIES;
}

/**
 * Fetch a URL through a CORS proxy, with automatic fallback.
 * @param {string} url - The target URL to fetch
 * @param {object} [opts] - Extra fetch options. Use opts.referer for the upstream Referer header.
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, opts = {}) {
  // No desktop o Rust baixa direto (sem CORS, com Referer/UA de navegador).
  // Se falhar, cai para a cadeia de proxies abaixo como fallback.
  if (isTauriRuntime()) {
    try {
      return await tauriFetch(url, opts);
    } catch {
      // segue para os proxies publicos
    }
  }

  let lastError;
  const { referer, timeout = 15_000, headers, ...fetchOpts } = opts;

  for (const buildProxy of getProxyBuilders()) {
    const proxyUrl = buildProxy(url, { referer });
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(proxyUrl, {
        ...fetchOpts,
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*',
          ...headers,
        },
      });

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from proxy`);
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  throw lastError ?? new Error('All CORS proxies failed');
}

/**
 * Fetch HTML and parse it into a DOM Document.
 * @param {string} url
 * @param {object} [opts]
 * @returns {Promise<{doc: Document, baseUrl: string}>}
 */
export async function fetchDocument(url, opts = {}) {
  const res = await proxyFetch(url, opts);
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Set base URL for resolving relative links
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  return { doc, baseUrl: url };
}

/**
 * Build a proxied image URL (for hotlink-protected images).
 * @param {string} imageUrl
 * @param {string} [referer]
 * @returns {string}
 */
export function proxyImageUrl(imageUrl, referer) {
  if (!imageUrl) return '';
  // If already proxied, return as-is
  if (imageUrl.includes('/cors-proxy?') || imageUrl.includes('corsproxy.io') || imageUrl.includes('allorigins.win')) {
    return imageUrl;
  }
  if (isLocalHost()) return buildLocalProxyUrl(imageUrl, { referer });
  return `https://corsproxy.io/?url=${encodeURIComponent(imageUrl)}`;
}

/**
 * Resolve a potentially relative URL against a base URL.
 * @param {string} href
 * @param {string} baseUrl
 * @returns {string}
 */
export function resolveUrl(href, baseUrl) {
  if (!href) return '';
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}
