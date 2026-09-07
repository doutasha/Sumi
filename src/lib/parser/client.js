/**
 * client.js — único ponto de saída HTTP para o motor Suwayomi.
 *
 * Todo o tráfego Sumi <-> servidor local passa por aqui (ver doc/01-endpoints.md).
 * Nenhum outro módulo de parser/ faz fetch direto: timeout, retry, auth e
 * normalização de erro são centrais para não espalhar comportamento.
 *
 * Transporte: no Tauri usa o fetch nativo do Rust (sem CORS); no browser usa
 * o fetch da página (o servidor reflete a origem, ver doc/03-connection.md).
 * Zero dependências novas — só fetch + btoa (ambos nativos).
 */

import { isTauriRuntime, tauriFetch } from '../../../desktop/frontend-integration/tauri-env.js';

export const DEFAULT_BASE_URL = 'http://127.0.0.1:4567';
export const API_PREFIX = '/api/v1';

/** Erro normalizado de qualquer chamada ao servidor. */
export class SuwayomiError extends Error {
  /**
   * @param {string} message mensagem amigável
   * @param {object} info { status?: number, code?: string, url?: string }
   * codes: 'UNREACHABLE' | 'TIMEOUT' | 'HTTP' | 'BAD_RESPONSE'
   */
  constructor(message, { status = null, code = 'HTTP', url = null } = {}) {
    super(message);
    this.name = 'SuwayomiError';
    this.status = status;
    this.code = code;
    this.url = url;
  }
}

function authHeader(config) {
  if (config?.username) {
    return { Authorization: `Basic ${btoa(`${config.username}:${config.password ?? ''}`)}` };
  }
  return {};
}

function buildUrl(config, path, query, apiPrefix = API_PREFIX) {
  const base = (config?.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(apiPrefix + path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function doFetch(url, { method, headers, body, timeout, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    if (isTauriRuntime()) {
      return await tauriFetch(url, { method, headers, body, signal: controller.signal, timeout });
    }
    return await fetch(url, { method, headers, body, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}

function isRetryable(err) {
  if (err instanceof SuwayomiError) {
    if (err.code !== 'HTTP' || err.status == null) return true;
    return err.status >= 500 || err.status === 429;
  }
  return true;
}

/**
 * Chamada JSON ao servidor com timeout + retry.
 * @param {string} path ex. '/source/list' (sem o prefixo /api/v1)
 * @param {object} opts { config, method, query, body (objeto = JSON), timeout, retries, signal, apiPrefix }
 *   apiPrefix alternativo ex. '/api' p/ GraphQL (/api/graphql) — ver extensions.js.
 * @returns {Promise<any>} corpo JSON (ou null p/ resposta vazia)
 * @throws {SuwayomiError}
 */
export async function suwayomiRequest(path, opts = {}) {
  const {
    config = null,
    method = 'GET',
    query = null,
    body = null,
    timeout = 15000,
    retries = 1,
    signal = null,
    apiPrefix = API_PREFIX,
  } = opts;

  const url = buildUrl(config, path, query, apiPrefix);
  const headers = { Accept: 'application/json', ...authHeader(config) };
  let payload = null;
  if (body !== null && body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(url, { method, headers, body: payload, timeout, signal });
      if (!res.ok) {
        throw new SuwayomiError(`Servidor respondeu HTTP ${res.status}`, {
          status: res.status,
          code: 'HTTP',
          url,
        });
      }
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new SuwayomiError('Resposta inválida do servidor', { code: 'BAD_RESPONSE', url });
      }
    } catch (err) {
      if (err?.name === 'AbortError' || /timeout/i.test(err?.message ?? '')) {
        lastError = new SuwayomiError('Tempo esgotado falando com o servidor', { code: 'TIMEOUT', url });
      } else if (err instanceof SuwayomiError) {
        lastError = err;
      } else {
        lastError = new SuwayomiError('Não foi possível alcançar o servidor', { code: 'UNREACHABLE', url });
      }
      if (!isRetryable(lastError)) throw lastError;
    }
  }
  throw lastError;
}

/** Atalho GET. */
export function suwayomiGet(path, opts = {}) {
  return suwayomiRequest(path, { ...opts, method: 'GET' });
}
