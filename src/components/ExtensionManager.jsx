import React, { useState, useEffect, useMemo } from 'react';
import {
  BUILTIN_SOURCES,
  getSourceImpl,
} from '../lib/sourceRegistry.js';
import {
  fetchCatalog,
  installExtension,
  uninstallExtension,
  updateExtension,
  getInstalledExtensions,
  toggleExtension,
  checkForUpdates,
  getExtensionIconUrl,
} from '../lib/extensionManager.js';
import {
  checkSourceCompatibility,
  getSourceHealthStore,
  SOURCE_HEALTH_STATUS,
} from '../lib/sourceHealth.js';

const LANG_LABELS = {
  all: 'Multi',
  en: 'English',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
  ko: '한국어',
  zh: '中文',
  ru: 'Русский',
  ar: 'العربية',
  tr: 'Türkçe',
  id: 'Indonesian',
  vi: 'Tiếng Việt',
  th: 'ไทย',
  pl: 'Polski',
};

const TABS = [
  { id: 'installed', label: 'Instaladas', icon: 'download_done' },
  { id: 'browse', label: 'Catálogo', icon: 'store' },
  { id: 'updates', label: 'Atualizações', icon: 'update' },
];

const HEALTH_META = {
  checking: { label: 'Testando', icon: 'progress_activity' },
  untested: { label: 'Nao testada', icon: 'help' },
  [SOURCE_HEALTH_STATUS.COMPATIBLE]: { label: 'Compativel', icon: 'verified' },
  [SOURCE_HEALTH_STATUS.PARTIAL]: { label: 'Parcial', icon: 'rule' },
  [SOURCE_HEALTH_STATUS.FAILING]: { label: 'Falhando', icon: 'warning' },
  [SOURCE_HEALTH_STATUS.UNSUPPORTED]: { label: 'Nao suportada', icon: 'extension_off' },
};

const HEALTH_STEPS = [
  { key: 'browse', label: 'Mangas' },
  { key: 'details', label: 'Detalhes' },
  { key: 'chapters', label: 'Capitulos' },
  { key: 'pages', label: 'Leitura' },
];

function healthRank(health) {
  switch (health?.status) {
    case SOURCE_HEALTH_STATUS.COMPATIBLE: return 0;
    case SOURCE_HEALTH_STATUS.PARTIAL: return 1;
    case undefined: return 2;
    case SOURCE_HEALTH_STATUS.UNSUPPORTED: return 3;
    case SOURCE_HEALTH_STATUS.FAILING: return 4;
    default: return 5;
  }
}

function sourceFromInstalledExtension(ext) {
  return {
    id: ext.id,
    name: ext.name,
    url: ext.baseUrl || ext.config?.baseUrl,
    type: 'extension',
    iconUrl: ext.iconUrl || getExtensionIconUrl(ext),
    lang: ext.lang,
    enabled: ext.enabled !== false,
    supportsBrowse: ext.config?.supportsBrowse !== false,
  };
}

function checkedAtLabel(timestamp) {
  if (!timestamp) return '';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function ExtensionManager({ onExtensionsChange, onBrowseSource }) {
  const [activeTab, setActiveTab] = useState('installed');
  const [catalog, setCatalog] = useState([]);
  const [installed, setInstalled] = useState({});
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(new Set());
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLang, setFilterLang] = useState('all');
  const [updatesAvailable, setUpdatesAvailable] = useState([]);
  const [pendingUninstall, setPendingUninstall] = useState(null);
  const [healthStore, setHealthStore] = useState(() => getSourceHealthStore());
  const [checkingSources, setCheckingSources] = useState(new Set());

  // DADOS
  useEffect(() => {
    setInstalled(getInstalledExtensions());
  }, []);

  // CATALOGO
  useEffect(() => {
    if (activeTab === 'browse' && catalog.length === 0) {
      loadCatalog();
    }
  }, [activeTab, catalog.length]);

  const loadCatalog = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog(force);
      setCatalog(data);
      setUpdatesAvailable(checkForUpdates(data));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (ext) => {
    setInstalling(prev => new Set([...prev, ext.id]));
    try {
      await installExtension(ext);
      setInstalled(getInstalledExtensions());
      onExtensionsChange?.();
    } catch (err) {
      alert(`Falha ao instalar ${ext.name}: ${err.message}`);
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(ext.id);
        return next;
      });
    }
  };

  const handleUninstall = (extId) => {
    uninstallExtension(extId);
    setInstalled(getInstalledExtensions());
    onExtensionsChange?.();
  };

  const handleUpdate = async (extId) => {
    setInstalling(prev => new Set([...prev, extId]));
    try {
      const catalogEntry = catalog.find(ext => ext.id === extId);
      await updateExtension(extId, catalogEntry);
      setInstalled(getInstalledExtensions());
      setUpdatesAvailable(prev => prev.filter(id => id !== extId));
      onExtensionsChange?.();
    } catch (err) {
      alert(`Falha ao atualizar: ${err.message}`);
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(extId);
        return next;
      });
    }
  };

  const handleToggle = (extId) => {
    toggleExtension(extId);
    setInstalled(getInstalledExtensions());
    onExtensionsChange?.();
  };

  const handleCheckSource = async (source) => {
    setCheckingSources(prev => new Set([...prev, source.id]));
    try {
      await checkSourceCompatibility(source);
      setHealthStore(getSourceHealthStore());
    } catch (err) {
      alert(`Falha ao testar ${source.name}: ${err.message}`);
    } finally {
      setCheckingSources(prev => {
        const next = new Set(prev);
        next.delete(source.id);
        return next;
      });
    }
  };

  // LISTAS
  const installedList = useMemo(() => {
    return Object.values(installed)
      .filter(ext => !searchQuery || ext.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (
        healthRank(healthStore[a.id]) - healthRank(healthStore[b.id]) ||
        a.name.localeCompare(b.name)
      ));
  }, [healthStore, installed, searchQuery]);

  const builtInList = useMemo(() => {
    return BUILTIN_SOURCES
      .filter(source => !searchQuery || source.name.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => (
        healthRank(healthStore[a.id]) - healthRank(healthStore[b.id]) ||
        a.name.localeCompare(b.name)
      ));
  }, [healthStore, searchQuery]);

  const availableList = useMemo(() => {
    const installedIds = new Set(Object.keys(installed));
    return catalog.filter(ext => {
      if (installedIds.has(ext.id)) return false;
      if (filterLang !== 'all' && ext.lang !== filterLang) return false;
      if (searchQuery && !ext.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [catalog, installed, searchQuery, filterLang]);

  const updatesList = useMemo(() => {
    return updatesAvailable
      .map(id => installed[id])
      .filter(Boolean);
  }, [updatesAvailable, installed]);

  const availableLangs = useMemo(() => {
    const langs = new Set(catalog.map(ext => ext.lang).filter(lang => lang && lang !== 'all'));
    return ['all', ...Array.from(langs).sort()];
  }, [catalog]);

  const installedCount = Object.keys(installed).length;
  const updatesCount = updatesAvailable.length;
  const tabItems = TABS.map(tab => ({
    ...tab,
    label: tab.id === 'updates' && updatesCount > 0 ? `${tab.label} (${updatesCount})` : tab.label,
  }));

  return (
    <div className="ext-manager">
      <section className="ext-manager__hero">
        <div>
          <p className="mono-cap mono-cap-shu">Keiyoushi / repositório</p>
          <div className="ext-manager__title-row">
            <h2 className="ext-manager__title">Extensões</h2>
            <span className="ext-manager__jp">拡張</span>
          </div>
          <p className="ext-manager__subtitle">
            Instale fontes, atualize parsers e navegue por cada repositório instalado.
          </p>
        </div>

        <div className="ext-manager__stats">
          <div>
            <span className="ext-manager__stat-value">{installedCount}</span>
            <span className="ext-manager__stat-label">instaladas</span>
          </div>
          <div>
            <span className="ext-manager__stat-value">{catalog.length || '-'}</span>
            <span className="ext-manager__stat-label">catálogo</span>
          </div>
          <div>
            <span className="ext-manager__stat-value">{updatesCount}</span>
            <span className="ext-manager__stat-label">pendentes</span>
          </div>
        </div>
      </section>

      <div className="ext-manager__toolbar">
        <div className="ext-manager__tabs">
          {tabItems.map(tab => (
            <button
              key={tab.id}
              className={`ext-manager__tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="material-symbols-outlined">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="ext-manager__filters">
          <div className="ext-manager__search">
            <span className="material-symbols-outlined">search</span>
            <input
              type="text"
              placeholder="Buscar extensão..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="ext-manager__search-clear"
                onClick={() => setSearchQuery('')}
                title="Limpar busca"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            )}
          </div>

          {activeTab === 'browse' && (
            <div className="ext-manager__lang-filter">
              <select
                value={filterLang}
                onChange={e => setFilterLang(e.target.value)}
                aria-label="Filtrar por idioma"
              >
                {availableLangs.map(lang => (
                  <option key={lang} value={lang}>
                    {lang === 'all' ? 'Todos os idiomas' : (LANG_LABELS[lang] || lang.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="ext-manager__error">
          <span className="material-symbols-outlined">error</span>
          <p>{error}</p>
          <button onClick={() => loadCatalog(true)}>Tentar novamente</button>
        </div>
      )}

      <div className="ext-manager__content">
        {activeTab === 'installed' && (
          <>
            {installedList.length === 0 && builtInList.length === 0 ? (
              <div className="ext-manager__empty">
                <span className="material-symbols-outlined">extension_off</span>
                <p>Nenhuma extensão instalada</p>
                <p className="ext-manager__empty-hint">
                  Abra o <strong>Catálogo</strong> para instalar novas fontes.
                </p>
              </div>
            ) : (
              <div className="ext-list">
                {builtInList.map(source => (
                  <ExtensionCard
                    key={source.id}
                    ext={source}
                    status="builtin"
                    health={healthStore[source.id]}
                    isChecking={checkingSources.has(source.id)}
                    onBrowse={() => onBrowseSource?.(source)}
                    onCheck={() => handleCheckSource(source)}
                  />
                ))}
                {installedList.map(ext => {
                  const source = sourceFromInstalledExtension(ext);
                  return (
                    <ExtensionCard
                      key={ext.id}
                      ext={ext}
                      status="installed"
                      health={healthStore[ext.id]}
                      isChecking={checkingSources.has(ext.id)}
                      isUpdating={installing.has(ext.id)}
                      hasUpdate={updatesAvailable.includes(ext.id)}
                      onBrowse={() => onBrowseSource?.(source)}
                      onCheck={ext.enabled === false ? null : () => handleCheckSource(source)}
                      onToggle={() => handleToggle(ext.id)}
                      onUninstall={() => setPendingUninstall(ext)}
                      onUpdate={() => handleUpdate(ext.id)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'browse' && (
          <>
            {loading ? (
              <div className="ext-manager__loading">
                <div className="spinner" />
                <p>Carregando catálogo do Keiyoushi...</p>
              </div>
            ) : (
              <>
                <div className="ext-manager__count">
                  <span>{availableList.length} extensões disponíveis</span>
                  <button
                    className="ext-manager__refresh"
                    onClick={() => loadCatalog(true)}
                    title="Atualizar catálogo"
                  >
                    <span className="material-symbols-outlined">refresh</span>
                  </button>
                </div>
                <div className="ext-list">
                  {availableList.map(ext => (
                    <ExtensionCard
                      key={ext.id}
                      ext={ext}
                      status="available"
                      isInstalling={installing.has(ext.id)}
                      onInstall={() => handleInstall(ext)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {activeTab === 'updates' && (
          <>
            {updatesList.length === 0 ? (
              <div className="ext-manager__empty">
                <span className="material-symbols-outlined">check_circle</span>
                <p>Todas as extensões estão atualizadas</p>
              </div>
            ) : (
              <>
                <button
                  className="ext-manager__update-all"
                  onClick={async () => {
                    for (const ext of updatesList) {
                      await handleUpdate(ext.id);
                    }
                  }}
                >
                  <span className="material-symbols-outlined">system_update</span>
                  Atualizar todas ({updatesList.length})
                </button>
                <div className="ext-list">
                  {updatesList.map(ext => (
                    <ExtensionCard
                      key={ext.id}
                      ext={ext}
                      status="update"
                      isUpdating={installing.has(ext.id)}
                      onUpdate={() => handleUpdate(ext.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="ext-manager__info">
        <span className="material-symbols-outlined">info</span>
        <p>
          As extensões vêm do repositório <strong>Keiyoushi</strong>. O Sumi converte o código Kotlin
          suportado para uso no navegador; fontes com proteções ou formatos ainda não suportados podem
          aparecer com status limitado.
        </p>
      </div>

      {pendingUninstall && (
        <div className="modal-overlay" onClick={() => setPendingUninstall(null)}>
          <div className="modal modal--small" onClick={e => e.stopPropagation()}>
            <div className="modal__header">
              <h2>Desinstalar extensão</h2>
              <button className="modal__close" onClick={() => setPendingUninstall(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal__body">
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Remover <strong>{pendingUninstall.name}</strong> das extensões instaladas?
              </p>
            </div>
            <div className="modal__footer">
              <button
                className="modal__btn modal__btn--secondary"
                onClick={() => setPendingUninstall(null)}
              >
                Cancelar
              </button>
              <button
                className="modal__btn modal__btn--danger"
                onClick={() => {
                  handleUninstall(pendingUninstall.id);
                  setPendingUninstall(null);
                }}
              >
                <span className="material-symbols-outlined">delete</span>
                Desinstalar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// CARD
function ExtensionCard({
  ext, status, health, isChecking, isInstalling, isUpdating, hasUpdate,
  onInstall, onUninstall, onUpdate, onToggle, onBrowse, onCheck,
}) {
  const [imgError, setImgError] = useState(false);
  const iconUrl = ext.iconUrl || (status !== 'builtin' ? getExtensionIconUrl(ext) : null);
  const impl = status === 'available' ? null : getSourceImpl(ext.id);
  const canBrowse = Boolean(onBrowse && ext.enabled !== false && impl);
  const browseUnsupported = Boolean(impl && impl.supportsBrowse === false);
  const isBuiltIn = status === 'builtin';

  return (
    <div className={`ext-card${ext.enabled === false ? ' ext-card--disabled' : ''}`}>
      <div className="ext-card__icon">
        {iconUrl && !imgError ? (
          <img
            src={iconUrl}
            alt=""
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <span className="material-symbols-outlined">{isBuiltIn ? 'hub' : 'extension'}</span>
        )}
      </div>

      <div className="ext-card__info">
        <div className="ext-card__name-row">
          <h3 className="ext-card__name">{ext.name}</h3>
          {isBuiltIn ? (
            <span className="ext-card__update-badge">NATIVA</span>
          ) : (
            <span className="ext-card__lang">{(ext.lang || 'en').toUpperCase()}</span>
          )}
          {hasUpdate && <span className="ext-card__update-badge">UPDATE</span>}
        </div>

        {ext.config?.baseUrl && <p className="ext-card__url">{ext.config.baseUrl}</p>}
        {ext.baseUrl && !ext.config?.baseUrl && <p className="ext-card__url">{ext.baseUrl}</p>}
        {ext.url && !ext.baseUrl && !ext.config?.baseUrl && <p className="ext-card__url">{ext.url}</p>}

        {ext.config?.multisrc && ext.config.multisrc !== 'unknown' && (
          <span className="ext-card__multisrc">{ext.config.multisrc}</span>
        )}
        {isBuiltIn && <span className="ext-card__multisrc">Fonte nativa</span>}
        {status !== 'available' && (
          <SourceHealth health={health} isChecking={isChecking} />
        )}
      </div>

      <div className="ext-card__actions">
        {onCheck && (
          <button
            className="ext-card__btn ext-card__btn--check"
            onClick={onCheck}
            disabled={isChecking}
            title="Testar mangas, detalhes, capitulos e leitura"
          >
            {isChecking ? (
              <div className="spinner spinner--small" />
            ) : (
              <span className="material-symbols-outlined">science</span>
            )}
            Testar
          </button>
        )}

        {canBrowse && (
          <button
            className={`ext-card__btn ${browseUnsupported ? 'ext-card__btn--status' : 'ext-card__btn--browse'}`}
            onClick={onBrowse}
            title={browseUnsupported ? 'Ver status do suporte' : 'Navegar'}
          >
            <span className="material-symbols-outlined">{browseUnsupported ? 'info' : 'explore'}</span>
            {browseUnsupported ? 'Status' : 'Navegar'}
          </button>
        )}

        {status === 'available' && (
          <button
            className="ext-card__btn ext-card__btn--install"
            onClick={onInstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <><div className="spinner spinner--small" /> Instalando...</>
            ) : (
              <><span className="material-symbols-outlined">download</span> Instalar</>
            )}
          </button>
        )}

        {status === 'installed' && (
          <>
            {hasUpdate && (
              <button
                className="ext-card__btn ext-card__btn--update"
                onClick={onUpdate}
                disabled={isUpdating}
                title="Atualizar"
              >
                {isUpdating ? (
                  <div className="spinner spinner--small" />
                ) : (
                  <span className="material-symbols-outlined">update</span>
                )}
              </button>
            )}
            <button
              className="ext-card__btn ext-card__btn--toggle"
              onClick={onToggle}
              title={ext.enabled ? 'Desativar' : 'Ativar'}
            >
              <span className="material-symbols-outlined">
                {ext.enabled !== false ? 'toggle_on' : 'toggle_off'}
              </span>
            </button>
            <button
              className="ext-card__btn ext-card__btn--uninstall"
              onClick={onUninstall}
              title="Desinstalar"
            >
              <span className="material-symbols-outlined">delete</span>
            </button>
          </>
        )}

        {status === 'update' && (
          <button
            className="ext-card__btn ext-card__btn--update"
            onClick={onUpdate}
            disabled={isUpdating}
          >
            {isUpdating ? (
              <><div className="spinner spinner--small" /> Atualizando...</>
            ) : (
              <><span className="material-symbols-outlined">update</span> Atualizar</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function SourceHealth({ health, isChecking }) {
  const status = isChecking ? 'checking' : (health?.status || 'untested');
  const meta = HEALTH_META[status] || HEALTH_META.untested;
  const lastChecked = checkedAtLabel(health?.checkedAt);
  const title = health?.sample?.mangaTitle
    ? `Ultimo teste: ${health.sample.mangaTitle}`
    : meta.label;

  return (
    <div className={`ext-card__health ext-card__health--${status}`} title={title}>
      <span className="ext-card__health-status">
        <span className="material-symbols-outlined">{meta.icon}</span>
        {meta.label}
        {lastChecked && <small>{lastChecked}</small>}
      </span>

      {health?.steps && (
        <span className="ext-card__health-steps">
          {HEALTH_STEPS.map(step => {
            const result = health.steps[step.key];
            const state = result ? (result.ok ? 'ok' : 'fail') : 'idle';
            const stepTitle = result?.error
              ? `${step.label}: ${result.error}`
              : step.label;
            return (
              <span key={step.key} className={`ext-card__health-step ${state}`} title={stepTitle}>
                {step.label.slice(0, 3)}
              </span>
            );
          })}
        </span>
      )}
    </div>
  );
}
