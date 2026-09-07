import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAllSources, getSourceImpl } from '../lib/sourceRegistry.js';

export default function OnlineSearch({ sources, onMangaSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const availableSources = useMemo(() => {
    return [
      ...sources,
      ...getAllSources().filter(source =>
        source.type === 'extension' && !sources.some(existing => existing.id === source.id)
      ),
    ];
  }, [sources]);

  const activeSources = useMemo(() => {
    return availableSources.filter(source => {
      const impl = getSourceImpl(source.id);
      return source.enabled && impl?.search && impl.supportsBrowse !== false;
    });
  }, [availableSources]);

  useEffect(() => {
    inputRef.current?.focus();
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
          <p className="mono-cap mono-cap-shu">Busca / fontes ativas</p>
          <div className="search-page-title-row">
            <h2 className="search-page-title">Busca global</h2>
            <span className="search-page-jp">検索</span>
          </div>
          <p className="search-page-sub">
            Pesquise em todas as fontes instaladas que possuem suporte a busca.
          </p>
        </div>

        <div className="search-page-metrics">
          <div>
            <span>{activeSources.length}</span>
            <small>fontes</small>
          </div>
          <div>
            <span>{results.length}</span>
            <small>resultados</small>
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
            placeholder="Nome do mangá..."
            value={query}
            onChange={handleInputChange}
          />
          {query && (
            <button type="button" className="search-page-clear" onClick={clearSearch} title="Limpar busca">
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>
      </form>

      {activeSources.length > 0 && (
        <div className="search-page-source-list">
          <span className="mono-cap">Fontes</span>
          {visibleSources.map(source => (
            <span key={source.id} className="search-page-source-chip">{source.name}</span>
          ))}
          {hiddenSourceCount > 0 && (
            <span className="search-page-source-chip">+{hiddenSourceCount}</span>
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
          <p>Buscando em todas as fontes...</p>
        </div>
      )}

      {!loading && searched && results.length === 0 && Object.keys(errors).length === 0 && (
        <div className="sb-error">
          <span className="material-symbols-outlined">search_off</span>
          <p>Nenhum resultado para "<strong>{query}</strong>"</p>
        </div>
      )}

      {!loading && activeSources.length === 0 && (
        <div className="sb-error">
          <span className="material-symbols-outlined">extension_off</span>
          <p>Nenhuma fonte com suporte a busca está ativa.</p>
        </div>
      )}

      {!loading && !searched && activeSources.length > 0 && (
        <div className="search-hint">
          <span className="material-symbols-outlined">travel_explore</span>
          <p>Digite um nome para pesquisar nas fontes ativas.</p>
        </div>
      )}

      {results.length > 0 && (
        <>
          <p className="search-result-count">
            {results.length} resultado{results.length !== 1 ? 's' : ''} para "{query}"
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
        <span className="sb-card__source-badge">{manga.sourceName || 'Fonte'}</span>
      </div>
      <div className="sb-card__info">
        <p className="sb-card__title">{manga.title}</p>
        {manga.author && <p className="sb-card__author">{manga.author}</p>}
      </div>
    </button>
  );
}
