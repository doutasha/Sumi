/**
 * library.js — importa biblioteca do Mihon (`.tachibk`) para o motor (Fase 6).
 *
 * Pipeline por mangá favorito do backup:
 *   1. fonte do backup (int64) → fonte instalada no servidor (match exato);
 *   2. busca por título na fonte + match de URL → id do mangá no servidor;
 *   3. `updateMangas{inLibrary:true}` + categorias + `updateChapters{isRead…}`;
 *   4. relatório do que entrou / faltou fonte / não achou.
 *
 * Tudo idempotente: rodar 2x não duplica nem desmarca nada. URLs são a
 * chave estável (mesma extensão nos dois lados). Mutations provadas ao
 * vivo em v2.3.2243 antes de codar (ver doc/01-endpoints.md).
 */

import { suwayomiGet, suwayomiRequest } from './client.js';
import { getSuwayomiConfig } from './connection.js';
import { refreshServerSources } from './sources.js';

async function gql(query, variables, config, timeout = 60000) {
  const data = await suwayomiRequest('/graphql', {
    config,
    method: 'POST',
    apiPrefix: '/api',
    timeout,
    retries: 0,
    body: { query, variables },
  });
  if (data?.errors?.length) {
    throw new Error(data.errors[0]?.message || 'GraphQL falhou');
  }
  return data?.data;
}

const normUrl = (u) => String(u || '').replace(/\/$/, '');
const normTitle = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** slug da URL sem hash final (`/manga/x-abc123` → `/manga/x`). */
function slugBase(url) {
  const clean = normUrl(url).split('/').pop() || '';
  const parts = clean.split('-');
  if (parts.length > 2 && /^[0-9a-f]{6,}$/i.test(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join('-');
}

function matchManga(candidates, { title, url }) {
  const wantUrl = normUrl(url);
  const wantTitle = normTitle(title);
  const exact = candidates.find((m) => normUrl(m.url) === wantUrl);
  if (exact) return exact;
  const sameTitle = candidates.filter((m) => normTitle(m.title) === wantTitle);
  if (sameTitle.length === 1) return sameTitle[0];
  // Site trocou slugs (/manga/x → /manga/x-5abb513e): mesmo título + base igual.
  const wantSlug = slugBase(url);
  return (
    sameTitle.find((m) => slugBase(m.url) === wantSlug) ??
    candidates.find((m) => normUrl(m.url).startsWith(`${wantUrl}-`) && normTitle(m.title) === wantTitle) ??
    null
  );
}

/** Match de capítulo: número primeiro (URLs mudam de slug), URL exata depois. */
function matchChapter(serverChapters, backupChapter) {
  const wantUrl = normUrl(backupChapter.url);
  const exact = serverChapters.find((c) => normUrl(c.url) === wantUrl);
  if (exact) return [exact];
  const num = Number(backupChapter.chapterNumber);
  if (Number.isFinite(num)) {
    const byNum = serverChapters.filter((c) => Number(c.chapterNumber) === num);
    if (byNum.length) return byNum;
  }
  return [];
}

/**
 * Acha o id do mangá no servidor: SEARCH por título (até 3 págs) + match
 * exato de URL. @returns {Promise<number|null>}
 */
export async function findServerMangaId(sourceSid, title, url, config) {
  for (let page = 1; page <= 3; page++) {
    const data = await gql(
      `mutation FindManga($source: LongString!, $query: String!, $page: Int!) {
        fetchSourceManga(input: {source: $source, type: SEARCH, query: $query, page: $page}) {
          hasNextPage mangas { id url title }
        }
      }`,
      { source: String(sourceSid), query: title || '', page },
      config,
    );
    const payload = data?.fetchSourceManga;
    const hit = matchManga(payload?.mangas || [], { title, url });
    if (hit) return Number(hit.id);
    if (!payload?.hasNextPage) break;
  }
  return null;
}

/** Garante as categorias do backup no servidor. @returns Map<backupCatId, serverCatId> */
export async function ensureCategories(backupCategories, config) {
  const map = new Map();
  if (!backupCategories.length) return map;
  const existing = await suwayomiGet('/category', { config }).catch(() => []);
  const byName = new Map((Array.isArray(existing) ? existing : []).map((c) => [c.name, c.id]));
  let order = 1; // servidor exige order >= 1 (provado: 0 dá IllegalArgumentException)
  for (const cat of backupCategories) {
    if (!cat.name || map.has(cat.name)) continue;
    let id = byName.get(cat.name) ?? null;
    if (id == null) {
      const data = await gql(
        `mutation MkCat($name: String!, $order: Int) {
          createCategory(input: {name: $name, order: $order}) { category { id name } }
        }`,
        { name: cat.name, order: order++ },
        config,
      );
      id = data?.createCategory?.category?.id ?? null;
    }
    if (id != null) map.set(cat.name, Number(id));
  }
  return map;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * É da biblioteca? `favorite=true` manda; `favorite=false` explícito veta.
 * Sem o campo (Mihon novo não escreve field 100), `dateAdded > 0` decide —
 * provado em backup real de 725 títulos: 0 com field 100, todos com
 * dateAdded > 0 e chapters (backup puro de biblioteca).
 */
export function isLibraryEntry(entry) {
  if (!entry) return false;
  if (entry.favorite === true) return true;
  if (entry.favorite === false) return false;
  return (Number(entry.dateAdded) || 0) > 0;
}

/**
 * Importa o backup parseado (ver tachibk.js).
 * @param {object} parsed
 * @param {object} [opts] - { config?, onProgress?: ({done,total,current}) => void }
 * @returns {Promise<{total,favorites,imported,skippedNotFavorite,missingSource,notFound,chaptersMarked,errors}>}
 */
export async function importBackup(parsed, opts = {}) {
  const config = opts.config ?? getSuwayomiConfig();
  const onProgress = opts.onProgress ?? null;
  const manga = Array.isArray(parsed?.manga) ? parsed.manga : [];
  const report = {
    total: manga.length,
    favorites: 0,
    imported: 0,
    skippedNotFavorite: 0,
    missingSource: [],
    notFound: [],
    chaptersMarked: 0,
    errors: [],
  };

  const { sources } = await refreshServerSources(config);
  const bySid = new Map((sources || []).map((s) => [String(s.serverId), s]));
  const sourceNameOf = new Map((parsed?.sources || []).map((s) => [String(s.sourceId), s.name]));
  const catIdToName = new Map();
  const catKeyOf = (c) => [c.backendId, c.order].filter((v) => v != null).map(String);
  for (const entry of manga) {
    for (const cid of entry.categories || []) {
      // BackupManga.categories referencia BackupCategory por id (field 3)
      // ou por order (field 2) conforme a versão — aceita os dois.
      const cat = (parsed.categories || []).find((c) => catKeyOf(c).includes(String(cid)));
      if (cat) catIdToName.set(String(cid), cat.name);
    }
  }
  // Categorias do backup referenciadas por id (field 3) quando presente;
  // fallback: nome nunca vem no mangá, então sem id não há o que mapear.
  const catNames = [...new Set([...catIdToName.values()])].map((name, i) => ({ name, order: i }));
  const catMap = await ensureCategories(catNames, config).catch((err) => {
    report.errors.push(`categorias: ${err.message}`);
    return new Map();
  });

  const favs = manga.filter((m) => isLibraryEntry(m));
  report.favorites = favs.length;
  report.skippedNotFavorite = manga.length - favs.length;

  let done = 0;
  for (const entry of favs) {
    done += 1;
    try {
      onProgress?.({ done, total: favs.length, current: entry.title || entry.url });
    } catch {
      /* observador não quebra a importação */
    }
    try {
      const src = bySid.get(String(entry.source));
      if (!src) {
        report.missingSource.push({
          sourceId: String(entry.source),
          name: sourceNameOf.get(String(entry.source)) || null,
          title: entry.title || entry.url,
        });
        continue;
      }
      const mangaId = await findServerMangaId(src.serverId, entry.title, entry.url, config);
      if (!mangaId) {
        report.notFound.push({ title: entry.title || entry.url, source: src.name });
        continue;
      }
      await gql(
        `mutation ToLib($ids: [Int!]!, $inLibrary: Boolean) {
          updateMangas(input: {ids: $ids, patch: {inLibrary: $inLibrary}}) { clientMutationId }
        }`,
        { ids: [mangaId], inLibrary: true },
        config,
      );
      const wantedCats = (entry.categories || [])
        .map((cid) => catMap.get(catIdToName.get(String(cid))))
        .filter((id) => id != null);
      if (wantedCats.length) {
        await gql(
          `mutation SetCats($id: Int!, $cats: [Int!]!) {
            updateMangaCategories(input: {id: $id, patch: {addToCategories: $cats}}) { clientMutationId }
          }`,
          { id: mangaId, cats: wantedCats },
          config,
        ).catch((err) => report.errors.push(`${entry.title}: categorias: ${err.message}`));
      }
      const chapters = await suwayomiGet(`/manga/${mangaId}/chapters`, { config });
      const serverChapters = Array.isArray(chapters) ? chapters : [];
      const toMark = [];
      for (const ch of entry.chapters || []) {
        for (const hit of matchChapter(serverChapters, ch)) {
          const patch = {};
          if (ch.read) patch.isRead = true;
          if (ch.bookmark) patch.isBookmarked = true;
          if (Number(ch.lastPageRead) > 0) patch.lastPageRead = Number(ch.lastPageRead);
          if (Object.keys(patch).length) toMark.push({ id: hit.id, patch });
        }
      }
      // Agrupa por patch igual p/ economizar mutations.
      const groups = new Map();
      for (const t of toMark) {
        const key = JSON.stringify(t.patch);
        if (!groups.has(key)) groups.set(key, { patch: t.patch, ids: [] });
        groups.get(key).ids.push(t.id);
      }
      for (const { patch, ids } of groups.values()) {
        for (const batch of chunk(ids, 100)) {
          await gql(
            `mutation MarkCh($ids: [Int!]!, $patch: UpdateChapterPatchInput!) {
              updateChapters(input: {ids: $ids, patch: $patch}) { clientMutationId }
            }`,
            { ids: batch, patch },
            config,
          );
          report.chaptersMarked += batch.length;
        }
      }
      report.imported += 1;
    } catch (err) {
      report.errors.push(`${entry.title || entry.url}: ${err.message}`);
    }
  }
  return report;
}
