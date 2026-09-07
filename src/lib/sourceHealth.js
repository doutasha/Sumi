import { getSourceImpl } from './sourceRegistry.js';

const STORAGE_KEY = 'sumi_source_health';
const CHECK_TIMEOUT = 20_000;
const IMAGE_TIMEOUT = 15_000;

export const SOURCE_HEALTH_STATUS = {
  COMPATIBLE: 'compatible',
  PARTIAL: 'partial',
  FAILING: 'failing',
  UNSUPPORTED: 'unsupported',
};

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function withTimeout(promise, label, timeout = CHECK_TIMEOUT) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} demorou demais para responder.`)), timeout);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function stepOk(extra = {}) {
  return { ok: true, ...extra };
}

function stepFail(error, extra = {}) {
  const message = error?.message || String(error || 'Falha desconhecida.');
  return { ok: false, error: message, ...extra };
}

function lookupMangaId(manga) {
  return manga?._mangaUrl || manga?.id || manga?.url || '';
}

function lookupChapterId(chapter) {
  return chapter?._chapterUrl || chapter?.id || chapter?.url || '';
}

function classify(steps) {
  if (steps.browse?.ok && steps.details?.ok && steps.chapters?.ok && steps.pages?.ok) {
    return SOURCE_HEALTH_STATUS.COMPATIBLE;
  }
  if (steps.browse?.ok || steps.details?.ok || steps.chapters?.ok || steps.pages?.ok) {
    return SOURCE_HEALTH_STATUS.PARTIAL;
  }
  if (steps.browse?.error === 'unsupported') return SOURCE_HEALTH_STATUS.UNSUPPORTED;
  return SOURCE_HEALTH_STATUS.FAILING;
}

function sourceLanguage(source, impl) {
  return source?.lang || impl?.lang || 'en';
}

async function loadMangaList(impl, source) {
  const lang = sourceLanguage(source, impl);
  let firstError = null;

  if (impl.browse) {
    try {
      const result = await withTimeout(impl.browse(1, lang, 6), 'Listagem');
      const results = Array.isArray(result?.results) ? result.results : [];
      if (results.length > 0) return { mode: 'browse', result, results };
    } catch (err) {
      firstError = err;
    }
  }

  if (impl.getLatest) {
    try {
      const result = await withTimeout(impl.getLatest(1, lang, 6), 'Recentes');
      const results = Array.isArray(result?.results) ? result.results : [];
      if (results.length > 0) return { mode: 'latest', result, results };
    } catch (err) {
      if (!firstError) firstError = err;
    }
  }

  if (firstError) throw firstError;
  return { mode: impl.browse ? 'browse' : 'latest', result: null, results: [] };
}

function testImageLoad(url) {
  if (!url || typeof Image === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    let done = false;
    const img = new Image();
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), IMAGE_TIMEOUT);

    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.decoding = 'async';
    img.src = url;
  });
}

function buildRecord(sourceId, sourceName, steps, sample = {}) {
  const status = classify(steps);
  return {
    sourceId,
    sourceName,
    status,
    checkedAt: Date.now(),
    steps,
    sample,
  };
}

export function getSourceHealthStore() {
  return readStore();
}

export function getSourceHealth(sourceId) {
  return readStore()[sourceId] ?? null;
}

export function saveSourceHealth(sourceId, record) {
  const store = readStore();
  store[sourceId] = record;
  writeStore(store);
  return record;
}

export async function checkSourceCompatibility(source) {
  const sourceId = source?.id;
  const sourceName = source?.name || sourceId || 'Fonte';
  const steps = {};
  const sample = {};

  if (!sourceId) {
    throw new Error('Fonte invalida.');
  }

  const impl = getSourceImpl(sourceId);
  if (!impl) {
    steps.browse = stepFail('unsupported');
    return saveSourceHealth(sourceId, buildRecord(sourceId, sourceName, steps, sample));
  }

  if (impl.supportsBrowse === false) {
    steps.browse = stepFail('unsupported', { reason: impl.unsupportedReason || 'Parser nao suportado.' });
    return saveSourceHealth(sourceId, buildRecord(sourceId, sourceName, steps, sample));
  }

  let manga = null;
  try {
    const list = await loadMangaList(impl, source);
    manga = list.results[0] ?? null;
    sample.mangaTitle = manga?.title || '';
    steps.browse = manga
      ? stepOk({ count: list.results.length, mode: list.mode })
      : stepFail('Nenhum manga encontrado na listagem.', { count: 0, mode: list.mode });
  } catch (err) {
    steps.browse = stepFail(err);
  }

  if (!manga) {
    return saveSourceHealth(sourceId, buildRecord(sourceId, sourceName, steps, sample));
  }

  let details = manga;
  try {
    const mangaId = lookupMangaId(manga);
    if (!impl.getMangaDetails || !mangaId) throw new Error('Detalhes nao suportados.');
    const loaded = await withTimeout(impl.getMangaDetails(mangaId), 'Detalhes');
    details = { ...manga, ...loaded };
    sample.mangaTitle = details.title || sample.mangaTitle;
    steps.details = stepOk({ title: details.title || manga.title || '' });
  } catch (err) {
    steps.details = stepFail(err);
  }

  let chapters = [];
  try {
    const mangaId = lookupMangaId(details) || lookupMangaId(manga);
    if (!impl.getChapters || !mangaId) throw new Error('Capitulos nao suportados.');
    const loaded = await withTimeout(
      impl.getChapters(mangaId, sourceLanguage(source, impl)),
      'Capitulos'
    );
    chapters = Array.isArray(loaded) ? loaded : [];
    sample.chapterTitle = chapters[0]?.title || chapters[0]?.chapter || '';
    steps.chapters = chapters.length > 0
      ? stepOk({ count: chapters.length })
      : stepFail('Nenhum capitulo encontrado.', { count: 0 });
  } catch (err) {
    steps.chapters = stepFail(err);
  }

  if (chapters.length === 0) {
    return saveSourceHealth(sourceId, buildRecord(sourceId, sourceName, steps, sample));
  }

  try {
    const chapterId = lookupChapterId(chapters[0]);
    if (!impl.getChapterPages || !chapterId) throw new Error('Leitura nao suportada.');
    const pages = await withTimeout(impl.getChapterPages(chapterId), 'Paginas');
    const pageList = Array.isArray(pages) ? pages : [];
    if (pageList.length === 0) throw new Error('Nenhuma pagina encontrada.');

    const firstImageOk = await testImageLoad(pageList[0]);
    if (!firstImageOk) throw new Error('A primeira imagem do capitulo nao carregou.');

    steps.pages = stepOk({ count: pageList.length });
  } catch (err) {
    steps.pages = stepFail(err);
  }

  return saveSourceHealth(sourceId, buildRecord(sourceId, sourceName, steps, sample));
}
