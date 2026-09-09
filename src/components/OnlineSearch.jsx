import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAllSources, getSourceImpl } from '../lib/sourceRegistry.js';
import ServerStatus from './ServerStatus.jsx';
import { SERVER_SOURCES_EVENT } from '../lib/parser/sources.js';
import { getOnlineSettings, saveOnlineSettings } from '../lib/onlineStorage.js';
import { t } from '../lib/i18n.js';

function readContentLang() {
  try {
    return getOnlineSettings()?.contentLang || 'all';
  } catch {
    return 'all';
  }
}

export default function OnlineSearch({ sources, onMangaSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [searched, setSearched] = useState(false);
  const [serverTick, setServerTick] = useState(0);
  const [contentLang, setContentLang] = useState(readContentLang);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const availableSources = useMemo(() => {
    return [
      ...sources,
      ...getAllSources().filter(source =>
        source.type === 'extension' && !sources.some(existing => existing.id === source.id)
      ),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, serverTick]);

  const activeSources = useMemo(() => {
    return availableSources.filter(source => {
      const impl = getSourceImpl(source.id);
      const langOk = contentLang === 'all'
        || !source.lang
        || source.lang === 'all'
        || source.lang === contentLang;
      return source.enabled && impl?.search && impl.supportsBrowse !== false && langOk;
    });
  }, [availableSources, contentLang]);

  const contentLangOptions = useMemo(() => {
    const set = new Set();
    for (const source of availableSources) {
      if (source.lang && source.lang !== 'all') set.add(source.lang);
    }
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSources, serverTick]);

  const handleContentLang = useCallback((lang) => {
    setContentLang(lang);
    try {
      saveOnlineSettings({ ...getOnlineSettings(), contentLang: lang });
    } catch {
      /* ignora */
    }
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onServerSources = () => setServerTick(t => t + 1);
    window.addEventListener(SERVER_SOURCES_EVENT, onServerSources);
    return () => window.removeEventListener(SERVER_SOURCES_EVENT, onServerSources);
  }, []);

  const search = useCallback(async (value) => {
    const term = value.trim();
    if (!term) {
      setResults([]);
      setErrors({});
      setSearched(false);
      return;
    }

    setLoading(true);
    setResults([]);
    setErrors({});
    setSearched(true);

    const searches = activeSources.map(async (source) => {
      const impl = getSourceImpl(source.id);
      try {
        const res = await impl.search(term);
        return { sourceId: source.id, sourceName: source.name, results: res.results, error: null };
      } catch (error) {
        return { sourceId: source.id, sourceName: source.name, results: [], error: error.message };
      }
    });

    const settled = await Promise.allSettled(searches);
    const all = settled.map(result => result.value ?? result.reason);

    const nextErrors = {};
    const nextResults = [];
    all.forEach(result => {
      if (result.error) nextErrors[result.sourceId] = result.error;
      nextResults.push(...result.results);
    });

    setResults(nextResults);
    setErrors(nextErrors);
    setLoading(false);
  }, [activeSources]);

  const handleInputChange = (event) => {
    const value = event.target.value;
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 500);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    clearTimeout(debounceRef.current);
    search(query);
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setQuery('');
    setResults([]);
    setErrors({});
    setSearched(false);
  };

  const visibleSources = activeSources.slice(0, 8);
  const hiddenSourceCount = Math.max(0, activeSources.length - visibleSources.length);

  return (
    <div className="online-search-page">
      <section className="search-page-header">
        <div>
          <p className="mono-cap mono-cap-shu">{t('sea.kicker')}</p>
          <div className="search-page-title-row">
            <h2 className="search-page-title">{t('sea.title')}</h2>
            <span className="search-page-jp">検索</span>
          </div>
          <p className="search-page-sub">
            {t('sea.sub')}
          </p>
          <ServerStatus onChange={() => setServerTick(t => t + 1)} />
        </div>

        <div className="search-page-metrics">
          <div>
            <span>{activeSources.length}</span>
            <small>{t('sea.sources')}</small>
          </div>
          <div>
            <span>{results.length}</span>
            <small>{t('sea.results')}</small>
          </div>
        </div>
      </section>

      <form className="search-page-form" onSubmit={handleSubmit}>
        <div className="search-page-input-wrap">
          <span className="material-symbols-outlined search-page-icon">search</span>
          <input
            ref={inputRef}
            type="text"
            className="search-page-input"
            placeholder={t('sea.placeholder')}
            value={query}
            onChange={handleInputChange}
          />
          {query && (
            <button type="button" className="search-page-clear" onClick={clearSearch} title={t('sea.clearSearch')}>
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>
      </form>

      {activeSources.length > 0 && (
        <div className="search-page-source-list">
          <span className="mono-cap">{t('sea.sources')}</span>
          {visibleSources.map(source => (
            <span key={source.id} className="search-page-source-chip">{source.name}</span>
          ))}
          {hiddenSourceCount > 0 && (
            <span className="search-page-source-chip">+{hiddenSourceCount}</span>
          )}
          {contentLangOptions.length > 1 && (
            <select
              className="sb-lang-select"
              value={contentLang}
              onChange={e => handleContentLang(e.target.value)}
              title={t('sea.searchLang')}
            >
              <option value="all">{t('sea.allLangs')}</option>
              {contentLangOptions.map(lang => (
                <option key={lang} value={lang}>{lang.toUpperCase()}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {Object.keys(errors).length > 0 && (
        <div className="search-errors">
          {Object.entries(errors).map(([sourceId, message]) => (
            <div key={sourceId} className="search-error-banner">
              <span className="material-symbols-outlined">warning</span>
              <span><strong>{activeSources.find(source => source.id === sourceId)?.name ?? sourceId}:</strong> {message}</span>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <div className="sb-loading">
          <div className="spinner" />
          <p>{t('sea.searchingAll')}</p>
        </div>
      )}

      {!loading && searched && results.length === 0 && Object.keys(errors).length === 0 && (
        <div className="sb-error">
          <span className="material-symbols-outlined">search_off</span>
          <p>{t('sea.noResultsFor')} "<strong>{query}</strong>"</p>
        </div>
      )}

      {!loading && activeSources.length === 0 && (
        <div className="sb-error">
          <span className="material-symbols-outlined">extension_off</span>
          <p>{t('sea.noSources')}</p>
        </div>
      )}

      {!loading && !searched && activeSources.length > 0 && (
        <div className="search-hint">
          <span className="material-symbols-outlined">travel_explore</span>
          <p>{t('sea.hint')}</p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <p className="search-result-count">
            {results.length} {results.length !== 1 ? t('sea.resultCountPl') : t('sea.resultCount')} {t('sea.for')} "{query}"
          </p>
          <div className="sb-grid">
            {results.map(manga => (
              <SearchResultCard
                key={`${manga.sourceId}-${manga.id}`}
                manga={manga}
                onClick={() => onMangaSelect(manga)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SearchResultCard({ manga, onClick }) {
  const [imgError, setImgError] = useState(false);

  return (
    <button className="sb-card" onClick={onClick}>
      <div className="sb-card__cover">
        {manga.coverUrl && !imgError ? (
          <img src={manga.coverUrl} alt={manga.title} loading="lazy" onError={() => setImgError(true)} />
        ) : (
          <div className="sb-card__no-cover">
            <span>本</span>
          </div>
        )}
        <span className="sb-card__source-badge">{manga.sourceName || t('sea.sourceFallback')}</span>
      </div>
      <div className="sb-card__info">
        <p className="sb-card__title">{manga.title}</p>
        {manga.author && <p className="sb-card__author">{manga.author}</p>}
      </div>
    </button>
  );
}
