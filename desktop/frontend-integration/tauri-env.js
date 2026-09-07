/**
 * tauri-env.js
 * Ponte entre o frontend web e o app desktop (Tauri 2).
 *
 * Seguro de importar no navegador: fora do Tauri, `isTauriRuntime()`
 * retorna false e `@tauri-apps/plugin-http` nunca chega a ser carregado
 * (import dinamico, so executado dentro de `tauriFetch`).
 */

export function isTauriRuntime() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

let httpFetchPromise = null;

function loadHttpFetch() {
  if (!httpFetchPromise) {
    httpFetchPromise = import('@tauri-apps/plugin-http').then((mod) => mod.fetch);
  }
  return httpFetchPromise;
}

/**
 * GET/HEAD executado no Rust via plugin-http: sem CORS, com Referer e
 * User-Agent de navegador. Retorna um `Response` padrao.
 *
 * @param {string} url
 * @param {object} [opts] - { headers, referer, method, signal, timeout }
 */
export async function tauriFetch(url, opts = {}) {
  const { headers, referer, signal, timeout = 15_000, method = 'GET', ...rest } = opts;
  const fetchFn = await loadHttpFetch();

  const mergedHeaders = {
    Accept: 'text/html,application/xhtml+xml,application/json,*/*',
    ...(headers || {}),
  };
  if (referer && !mergedHeaders.Referer && !mergedHeaders.referer) {
    mergedHeaders.Referer = referer;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onOuterAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    // NÃO lançar em !ok aqui: o client.js traduz HTTP vs rede vs timeout.
    // (Lançar Error puro mascarava todo HTTP como UNREACHABLE — provado.)
    return await fetchFn(url, {
      ...rest,
      method,
      headers: mergedHeaders,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}
