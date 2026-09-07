import React, { useMemo, useState } from 'react';
import {
  addCategory,
  deleteCategory,
  getReadingProgress,
  removeFavorite,
} from '../lib/onlineStorage.js';

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

  const filteredFavorites = activeCategory
    ? favorites.filter(favorite => favorite.categories?.includes(activeCategory))
    : favorites;

  const activeCategoryName = useMemo(() => {
    if (!activeCategory) return 'Todos os mang\u00e1s';
    return categories.find(category => category.id === activeCategory)?.name ?? 'Categoria';
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

  const handleDeleteCategory = (categoryId) => {
    if (!window.confirm('Excluir esta categoria? Os mang\u00e1s n\u00e3o ser\u00e3o removidos da biblioteca.')) return;
    deleteCategory(categoryId);
    if (activeCategory === categoryId) {
      onCategoryChange(null);
    }
    onDataChange();
  };

  const handleRemoveFavorite = (manga) => {
    if (!window.confirm(`Remover "${manga.title}" da biblioteca?`)) return;
    removeFavorite(manga.id, manga.sourceId);
    onDataChange();
  };

  return (
    <div className="online-library">
      <aside className="online-library__sidebar">
        <div className="online-library__sidebar-header">
          <div>
            <p className="mono-cap mono-cap-shu">Estantes</p>
            <h3>Categorias</h3>
          </div>
          <button
            className="online-library__add-category"
            onClick={() => setShowCategoryModal(true)}
            title="Adicionar categoria"
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
            <span>Todos</span>
            <span className="online-library__category-count">{favorites.length}</span>
          </button>

          {categories.map(category => {
            const count = favorites.filter(favorite => favorite.categories?.includes(category.id)).length;
            return (
              <div key={category.id} className="online-library__category-wrapper">
                <button
                  className={`online-library__category${activeCategory === category.id ? ' active' : ''}`}
                  onClick={() => onCategoryChange(category.id)}
                  type="button"
                >
                  <span className="online-library__category-kanji">{'\u68da'}</span>
                  <span>{category.name}</span>
                  <span className="online-library__category-count">{count}</span>
                </button>
                <button
                  className="online-library__category-delete"
                  onClick={() => handleDeleteCategory(category.id)}
                  title="Excluir categoria"
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
            <p className="mono-cap">Biblioteca / {activeCategoryName}</p>
            <h2>{activeCategoryName}</h2>
          </div>
          <div className="online-library__summary-stats">
            <div>
              <span>{filteredFavorites.length}</span>
              <small>na estante</small>
            </div>
            <div>
              <span>{favorites.length}</span>
              <small>total</small>
            </div>
            <div>
              <span>{sourceCount}</span>
              <small>fontes</small>
            </div>
          </div>
        </div>

        {filteredFavorites.length === 0 ? (
          <div className="online-library__empty">
            <span className="material-symbols-outlined online-library__empty-icon">
              bookmark_border
            </span>
            <h3>Nenhum mangá nesta estante</h3>
            <p>Use Busca ou Extensões para navegar por uma fonte e adicionar títulos.</p>
          </div>
        ) : (
          <div className="online-library__grid">
            {filteredFavorites.map(manga => {
              const percent = progressPercent(manga);

              return (
                <article key={`${manga.sourceId}-${manga.id}`} className="online-manga-card">
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
                    <div className="online-manga-card__overlay">
                      <button
                        className="online-manga-card__action"
                        onClick={() => onMangaOpen?.(manga)}
                        title="Abrir"
                        type="button"
                      >
                        <span className="material-symbols-outlined">visibility</span>
                      </button>
                      <button
                        className="online-manga-card__action online-manga-card__action--danger"
                        onClick={() => handleRemoveFavorite(manga)}
                        title="Remover da biblioteca"
                        type="button"
                      >
                        <span className="material-symbols-outlined">bookmark_remove</span>
                      </button>
                    </div>
                  </div>
                  <div className="online-manga-card__info">
                    <h4 className="online-manga-card__title">{manga.title}</h4>
                    <p className="online-manga-card__source">
                      {manga.sourceName || 'Fonte desconhecida'}
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
              <h2>Adicionar categoria</h2>
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
                Nome da categoria
                <input
                  type="text"
                  className="modal__input"
                  value={newCategoryName}
                  onChange={event => setNewCategoryName(event.target.value)}
                  onKeyDown={event => event.key === 'Enter' && handleAddCategory()}
                  placeholder="Ex.: Ação, Romance, Favoritos..."
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
                Cancelar
              </button>
              <button
                className="modal__btn modal__btn--primary"
                onClick={handleAddCategory}
                disabled={!newCategoryName.trim()}
                type="button"
              >
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
