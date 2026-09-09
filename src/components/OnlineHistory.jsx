import React from 'react';
import { clearReadingHistory } from '../lib/onlineStorage.js';
import { confirmDialog } from './Toast.jsx';

function chapterLabel(chapter) {
  if (!chapter) return 'Capitulo';
  const base = chapter.chapter ? `Cap. ${chapter.chapter}` : 'Oneshot';
  if (!chapter.title || chapter.title === base) return base;
  return `${base} - ${chapter.title}`;
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
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
      title: 'Limpar histórico?',
      body: 'Apaga todo o histórico de leitura.',
      confirmLabel: 'Limpar',
    });
    if (!confirmed) return;
    clearReadingHistory();
    onDataChange?.();
  };

  return (
    <div className="online-history">
      <section className="online-history__summary">
        <div>
          <p className="mono-cap mono-cap-shu">Leitura local</p>
          <h2>Historico recente</h2>
        </div>
        <div className="online-history__actions">
          <div className="online-history__metric">
            <span>{history.length}</span>
            <small>titulos</small>
          </div>
          {history.length > 0 && (
            <button className="online-history__clear" onClick={handleClear} type="button">
              <span className="material-symbols-outlined">delete_sweep</span>
              Limpar
            </button>
          )}
        </div>
      </section>

      {history.length === 0 ? (
        <div className="online-history__empty">
          <span className="material-symbols-outlined">history</span>
          <h3>Nenhuma leitura registrada</h3>
          <p>Abra um capitulo para o Sumi salvar seu progresso neste PC.</p>
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
                  title="Abrir detalhes"
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
                    <p className="mono-cap">{entry.manga.sourceName || 'Fonte'}</p>
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
                      Pag. {entry.pageIndex + 1}{entry.totalPages ? ` / ${entry.totalPages}` : ''}
                    </span>
                    <button className="history-card__continue" onClick={() => onContinue?.(entry)} type="button">
                      <span className="material-symbols-outlined">play_arrow</span>
                      Continuar
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
