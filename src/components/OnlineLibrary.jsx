import React, { useMemo, useState } from 'react';
import {
  addCategory,
  deleteCategory,
  getChapterCounts,
  getMangaStorageKey,
  getReadingProgress,
  removeFavorite,
  updateFavoriteCategories,
} from '../lib/onlineStorage.js';
import { confirmDialog, toast } from './Toast.jsx';
import { t } from '../lib/i18n.js';

const SORTS = [
  { value: 'az', labelKey: 'lib.sortAZ' },
  { value: 'recent', labelKey: 'lib.sortRecent' },
  { value: 'total_desc', labelKey: 'lib.sortChaptersDesc' },
  { value: 'total_asc', labelKey: 'lib.sortChaptersAsc' },
  { value: 'unread_desc', labelKey: 'lib.sortUnreadDesc' },
  { value: 'unread_asc', labelKey: 'lib.sortUnreadAsc' },
];

function chapterTotalOf(counts, manga) {
  const key = getMangaStorageKey(manga);
  const total = Number(counts[key]?.total);
  return Number.isFinite(total) ? total : null;
}

function unreadOf(counts, manga) {
  const total = chapterTotalOf(counts, manga);
  if (total == null) return null;
  const prog = getReadingProgress(manga);
  const read = Object.values(prog?.readChapters ?? {}).filter((r) => r?.completed).length;
  return Math.max(0, total - read);
}

function progressPercent(manga) {
  const progress = getReadingProgress(manga);
  if (!progress?.totalPages) return 0;
  return Math.max(0, Math.min(100, Math.round(((progress.pageIndex + 1) / progress.totalPages) * 100)));
}

export default function OnlineLibrary({
  favorites,
  categories,
  activeCategory,
  onCategoryChange,
  onDataChange,
  onMangaOpen,
}) {
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [dragManga, setDragManga] = useState(null);
  const [dropCat, setDropCat] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('az');

  const baseFiltered = activeCategory
    ? favorites.filter(favorite => favorite.categories?.includes(activeCategory))
    : favorites;

  const filteredFavorites = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? baseFiltered.filter((m) => String(m.title || '').toLowerCase().includes(q))
      : [...baseFiltered];
    const progressOf = (m) => getReadingProgress(m);
    const counts = getChapterCounts();
    switch (sort) {
      case 'recent':
        return list.sort((a, b) => {
          const pa = progressOf(a)?.updatedAt ?? a.addedAt ?? 0;
          const pb = progressOf(b)?.updatedAt ?? b.addedAt ?? 0;
          return pb - pa;
        });
      case 'total_desc':
      case 'total_asc':
      case 'unread_desc':
      case 'unread_asc': {
        const val = (m) => sort.startsWith('total') ? chapterTotalOf(counts, m) : unreadOf(counts, m);
        const desc = sort.endsWith('desc');
        return list.sort((a, b) => {
          const va = val(a);
          const vb = val(b);
          if (va == null && vb == null) return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
          if (va == null) return 1;
          if (vb == null) return -1;
          return desc ? vb - va : va - vb;
        });
      }
      case 'az':
      default:
        return list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR'));
    }
  }, [baseFiltered, query, sort]);

  const activeCategoryName = useMemo(() => {
    if (!activeCategory) return t('lib.all');
    return categories.find(category => category.id === activeCategory)?.name ?? t('lib.categories');
  }, [activeCategory, categories]);

  const sourceCount = useMemo(() => {
    return new Set(favorites.map(manga => manga.sourceId).filter(Boolean)).size;
  }, [favorites]);

  const handleAddCategory = () => {
    const name = newCategoryName.trim();
    if (!name) return;
    addCategory(name);
    setNewCategoryName('');
    setShowCategoryModal(false);
    onDataChange();
  };

  const handleDeleteCategory = async (categoryId) => {
    const confirmed = await confirmDialog({
      title: t('lib.deleteCategoryTitle'),
      body: t('lib.deleteCategoryBody'),
      confirmLabel: t('lib.delete'),
    });
    if (!confirmed) return;
    deleteCategory(categoryId);
    if (activeCategory === categoryId) {
      onCategoryChange(null);
    }
    onDataChange();
  };

  const handleRemoveFavorite = async (manga) => {
    const confirmed = await confirmDialog({
      title: t('lib.removeTitle'),
      body: `"${manga.title}"`,
      confirmLabel: t('lib.remove'),
    });
    if (!confirmed) return;
    removeFavorite(manga.id, manga.sourceId);
    onDataChange();
  };

  const handleDragStart = (event, manga) => {
    setDragManga({ id: manga.id, sourceId: manga.sourceId, title: manga.title });
    event.dataTransfer.effectAllowed = 'move';
    try {
      event.dataTransfer.setData('text/plain', `${manga.sourceId}::${manga.id}`);
    } catch {
      /* drag sem payload: segue pelo estado */
    }
  };

  const handleDragEnd = () => {
    setDragManga(null);
    setDropCat(null);
  };

  const handleDropOnCategory = (event, categoryId, categoryName) => {
    event.preventDefault();
    setDropCat(null);
    if (!dragManga) return;
    updateFavoriteCategories(dragManga.id, dragManga.sourceId, [categoryId]);
    toast(`"${dragManga.title}" → ${categoryName}.`, 'success');
    setDragManga(null);
    onDataChange();
  };

  const cardCounts = getChapterCounts();

  return (
    <div className="online-library">
      <aside className="online-library__sidebar">
        <div className="online-library__sidebar-header">
          <div>
            <p className="mono-cap mono-cap-shu">{t('lib.shelves')}</p>
            <h3>{t('lib.categories')}</h3>
          </div>
          <button
            className="online-library__add-category"
            onClick={() => setShowCategoryModal(true)}
            title={t('lib.addCategory')}
            type="button"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>

        <nav className="online-library__categories" aria-label="Categorias da biblioteca">
          <button
            className={`online-library__category${!activeCategory ? ' active' : ''}`}
            onClick={() => onCategoryChange(null)}
            type="button"
          >
            <span className="online-library__category-kanji">{'\u5168'}</span>
            <span>{t('lib.all')}</span>
            <span className="online-library__category-count">{favorites.length}</span>
          </button>

          {categories.map(category => {
            const count = favorites.filter(favorite => favorite.categories?.includes(category.id)).length;
            return (
              <div key={category.id} className="online-library__category-wrapper">
                <button
                  className={`online-library__category${activeCategory === category.id ? ' active' : ''}${dropCat === category.id ? ' online-library__category--droptarget' : ''}`}
                  onClick={() => onCategoryChange(category.id)}
                  onDragOver={(e) => { e.preventDefault(); setDropCat(category.id); }}
                  onDragLeave={() => setDropCat((cur) => (cur === category.id ? null : cur))}
                  onDrop={(e) => handleDropOnCategory(e, category.id, category.name)}
                  type="button"
                >
                  <span className="online-library__category-kanji">{'\u68da'}</span>
                  <span>{category.name}</span>
                  <span className="online-library__category-count">{count}</span>
                </button>
                <button
                  className="online-library__category-delete"
                  onClick={() => handleDeleteCategory(category.id)}
                  title={t('lib.deleteCategory')}
                  type="button"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            );
          })}
        </nav>
      </aside>

      <section className="online-library__content">
        <div className="online-library__summary">
          <div>
            <p className="mono-cap">{t('lib.library')} / {activeCategoryName}</p>
            <h2>{activeCategoryName}</h2>
          </div>
          <div className="online-library__summary-stats">
            <div>
              <span>{filteredFavorites.length}</span>
              <small>{t('lib.onShelf')}</small>
            </div>
            <div>
              <span>{favorites.length}</span>
              <small>{t('lib.total')}</small>
            </div>
            <div>
              <span>{sourceCount}</span>
              <small>{t('lib.sources')}</small>
            </div>
          </div>
        </div>

        <div className="online-library__toolbar">
          <div className="ext-manager__search">
            <span className="material-symbols-outlined">search</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('lib.filter')}
              aria-label={t('lib.filterLabel')}
            />
            {query && (
              <button className="ext-manager__search-clear" onClick={() => setQuery('')} title={t('lib.clearFilter')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            )}
          </div>
          <div className="ext-manager__lang-filter">
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t('lib.sort')}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{t(s.labelKey)}</option>
              ))}
            </select>
          </div>
        </div>

        {filteredFavorites.length === 0 ? (
          <div className="online-library__empty">
            <span className="material-symbols-outlined online-library__empty-icon">
              bookmark_border
            </span>
            <h3>{t('lib.empty')}</h3>
            <p>{t('lib.emptyHint')}</p>
          </div>
        ) : (
          <div className="online-library__grid lib-fade" key={`${activeCategory ?? 'all'}|${sort}|${query}`}>
            {filteredFavorites.map(manga => {
              const percent = progressPercent(manga);
              const isDragging = dragManga && dragManga.id === manga.id && dragManga.sourceId === manga.sourceId;
              const total = chapterTotalOf(cardCounts, manga);

              return (
                <article
                  key={`${manga.sourceId}-${manga.id}`}
                  className={`online-manga-card${isDragging ? ' online-manga-card--dragging' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, manga)}
                  onDragEnd={handleDragEnd}
                >
                  <div className="online-manga-card__cover">
                    {manga.coverUrl ? (
                      <img src={manga.coverUrl} alt={manga.title} loading="lazy" />
                    ) : (
                      <div className="online-manga-card__cover-placeholder">
                        <span>{'\u672c'}</span>
                      </div>
                    )}
                    {percent > 0 && (
                      <div className="online-manga-card__progress" aria-hidden="true">
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    )}
                    {total != null && (
                      <span className="online-manga-card__count" title={`${total} ${t('lib.chapters')}`}>
                        {total}
                      </span>
                    )}
                    <div className="online-manga-card__overlay">
                      <button
                        className="online-manga-card__action"
                        onClick={() => onMangaOpen?.(manga)}
                        title={t('lib.open')}
                        type="button"
                      >
                        <span className="material-symbols-outlined">visibility</span>
                      </button>
                      <button
                        className="online-manga-card__action online-manga-card__action--danger"
                        onClick={() => handleRemoveFavorite(manga)}
                        title={t('lib.removeTitle')}
                        type="button"
                      >
                        <span className="material-symbols-outlined">bookmark_remove</span>
                      </button>
                    </div>
                  </div>
                  <div className="online-manga-card__info">
                    <h4 className="online-manga-card__title">{manga.title}</h4>
                    <p className="online-manga-card__source">
                      {manga.sourceName || t('lib.unknownSource')}
                      {percent > 0 ? ` / ${percent}%` : ''}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {showCategoryModal && (
        <div className="modal-overlay" onClick={() => setShowCategoryModal(false)}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <div className="modal__header">
              <h2>{t('lib.newCategory')}</h2>
              <button
                className="modal__close"
                onClick={() => setShowCategoryModal(false)}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal__body">
              <label className="modal__label">
                {t('lib.categoryName')}
                <input
                  type="text"
                  className="modal__input"
                  value={newCategoryName}
                  onChange={event => setNewCategoryName(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && handleAddCategory()}
                  placeholder={t('lib.categoryPlaceholder')}
                  autoFocus
                />
              </label>
            </div>
            <div className="modal__footer">
              <button
                className="modal__btn modal__btn--secondary"
                onClick={() => setShowCategoryModal(false)}
                type="button"
              >
                {t('lib.cancel')}
              </button>
              <button
                className="modal__btn modal__btn--primary"
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                type="button"
              >
                {t('lib.add')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
