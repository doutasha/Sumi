import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSourceImpl } from '../lib/sourceRegistry.js';
import {
  addFavorite,
  getCategories,
  getChapterProgress,
  getChapterStorageKey,
  getReadingProgress,
  isFavorite,
  removeFavorite,
  setChapterReadStatus,
  setChaptersReadStatus,
  updateFavoriteCategories,
} from '../lib/onlineStorage.js';

const LANG_LABELS = {
  en: 'English',
  'pt-br': 'Português (BR)',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: 'Japonês',
  ko: 'Coreano',
  zh: 'Chinês',
  ru: 'Russo',
};

const STATUS_LABELS = {
  ongoing: 'Em andamento',
  completed: 'Completo',
  hiatus: 'Hiato',
  cancelled: 'Cancelado',
};

const RATING_LABELS = {
  safe: 'Seguro',
  suggestive: 'Sugestivo',
  erotica: 'Erótico',
  pornographic: 'Adulto',
};

function getLookupId(manga) {
  return manga?._mangaUrl || manga?.id;
}

function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

function ratingLabel(rating) {
  return RATING_LABELS[rating] ?? rating;
}

function languageLabel(code) {
  if (!code) return null;
  return LANG_LABELS[code] ?? code.toUpperCase();
}

function chapterNumber(chapter) {
  return chapter.chapter ? `Cap. ${chapter.chapter}` : 'Oneshot';
}

function chapterTitle(chapter) {
  const base = chapterNumber(chapter);
  if (!chapter.title || chapter.title === base) return base;
  return `${base} - ${chapter.title}`;
}

function chapterDate(chapter) {
  const raw = chapter.publishAt || chapter.date || chapter.dateUpload || chapter.readableAt;
  if (!raw) return '-';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function uniqueTags(tags) {
  return [...new Set((tags ?? []).filter(Boolean))].slice(0, 12);
}

function sameChapterList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((chapter, index) => {
    const next = b[index];
    return chapter?.id === next?.id &&
      chapter?.chapter === next?.chapter &&
      chapter?.title === next?.title;
  });
}

export default function MangaDetailPage({ manga, onChapterSelect, onBack }) {
  const [details, setDetails] = useState(manga);
  const [chapters, setChapters] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [favorite, setFavorite] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [loadingChapters, setLoadingChapters] = useState(false);
  const [detailsError, setDetailsError] = useState(null);
  const [chaptersError, setChaptersError] = useState(null);
  const [sortDesc, setSortDesc] = useState(true);
  const [language, setLanguage] = useState('en');
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [readingProgress, setReadingProgress] = useState(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedChapterKeys, setSelectedChapterKeys] = useState(() => new Set());
  const detailLoadKeyRef = useRef(null);
  const chapterLoadKeyRef = useRef(null);
  const chapterLoadSeqRef = useRef(0);

  const impl = useMemo(() => getSourceImpl(manga.sourceId), [manga.sourceId]);
  const mangaLookupId = getLookupId(manga);
  const chapterLookupId = getLookupId(details) || mangaLookupId;

  const languageOptions = useMemo(() => {
    if (!Array.isArray(impl?.languages) || impl.languages.length <= 1) return [];
    return impl.languages.map(code => ({ value: code, label: languageLabel(code) }));
  }, [impl]);

  const canSelectLanguage = languageOptions.length > 0;
  const originalUrl = details._mangaUrl || (impl?.url && details.sourceId === 'mangadex'
    ? `${impl.url}/title/${details.id}`
    : impl?.url);

  const visibleChapters = useMemo(() => {
    const list = [...chapters];
    return sortDesc ? list.reverse() : list;
  }, [chapters, sortDesc]);

  const visibleChapterKeys = useMemo(() => {
    return visibleChapters.map(chapter => getChapterStorageKey(chapter));
  }, [visibleChapters]);
  const visibleChapterKeySet = useMemo(() => new Set(visibleChapterKeys), [visibleChapterKeys]);

  const selectedChapters = useMemo(() => {
    return visibleChapters.filter(chapter => selectedChapterKeys.has(getChapterStorageKey(chapter)));
  }, [selectedChapterKeys, visibleChapters]);

  const selectedCount = selectedChapterKeys.size;
  const allVisibleSelected = visibleChapterKeys.length > 0 &&
    visibleChapterKeys.every(key => selectedChapterKeys.has(key));

  const tags = useMemo(() => uniqueTags(details.tags), [details.tags]);
  const progressChapterKey = readingProgress?.chapterKey;
  const continueChapter = useMemo(() => {
    if (!progressChapterKey) return null;
    return visibleChapters.find(chapter => getChapterStorageKey(chapter) === progressChapterKey)
      || readingProgress?.lastChapter
      || null;
  }, [progressChapterKey, readingProgress, visibleChapters]);
  const primaryChapter = continueChapter || visibleChapters[0];

  const loadCategories = useCallback(() => {
    const allCategories = getCategories();
    setCategories(allCategories);

    const raw = localStorage.getItem('online_reader_favorites');
    const favorites = raw ? JSON.parse(raw) : [];
    const stored = favorites.find(item => item.id === manga.id && item.sourceId === manga.sourceId);
    setSelectedCategories(stored?.categories ?? []);
  }, [manga.id, manga.sourceId]);

  const loadDetails = useCallback(async () => {
    const currentLookupId = mangaLookupId;
    const requestKey = `${manga.sourceId}|${currentLookupId || ''}`;
    if (detailLoadKeyRef.current === requestKey) return;
    detailLoadKeyRef.current = requestKey;

    const sourceImpl = getSourceImpl(manga.sourceId);
    if (!sourceImpl?.getMangaDetails || !currentLookupId) return;

    setLoadingDetails(true);
    setDetailsError(null);
    try {
      const loaded = await sourceImpl.getMangaDetails(currentLookupId);
      setDetails(prev => ({
        ...prev,
        ...loaded,
        id: prev.id ?? loaded.id,
        sourceId: loaded.sourceId ?? prev.sourceId,
        sourceName: loaded.sourceName ?? prev.sourceName,
        _mangaUrl: loaded._mangaUrl ?? prev._mangaUrl,
      }));
    } catch (err) {
      setDetailsError(err.message);
    } finally {
      setLoadingDetails(false);
    }
  }, [manga.description, manga.sourceId, mangaLookupId]);

  const loadChapters = useCallback(async (nextLanguage = language, options = {}) => {
    const requestKey = `${manga.sourceId}|${chapterLookupId || ''}|${nextLanguage}`;
    if (!options.force && chapterLoadKeyRef.current === requestKey) return;
    chapterLoadKeyRef.current = requestKey;

    const currentSeq = chapterLoadSeqRef.current + 1;
    chapterLoadSeqRef.current = currentSeq;
    const sourceImpl = getSourceImpl(manga.sourceId);

    if (!sourceImpl?.getChapters || !chapterLookupId) {
      setChapters(prev => (prev.length ? [] : prev));
      return;
    }

    setLoadingChapters(true);
    setChaptersError(null);
    try {
      const loaded = await sourceImpl.getChapters(chapterLookupId, nextLanguage);
      if (chapterLoadSeqRef.current !== currentSeq) return;
      const nextChapters = Array.isArray(loaded) ? loaded : [];
      setChapters(prev => (sameChapterList(prev, nextChapters) ? prev : nextChapters));
    } catch (err) {
      if (chapterLoadSeqRef.current !== currentSeq) return;
      setChaptersError(err.message);
    } finally {
      if (chapterLoadSeqRef.current === currentSeq) setLoadingChapters(false);
    }
  }, [chapterLookupId, language, manga.sourceId]);

  useEffect(() => {
    setDetails(manga);
    setFavorite(isFavorite(manga.id, manga.sourceId));
    setReadingProgress(getReadingProgress(manga));
    setSelectionMode(false);
    setSelectedChapterKeys(new Set());
    loadCategories();
    window.scrollTo(0, 0);
  }, [loadCategories, manga.id, manga.sourceId, manga._mangaUrl]);

  useEffect(() => {
    setReadingProgress(getReadingProgress(details) ?? getReadingProgress(manga));
  }, [details.id, details.sourceId, details._mangaUrl, manga]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  useEffect(() => {
    if (!canSelectLanguage || languageOptions.some(option => option.value === language)) return;
    setLanguage(languageOptions[0].value);
  }, [canSelectLanguage, language, languageOptions]);

  useEffect(() => {
    setSelectedChapterKeys(prev => {
      const next = new Set([...prev].filter(key => visibleChapterKeySet.has(key)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleChapterKeySet]);

  useEffect(() => {
    loadChapters(language);
  }, [language, loadChapters]);

  const toggleFavorite = () => {
    if (favorite) {
      removeFavorite(details.id, details.sourceId);
      setFavorite(false);
      return;
    }

    setShowCategoryModal(true);
  };

  const saveFavorite = () => {
    const added = addFavorite(details, selectedCategories);
    if (!added) {
      updateFavoriteCategories(details.id, details.sourceId, selectedCategories);
    }
    setFavorite(true);
    setShowCategoryModal(false);
  };

  const toggleCategory = (categoryId) => {
    setSelectedCategories(prev => (
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    ));
  };

  const readActionLabel = primaryChapter && continueChapter
    ? `Continuar ${chapterNumber(primaryChapter)}`
    : primaryChapter
      ? `Ler ${chapterNumber(primaryChapter)}`
      : '';
  const primaryChapterList = primaryChapter && visibleChapters.some(chapter => getChapterStorageKey(chapter) === getChapterStorageKey(primaryChapter))
    ? visibleChapters
    : primaryChapter
      ? [primaryChapter]
      : [];

  const refreshReadingProgress = () => {
    setReadingProgress(getReadingProgress(details) ?? getReadingProgress(manga));
  };

  const toggleChapterSelection = (chapter) => {
    const key = getChapterStorageKey(chapter);
    setSelectedChapterKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectionMode = () => {
    setSelectionMode(active => {
      if (active) setSelectedChapterKeys(new Set());
      return !active;
    });
  };

  const toggleAllVisibleChapters = () => {
    setSelectedChapterKeys(prev => {
      if (allVisibleSelected) return new Set();
      const next = new Set(prev);
      visibleChapterKeys.forEach(key => next.add(key));
      return next;
    });
  };

  const updateChapterReadStatus = (chapter, completed) => {
    setChapterReadStatus(details, chapter, completed);
    refreshReadingProgress();
  };

  const updateSelectedReadStatus = (completed) => {
    if (selectedChapters.length === 0) return;
    setChaptersReadStatus(details, selectedChapters, completed);
    setSelectionMode(false);
    setSelectedChapterKeys(new Set());
    refreshReadingProgress();
  };

  const openChapter = (chapter) => {
    if (selectionMode) {
      toggleChapterSelection(chapter);
      return;
    }
    onChapterSelect(chapter, details, visibleChapters);
  };

  return (
    <div className="manga-detail">
      <section className="manga-detail__hero">
        <div className="manga-detail__crumbs">
          <button className="manga-detail__back" onClick={onBack} title="Voltar">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <span>Biblioteca</span>
          <span>/</span>
          <span>{details.sourceName || impl?.name || 'Fonte'}</span>
          <span>/</span>
          <strong>{details.title}</strong>
        </div>

        <div className="manga-detail__hero-grid">
          <div className="manga-detail__cover-wrap">
            {details.coverUrl ? (
              <img className="manga-detail__cover" src={details.coverUrl} alt={details.title} />
            ) : (
              <div className="manga-detail__cover-placeholder">
                <span className="material-symbols-outlined">menu_book</span>
              </div>
            )}
          </div>

          <div className="manga-detail__meta">
            <p className="manga-detail__eyebrow">{details.sourceName || impl?.name || 'Fonte externa'}</p>
            <h1 className="manga-detail__title">{details.title}</h1>

            {(details.author || details.artist) && (
              <p className="manga-detail__author">
                por <strong>{details.author || details.artist}</strong>
              </p>
            )}

            <div className="manga-detail__pills">
              {details.status && (
                <span className={`detail-pill detail-pill--${details.status}`}>
                  {statusLabel(details.status)}
                </span>
              )}
              {details.year && <span className="detail-pill">{details.year}</span>}
              {details.originalLanguage && <span className="detail-pill">{languageLabel(details.originalLanguage)}</span>}
              {details.contentRating && details.contentRating !== 'safe' && (
                <span className="detail-pill detail-pill--rating">{ratingLabel(details.contentRating)}</span>
              )}
              {tags.slice(0, 5).map(tag => (
                <span key={tag} className="detail-pill">{tag}</span>
              ))}
            </div>

            {details.description ? (
              <p className="manga-detail__desc">{details.description}</p>
            ) : (
              <p className="manga-detail__desc manga-detail__desc--empty">
                Sem sinopse disponível nesta fonte.
              </p>
            )}

            {detailsError && (
              <div className="manga-detail__notice">
                <span className="material-symbols-outlined">info</span>
                {detailsError}
              </div>
            )}

            <div className="manga-detail__stats">
              <div>
                <span>{chapters.length}</span>
                <small>capítulos</small>
              </div>
              <div>
                <span>{details.status ? statusLabel(details.status) : '-'}</span>
                <small>status</small>
              </div>
              <div>
                <span>{details.sourceName || impl?.name || '-'}</span>
                <small>fonte</small>
              </div>
            </div>

            <div className="manga-detail__actions">
              {primaryChapter && (
                <button
                  className="detail-action-btn detail-action-btn--primary"
                  onClick={() => onChapterSelect(primaryChapter, details, primaryChapterList)}
                >
                  <span className="material-symbols-outlined">play_arrow</span>
                  {readActionLabel}
                </button>
              )}

              <button
                className={`detail-action-btn${favorite ? ' favorited' : ''}`}
                onClick={toggleFavorite}
              >
                <span className="material-symbols-outlined">{favorite ? 'bookmark_remove' : 'bookmark_add'}</span>
                {favorite ? 'Remover da biblioteca' : 'Adicionar à biblioteca'}
              </button>

              {originalUrl && (
                <a
                  className="detail-action-btn detail-action-btn--secondary"
                  href={originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="material-symbols-outlined">open_in_new</span>
                  Abrir fonte
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="manga-detail__chapters">
        <div className="manga-detail__chapters-header">
          <div>
            <p className="mono-cap mono-cap-shu">Capítulos</p>
            <h2 className="manga-detail__section-title">
              Lista de capítulos
              <span className="chapter-count">{chapters.length}</span>
            </h2>
          </div>

          <div className="manga-detail__chapters-controls">
            {canSelectLanguage && (
              <select
                className="chapter-lang-select"
                value={language}
                onChange={event => setLanguage(event.target.value)}
              >
                {languageOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <button className="sort-btn" onClick={() => setSortDesc(value => !value)} title="Alternar ordem">
              <span className="material-symbols-outlined">
                {sortDesc ? 'south' : 'north'}
              </span>
            </button>
          </div>
        </div>

        {visibleChapters.length > 0 && (
          <div className={`chapter-bulk-toolbar${selectionMode ? ' selecting' : ''}`}>
            <button
              className={`chapter-selection-toggle${selectionMode ? ' active' : ''}`}
              onClick={toggleSelectionMode}
              type="button"
            >
              <span className="material-symbols-outlined">{selectionMode ? 'close' : 'select_all'}</span>
              {selectionMode ? 'Cancelar' : 'Selecionar'}
            </button>

            {selectionMode ? (
              <>
                <button
                  className="chapter-bulk-btn"
                  onClick={toggleAllVisibleChapters}
                  type="button"
                >
                  <span className="material-symbols-outlined">{allVisibleSelected ? 'deselect' : 'select_all'}</span>
                  {allVisibleSelected ? 'Limpar selecao' : 'Todos visiveis'}
                </button>
                <span className="chapter-bulk-toolbar__count">{selectedCount} selecionado{selectedCount === 1 ? '' : 's'}</span>
                <button
                  className="chapter-bulk-btn"
                  onClick={() => updateSelectedReadStatus(true)}
                  disabled={selectedCount === 0}
                  type="button"
                >
                  <span className="material-symbols-outlined">done_all</span>
                  Marcar lido
                </button>
                <button
                  className="chapter-bulk-btn"
                  onClick={() => updateSelectedReadStatus(false)}
                  disabled={selectedCount === 0}
                  type="button"
                >
                  <span className="material-symbols-outlined">remove_done</span>
                  Desmarcar lido
                </button>
              </>
            ) : (
              <span className="chapter-bulk-toolbar__count">Acoes em lote</span>
            )}
          </div>
        )}

        {loadingDetails && (
          <div className="chapters-loading">
            <div className="spinner" />
            <p>Carregando detalhes...</p>
          </div>
        )}

        {loadingChapters && (
          <div className="chapters-loading">
            <div className="spinner" />
            <p>Carregando capítulos...</p>
          </div>
        )}

        {chaptersError && !loadingChapters && (
          <div className="chapters-error">
            <span className="material-symbols-outlined">wifi_off</span>
            <p>{chaptersError}</p>
            <button className="sb-retry" onClick={() => loadChapters(language, { force: true })}>
              <span className="material-symbols-outlined">refresh</span>
              Tentar novamente
            </button>
          </div>
        )}

        {!loadingChapters && !chaptersError && chapters.length === 0 && (
          <div className="chapters-empty">
            <span className="material-symbols-outlined">menu_book</span>
            <p>Nenhum capítulo encontrado nesta fonte.</p>
          </div>
        )}

        {!loadingChapters && !chaptersError && visibleChapters.length > 0 && (
          <div className="chapter-list">
            <div className="chapter-row chapter-row--head" aria-hidden="true">
              <span />
              <span>#</span>
              <span>Título</span>
              <span>Grupo</span>
              <span>Páginas</span>
              <span>Data</span>
              <span />
              <span />
            </div>

            {visibleChapters.map((chapter, index) => {
              const chapterProgress = getChapterProgress(details, chapter);
              const chapterKey = getChapterStorageKey(chapter);
              const isSelected = selectedChapterKeys.has(chapterKey);
              const isCurrent = progressChapterKey && chapterKey === progressChapterKey;
              const isRead = !!chapterProgress?.completed;

              return (
                <div
                  key={chapter.id || `${chapter.chapter}-${index}`}
                  className={`chapter-row${selectionMode ? ' chapter-row--selection' : ''}${isRead ? ' chapter-row--read' : ''}${isCurrent ? ' chapter-row--current' : ''}${isSelected ? ' chapter-row--selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openChapter(chapter)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openChapter(chapter);
                    }
                  }}
                >
                  <span className="chapter-row__select-marker" aria-hidden="true">
                    <span className="material-symbols-outlined">{isSelected ? 'check' : 'add'}</span>
                  </span>
                  <span className="chapter-row__num">{chapter.chapter || index + 1}</span>
                  <span className="chapter-row__title">
                    {chapterTitle(chapter)}
                    {isCurrent && !isRead && <small className="chapter-row__badge">Em leitura</small>}
                    {isRead && <small className="chapter-row__badge">Lido</small>}
                  </span>
                  <span className="chapter-row__group">{chapter.group || '-'}</span>
                  <span className="chapter-row__pages">{chapter.pages ? `${chapter.pages} pg` : '-'}</span>
                  <span className="chapter-row__date">{chapterDate(chapter)}</span>
                  <span className="material-symbols-outlined chapter-row__arrow">chevron_right</span>
                  <button
                    className={`chapter-row__read-toggle${isRead ? ' active' : ''}`}
                    onClick={event => {
                      event.stopPropagation();
                      updateChapterReadStatus(chapter, !isRead);
                    }}
                    title={isRead ? 'Desmarcar como lido' : 'Marcar como lido'}
                    type="button"
                  >
                    <span className="material-symbols-outlined">{isRead ? 'remove_done' : 'done'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal__header">
              <h2>Adicionar à biblioteca</h2>
              <button className="modal__close" onClick={() => setShowCategoryModal(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal__body">
              {categories.length === 0 ? (
                <p className="modal__hint">Nenhuma categoria criada. O mangá será salvo sem categoria.</p>
              ) : (
                <div className="cat-checkbox-list">
                  {categories.map(category => (
                    <label key={category.id} className="cat-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(category.id)}
                        onChange={() => toggleCategory(category.id)}
                      />
                      <span>{category.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="modal__footer">
              <button className="modal__btn modal__btn--secondary" onClick={() => setShowCategoryModal(false)}>
                Cancelar
              </button>
              <button className="modal__btn modal__btn--primary" onClick={saveFavorite}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
