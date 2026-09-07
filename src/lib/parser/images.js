/**
 * images.js — URLs de imagem servidas pelo motor (espelho de
 * ThumbnailDownloadHelper + comportamento do pageRetrieve).
 *
 * O servidor proxea os bytes com os headers corretos: o app só monta a URL
 * absoluta e carrega direto (<img>, fetch, leitor). Sem proxy público,
 * sem Referer manual, sem hotlink.
 */

import { DEFAULT_BASE_URL } from './client.js';
import { getSuwayomiConfig } from './connection.js';

function serverBase(config) {
  return (config?.baseUrl || getSuwayomiConfig().baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
}

/** Resolve path do servidor (relativo ou absoluto) p/ URL absoluta. */
export function absoluteServerUrl(path, config = null) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${serverBase(config)}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Capa de um mangá: GET /manga/{id}/thumbnail (bytes). */
export function serverThumbnailUrl(serverMangaId, config = null) {
  if (serverMangaId === undefined || serverMangaId === null) return '';
  return `${serverBase(config)}/api/v1/manga/${serverMangaId}/thumbnail`;
}

/** Página de capítulo: GET /manga/{id}/chapter/{index}/page/{i} (bytes). */
export function serverPageUrl(serverMangaId, chapterIndex, pageIndex, config = null) {
  return `${serverBase(config)}/api/v1/manga/${serverMangaId}/chapter/${chapterIndex}/page/${pageIndex}`;
}

/** Ícone de extensão: GET /extension/icon/{pkg} ou path do source. */
export function serverIconUrl(iconPath, config = null) {
  return absoluteServerUrl(iconPath, config);
}
