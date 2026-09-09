import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSourceImpl } from '../lib/sourceRegistry.js';
import { getCachedServerSources, sourceOwnerPkg } from '../lib/parser/sources.js';
import { t } from '../lib/i18n.js';

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'pt-br', label: 'Portugu\u00eas (BR)' },
  { value: 'es', label: 'Espa\u00f1ol' },
  { value: 'fr', label: 'Fran\u00e7ais' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'ru', label: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439' },
];

function cloneFilterValue(value) {
  return Array.isArray(value) ? [...value] : value;
}

function getDefaultFilterValue(filter) {
  if ('defaultValue' in filter) return cloneFilterValue(filter.defaultValue);
  return filter.type === 'multi' ? [] : 'all';
}

function getDefaultFilterValues(filters) {
  return Object.fromEntries(filters.map(filter => [filter.key, getDefaultFilterValue(filter)]));
}

function valuesMatch(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const aa = Array.isArray(a) ? a : [];
    const bb = Array.isArray(b) ? b : [];
    return aa.length === bb.length && aa.every(item => bb.includes(item));
  }
  return a === b;
}

function countActiveFilters(filters, values) {
  return filters.reduce((count, filter) => {
    const current = values[filter.key] ?? getDefaultFilterValue(filter);
    return count + (valuesMatch(current, getDefaultFilterValue(filter)) ? 0 : 1);
  }, 0);
}

const CARD_MIN_W = 148;
const CARD_GAP = 20;
const CARD_H = 240;
const CHROME_H = 110;

// Calcula quantos cards cabem na tela.
function calcPageSize() {
  if (typeof window === 'undefined') return 24;
  const availW = window.innerWidth - 48;
  const cols = Math.max(2, Math.floor((availW + CARD_GAP) / (CARD_MIN_W + CARD_GAP)));
  const availH = window.innerHeight - CHROME_H;
  const rows = Math.max(4, Math.floor((availH + CARD_GAP) / (CARD_H + CARD_GAP)) + 1);
  return cols * rows;
}

function getModeLabel(tab, isSearching) {
  if (isSearching) return t('sb.searching');
  return {
    popular: t('sb.popular'),
    recent: t('sb.recent'),
    'top-rated': t('sb.topRated'),
    new: t('sb.new'),
  }[tab] ?? t('sb.browseMode');
}

export default function SourceBrowser({ source, siblings, onMangaSelect, onBack }) {
  const [tab, setTab] = useState('popular');
  const [query, setQuery] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [mangas, setMangas] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [language, setLanguage] = useState('en');
  const [pageSize, setPageSize] = useState(calcPageSize);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterValues, setFilterValues] = useState({});

  const debounceRef = useRef(null);
  const viewportWidthRef = useRef(typeof window !== 'undefined' ? window.innerWidth : 0);
  // Fonte ativa: troca entre fontes-irmãs (mesma extensão, outro idioma) sem sair da tela.
  const [activeSource, setActiveSource] = useState(source);
  const impl = useMemo(() => getSourceImpl(activeSource.id), [activeSource.id]);
  const siblingOptions = useMemo(() => {
    // Caminho principal: irmãs passadas na navegação. Fallback: deriva do
    // cache pelo pkg dono (cura cliques antigos / estado HMR preservado).
    let incoming = Array.isArray(siblings) ? siblings : [];
    if (incoming.length === 0 && typeof activeSource.id === 'string' && activeSource.id.startsWith('suwayomi:')) {
      const owner = sourceOwnerPkg(activeSource.iconUrl);
      if (owner) {
        incoming = getCachedServerSources().filter(s => sourceOwnerPkg(s.iconUrl) === owner);
      }
    }
    const list = [source, ...incoming];
    const seen = new Set();
    return list.filter(s => s?.id && !seen.has(s.id) && (seen.add(s.id), true));
  }, [source, siblings, activeSource.id, activeSource.iconUrl]);
  const filterDefs = useMemo(() => (Array.isArray(impl?.filters) ? impl.filters : []), [impl]);
  const supportsFilters = filterDefs.length > 0;
  const activeFilterCount = useMemo(() => countActiveFilters(filterDefs, filterValues), [filterDefs, filterValues]);

  const languageOptions = useMemo(() => {
    if (!Array.isArray(impl?.languages) || impl.languages.length === 0) return [];
    return LANGS.filter(lang => impl.languages.includes(lang.value));
  }, [impl]);

  const supportsLanguageSelect = languageOptions.length > 0;
  const fixedLanguageLabel = useMemo(() => {
    if (supportsLanguageSelect || !activeSource.lang) return null;
    return LANGS.find(lang => lang.value === activeSource.lang)?.label ?? activeSource.lang.toUpperCase();
  }, [activeSource.lang, supportsLanguageSelect]);

  const handleSiblingChange = useCallback((nextId) => {
    const next = siblingOptions.find(s => s.id === nextId);
    if (!next || next.id === activeSource.id) return;
    setActiveSource(next);
    setPage(1);
    setMangas([]);
    setTotal(0);
    setError(null);
    window.scrollTo(0, 0);
  }, [siblingOptions, activeSource.id]);

  useEffect(() => {
    const onResize = () => {
      const nextWidth = window.innerWidth;
      if (Math.abs(nextWidth - viewportWidthRef.current) < 16) return;
      viewportWidthRef.current = nextWidth;
      setPageSize(calcPageSize());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const totalPages = useMemo(() => (total > 0 ? Math.ceil(total / pageSize) : 0), [total, pageSize]);

  const load = useCallback(async (pg, lang, q, t, filters = filterValues) => {
    if (!impl || impl.supportsBrowse === false) return;
    setLoading(true);
    setError(null);
    setMangas([]);
    window.scrollTo(0, 0);

    try {
      let res;
      const cleanQuery = q.trim();

      if (cleanQuery) {
        if (!impl.search) throw new Error('Esta fonte n\u00e3o suporta busca.');
        res = await impl.search(cleanQuery, pg, lang, pageSize, filters);
      } else if (t === 'recent') {
        if (!impl.getLatest) throw new Error('Esta fonte n\u00e3o suporta recentes.');
        res = await impl.getLatest(pg, lang, pageSize, filters);
      } else if (t === 'top-rated') {
        if (!impl.getTopRated) throw new Error('Esta fonte n\u00e3o suporta avalia\u00e7\u00f5es.');
        res = await impl.getTopRated(pg, lang, pageSize, filters);
      } else if (t === 'new') {
        if (!impl.getNew) throw new Error('Esta fonte n\u00e3o suporta novos.');
        res = await impl.getNew(pg, lang, pageSize, filters);
      } else {
        if (!impl.browse) throw new Error('Esta fonte n\u00e3o suporta navega\u00e7\u00e3o.');
        res = await impl.browse(pg, lang, pageSize, filters);
      }

      const nextTotal = Number(res?.total);
      setMangas(Array.isArray(res?.results) ? res.results : []);
      setTotal(Number.isFinite(nextTotal) ? nextTotal : 0);
      setPage(pg);
    } catch (e) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [filterValues, impl, pageSize]);

  useEffect(() => {
    load(1, language, query, tab);
  }, [tab, language, pageSize, load]);

  useEffect(() => {
    if (!supportsLanguageSelect || languageOptions.some(lang => lang.value === language)) return;
    setLanguage(languageOptions[0].value);
  }, [language, languageOptions, supportsLanguageSelect]);

  useEffect(() => {
    setFilterOpen(false);
    setFilterValues(getDefaultFilterValues(filterDefs));
  }, [filterDefs]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(val);
      load(1, language, val, tab);
    }, 500);
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setInputValue('');
    setQuery('');
    load(1, language, '', tab);
  };

  const handleTabChange = (nextTab) => {
    setTab(nextTab);
    setQuery('');
    setInputValue('');
  };

  const goToPage = (pg) => {
    if (pg < 1 || pg > totalPages || pg === page) return;
    load(pg, language, query, tab);
  };

  const updateFilter = (key, value) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  };

  const toggleMultiFilter = (filter, optionValue) => {
    setFilterValues(prev => {
      const current = Array.isArray(prev[filter.key]) ? prev[filter.key] : [];
      if (current.length <= 1 && current.includes(optionValue)) return prev;
      const next = current.includes(optionValue)
        ? current.filter(value => value !== optionValue)
        : [...current, optionValue];
      return { ...prev, [filter.key]: next };
    });
  };

  const clearFilters = () => {
    setFilterValues(getDefaultFilterValues(filterDefs));
  };

  if (!impl || impl.supportsBrowse === false) {
    const message = !impl
      ? `${t('sb.noApi')}${source?.id ? ` (${source.id})` : ''}`
      : t('sb.noParser');

    return (
      <div className="source-browser source-browser--sumi">
        <BrowserHeader source={source} onBack={onBack} />
        <div className="sb-error">
          <span className="material-symbols-outlined">extension_off</span>
          <p>{message}</p>
          {source.url && (
            <a className="sb-external" href={source.url} target="_blank" rel="noopener noreferrer">
              Abrir site externo
              <span className="material-symbols-outlined">open_in_new</span>
            </a>
          )}
        </div>
      </div>
    );
  }

  const isSearching = !!query.trim();
  const modeLabel = getModeLabel(tab, isSearching);
  return (
    <div className="source-browser source-browser--sumi">
      <BrowserHeader
        source={activeSource}
        onBack={onBack}
        mode={modeLabel}
        total={total}
        page={page}
        shown={mangas.length}
        languageLabel={fixedLanguageLabel}
        searchValue={inputValue}
        onSearchChange={handleInputChange}
        onSearchClear={clearSearch}
      >
        {supportsFilters && (
          <button
            className={`sb-filter-toggle${filterOpen ? ' active' : ''}`}
            onClick={() => setFilterOpen(open => !open)}
            title={t('sb.filter')}
            type="button"
          >
            <span className="material-symbols-outlined">tune</span>
            <span>{t('sb.filter')}</span>
            {activeFilterCount > 0 && <span className="sb-filter-count">{activeFilterCount}</span>}
          </button>
        )}
        {supportsLanguageSelect && (
          <select className="sb-lang-select" value={language} onChange={e => setLanguage(e.target.value)}>
            {languageOptions.map(lang => <option key={lang.value} value={lang.value}>{lang.label}</option>)}
          </select>
        )}
        {siblingOptions.length > 1 && (
          <select
            className="sb-lang-select"
            value={activeSource.id}
            onChange={e => handleSiblingChange(e.target.value)}
            title={t('sb.sourceLang')}
          >
            {siblingOptions.map(s => (
              <option key={s.id} value={s.id}>{(s.lang || '??').toUpperCase()}</option>
            ))}
          </select>
        )}
      </BrowserHeader>

      {supportsFilters && filterOpen && (
        <div className="sb-filter-panel">
          <div className="sb-filter-panel__head">
            <span className="mono-cap mono-cap-shu">{t('sb.filters')}</span>
            <span>{activeFilterCount} {t('sb.active')}</span>
          </div>
          <div className="sb-filter-panel__body">
            {filterDefs.map(filter => (
              <FilterControl
                key={filter.key}
                filter={filter}
                value={filterValues[filter.key] ?? getDefaultFilterValue(filter)}
                onChange={value => updateFilter(filter.key, value)}
                onToggle={value => toggleMultiFilter(filter, value)}
              />
            ))}
            {activeFilterCount > 0 && (
              <button className="sb-filter-clear" onClick={clearFilters} type="button">
                <span className="material-symbols-outlined">filter_alt_off</span>
                {t('sb.clearFilters')}
              </button>
            )}
          </div>
        </div>
      )}

      {!isSearching && (
        <div className="sb-tabs" role="tablist" aria-label="Modo de navegacao">
          <button className={`sb-tab${tab === 'popular' ? ' active' : ''}`} onClick={() => handleTabChange('popular')} type="button">
            <span className="material-symbols-outlined">local_fire_department</span>
            Popular
          </button>
          {impl.getLatest && (
            <button className={`sb-tab${tab === 'recent' ? ' active' : ''}`} onClick={() => handleTabChange('recent')} type="button">
              <span className="material-symbols-outlined">schedule</span>
              Recentes
            </button>
          )}
          {impl.getTopRated && (
            <button className={`sb-tab${tab === 'top-rated' ? ' active' : ''}`} onClick={() => handleTabChange('top-rated')} type="button">
              <span className="material-symbols-outlined">star</span>
              Melhor avaliados
            </button>
          )}
          {impl.getNew && (
            <button className={`sb-tab${tab === 'new' ? ' active' : ''}`} onClick={() => handleTabChange('new')} type="button">
              <span className="material-symbols-outlined">fiber_new</span>
              Novos
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="sb-loading">
          <div className="spinner" />
          <p>{isSearching ? `Buscando "${query}"...` : 'Carregando...'}</p>
        </div>
      )}

      {error && !loading && (
        <div className="sb-error">
          <span className="material-symbols-outlined">wifi_off</span>
          <p>{error}</p>
          <button className="sb-retry" onClick={() => load(page, language, query, tab)} type="button">
            <span className="material-symbols-outlined">refresh</span>
            Tentar novamente
          </button>
        </div>
      )}

      {!loading && !error && mangas.length === 0 && (
        <div className="sb-error">
          <span className="material-symbols-outlined">search_off</span>
          <p>{isSearching ? `Nenhum resultado para "${query}".` : supportsLanguageSelect ? 'Nenhum mang\u00e1 encontrado para este idioma.' : 'Nenhum mang\u00e1 encontrado nesta fonte.'}</p>
        </div>
      )}

      {!loading && !error && mangas.length > 0 && (
        <>
          <div className="sb-result-strip">
            <span>{modeLabel}</span>
            <strong>{mangas.length}</strong>
            <span>itens carregados</span>
            {total > 0 && <span>de {total}</span>}
          </div>
          <div className="sb-grid">
            {mangas.map(manga => (
              <MangaCard key={manga.id} manga={manga} onClick={() => onMangaSelect(manga)} />
            ))}
          </div>

          {totalPages > 1 && (
            <Pagination current={page} total={totalPages} onGo={goToPage} />
          )}
        </>
      )}
    </div>
  );
}

function FilterControl({ filter, value, onChange, onToggle }) {
  if (filter.type === 'text') {
    return (
      <label className="sb-filter-group">
        <span>{filter.label ?? filter.key}</span>
        <input
          type="text"
          value={value === 'all' ? '' : value}
          placeholder={filter.placeholder ?? ''}
          onChange={e => onChange(e.target.value)}
        />
      </label>
    );
  }

  if (filter.type === 'multi') {
    const selected = Array.isArray(value) ? value : [];
    const options = Array.isArray(filter.options) ? filter.options : [];
    return (
      <fieldset className="sb-filter-group">
        <legend>{filter.label ?? filter.key}</legend>
        <div className="sb-filter-options">
          {options.map(option => (
            <label key={option.value} className="sb-filter-check">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  const options = Array.isArray(filter.options) ? filter.options : [];

  return (
    <label className="sb-filter-group">
      <span>{filter.label ?? filter.key}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function Pagination({ current, total, onGo }) {
  const pages = buildPageRange(current, total);

  return (
    <nav className="sb-pagination" aria-label={t('sb.pagination')}>
      <button className="sb-page-btn" disabled={current === 1} onClick={() => onGo(current - 1)} title={t('sb.prevPage')} type="button">
        <span className="material-symbols-outlined">chevron_left</span>
      </button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="sb-page-ellipsis">...</span>
        ) : (
          <button
            key={p}
            className={`sb-page-btn${p === current ? ' active' : ''}`}
            onClick={() => onGo(p)}
            type="button"
          >
            {p}
          </button>
        )
      )}

      <button className="sb-page-btn" disabled={current === total} onClick={() => onGo(current + 1)} title={t('sb.nextPage')} type="button">
        <span className="material-symbols-outlined">chevron_right</span>
      </button>

      <span className="sb-page-info">{current} / {total}</span>
    </nav>
  );
}

function buildPageRange(current, total) {
  if (total <= 9) return Array.from({ length: total }, (_, i) => i + 1);
  const delta = 2;
  const range = new Set([1, total]);
  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) range.add(i);
  const sorted = [...range].sort((a, b) => a - b);
  const result = [];
  let prev = 0;

  for (const p of sorted) {
    if (p - prev > 1) result.push('...');
    result.push(p);
    prev = p;
  }

  return result;
}

function BrowserHeader({
  source,
  onBack,
  mode,
  total,
  page,
  shown,
  languageLabel,
  searchValue,
  onSearchChange,
  onSearchClear,
  children,
}) {
  const typeLabel = (source.type ?? 'fonte').toString();
  const initial = (source.name ?? 'S').trim().slice(0, 1).toUpperCase() || 'S';
  const host = getSourceHost(source.url ?? source.config?.baseUrl);
  const hasToolbar = onSearchChange || children;

  return (
    <header className="sb-header">
      <div className="sb-header__top">
        <button className="sb-back" onClick={onBack} title={t('sb.back')} type="button">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>

        <div className="sb-source-mark" aria-hidden="true">{initial}</div>

        <div className="sb-header__info">
          <p className="mono-cap mono-cap-shu">{t('sb.source')} / {typeLabel}</p>
          <div className="sb-header__title-row">
            <h2 className="sb-header__name">{source.name}</h2>
            <span className="sb-header__tag">{typeLabel}</span>
          </div>
          {host && <p className="sb-header__url">{host}</p>}
        </div>

        {typeof shown === 'number' && (
          <div className="sb-header__metrics">
            <div>
              <span>{shown}</span>
              <small>{t('sb.onScreen')}</small>
            </div>
            <div>
              <span>{total || '-'}</span>
              <small>{t('sb.total')}</small>
            </div>
            <div>
              <span>{page || 1}</span>
              <small>{t('sb.page')}</small>
            </div>
            {mode && (
              <div>
                <span>{mode}</span>
                <small>{t('sb.mode')}</small>
              </div>
            )}
          </div>
        )}
      </div>

      {hasToolbar && (
        <div className="sb-header__toolbar">
          {onSearchChange && (
            <div className="sb-header__search">
              <span className="material-symbols-outlined sb-search-icon">search</span>
              <input
                className="sb-search-input"
                type="text"
                placeholder={`${t('sb.searchIn')} ${source.name}...`}
                value={searchValue ?? ''}
                onChange={onSearchChange}
              />
              {searchValue && (
                <button className="sb-search-clear" onClick={onSearchClear} title={t('sb.clear')} type="button">
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </div>
          )}

          <div className="sb-header__actions">
            {children}
            {languageLabel && <span className="sb-header__language">{languageLabel}</span>}
          </div>
        </div>
      )}
    </header>
  );
}

function MangaCard({ manga, onClick }) {
  const [imgError, setImgError] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        obs.disconnect();
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <button className="sb-card" onClick={onClick} ref={ref} title={manga.title} type="button">
      <div className="sb-card__cover">
        {visible && manga.coverUrl && !imgError ? (
          <img
            src={manga.coverUrl}
            alt={manga.title}
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : !visible ? (
          <div className="sb-card__no-cover sb-card__skeleton" />
        ) : (
          <div className="sb-card__no-cover">
            <span className="material-symbols-outlined">book</span>
          </div>
        )}
        {manga.status && (
          <span className={`sb-card__status sb-card__status--${manga.status}`}>
            {statusLabel(manga.status)}
          </span>
        )}
      </div>
      <div className="sb-card__info">
        <p className="sb-card__title">{manga.title}</p>
        {manga.author && <p className="sb-card__author">{manga.author}</p>}
      </div>
    </button>
  );
}

function getSourceHost(url) {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function statusLabel(status) {
  return {
    ongoing: t('sb.st.ongoing'),
    completed: t('sb.st.completed'),
    hiatus: t('sb.st.hiatus'),
    cancelled: t('sb.st.cancelled'),
  }[status] ?? status;
}
