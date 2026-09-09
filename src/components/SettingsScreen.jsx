import React, { useEffect, useState } from 'react';
import ServerStatus from './ServerStatus.jsx';
import { checkHealth, getSuwayomiConfig, saveSuwayomiConfig } from '../lib/parser/connection.js';
import { addExtensionRepo, listRepos, removeRepo, refreshServerExtensions } from '../lib/parser/extensions.js';
import { refreshServerSources } from '../lib/parser/sources.js';
import { clearServerSourceCache } from '../lib/sourceRegistry.js';
import { isTauriRuntime } from '../../desktop/frontend-integration/tauri-env.js';
import { sidecarStatus, sidecarStart, sidecarStop, sidecarDownload, sidecarSetKcef } from '../../desktop/frontend-integration/sidecar.js';
import { checkForUpdates, installUpdate, currentVersion } from '../../desktop/frontend-integration/updater.js';
import { clearCaches, wipeAllAppData, wipePreview, formatBytes } from '../lib/parser/maintenance.js';
import { getStoredLocale, setLocale, t } from '../lib/i18n.js';
import { TOUR_SECTION_EVENT, startTour } from '../lib/tour.js';

/**
 * SettingsScreen — Configurações > Motor + Biblioteca > Repositórios.
 * O app sai vazio (sem repos, sem extensões): o usuário adiciona o
 * indexUrl do repo que quiser (Keiyoushi ou outro compatível com Mihon).
 *
 * Layout em sanfona: uma seção aberta por vez (motor / embutido / biblioteca).
 */
function Section({ id, num, title, hint, hintTone, open, onToggle, children }) {
  return (
    <section className="ext-manager__content cfg-sec">
      <button
        className="cfg-head"
        data-tour={id ? `cfg-${id}` : undefined}
        onClick={onToggle}
        aria-expanded={open}
        title={open ? `Recolher ${title}` : `Expandir ${title}`}
      >
        <span className="cfg-num">{num}</span>
        <span className="cfg-title">{title}</span>
        {hint && (
          <span className={`cfg-status${hintTone ? ` cfg-status--${hintTone}` : ''}`}>{hint}</span>
        )}
        <span className="material-symbols-outlined">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && children}
    </section>
  );
}

export default function SettingsScreen() {
  const [config, setConfig] = useState(() => getSuwayomiConfig());
  const [baseUrlInput, setBaseUrlInput] = useState(config.baseUrl);
  const [health, setHealth] = useState(null);
  const [repos, setRepos] = useState([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [isDesktop] = useState(() => isTauriRuntime());
  const [sidecar, setSidecar] = useState(null);
  const [sidecarBusy, setSidecarBusy] = useState(false);
  const [dlProgress, setDlProgress] = useState(null);
  const [openSection, setOpenSection] = useState('motor');
  const toggleSection = (id) => setOpenSection((cur) => (cur === id ? null : id));
  // Numeração segue as seções VISÍVEIS (2 e 4 são só-desktop).
  const visibleSections = [
    'motor',
    ...(isDesktop ? ['sidecar'] : []),
    'library',
    ...(isDesktop ? ['updates'] : []),
    'data',
    'lang',
  ];
  const numOf = (id) => visibleSections.indexOf(id) + 1;
  const [appVersion, setAppVersion] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [upProgress, setUpProgress] = useState(null);
  const [maintBusy, setMaintBusy] = useState(false);
  const [wipeArmed, setWipeArmed] = useState(false);
  const [wipeBytes, setWipeBytes] = useState(null);
  const [storedLocale, setStoredLocale] = useState(() => getStoredLocale());

  const loadRepos = async (cfg = config) => {
    setReposLoading(true);
    try {
      setRepos(await listRepos(cfg));
    } catch {
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  };

  useEffect(() => {
    checkHealth().then(setHealth).catch(() => setHealth({ online: false }));
    loadRepos();
    if (isTauriRuntime()) {
      sidecarStatus().then(setSidecar).catch(() => setSidecar(null));
      currentVersion().then(setAppVersion).catch(() => {});
    }
    const onTourSection = (event) => {
      const id = event?.detail;
      if (typeof id === 'string') setOpenSection(id);
    };
    window.addEventListener(TOUR_SECTION_EVENT, onTourSection);
    return () => window.removeEventListener(TOUR_SECTION_EVENT, onTourSection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (message, isError = false) => {
    setError(isError ? message : null);
    setNotice(!isError ? message : null);
  };

  const handleSaveEngine = async () => {
    const baseUrl = baseUrlInput.trim().replace(/\/$/, '') || 'http://127.0.0.1:4567';
    const next = saveSuwayomiConfig({ ...config, baseUrl });
    setConfig(next);
    const status = await checkHealth(next).catch((err) => ({ online: false, message: err.message }));
    setHealth(status);
    await loadRepos(next);
    flash(status.online ? t('cfg.engineConnected') : `${t('cfg.engineUnreachable')} ${status.message ?? status.code}`, !status.online);
  };

  const handleToggleEngine = async () => {
    const next = saveSuwayomiConfig({ ...config, enabled: !config.enabled });
    setConfig(next);
    setHealth(await checkHealth(next).catch((err) => ({ online: false, message: err.message })));
  };

  const refreshSidecar = async () => {
    try {
      setSidecar(await sidecarStatus());
    } catch {
      setSidecar(null);
    }
    setHealth(await checkHealth().catch((err) => ({ online: false, message: err.message })));
  };

  const handleSidecarStart = async () => {
    setSidecarBusy(true);
    try {
      await sidecarStart();
      await refreshSidecar();
      flash('Motor embutido iniciado.');
    } catch (err) {
      flash(String(err?.message ?? err), true);
    } finally {
      setSidecarBusy(false);
    }
  };

  const handleSidecarStop = async () => {
    setSidecarBusy(true);
    try {
      await sidecarStop();
      await refreshSidecar();
      flash('Motor embutido parado.');
    } catch (err) {
      flash(String(err?.message ?? err), true);
    } finally {
      setSidecarBusy(false);
    }
  };

  const handleSidecarDownload = async () => {
    setSidecarBusy(true);
    setDlProgress({ phase: 'jar', received: 0, total: 1 });
    try {
      const res = await sidecarDownload({
        onProgress: (ev) => setDlProgress(ev),
      });
      setDlProgress(null);
      await refreshSidecar();
      flash(res?.cached ? t('cfg.engineCached') : `${t('cfg.engineDownloaded')} (${res?.javaVersion ?? 'java ok'}).`);
    } catch (err) {
      setDlProgress(null);
      flash(String(err?.message ?? err), true);
    } finally {
      setSidecarBusy(false);
    }
  };

  const handleSidecarKcef = async () => {
    const next = !sidecar?.kcef;
    setSidecarBusy(true);
    try {
      await sidecarSetKcef(next);
      if (sidecar?.running) {
        await sidecarStop();
        await sidecarStart();
      }
      await refreshSidecar();
      flash(next ? t('cfg.kcefEnabledMsg') : t('cfg.kcefDisabledMsg'));
    } catch (err) {
      flash(String(err?.message ?? err), true);
    } finally {
      setSidecarBusy(false);
    }
  };

  const handleCheckUpdates = async () => {
    setUpdateBusy(true);
    try {
      const info = await checkForUpdates();
      setUpdateInfo(info);
      flash(info ? `${t('cfg.updateAvailable')} v${info.version}.` : t('cfg.upToDate'));
    } catch (err) {
      flash(String(err?.message ?? err), true);
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleInstallUpdate = async () => {
    setUpdateBusy(true);
    setUpProgress({ phase: 'download', received: 0, total: 0 });
    try {
      const res = await installUpdate({ onProgress: (ev) => setUpProgress(ev) });
      setUpProgress(null);
      if (!res?.updated) {
        flash(t('cfg.upToDate'));
        setUpdateInfo(null);
      }
      // Se atualizou, o instalador reinicia o app sozinho (Windows).
    } catch (err) {
      setUpProgress(null);
      flash(String(err?.message ?? err), true);
    } finally {
      setUpdateBusy(false);
    }
  };

  const upLabel = () => {
    if (!upProgress) return null;
    if (upProgress.phase === 'install') return t('cfg.installingRestart');
    const { received = 0, total = 0 } = upProgress;
    if (!total) return `${t('cfg.downloading')}… (${(received / 1048576).toFixed(0)}MB)`;
    return `${t('cfg.downloading')}… ${Math.round((received / total) * 100)}% (${(received / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)}MB)`;
  };

  const handleClearCaches = async () => {
    setMaintBusy(true);
    try {
      const res = await clearCaches();
      await loadRepos();
      setHealth(await checkHealth().catch((err) => ({ online: false, message: err.message })));
      flash(`${t('cfg.cacheCleaned')} (${res.frontendKeys} ${t('cfg.cacheLocal')}${res.serverImages ? ` + ${t('cfg.cacheCovers')}` : ''}).`);
    } catch (err) {
      flash(String(err?.message ?? err), true);
    } finally {
      setMaintBusy(false);
    }
  };

  const handleWipe = async () => {
    if (!wipeArmed) {
      setWipeArmed(true);
      try {
        const prev = await wipePreview().catch(() => null);
        if (prev) setWipeBytes(prev.freedBytes);
      } catch {
        /* mostra sem o tamanho */
      }
      window.setTimeout(() => setWipeArmed(false), 8000);
      return;
    }
    setMaintBusy(true);
    try {
      const res = await wipeAllAppData();
      flash(`${t('cfg.wiped')} (${formatBytes(res?.freedBytes)})`);
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      flash(String(err?.message ?? err), true);
    } finally {
      setMaintBusy(false);
      setWipeArmed(false);
    }
  };

  const handleLocale = (value) => {
    setLocale(value);
    setStoredLocale(getStoredLocale());
    flash(t('lang.saved'));
  };

  const dlLabel = () => {
    if (!dlProgress) return null;
    const { phase, received = 0, total = 0 } = dlProgress;
    if (phase === 'done') return t('cfg.done');
    if (phase === 'extract') return `${t('cfg.extracting')} (${received}/${total})`;
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    const mb = (v) => `${(v / 1048576).toFixed(0)}MB`;
    const name = phase === 'jar' ? 'JAR' : 'JRE';
    return `${t('cfg.downloading')} ${name}… ${pct}% (${mb(received)}/${mb(total)})`;
  };

  const syncAfterRepoChange = async (cfg = config) => {
    try {
      await refreshServerExtensions(cfg);
      await refreshServerSources(cfg);
    } catch {
      /* catálogo atualiza na próxima abertura */
    }
    clearServerSourceCache();
    await loadRepos(cfg);
  };

  const handleAddRepo = async () => {
    const indexUrl = repoInput.trim();
    if (!/^https?:\/\/.+/i.test(indexUrl)) {
      flash(t('cfg.invalidRepoUrl'), true);
      return;
    }
    if (repos.some((repo) => repo.indexUrl === indexUrl)) {
      flash(t('cfg.repoExists'), true);
      return;
    }
    setBusy(true);
    try {
      await addExtensionRepo(indexUrl);
      setRepoInput('');
      await syncAfterRepoChange();
      flash(t('cfg.repoAdded'));
    } catch (err) {
      flash(`${t('cfg.repoAddFail')}: ${err.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveRepo = async (indexUrl) => {
    setBusy(true);
    try {
      await removeRepo(indexUrl);
      await syncAfterRepoChange();
      flash(t('cfg.repoRemoved'));
    } catch (err) {
      flash(`${t('cfg.repoRemoveFail')}: ${err.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ext-manager">
      <section className="ext-manager__hero">
          <div>
            <p className="mono-cap mono-cap-shu">{t('cfg.kicker')}</p>
            <div className="ext-manager__title-row">
              <h2 className="ext-manager__title">{t('cfg.title')}</h2>
              <span className="ext-manager__jp">設定</span>
            </div>
            <p className="ext-manager__subtitle">
              {t('cfg.subtitle')}
            </p>
            <p className="cfg-note">
              {t('cfg.creditsA')} <strong>Suwayomi-Server</strong> · {t('cfg.creditsB')}
              <strong> Keiyoushi/Mihon</strong> · {t('cfg.creditsC')}
            </p>
          <p className="cfg-note">
            <button
              className="online-backup__button"
              onClick={() => startTour()}
              title={t('welcome.tour')}
              type="button"
            >
              <span className="material-symbols-outlined">tour</span>
              {t('welcome.tour')}
            </button>
          </p>
        </div>
        <div className="ext-manager__stats">
          <div>
            <span className="ext-manager__stat-value">{health?.online ? health.sourceCount ?? '–' : '–'}</span>
            <span className="ext-manager__stat-label">{t('cfg.sourcesOnEngine')}</span>
          </div>
          <div>
            <span className="ext-manager__stat-value">{repos.length}</span>
            <span className="ext-manager__stat-label">{t('cfg.repos')}</span>
          </div>
        </div>
      </section>

      {error && (
        <div className="ext-manager__error">
          <span className="material-symbols-outlined">error</span>
          <p>{error}</p>
        </div>
      )}
      {notice && (
        <div className="ext-manager__count">
          <span>{notice}</span>
        </div>
      )}

      <Section
        id="motor"
        num={numOf('motor')}
        title={t('cfg.secMotor')}
        hint={health?.online ? `${health.sourceCount ?? '–'} fontes` : 'offline'}
        hintTone={health?.online ? 'ok' : 'warn'}
        open={openSection === 'motor'}
        onToggle={() => toggleSection('motor')}
      >
        <ServerStatus />
        <div className="ext-manager__search">
          <span className="material-symbols-outlined">dns</span>
          <input
            type="text"
            value={baseUrlInput}
            onChange={(e) => setBaseUrlInput(e.target.value)}
            placeholder="http://127.0.0.1:4567"
            aria-label={t('cfg.addrLabel')}
          />
        </div>
        <div className="cfg-row">
          <span className="cfg-row__label">{t('cfg.connLabel')}<small>{t('cfg.connHint')}</small></span>
          <span className="cfg-row__actions">
            <button className="online-backup__button" onClick={handleSaveEngine} title={t('cfg.saveTest')}>
              <span className="material-symbols-outlined">save</span>
              {t('cfg.save')}
            </button>
            <button className="online-backup__button" onClick={handleToggleEngine} title={config.enabled ? t('cfg.turnOff') : t('cfg.turnOn')}>
              <span className="material-symbols-outlined">{config.enabled ? 'toggle_on' : 'toggle_off'}</span>
              {config.enabled ? t('cfg.engineOn') : t('cfg.engineLight')}
            </button>
          </span>
        </div>
      </Section>

      {isDesktop && (
        <Section
          id="sidecar"
          num={numOf('sidecar')}
          title={t('cfg.secSidecar')}
          hint={sidecar?.running ? `${t('cfg.scHintRunning')} ${sidecar.info?.pid}` : sidecar?.needsDownload ? t('cfg.scHintDownload') : t('cfg.scHintStopped')}
          hintTone={sidecar?.running ? 'ok' : 'warn'}
          open={openSection === 'sidecar'}
          onToggle={() => toggleSection('sidecar')}
        >
          <p className="cfg-note">
            {sidecar?.running
              ? `${t('cfg.scRunning')} (PID ${sidecar.info?.pid}). ${t('cfg.scKillNote')}`
              : sidecar?.needsDownload
                ? <>{t('cfg.scNeedDl')}</>
                : t('cfg.scStopped')}
          </p>
          {dlProgress && (
            <p className="cfg-progress">{dlLabel()}</p>
          )}
          <div className="cfg-row">
            <span className="cfg-row__label">{sidecar?.running ? t('cfg.scRunning') : sidecar?.needsDownload ? t('cfg.scDownload') : t('cfg.scStart')}</span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button online-backup__button--primary"
                onClick={sidecar?.running ? handleSidecarStop : sidecar?.needsDownload ? handleSidecarDownload : handleSidecarStart}
                disabled={sidecarBusy}
                title={sidecar?.running ? t('cfg.scStop') : sidecar?.needsDownload ? t('cfg.scDownloadTitle') : t('cfg.scStart')}
              >
                <span className="material-symbols-outlined">{sidecar?.running ? 'stop' : sidecar?.needsDownload ? 'download' : 'play_arrow'}</span>
                {sidecar?.running ? t('cfg.scStopBtn') : sidecar?.needsDownload ? t('cfg.scDownloadBtn') : t('cfg.scStartBtn')}
              </button>
              <button className="online-backup__button" onClick={refreshSidecar} title={t('cfg.refreshStatus')}>
                <span className="material-symbols-outlined">refresh</span>
                {t('cfg.statusBtn')}
              </button>
            </span>
          </div>
          {!sidecar?.needsDownload && (
            <div className="cfg-row">
              <span className="cfg-row__label">{t('cfg.kcefLabel')}<small>{t('cfg.kcefHint')}</small></span>
              <span className="cfg-row__actions">
                <button
                  className="online-backup__button"
                  onClick={handleSidecarKcef}
                  disabled={sidecarBusy}
                  title={sidecar?.kcef ? t('cfg.kcefTurnOff') : t('cfg.kcefTurnOn')}
                >
                  <span className="material-symbols-outlined">{sidecar?.kcef ? 'toggle_on' : 'toggle_off'}</span>
                  {sidecar?.kcef ? t('cfg.kcefOn') : t('cfg.kcefOff')}
                </button>
              </span>
            </div>
          )}
        </Section>
      )}

      <Section
        id="library"
        num={numOf('library')}
        title={t('cfg.secRepos')}
        hint={`${repos.length} repos`}
        open={openSection === 'library'}
        onToggle={() => toggleSection('library')}
      >
        <p className="cfg-note">
          {t('cfg.reposHintA')} <strong>index.json</strong> {t('cfg.reposHintB')}
        </p>
        <div className="ext-manager__search">
          <span className="material-symbols-outlined">add_link</span>
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="https://…/repo/index.json"
            aria-label={t('cfg.repoLinkLabel')}
          />
          <button
            className="ext-manager__search-clear"
            onClick={handleAddRepo}
            disabled={busy || !repoInput.trim()}
            title={t('cfg.repoAdd')}
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
        {reposLoading ? (
          <div className="ext-manager__loading">
            <div className="spinner" />
            <p>{t('cfg.reposLoading')}</p>
          </div>
        ) : repos.length === 0 ? (
          <div className="ext-manager__empty">
            <span className="material-symbols-outlined">store</span>
            <p>{t('cfg.reposEmpty')}</p>
          </div>
        ) : (
          <div className="ext-list">
            {repos.map((repo) => (
              <div className="ext-card" key={repo.indexUrl}>
                <div className="ext-card__icon">
                  <span className="material-symbols-outlined">store</span>
                </div>
                <div className="ext-card__info">
                  <div className="ext-card__name-row">
                    <h3 className="ext-card__name">{repo.name || t('cfg.repoFallback')}</h3>
                  </div>
                  <p className="ext-card__url">{repo.indexUrl}</p>
                </div>
                <div className="ext-card__actions">
                  <button
                    className="ext-card__btn ext-card__btn--uninstall"
                    onClick={() => handleRemoveRepo(repo.indexUrl)}
                    disabled={busy}
                    title={t('cfg.repoRemove')}
                  >
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {isDesktop && (
        <Section
          id="updates"
          num={numOf('updates')}
          title={t('cfg.secUpdates')}
          hint={updateInfo ? `v${updateInfo.version} nova` : appVersion ? `v${appVersion}` : ''}
          hintTone={updateInfo ? 'warn' : ''}
          open={openSection === 'updates'}
          onToggle={() => toggleSection('updates')}
        >
          <p className="cfg-note">
            {updateInfo
              ? <>{t('cfg.updateAvailable')} <strong>v{updateInfo.version}</strong>{updateInfo.date ? ` (${updateInfo.date.slice(0, 10)})` : ''}.</>
              : t('cfg.updCheckNow')}
          </p>
          {updateInfo?.body && (
            <p className="cfg-note">{updateInfo.body.slice(0, 600)}</p>
          )}
          {upProgress && (
            <p className="cfg-progress">{upLabel()}</p>
          )}
          <div className="cfg-row">
            <span className="cfg-row__label">{updateInfo ? `${t('cfg.updInstall')} v${updateInfo.version}` : t('cfg.updCheckTitle')}</span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button online-backup__button--primary"
                onClick={updateInfo ? handleInstallUpdate : handleCheckUpdates}
                disabled={updateBusy}
                title={updateInfo ? t('cfg.updDownloadInstall') : t('cfg.updCheckTitle')}
              >
                <span className="material-symbols-outlined">{updateInfo ? 'download' : 'refresh'}</span>
                {updateInfo ? t('cfg.updInstall') : t('cfg.updCheckTitle')}
              </button>
            </span>
          </div>
        </Section>
      )}

      <Section
        id="data"
        num={numOf('data')}
        title={t('cfg.secData')}
        hint=""
        open={openSection === 'data'}
        onToggle={() => toggleSection('data')}
      >
        <div className="cfg-row">
          <span className="cfg-row__label">{t('cfg.cacheLabel')}<small>{t('cfg.cacheHint')}</small></span>
          <span className="cfg-row__actions">
            <button
              className="online-backup__button"
              onClick={handleClearCaches}
              disabled={maintBusy}
              title={t('cfg.cacheLabel')}
            >
              <span className="material-symbols-outlined">mop</span>
              {t('cfg.cacheBtn')}
            </button>
          </span>
        </div>
        {isDesktop && (
          <div className="cfg-row">
            <span className="cfg-row__label">
              {wipeArmed ? t('cfg.wipeArmed') : t('cfg.wipeLabel')}
              <small>{wipeArmed && wipeBytes ? `~${formatBytes(wipeBytes)} — ` : ''}{t('cfg.wipeHint')}</small>
            </span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button online-backup__button--primary"
                onClick={handleWipe}
                disabled={maintBusy}
                title={t('cfg.wipeLabel')}
              >
                <span className="material-symbols-outlined">{wipeArmed ? 'warning' : 'delete_forever'}</span>
                {wipeArmed ? t('cfg.wipeConfirm') : t('cfg.wipeBtn')}
              </button>
            </span>
          </div>
        )}
      </Section>

      <Section
        id="lang"
        num={numOf('lang')}
        title={t('lang.title')}
        hint={storedLocale === 'auto' ? 'auto' : storedLocale}
        open={openSection === 'lang'}
        onToggle={() => toggleSection('lang')}
      >
        <p className="cfg-note">{t('lang.hint')}</p>
        {[
          { value: 'auto', label: t('welcome.auto') },
          { value: 'pt', label: 'Português (BR)' },
          { value: 'en', label: 'English' },
        ].map((opt) => (
          <div className="cfg-row" key={opt.value}>
            <span className="cfg-row__label">{opt.label}</span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button"
                onClick={() => handleLocale(opt.value)}
                title={opt.label}
              >
                <span className="material-symbols-outlined">
                  {storedLocale === opt.value ? 'radio_button_checked' : 'radio_button_unchecked'}
                </span>
                {storedLocale === opt.value ? 'Ativo' : 'Usar'}
              </button>
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}
