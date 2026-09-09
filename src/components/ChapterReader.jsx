import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getSourceImpl } from '../lib/sourceRegistry.js';
import { saveReadingProgress } from '../lib/onlineStorage.js';
import { t } from '../lib/i18n.js';

const CHAPTER_LOAD_TIMEOUT = 30_000;
const MAX_READER_PAGES = 250;
const CHAPTER_PAGE_CACHE_LIMIT = 2;
const chapterPageCache = new Map();
const chapterPageRequests = new Map();
let activeChapterPageCacheWindow = { currentKey: '', nextKey: '' };

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizePageUrls(urls) {
  return [...new Set((urls ?? []).filter(Boolean))]
    .filter(url => typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('blob:'))
    .slice(0, MAX_READER_PAGES);
}

function getPageRenderKey(url, index) {
  return `${index}:${url || ''}`;
}

function getChapterPageCacheKey(manga, chapter) {
  const sourceId = manga?.sourceId || 'unknown-source';
  const chapterId = chapter?.id || chapter?._chapterUrl || chapter?.url || chapter?.chapter || chapter?.title;
  return chapterId ? `${sourceId}:${chapterId}` : '';
}

function hasCachedChapterPages(cacheKey) {
  return !!cacheKey && chapterPageCache.has(cacheKey);
}

function getActiveChapterPageCacheKeys() {
  return [
    activeChapterPageCacheWindow.currentKey,
    activeChapterPageCacheWindow.nextKey,
  ].filter(Boolean);
}

function trimChapterPageCache(keepKeys = []) {
  const keep = new Set(keepKeys.filter(Boolean));
  while (chapterPageCache.size > CHAPTER_PAGE_CACHE_LIMIT) {
    const disposableKey = [...chapterPageCache.keys()].find(key => !keep.has(key));
    chapterPageCache.delete(disposableKey || chapterPageCache.keys().next().value);
  }
}

function pruneChapterPageCache(keepKeys) {
  const keep = new Set(keepKeys.filter(Boolean));
  for (const key of chapterPageCache.keys()) {
    if (!keep.has(key)) chapterPageCache.delete(key);
  }

  trimChapterPageCache(keepKeys);
}

function setActiveChapterPageCacheWindow(currentKey, nextKey) {
  activeChapterPageCacheWindow = { currentKey, nextKey };
  pruneChapterPageCache(getActiveChapterPageCacheKeys());
}

function getCachedChapterPages(cacheKey) {
  if (!cacheKey) return null;
  const entry = chapterPageCache.get(cacheKey);
  if (!entry) return null;

  chapterPageCache.delete(cacheKey);
  chapterPageCache.set(cacheKey, entry);
  return entry.pages;
}

function setCachedChapterPages(cacheKey, pages) {
  if (!cacheKey || !pages?.length) return;

  chapterPageCache.delete(cacheKey);
  chapterPageCache.set(cacheKey, { pages, cachedAt: Date.now() });

  const activeKeys = getActiveChapterPageCacheKeys();
  if (activeKeys.length) pruneChapterPageCache(activeKeys);
  else trimChapterPageCache();
}

async function fetchChapterPages(manga, chapter) {
  const cacheKey = getChapterPageCacheKey(manga, chapter);
  const cachedPages = getCachedChapterPages(cacheKey);
  if (cachedPages) return cachedPages;

  if (cacheKey && chapterPageRequests.has(cacheKey)) {
    return chapterPageRequests.get(cacheKey);
  }

  const impl = getSourceImpl(manga.sourceId);
  if (!impl?.getChapterPages) {
    throw new Error('Esta fonte n\u00e3o suporta leitura de cap\u00edtulos no app.');
  }

  const request = withTimeout(
    impl.getChapterPages(chapter.id),
    CHAPTER_LOAD_TIMEOUT,
    'Tempo esgotado ao carregar este cap\u00edtulo. A fonte pode estar bloqueando o acesso ou demorando demais.'
  )
    .then((urls) => {
      const normalized = normalizePageUrls(urls);
      if (!normalized.length) throw new Error('Nenhuma p\u00e1gina retornada pelo servidor.');
      setCachedChapterPages(cacheKey, normalized);
      return normalized;
    })
    .finally(() => {
      if (cacheKey) chapterPageRequests.delete(cacheKey);
    });

  if (cacheKey) chapterPageRequests.set(cacheKey, request);
  return request;
}

export default function ChapterReader({
  chapter,
  manga,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  nextChapter,
  onProgressChange,
}) {
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [loadedPageKeys, setLoadedPageKeys] = useState(() => new Set());
  const [mode, setMode] = useState('vertical');
  const hideTimer = useRef(null);
  const loadIdRef = useRef(0);
  const progressKeyRef = useRef('');
  const pageRefs = useRef([]);
  const scrollFrameRef = useRef(null);
  const readerRef = useRef(null);

  const showUi = useCallback(() => {
    setUiVisible(true);
  }, []);

  const handleBack = useCallback((event) => {
    event?.stopPropagation?.();
    clearTimeout(hideTimer.current);
    showUi();
    onBack();
  }, [onBack, showUi]);

  const loadPages = useCallback(async () => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    const cacheKey = getChapterPageCacheKey(manga, chapter);
    const nextKey = getChapterPageCacheKey(manga, nextChapter);
    setActiveChapterPageCacheWindow(cacheKey, nextKey);
    const cachedPages = getCachedChapterPages(cacheKey);

    showUi();
    setError(null);
    setCurrentPage(0);
    setLoadedPageKeys(new Set());

    if (cachedPages) {
      setPages(cachedPages);
      setLoading(false);
      return;
    }

    setLoading(true);
    setPages([]);

    try {
      const normalized = await fetchChapterPages(manga, chapter);

      if (loadIdRef.current !== loadId) return;
      setPages(normalized);
    } catch (err) {
      if (loadIdRef.current !== loadId) return;
      setError(`N\u00e3o foi poss\u00edvel carregar o cap\u00edtulo.\n${err?.message ?? String(err)}`);
    } finally {
      if (loadIdRef.current === loadId) setLoading(false);
    }
  }, [chapter, manga, nextChapter, showUi]);

  const goPrev = useCallback(() => {
    if (mode === 'paged') {
      if (currentPage > 0) setCurrentPage(page => page - 1);
      else if (hasPrev) onPrev();
      return;
    }

    if (hasPrev) onPrev();
  }, [currentPage, hasPrev, mode, onPrev]);

  const goNext = useCallback(() => {
    if (mode === 'paged') {
      if (currentPage < pages.length - 1) setCurrentPage(page => page + 1);
      else if (hasNext) onNext();
      return;
    }

    if (hasNext) onNext();
  }, [currentPage, hasNext, mode, onNext, pages.length]);

  const handlePrevClick = useCallback((event) => {
    event?.stopPropagation?.();
    showUi();
    goPrev();
  }, [goPrev, showUi]);

  const handleNextClick = useCallback((event) => {
    event?.stopPropagation?.();
    showUi();
    goNext();
  }, [goNext, showUi]);

  const handleModeClick = useCallback((nextMode) => (event) => {
    event?.stopPropagation?.();
    showUi();
    setMode(nextMode);
  }, [showUi]);

  const handlePageSettled = useCallback((url, index) => {
    const pageKey = getPageRenderKey(url, index);
    setLoadedPageKeys(prev => {
      if (prev.has(pageKey)) return prev;
      const next = new Set(prev);
      next.add(pageKey);
      return next;
    });
  }, []);

  const setPageNode = useCallback((index, node) => {
    if (node) pageRefs.current[index] = node;
    else delete pageRefs.current[index];
  }, []);

  const updateVerticalPageFromScroll = useCallback(() => {
    if (mode !== 'vertical' || !pages.length) return;

    const readerRect = readerRef.current?.getBoundingClientRect();
    const viewportCenter = readerRect
      ? readerRect.top + readerRect.height * 0.5
      : window.innerHeight * 0.5;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    pageRefs.current.forEach((node, index) => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const containsCenter = rect.top <= viewportCenter && rect.bottom >= viewportCenter;
      const distance = containsCenter
        ? 0
        : Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter));

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    setCurrentPage(page => (page === bestIndex ? page : bestIndex));
  }, [mode, pages.length]);

  const scheduleVerticalPageUpdate = useCallback(() => {
    if (scrollFrameRef.current) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      updateVerticalPageFromScroll();
    });
  }, [updateVerticalPageFromScroll]);

  useEffect(() => {
    loadPages();
    pageRefs.current = [];
    progressKeyRef.current = '';
    readerRef.current?.scrollTo({ top: 0, left: 0 });
    return () => {
      loadIdRef.current += 1;
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [loadPages]);

  useEffect(() => {
    if (loading || error || !pages.length) return;

    const currentKey = getChapterPageCacheKey(manga, chapter);
    const nextKey = getChapterPageCacheKey(manga, nextChapter);
    setActiveChapterPageCacheWindow(currentKey, nextKey);

    if (!nextKey || nextKey === currentKey || hasCachedChapterPages(nextKey)) return;

    fetchChapterPages(manga, nextChapter)
      .then(() => {
        if (activeChapterPageCacheWindow.currentKey === currentKey &&
            activeChapterPageCacheWindow.nextKey === nextKey) {
          pruneChapterPageCache([currentKey, nextKey]);
        }
      })
      .catch(() => {
        if (activeChapterPageCacheWindow.currentKey === currentKey &&
            activeChapterPageCacheWindow.nextKey === nextKey) {
          pruneChapterPageCache([currentKey]);
        }
      });
  }, [chapter, error, loading, manga, nextChapter, pages.length]);

  useEffect(() => {
    if (mode !== 'vertical' || !pages.length) return undefined;

    scheduleVerticalPageUpdate();
    window.addEventListener('resize', scheduleVerticalPageUpdate);

    return () => {
      window.removeEventListener('resize', scheduleVerticalPageUpdate);
      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [mode, pages.length, scheduleVerticalPageUpdate]);

  useEffect(() => {
    if (mode === 'paged') {
      clearTimeout(hideTimer.current);
      setUiVisible(true);
      return undefined;
    }

    if (uiVisible) {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setUiVisible(false), 4000);
    }

    return () => clearTimeout(hideTimer.current);
  }, [mode, uiVisible]);

  useEffect(() => {
    const handler = (event) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') goPrev();
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') goNext();
      if (event.key === 'Escape') handleBack(event);
      showUi();
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, handleBack, showUi]);

  useEffect(() => {
    if (!pages.length) return;

    const pageIndex = Math.min(currentPage, pages.length - 1);
    const completed = pageIndex >= pages.length - 1;
    const progressKey = `${chapter.id}|${pageIndex}|${pages.length}|${completed}`;
    if (progressKeyRef.current === progressKey) return;
    progressKeyRef.current = progressKey;

    saveReadingProgress({
      manga,
      chapter,
      pageIndex,
      totalPages: pages.length,
      completed,
    });
    onProgressChange?.();
  }, [chapter, currentPage, manga, onProgressChange, pages.length]);

  const chapterLabel = chapter.chapter ? `${t('rd.chapterShort')} ${chapter.chapter}` : t('rd.oneshot');
  const pageLabel = pages.length
    ? `${currentPage + 1} / ${pages.length}`
    : `${pages.length || '-'} ${t('rd.pagesUnit')}`;
  const firstPageReady = pages.length > 0 && loadedPageKeys.has(getPageRenderKey(pages[0], 0));
  const currentPageReady = pages.length > 0 &&
    loadedPageKeys.has(getPageRenderKey(pages[currentPage], currentPage));
  const waitingForImage = !loading && !error && pages.length > 0 &&
    (mode === 'paged' ? !currentPageReady : !firstPageReady);
  const showReaderLoading = loading || waitingForImage;
  const loadingLabel = loading ? t('rd.loadingChapter') : t('rd.loadingPage');

  return (
    <div
      ref={readerRef}
      className={`chapter-reader chapter-reader--sumi${uiVisible ? '' : ' ui-hidden'}`}
      onClick={() => setUiVisible(visible => !visible)}
      onScroll={scheduleVerticalPageUpdate}
    >
      <button className="reader-safe-back" onClick={handleBack} title={t('rd.exitReader')} type="button">
        <span className="material-symbols-outlined">close</span>
      </button>

      <div className="reader-topbar" onClick={event => event.stopPropagation()}>
        <div className="reader-topbar__title">
          <p className="reader-topbar__meta">SUMI / Leitor</p>
          <p className="reader-topbar__manga">{manga.title}</p>
          <p className="reader-topbar__chapter">
            {chapterLabel}{chapter.title ? ` - ${chapter.title}` : ''}
          </p>
        </div>
        <div className="reader-topbar__progress">
          <span>{pageLabel}</span>
          <small>{mode === 'paged' ? 'pagina' : 'vertical'}</small>
        </div>
        <div className="reader-topbar__controls">
          <button
            className={`reader-mode-btn${mode === 'vertical' ? ' active' : ''}`}
            onClick={handleModeClick('vertical')}
            title="Modo vertical"
            type="button"
          >
            <span className="material-symbols-outlined">view_agenda</span>
          </button>
          <button
            className={`reader-mode-btn${mode === 'paged' ? ' active' : ''}`}
            onClick={handleModeClick('paged')}
            title="Modo paginado"
            type="button"
          >
            <span className="material-symbols-outlined">auto_stories</span>
          </button>
        </div>
      </div>

      {showReaderLoading && (
        <div
          className={`reader-loading${waitingForImage ? ' reader-loading--overlay' : ''}`}
          aria-label={loadingLabel}
          onClick={event => event.stopPropagation()}
        >
          <div className="spinner spinner--lg" />
          <p>{t('rd.loadingChapter')}</p>
          <button className="sb-retry" onClick={handleBack} type="button">
            <span className="material-symbols-outlined">arrow_back</span>
            {t('rd.back')}
          </button>
        </div>
      )}

      {error && !loading && (
        <div className="reader-error" onClick={event => event.stopPropagation()}>
          <span className="material-symbols-outlined">broken_image</span>
          <p className="reader-error__message">{error}</p>
          <div className="reader-error__actions">
            <button className="sb-retry" onClick={loadPages} type="button">
              <span className="material-symbols-outlined">refresh</span>
              {t('rd.retry')}
            </button>
            <button className="sb-retry" onClick={handleBack} type="button">
              <span className="material-symbols-outlined">arrow_back</span>
              {t('rd.back')}
            </button>
          </div>
        </div>
      )}

      {!loading && !error && pages.length > 0 && mode === 'vertical' && (
        <div className="reader-vertical">
          {pages.map((url, index) => (
            <ReaderPage
              key={`${url}-${index}`}
              url={url}
              index={index}
              ref={node => setPageNode(index, node)}
              onLayoutChange={scheduleVerticalPageUpdate}
              onPageSettled={handlePageSettled}
            />
          ))}
          <div className="reader-chapter-end" onClick={event => event.stopPropagation()}>
            <p>{t('rd.chapterEnd')}</p>
            <div className="reader-end-actions">
              <button
                className="reader-nav-btn reader-nav-btn--secondary"
                disabled={!hasPrev}
                onClick={handlePrevClick}
                type="button"
              >
                <span className="material-symbols-outlined">chevron_left</span>
                {t('rd.prevChapter')}
              </button>
              <button
                className="reader-nav-btn"
                disabled={!hasNext}
                onClick={handleNextClick}
                type="button"
              >
                {t('rd.nextChapter')}
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && pages.length > 0 && mode === 'paged' && (
        <div className="reader-paged" onClick={event => event.stopPropagation()}>
          <ReaderPage
            key={`${pages[currentPage]}-${currentPage}`}
            url={pages[currentPage]}
            index={currentPage}
            onPageSettled={handlePageSettled}
          />
          <div className="reader-paged__nav">
            <button
              className="reader-page-btn"
              disabled={currentPage === 0 && !hasPrev}
              onClick={handlePrevClick}
              type="button"
            >
              <span className="material-symbols-outlined">chevron_left</span>
              {currentPage === 0 && hasPrev ? t('rd.prevChapterShort') : t('rd.prev')}
            </button>
            <span className="reader-page-indicator">
              {currentPage + 1} / {pages.length}
            </span>
            <button
              className="reader-page-btn"
              disabled={currentPage === pages.length - 1 && !hasNext}
              onClick={handleNextClick}
              type="button"
            >
              {currentPage === pages.length - 1 && hasNext ? t('rd.nextChapterShort') : t('rd.next')}
              <span className="material-symbols-outlined">chevron_right</span>
            </button>
          </div>
        </div>
      )}

      {!loading && !error && mode === 'vertical' && (
        <div className="reader-bottombar" onClick={event => event.stopPropagation()}>
          <button
            className="reader-btn"
            disabled={!hasPrev}
            onClick={handlePrevClick}
            title={t('rd.prevChapter')}
            type="button"
          >
            <span className="material-symbols-outlined">skip_previous</span>
          </button>
          <span className="reader-chapter-label">{chapterLabel}</span>
          <button
            className="reader-btn"
            disabled={!hasNext}
            onClick={handleNextClick}
            title={t('rd.nextChapter')}
            type="button"
          >
            <span className="material-symbols-outlined">skip_next</span>
          </button>
        </div>
      )}
    </div>
  );
}

const ReaderPage = React.forwardRef(function ReaderPage({ url, index, onLayoutChange, onPageSettled }, ref) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setErr(false);
  }, [url]);

  return (
    <div
      className={`reader-page${loaded ? ' loaded' : ''}`}
      ref={ref}
    >
      {!loaded && !err && <div className="reader-page__skeleton" />}
      {err ? (
        <div className="reader-page__error">
          <span className="material-symbols-outlined">broken_image</span>
          <p>{t('rd.pageFail')} {index + 1}</p>
        </div>
      ) : (
        <img
          src={url}
          alt={`${t('rd.pageAlt')} ${index + 1}`}
          onLoad={() => {
            setLoaded(true);
            onPageSettled?.(url, index);
            window.requestAnimationFrame(() => onLayoutChange?.());
          }}
          onError={() => {
            setErr(true);
            setLoaded(true);
            onPageSettled?.(url, index);
          }}
          style={{ display: loaded ? 'block' : 'none' }}
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
});
