import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getMangaStorageKey, getChapterSnapshot, saveChapterSnapshot, recordChapterCount,
  getCategories, getUpdatesScope, saveUpdatesScope, getUpdateFeed, appendUpdateFeed,
  clearUpdateFeed, getUpdatesConfig, saveUpdatesConfig, getUpdatesChecked, saveUpdatesChecked,
} from '../lib/onlineStorage.js';
import { getSuwayomiConfig } from '../lib/parser/connection.js';
import { refreshServerMangaChapters } from '../lib/parser/library.js';
import { getSourceImpl } from '../lib/sourceRegistry.js';
import { isTauriRuntime } from '../../desktop/frontend-integration/tauri-env.js';
import { toast } from './Toast.jsx';
import { getLocale, t } from '../lib/i18n.js';

const INTERVALS = [
  { value: 6, labelKey: 'upd.every6h' },
  { value: 24, labelKey: 'upd.every24h' },
  { value: 72, labelKey: 'upd.every72h' },
  { value: 168, labelKey: 'upd.weekly' },
];

const WEEKDAYS = [
  { value: 1, labelKey: 'upd.mon' },
  { value: 2, labelKey: 'upd.tue' },
  { value: 3, labelKey: 'upd.wed' },
  { value: 4, labelKey: 'upd.thu' },
  { value: 5, labelKey: 'upd.fri' },
  { value: 6, labelKey: 'upd.sat' },
  { value: 0, labelKey: 'upd.sun' },
];

const SKIP_STATUSES = [
  { value: 'completed', labelKey: 'sb.st.completed' },
  { value: 'cancelled', labelKey: 'sb.st.cancelled' },
  { value: 'hiatus', labelKey: 'sb.st.hiatus' },
];

/**
 * OnlineUpdates — novos capítulos dos favoritos, estilo Mihon + smart.
 * Auto ao abrir (se configurado e no dia), manual força tudo. Falhas
 * geram log salvável no Desktop.
 */
export default function OnlineUpdates({ favorites, onMangaOpen }) {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(() => getUpdateFeed());
  const [failures, setFailures] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [skippedSmart, setSkippedSmart] = useState(0);
  const [baseline, setBaseline] = useState(false);
  const [scope, setScope] = useState(() => getUpdatesScope());
  const [config, setConfig] = useState(() => getUpdatesConfig());
  const [showSettings, setShowSettings] = useState(false);
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

  const patchConfig = (patch) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      saveUpdatesConfig(next);
      return next;
    });
  };

  const runCheck = useCallback(async (forced = false) => {
    const id = ++runId.current;
    const cfg = getUpdatesConfig();
    const list = scopedFavorites;
    if (!list.length) {
      setPhase('done');
      return;
    }
    setPhase('checking');
    setFailures([]);
    setSkipped(0);
    setSkippedSmart(0);
    setBaseline(false);
    const checked = getUpdatesChecked();
    const now = Date.now();
    const minMs = cfg.minIntervalHours * 3600000;
    const snapshot = getChapterSnapshot();
    const firstRun = Object.keys(snapshot).length === 0;
    const next = { ...snapshot };
    const checkedNext = { ...checked };
    const freshItems = [];
    const failed = [];
    let skip = 0;
    let smart = 0;
    let done = 0;
    const appConfig = getSuwayomiConfig();
    for (const manga of list) {
      if (runId.current !== id) return;
      const key = getMangaStorageKey(manga);
      // Smart: pula conferidos recentemente (manual força), categorias
      // excluídas e status pulados.
      if (!forced && now - (checkedNext[key] || 0) < minMs) {
        smart += 1;
        done += 1;
        setProgress({ done, total: list.length, current: manga.title });
        continue;
      }
      if (cfg.excludedCategories?.length && (manga.categories || []).some((c) => cfg.excludedCategories.includes(c))) {
        smart += 1;
        done += 1;
        setProgress({ done, total: list.length, current: manga.title });
        continue;
      }
      if (cfg.skipStatuses?.length && cfg.skipStatuses.includes(manga.status)) {
        smart += 1;
        done += 1;
        setProgress({ done, total: list.length, current: manga.title });
        continue;
      }
      done += 1;
      setProgress({ done, total: list.length, current: manga.title });
      try {
        const impl = getSourceImpl(manga.sourceId);
        if (!impl?.getChapters) {
          skip += 1;
          continue;
        }
        try {
          await refreshServerMangaChapters(manga, appConfig);
        } catch {
          /* segue com o cache */
        }
        const chapters = await impl.getChapters(manga.id);
        recordChapterCount(manga, (Array.isArray(chapters) ? chapters : []).length);
        const ids = (Array.isArray(chapters) ? chapters : []).map((c) => String(c.id ?? c.url ?? ''));
        const seen = new Set(next[key] || []);
        const fresh = (Array.isArray(chapters) ? chapters : []).filter((c) => !seen.has(String(c.id ?? c.url ?? '')));
        next[key] = ids;
        checkedNext[key] = now;
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
            foundAt: now,
          });
        }
      } catch (err) {
        failed.push({
          title: manga.title || '?',
          source: manga.sourceName || manga.sourceId || '?',
          error: err?.message || String(err),
        });
      }
    }
    if (runId.current !== id) return;
    saveChapterSnapshot(next);
    saveUpdatesChecked(checkedNext);
    const feed = appendUpdateFeed(freshItems);
    setResults(feed);
    setFailures(failed);
    setSkipped(skip);
    setSkippedSmart(smart);
    setBaseline(firstRun);
    setProgress(null);
    setPhase('done');
    if (firstRun) return;
    if (freshItems.length) {
      toast(`${t('upd.doneOk')} ${freshItems.length} ${freshItems.length === 1 ? t('upd.withNewsOne') : t('upd.withNews')}`, 'success');
    } else if (!failed.length) {
      toast(t('upd.none'), 'info');
    }
    if (failed.length) {
      toast(`${t('upd.doneFail')} ${failed.length} ${failed.length === 1 ? t('upd.failedOne') : t('upd.failedMany')}`, 'error');
    }
  }, [scopedFavorites]);

  // Auto ao abrir: só se ligado, no dia certo.
  useEffect(() => {
    const cfg = getUpdatesConfig();
    if (!cfg.autoOnOpen) return undefined;
    if (cfg.days?.length && !cfg.days.includes(new Date().getDay())) return undefined;
    const timer = setTimeout(() => runCheck(false), 2000);
    return () => {
      clearTimeout(timer);
      runId.current += 1;
    };
  }, [runCheck]);

  useEffect(() => () => {
    runId.current += 1;
  }, []);

  const markAllSeen = () => {
    clearUpdateFeed();
    setResults([]);
    toast(t('upd.feedCleared'), 'success');
  };

  const saveLog = async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const lines = [
      `Sumi — log de falhas em Novidades (${new Date().toLocaleString()})`,
      '',
      ...failures.map((f) => `[${f.source}] ${f.title} :: ${f.error}`),
    ];
    const name = `sumi-updates-log-${stamp}.txt`;
    try {
      if (isTauriRuntime()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const dest = await save({ defaultPath: name, filters: [{ name: 'Texto', extensions: ['txt'] }] });
        if (!dest) return;
        await writeTextFile(dest, lines.join('\n'));
      } else {
        const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast(t('upd.logSaved'), 'success');
    } catch (err) {
      toast(String(err?.message ?? err), 'error');
    }
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
      return new Intl.DateTimeFormat(getLocale() === 'pt' ? 'pt-BR' : 'en-US', { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
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

  const toggleDay = (values, value) => (values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);

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
                  ? `${totalNew} ${totalNew === 1 ? t('upd.summaryOne') : t('upd.summary')} ${results.length} ${results.length === 1 ? t('upd.titleOne') : t('upd.titles')}.`
                  : t('upd.none')}
          </p>
          {failures.length > 0 && phase === 'done' && (
            <p>{failures.length} {failures.length === 1 ? t('upd.failedOne') : t('upd.failedMany')}</p>
          )}
        </div>
        <div className="online-backup__actions">
          <button
            className="online-backup__button"
            onClick={() => runCheck(true)}
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
          {failures.length > 0 && phase === 'done' && (
            <button
              className="online-backup__button"
              onClick={saveLog}
              type="button"
            >
              <span className="material-symbols-outlined">description</span>
              {t('upd.saveLog')}
            </button>
          )}
          <button
            className="online-backup__button"
            onClick={() => setShowSettings((v) => !v)}
            title={t('upd.settings')}
            type="button"
          >
            <span className="material-symbols-outlined">settings</span>
          </button>
        </div>
      </section>

      {showSettings && (
      <>
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

      <section className="online-backup__panel">
        <div className="online-backup__panel-main">
          <p className="mono-cap">{t('upd.smart')}</p>
          <h3>{t('upd.smartTitle')}</h3>
          <p>{t('upd.smartHint')}</p>
        </div>
      </section>

      <div className="ext-manager__lang-filter">
        <label className="cat-checkbox">
          <input
            type="checkbox"
            checked={config.autoOnOpen !== false}
            onChange={(e) => patchConfig({ autoOnOpen: e.target.checked })}
          />
          <span>{t('upd.autoOnOpen')}</span>
        </label>
      </div>

      <p className="mono-cap">{t('upd.days')}</p>
      <div className="ext-manager__lang-filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {WEEKDAYS.map((d) => (
          <label key={d.value} className="cat-checkbox">
            <input
              type="checkbox"
              checked={(config.days ?? []).includes(d.value)}
              onChange={() => patchConfig({ days: toggleDay(config.days ?? [], d.value) })}
            />
            <span>{t(d.labelKey)}</span>
          </label>
        ))}
      </div>

      <p className="mono-cap">{t('upd.interval')}</p>
      <div className="ext-manager__lang-filter">
        <select
          value={config.minIntervalHours ?? 24}
          onChange={(e) => patchConfig({ minIntervalHours: Number(e.target.value) })}
          aria-label={t('upd.interval')}
        >
          {INTERVALS.map((o) => (
            <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
          ))}
        </select>
      </div>

      <p className="mono-cap">{t('upd.excludeCats')}</p>
      <div className="ext-manager__lang-filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {categories.map((c) => (
          <label key={c.id} className="cat-checkbox">
            <input
              type="checkbox"
              checked={(config.excludedCategories ?? []).includes(c.id)}
              onChange={() => patchConfig({ excludedCategories: toggleDay(config.excludedCategories ?? [], c.id) })}
            />
            <span>{c.name}</span>
          </label>
        ))}
      </div>

      <p className="mono-cap">{t('upd.skipStatus')}</p>
      <div className="ext-manager__lang-filter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SKIP_STATUSES.map((s) => (
          <label key={s.value} className="cat-checkbox">
            <input
              type="checkbox"
              checked={(config.skipStatuses ?? []).includes(s.value)}
              onChange={() => patchConfig({ skipStatuses: toggleDay(config.skipStatuses ?? [], s.value) })}
            />
            <span>{t(s.labelKey)}</span>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="online-backup__button"
          onClick={() => setShowSettings((v) => !v)}
          type="button"
        >
          <span className="material-symbols-outlined">settings</span>
          {t('upd.settings')}
        </button>
      </div>
      </>
      )}

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
      {skippedSmart > 0 && phase === 'done' && (
        <p className="cfg-note">{skippedSmart} {t('upd.skippedSmart')}</p>
      )}
    </div>
  );
}
