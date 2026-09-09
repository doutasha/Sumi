import React, { useState, useEffect, useCallback } from 'react';
import { getSources, getCategories, getFavorites, getReadingHistory, getChapterStorageKey } from '../lib/onlineStorage.js';
import { clearServerSourceCache } from '../lib/sourceRegistry.js';
import { checkHealth, getSuwayomiConfig } from '../lib/parser/connection.js';
import { isTauriRuntime } from '../../desktop/frontend-integration/tauri-env.js';
import { watchServer } from '../../desktop/frontend-integration/sidecar.js';
import { checkForUpdates } from '../../desktop/frontend-integration/updater.js';
import Tour from './Tour.jsx';
import { ToastHost } from './Toast.jsx';
import { tourSteps, TOUR_START_EVENT } from '../lib/tour.js';
import OnlineLibrary from './OnlineLibrary.jsx';
import SourceBrowser from './SourceBrowser.jsx';
import MangaDetailPage from './MangaDetailPage.jsx';
import ChapterReader from './ChapterReader.jsx';
import OnlineSearch from './OnlineSearch.jsx';
import ExtensionManager from './ExtensionManager.jsx';
import SettingsScreen from './SettingsScreen.jsx';
import OnlineHistory from './OnlineHistory.jsx';
import OnlineBackup from './OnlineBackup.jsx';

const MAIN_VIEWS = [
  { id: 'library', icon: 'local_library', kanji: '\u672c', label: 'Biblioteca', title: 'Biblioteca', jp: '\u672c\u68da' },
  { id: 'history', icon: 'history', kanji: '\u8a18', label: 'Hist\u00f3rico', title: 'Hist\u00f3rico', jp: '\u5c65\u6b74' },
  { id: 'backup', icon: 'backup', kanji: '\u4fdd', label: 'Backup', title: 'Backup', jp: '\u4fdd\u5b58' },
  { id: 'extensions', icon: 'extension', kanji: '\u62e1', label: 'Extens\u00f5es', title: 'Extens\u00f5es', jp: '\u62e1\u5f35' },
  { id: 'search', icon: 'travel_explore', kanji: '\u7d22', label: 'Busca', title: 'Busca global', jp: '\u691c\u7d22' },
  { id: 'settings', icon: 'settings', kanji: '\u8a2d', label: 'Config', title: 'Configurações', jp: '\u8a2d\u5b9a' },
];

function parseChapterNumber(chapter) {
  const raw = chapter?.chapter ?? chapter?.number;
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).replace(',', '.').trim();
  const match = text.match(/\d+(?:\.\d+)?/);
  const parsed = Number.parseFloat(match?.[0] ?? text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getNavigationChapters(chapters) {
  const list = Array.isArray(chapters) ? chapters.filter(Boolean) : [];
  if (list.length < 2) return list;

  const indexed = list.map((chapter, index) => ({
    chapter,
    index,
    number: parseChapterNumber(chapter),
  }));
  const numberedCount = indexed.filter(item => item.number !== null).length;

  if (numberedCount < Math.max(2, Math.ceil(list.length * 0.7))) {
    return list;
  }

  return indexed
    .sort((a, b) => {
      if (a.number !== null && b.number !== null && a.number !== b.number) {
        return a.number - b.number;
      }
      if (a.number !== null && b.number === null) return -1;
      if (a.number === null && b.number !== null) return 1;
      return a.index - b.index;
    })
    .map(item => item.chapter);
}

function findChapterIndex(chapters, chapter) {
  const key = getChapterStorageKey(chapter);
  if (key && key !== 'unknown') {
    const byKey = chapters.findIndex(item => getChapterStorageKey(item) === key);
    if (byKey >= 0) return byKey;
  }
  return chapters.findIndex(item => item === chapter);
}

// NAV STACK
export default function OnlineReader({ startTour = false }) {
  const [sources, setSources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [history, setHistory] = useState([]);
  const [activeView, setActiveView] = useState('library');
  const [activeCategory, setActiveCategory] = useState(null);
  const [navStack, setNavStack] = useState([]);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => { loadData(); }, []);

  // Tour: pedido do Welcome (1º boot) ou replay (evento).
  useEffect(() => {
    if (startTour) setTourActive(true);
  }, [startTour]);
  useEffect(() => {
    const onStart = () => {
      setNavStack([]);
      setTourActive(true);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, []);

  // Vigia do motor embutido (desktop): relança sozinho se o java morrer.
  // Só no Tauri; no browser vira no-op. Silencioso por desenho.
  useEffect(() => {
    if (!isTauriRuntime()) return undefined;
    const stop = watchServer({ checkHealth, getConfig: getSuwayomiConfig });
    return stop;
  }, []);

  // Checagem de update ao abrir (desktop, 1x, silenciosa): só mostra o aviso.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let alive = true;
    const timer = setTimeout(() => {
      checkForUpdates()
        .then((info) => { if (alive && info) setPendingUpdate(info); })
        .catch(() => {});
    }, 15000);
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  const loadData = () => {
    setSources(getSources());
    setCategories(getCategories());
    setFavorites(getFavorites());
    setHistory(getReadingHistory());
  };

  const handleExtensionsChange = useCallback(() => {
    clearServerSourceCache();
    loadData();
  }, []);

  const handleBackupRestore = useCallback(() => {
    clearServerSourceCache();
    loadData();
  }, []);

  const pushNav = (page) => setNavStack(prev => [...prev, page]);
  const popNav = () => setNavStack(prev => prev.slice(0, -1));

  const openSource = useCallback((source, siblings = null) => pushNav({ type: 'source-browser', source, siblings }), []);
  const openManga = useCallback((manga) => pushNav({ type: 'manga-detail', manga }), []);

  const openChapter = useCallback((ch, manga, chapters) => {
    const chapterList = Array.isArray(chapters) && chapters.length ? chapters : [ch];
    pushNav({ type: 'chapter-reader', chapter: ch, manga, chapters: chapterList });
  }, []);

  const goToChapterByIndex = (idx, navigationChapters) => {
    setNavStack(prev => {
      const next = [...prev];
      const top = next[next.length - 1];
      if (top?.type !== 'chapter-reader') return prev;
      const list = Array.isArray(navigationChapters) ? navigationChapters : getNavigationChapters(top.chapters);
      const ch = list[idx];
      if (!ch) return prev;
      next[next.length - 1] = { ...top, chapter: ch };
      return next;
    });
  };

  if (navStack.length > 0) {
    const top = navStack[navStack.length - 1];

    if (top.type === 'source-browser') {
      return (
        <div className="online-reader sumi-reader sumi-reader--stack">
          <SourceBrowser source={top.source} siblings={top.siblings ?? null} onMangaSelect={openManga} onBack={popNav} />
        </div>
      );
    }

    if (top.type === 'manga-detail') {
      return (
        <div className="online-reader sumi-reader sumi-reader--stack">
          <main className="online-main online-main--detail">
            <MangaDetailPage
              manga={top.manga}
              onChapterSelect={(ch, manga, chapters) => openChapter(ch, manga, chapters)}
              onBack={popNav}
            />
          </main>
        </div>
      );
    }

    if (top.type === 'chapter-reader') {
      const navigationChapters = getNavigationChapters(top.chapters);
      const idx = findChapterIndex(navigationChapters, top.chapter);
      const hasChapterNav = idx >= 0;
      const hasPrev = hasChapterNav && idx > 0;
      const hasNext = hasChapterNav && idx < navigationChapters.length - 1;
      return (
        <ChapterReader
          chapter={top.chapter}
          manga={top.manga}
          hasPrev={hasPrev}
          hasNext={hasNext}
          nextChapter={hasNext ? navigationChapters[idx + 1] : null}
          onBack={popNav}
          onPrev={() => hasPrev && goToChapterByIndex(idx - 1, navigationChapters)}
          onNext={() => hasNext && goToChapterByIndex(idx + 1, navigationChapters)}
          onProgressChange={loadData}
        />
      );
    }
  }

  const activeMeta = MAIN_VIEWS.find(view => view.id === activeView) ?? MAIN_VIEWS[0];

  return (
    <div className="online-reader sumi-reader sumi-shell">
      <aside className="sumi-sidebar">
        <div className="sumi-brand">
          <div className="sumi-brand__seal">{'\u58a8'}</div>
          <div>
            <p className="sumi-brand__name">SUMI</p>
            <p className="sumi-brand__subtitle">Online Reader</p>
          </div>
        </div>

        <nav className="sumi-nav" aria-label="Navegação principal">
          {MAIN_VIEWS.map(view => (
            <button
              key={view.id}
              data-tour={`nav-${view.id}`}
              className={`sumi-nav__item${activeView === view.id ? ' active' : ''}`}
              onClick={() => setActiveView(view.id)}
            >
              <span className="sumi-nav__kanji">{view.kanji}</span>
              <span className="material-symbols-outlined">{view.icon}</span>
              <span>{view.label}</span>
            </button>
          ))}
        </nav>

        <div className="sumi-sidebar__footer">
          <span className="mono-cap">Sumi</span>
        </div>
      </aside>

      <div className="sumi-content">
        <header className="sumi-topbar">
          <div>
            <p className="mono-cap mono-cap-shu">SUMI / {activeMeta.label}</p>
            <div className="sumi-topbar__title-row">
              <h1 className="sumi-topbar__title">{activeMeta.title}</h1>
              <span className="sumi-topbar__jp">{activeMeta.jp}</span>
            </div>
          </div>

          <div className="sumi-topbar__stats">
            <div>
              <span className="sumi-stat__value">{favorites.length}</span>
              <span className="sumi-stat__label">na biblioteca</span>
            </div>
            <div>
              <span className="sumi-stat__value">{history.length}</span>
              <span className="sumi-stat__label">no histórico</span>
            </div>
          </div>
        </header>

        {pendingUpdate && (
          <div className="ext-manager__count">
            <span>Nova versão v{pendingUpdate.version} disponível.</span>
            <span>
              <button
                className="ext-manager__refresh"
                onClick={() => { setActiveView('settings'); setPendingUpdate(null); }}
                title="Ver atualização no Config"
              >
                <span className="material-symbols-outlined">system_update</span>
              </button>
            </span>
          </div>
        )}

        <main className="online-main sumi-main">
          {activeView === 'library' && (
            <OnlineLibrary
              favorites={favorites}
              categories={categories}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              onDataChange={loadData}
              onMangaOpen={openManga}
            />
          )}

          {activeView === 'history' && (
            <OnlineHistory
              history={history}
              onDataChange={loadData}
              onMangaOpen={openManga}
              onContinue={(entry) => openChapter(entry.lastChapter, entry.manga, [entry.lastChapter])}
            />
          )}

          {activeView === 'backup' && (
            <OnlineBackup onRestore={handleBackupRestore} />
          )}

          {activeView === 'extensions' && (
            <ExtensionManager
              onExtensionsChange={handleExtensionsChange}
              onBrowseSource={openSource}
            />
          )}

          {activeView === 'search' && (
            <OnlineSearch sources={sources} onMangaSelect={openManga} />
          )}

          {activeView === 'settings' && (
            <SettingsScreen />
          )}
        </main>
      </div>
      {tourActive && (
        <Tour
          steps={tourSteps(isTauriRuntime())}
          onNavigate={(view) => { setNavStack([]); setActiveView(view); }}
          onDone={() => setTourActive(false)}
        />
      )}
      <ToastHost />
    </div>
  );
}
