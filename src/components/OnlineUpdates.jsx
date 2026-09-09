import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMangaStorageKey, getChapterSnapshot, saveChapterSnapshot, recordChapterCount, getCategories, getUpdatesScope, saveUpdatesScope, getUpdateFeed, appendUpdateFeed, clearUpdateFeed } from '../lib/onlineStorage.js';
import { getSourceImpl } from '../lib/sourceRegistry.js';
import { toast } from './Toast.jsx';
import { t } from '../lib/i18n.js';

/**
 * OnlineUpdates — novos capítulos dos favoritos, estilo Mihon.
 * Compara capítulos atuais com o snapshot local; 1ª vez cria a base
 * em silêncio (sem spam de "novos").
 */
export default function OnlineUpdates({ favorites, onMangaOpen }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(() => getUpdateFeed());
  const [skipped, setSkipped] = useState(0);
  const [baseline, setBaseline] = useState(false);
  const [scope, setScope] = useState(() => getUpdatesScope());
  const runId = useRef(0);

  const categories = useMemo(() => {
    try {
      return getCategories();
    } catch {
      return [];
    }
  }, []);

  const extensions = useMemo(() => {
    const map = new Map();
    for (const manga of Array.isArray(favorites) ? favorites : []) {
      if (manga?.sourceId && !map.has(manga.sourceId)) {
        map.set(manga.sourceId, manga.sourceName || manga.sourceId);
      }
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [favorites]);

  const scopedFavorites = useMemo(() => {
    const list = Array.isArray(favorites) ? favorites : [];
    if (scope?.kind === 'category' && scope.id) {
      return list.filter((m) => m.categories?.includes(scope.id));
    }
    if (scope?.kind === 'extension' && scope.id) {
      return list.filter((m) => m.sourceId === scope.id);
    }
    return list;
  }, [favorites, scope]);

  const pickScope = (kind, id = null) => {
    const next = { kind, id };
    setScope(next);
    saveUpdatesScope(next);
  };

  const runCheck = useCallback(async () => {
    const id = ++runId.current;
    const list = scopedFavorites;
    if (!list.length) {
      setPhase('done');
      return;
    }
    setPhase('checking');
    setSkipped(0);
    setBaseline(false);
    const snapshot = getChapterSnapshot();
    const firstRun = Object.keys(snapshot).length === 0;
    const next = { ...snapshot };
    const freshItems = [];
    let skip = 0;
    let done = 0;
    for (const manga of list) {
      if (runId.current !== id) return;
      done += 1;
      setProgress({ done, total: list.length, current: manga.title });
      try {
        const impl = getSourceImpl(manga.sourceId);
        if (!impl?.getChapters) {
          skip += 1;
          continue;
        }
        const chapters = await impl.getChapters(manga.id);
        recordChapterCount(manga, (Array.isArray(chapters) ? chapters : []).length);
        const ids = (Array.isArray(chapters) ? chapters : []).map((c) => String(c.id ?? c.url ?? ''));
        const key = getMangaStorageKey(manga);
        const seen = new Set(next[key] || []);
        const fresh = (Array.isArray(chapters) ? chapters : []).filter((c) => !seen.has(String(c.id ?? c.url ?? '')));
        next[key] = ids;
        if (!firstRun && fresh.length) {
          freshItems.push({
            mangaKey: key,
            manga: {
              id: manga.id,
              sourceId: manga.sourceId,
              title: manga.title,
              coverUrl: manga.coverUrl || null,
              sourceName: manga.sourceName || null,
            },
            chapters: fresh.map((c) => ({
              id: String(c.id ?? c.url ?? ''),
              chapter: c.chapter ?? null,
              title: c.title || null,
            })),
            foundAt: Date.now(),
          });
        }
      } catch {
        skip += 1;
      }
    }
    if (runId.current !== id) return;
    saveChapterSnapshot(next);
    const feed = appendUpdateFeed(freshItems);
    setResults(feed);
    setSkipped(skip);
    setBaseline(firstRun);
    setProgress(null);
    setPhase('done');
    if (!firstRun) {
      toast(freshItems.length ? `${freshItems.length} ${t('upd.withNews')}` : t('upd.none'), freshItems.length ? 'success' : 'info');
    }
  }, [scopedFavorites]);

  useEffect(() => {
    runCheck();
    return () => {
      runId.current += 1;
    };
  }, [runCheck]);

  const markAllSeen = () => {
    clearUpdateFeed();
    setResults([]);
    toast(t('upd.feedCleared'), 'success');
  };

  const totalNew = results.reduce((acc, e) => acc + (e.chapters?.length ?? 0), 0);

  // Agrupa por dia (foundAt), mais recente primeiro.
  const groups = (() => {
    const byDay = new Map();
    const dayKey = (ts) => {
      const d = new Date(ts || 0);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    for (const entry of results) {
      const key = dayKey(entry.foundAt);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(entry);
    }
    const fmt = (key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
    };
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, entries]) => ({
        key,
        label: fmt(key),
        count: entries.reduce((acc, e) => acc + (e.chapters?.length ?? 0), 0),
        entries,
      }));
  })();

  const chapterLabel = (ch) => {
    if (ch.chapter != null && ch.chapter !== '') return `Cap. ${ch.chapter}`;
    return ch.title || t('upd.chapterFallback');
  };

  return (
    <div className="online-backup">
      <section className="online-backup__panel">
        <div className="online-backup__panel-main">
          <p className="mono-cap">{t('upd.cap')}</p>
          <h3>{t('upd.title')}</h3>
          <p>
            {phase === 'checking' && progress
              ? `${t('upd.checking')} ${progress.done}/${progress.total}${progress.current ? `: ${progress.current}` : ''}…`
              : baseline
                ? t('upd.baseline')
                : totalNew > 0
                  ? `${totalNew} ${t('upd.summary')} ${results.length} ${t('upd.titles')}.`
                  : t('upd.none')}
          </p>
        </div>
        <div className="online-backup__actions">
          <button
            className="online-backup__button"
            onClick={runCheck}
            disabled={phase === 'checking'}
            type="button"
          >
            <span className="material-symbols-outlined">refresh</span>
            {t('upd.check')}
          </button>
          {results.length > 0 ? (
            <button
              className="online-backup__button online-backup__button--primary"
              onClick={markAllSeen}
              type="button"
            >
              <span className="material-symbols-outlined">done_all</span>
              {t('upd.markSeen')}
            </button>
          ) : (
            <button
              className="online-backup__button"
              disabled
              title={t('upd.nothingToClear')}
              type="button"
            >
              <span className="material-symbols-outlined">done_all</span>
              {t('upd.markSeen')}
            </button>
          )}
        </div>
      </section>

      <section className="online-backup__panel">
        <div className="online-backup__panel-main">
          <p className="mono-cap">{t('upd.scope')}</p>
          <h3>{t('upd.scopeTitle')}</h3>
        </div>
        <div className="ext-manager__lang-filter">
          <select
            value={`${scope?.kind || 'all'}:${scope?.id || ''}`}
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(':');
              pickScope(kind, rest.join(':') || null);
            }}
            aria-label={t('upd.scopeLabel')}
          >
            <option value="all:">{t('upd.all')}</option>
            <optgroup label={t('upd.categories')}>
              {categories.map((c) => (
                <option key={c.id} value={`category:${c.id}`}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label={t('upd.extensions')}>
              {extensions.map((s) => (
                <option key={s.id} value={`extension:${s.id}`}>{s.name}</option>
              ))}
            </optgroup>
          </select>
        </div>
      </section>

      {phase === 'done' && results.length === 0 && !baseline && (
        <div className="ext-manager__empty">
          <span className="material-symbols-outlined">update</span>
          <p>{t('upd.empty')}</p>
        </div>
      )}

      {groups.map((group) => (
        <div key={group.key}>
          <p className="mono-cap">{group.label} — {group.count} {t('upd.new')}</p>
          <div className="ext-list">
            {group.entries.map((entry) => (
              <div className="ext-card" key={`${entry.mangaKey}-${group.key}`}>
                <div className="ext-card__icon">
                  {entry.manga?.coverUrl ? (
                    <img src={entry.manga.coverUrl} alt="" loading="lazy" />
                  ) : (
                    <span className="material-symbols-outlined">book</span>
                  )}
                </div>
                <div className="ext-card__info">
                  <div className="ext-card__name-row">
                    <h3 className="ext-card__name">{entry.manga?.title}</h3>
                    <span className="ext-card__update-badge">+{entry.chapters?.length ?? 0}</span>
                  </div>
                  <p className="ext-card__url">
                    {(entry.chapters || []).map((c) => chapterLabel(c)).join(' · ')}
                  </p>
                </div>
                <div className="ext-card__actions">
                  <button
                    className="ext-card__btn ext-card__btn--browse"
                    onClick={() => onMangaOpen?.({
                      id: entry.manga?.id,
                      sourceId: entry.manga?.sourceId,
                      title: entry.manga?.title,
                      coverUrl: entry.manga?.coverUrl,
                      sourceName: entry.manga?.sourceName,
                    })}
                    title={t('upd.openTitle')}
                    type="button"
                  >
                    <span className="material-symbols-outlined">open_in_new</span>
                    {t('lib.open')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {skipped > 0 && phase === 'done' && (
          <p className="cfg-note">{skipped} {t('upd.skipped')}</p>
      )}
    </div>
  );
}
