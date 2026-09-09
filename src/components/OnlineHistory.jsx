import React from 'react';
import { clearReadingHistory } from '../lib/onlineStorage.js';
import { confirmDialog } from './Toast.jsx';
import { getLocale, t } from '../lib/i18n.js';

function chapterLabel(chapter) {
  if (!chapter) return t('hist.chapterFallback');
  const base = chapter.chapter ? `${t('hist.chapterShort')} ${chapter.chapter}` : t('hist.oneshot');
  if (!chapter.title || chapter.title === base) return base;
  return `${base} - ${chapter.title}`;
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(getLocale() === 'pt' ? 'pt-BR' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function progressPercent(entry) {
  if (!entry?.totalPages) return 0;
  return Math.max(0, Math.min(100, Math.round(((entry.pageIndex + 1) / entry.totalPages) * 100)));
}

export default function OnlineHistory({ history, onDataChange, onMangaOpen, onContinue }) {
  const handleClear = async () => {
    const confirmed = await confirmDialog({
      title: t('hist.clearTitle'),
      body: t('hist.clearBody'),
      confirmLabel: t('hist.clearConfirm'),
    });
    if (!confirmed) return;
    clearReadingHistory();
    onDataChange?.();
  };

  return (
    <div className="online-history">
      <section className="online-history__summary">
        <div>
          <p className="mono-cap mono-cap-shu">{t('hist.reading')}</p>
          <h2>{t('hist.title')}</h2>
        </div>
        <div className="online-history__actions">
          <div className="online-history__metric">
            <span>{history.length}</span>
            <small>{t('hist.titles')}</small>
          </div>
          {history.length > 0 && (
            <button className="online-history__clear" onClick={handleClear} type="button">
              <span className="material-symbols-outlined">delete_sweep</span>
              {t('hist.clear')}
            </button>
          )}
        </div>
      </section>

      {history.length === 0 ? (
        <div className="online-history__empty">
          <span className="material-symbols-outlined">history</span>
          <h3>{t('hist.empty')}</h3>
          <p>{t('hist.emptyHint')}</p>
        </div>
      ) : (
        <div className="online-history__list">
          {history.map(entry => {
            const percent = progressPercent(entry);
            return (
              <article key={entry.mangaKey} className="history-card">
                <button
                  className="history-card__cover"
                  onClick={() => onMangaOpen?.(entry.manga)}
                  type="button"
                  title={t('hist.openDetails')}
                >
                  {entry.manga.coverUrl ? (
                    <img src={entry.manga.coverUrl} alt={entry.manga.title} loading="lazy" />
                  ) : (
                    <div className="history-card__cover-placeholder">
                      <span className="material-symbols-outlined">menu_book</span>
                    </div>
                  )}
                </button>

                <div className="history-card__body">
                  <div className="history-card__main">
                    <p className="mono-cap">{entry.manga.sourceName || t('hist.source')}</p>
                    <button
                      className="history-card__title"
                      onClick={() => onMangaOpen?.(entry.manga)}
                      type="button"
                    >
                      {entry.manga.title}
                    </button>
                    <p className="history-card__chapter">{chapterLabel(entry.lastChapter)}</p>
                  </div>

                  <div className="history-card__side">
                    <span>{percent}%</span>
                    <small>{formatDate(entry.updatedAt)}</small>
                  </div>

                  <div className="history-card__progress" aria-hidden="true">
                    <span style={{ width: `${percent}%` }} />
                  </div>

                  <div className="history-card__footer">
                    <span>
                      {t('hist.page')} {entry.pageIndex + 1}{entry.totalPages ? ` / ${entry.totalPages}` : ''}
                    </span>
                    <button className="history-card__continue" onClick={() => onContinue?.(entry)} type="button">
                      <span className="material-symbols-outlined">play_arrow</span>
                      {t('hist.continue')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
