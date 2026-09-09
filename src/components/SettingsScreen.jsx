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
    flash(status.online ? 'Motor conectado.' : `Motor inalcançável: ${status.message ?? status.code}`, !status.online);
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
      flash(res?.cached ? 'Motor já estava baixado.' : `Motor baixado (${res?.javaVersion ?? 'java ok'}).`);
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
      flash(next
        ? 'WebView ligado. O Chromium (~260MB) baixa sozinho no primeiro site com Cloudflare.'
        : 'WebView desligado.');
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
      flash(info ? `Nova versão disponível: v${info.version}.` : 'Sumi já está atualizado.');
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
        flash('Sumi já está atualizado.');
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
    if (upProgress.phase === 'install') return 'Instalando… o app vai reiniciar.';
    const { received = 0, total = 0 } = upProgress;
    if (!total) return `Baixando… (${(received / 1048576).toFixed(0)}MB)`;
    return `Baixando… ${Math.round((received / total) * 100)}% (${(received / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)}MB)`;
  };

  const handleClearCaches = async () => {
    setMaintBusy(true);
    try {
      const res = await clearCaches();
      await loadRepos();
      setHealth(await checkHealth().catch((err) => ({ online: false, message: err.message })));
      flash(`Cache limpo (${res.frontendKeys} locais${res.serverImages ? ' + capas do motor' : ''}).`);
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
      flash(`Tudo apagado (${formatBytes(res?.freedBytes)}). Reiniciando zerado…`);
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
    if (phase === 'done') return 'Concluído.';
    if (phase === 'extract') return `Extraindo JRE… (${received}/${total} arquivos)`;
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    const mb = (v) => `${(v / 1048576).toFixed(0)}MB`;
    const name = phase === 'jar' ? 'JAR' : 'JRE';
    return `Baixando ${name}… ${pct}% (${mb(received)}/${mb(total)})`;
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
      flash('Cole um link http(s) válido para o index.json do repositório.', true);
      return;
    }
    if (repos.some((repo) => repo.indexUrl === indexUrl)) {
      flash('Este repositório já está adicionado.', true);
      return;
    }
    setBusy(true);
    try {
      await addExtensionRepo(indexUrl);
      setRepoInput('');
      await syncAfterRepoChange();
      flash('Repositório adicionado.');
    } catch (err) {
      flash(`Falha ao adicionar: ${err.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveRepo = async (indexUrl) => {
    setBusy(true);
    try {
      await removeRepo(indexUrl);
      await syncAfterRepoChange();
      flash('Repositório removido.');
    } catch (err) {
      flash(`Falha ao remover: ${err.message}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ext-manager">
      <section className="ext-manager__hero">
        <div>
          <p className="mono-cap mono-cap-shu">Sumi / ajustes</p>
          <div className="ext-manager__title-row">
            <h2 className="ext-manager__title">Configurações</h2>
            <span className="ext-manager__jp">設定</span>
          </div>
          <p className="ext-manager__subtitle">
            Motor local, repositórios de extensões e biblioteca.
          </p>
          <p className="cfg-note">
            Motor <strong>Suwayomi-Server</strong> · extensões compatíveis com
            <strong> Keiyoushi/Mihon</strong> · Sumi sem conteúdo embutido.
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
            <span className="ext-manager__stat-label">fontes no motor</span>
          </div>
          <div>
            <span className="ext-manager__stat-value">{repos.length}</span>
            <span className="ext-manager__stat-label">repositórios</span>
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
        title="Motor local"
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
            aria-label="Endereço do motor"
          />
        </div>
        <div className="cfg-row">
          <span className="cfg-row__label">Conexão com o motor<small>Salva o endereço e testa na hora.</small></span>
          <span className="cfg-row__actions">
            <button className="online-backup__button" onClick={handleSaveEngine} title="Salvar e testar">
              <span className="material-symbols-outlined">save</span>
              Salvar
            </button>
            <button className="online-backup__button" onClick={handleToggleEngine} title={config.enabled ? 'Desligar motor (modo leve)' : 'Ligar motor'}>
              <span className="material-symbols-outlined">{config.enabled ? 'toggle_on' : 'toggle_off'}</span>
              {config.enabled ? 'Ligado' : 'Leve'}
            </button>
          </span>
        </div>
      </Section>

      {isDesktop && (
        <Section
          id="sidecar"
          num={numOf('sidecar')}
          title="Motor embutido"
          hint={sidecar?.running ? `PID ${sidecar.info?.pid}` : sidecar?.needsDownload ? 'baixar' : 'parado'}
          hintTone={sidecar?.running ? 'ok' : 'warn'}
          open={openSection === 'sidecar'}
          onToggle={() => toggleSection('sidecar')}
        >
          <p className="cfg-note">
            {sidecar?.running
              ? `Rodando (PID ${sidecar.info?.pid}). O app fecha o processo junto.`
              : sidecar?.needsDownload
                ? <>JRE + JAR (~220MB) ainda não baixados — <strong>sob demanda, com SHA-256.</strong></>
                : 'Parado.'}
          </p>
          {dlProgress && (
            <p className="cfg-progress">{dlLabel()}</p>
          )}
          <div className="cfg-row">
            <span className="cfg-row__label">{sidecar?.running ? 'Motor em execução' : sidecar?.needsDownload ? 'Baixar o motor' : 'Subir o motor oculto'}</span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button online-backup__button--primary"
                onClick={sidecar?.running ? handleSidecarStop : sidecar?.needsDownload ? handleSidecarDownload : handleSidecarStart}
                disabled={sidecarBusy}
                title={sidecar?.running ? 'Parar motor' : sidecar?.needsDownload ? 'Baixar JRE + JAR' : 'Iniciar motor'}
              >
                <span className="material-symbols-outlined">{sidecar?.running ? 'stop' : sidecar?.needsDownload ? 'download' : 'play_arrow'}</span>
                {sidecar?.running ? 'Parar' : sidecar?.needsDownload ? 'Baixar' : 'Iniciar'}
              </button>
              <button className="online-backup__button" onClick={refreshSidecar} title="Atualizar status">
                <span className="material-symbols-outlined">refresh</span>
                Status
              </button>
            </span>
          </div>
          {!sidecar?.needsDownload && (
            <div className="cfg-row">
              <span className="cfg-row__label">WebView p/ Cloudflare<small>Resolve Comix e afins. Baixa ~260MB de Chromium no primeiro uso.</small></span>
              <span className="cfg-row__actions">
                <button
                  className="online-backup__button"
                  onClick={handleSidecarKcef}
                  disabled={sidecarBusy}
                  title={sidecar?.kcef ? 'Desligar WebView' : 'Ligar WebView'}
                >
                  <span className="material-symbols-outlined">{sidecar?.kcef ? 'toggle_on' : 'toggle_off'}</span>
                  {sidecar?.kcef ? 'Ligado' : 'Desligado'}
                </button>
              </span>
            </div>
          )}
        </Section>
      )}

      <Section
        id="library"
        num={numOf('library')}
        title="Repositórios de extensões"
        hint={`${repos.length} repos`}
        open={openSection === 'library'}
        onToggle={() => toggleSection('library')}
      >
        <p className="cfg-note">
          O Sumi sai vazio. Cole o link do <strong>index.json</strong> do repositório
          (Keiyoushi ou outro compatível com Mihon).
        </p>
        <div className="ext-manager__search">
          <span className="material-symbols-outlined">add_link</span>
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="https://…/repo/index.json"
            aria-label="Link do repositório"
          />
          <button
            className="ext-manager__search-clear"
            onClick={handleAddRepo}
            disabled={busy || !repoInput.trim()}
            title="Adicionar repositório"
          >
            <span className="material-symbols-outlined">add</span>
          </button>
        </div>
        {reposLoading ? (
          <div className="ext-manager__loading">
            <div className="spinner" />
            <p>Carregando repositórios...</p>
          </div>
        ) : repos.length === 0 ? (
          <div className="ext-manager__empty">
            <span className="material-symbols-outlined">store</span>
            <p>Nenhum repositório adicionado</p>
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
                    <h3 className="ext-card__name">{repo.name || 'Repositório'}</h3>
                  </div>
                  <p className="ext-card__url">{repo.indexUrl}</p>
                </div>
                <div className="ext-card__actions">
                  <button
                    className="ext-card__btn ext-card__btn--uninstall"
                    onClick={() => handleRemoveRepo(repo.indexUrl)}
                    disabled={busy}
                    title="Remover repositório"
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
          title="Atualizações"
          hint={updateInfo ? `v${updateInfo.version} nova` : appVersion ? `v${appVersion}` : ''}
          hintTone={updateInfo ? 'warn' : ''}
          open={openSection === 'updates'}
          onToggle={() => toggleSection('updates')}
        >
          <p className="cfg-note">
            {updateInfo
              ? <>Nova versão <strong>v{updateInfo.version}</strong> disponível{updateInfo.date ? ` (${updateInfo.date.slice(0, 10)})` : ''}.</>
              : 'Verifica releases no GitHub e instala por cima (sem duplicar).'}
          </p>
          {updateInfo?.body && (
            <p className="cfg-note">{updateInfo.body.slice(0, 600)}</p>
          )}
          {upProgress && (
            <p className="cfg-progress">{upLabel()}</p>
          )}
          <div className="cfg-row">
            <span className="cfg-row__label">{updateInfo ? `Instalar v${updateInfo.version}` : 'Buscar atualizações'}</span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button online-backup__button--primary"
                onClick={updateInfo ? handleInstallUpdate : handleCheckUpdates}
                disabled={updateBusy}
                title={updateInfo ? 'Baixar e instalar' : 'Verificar atualizações'}
              >
                <span className="material-symbols-outlined">{updateInfo ? 'download' : 'refresh'}</span>
                {updateInfo ? 'Instalar' : 'Verificar'}
              </button>
            </span>
          </div>
        </Section>
      )}

      <Section
        id="data"
        num={numOf('data')}
        title="Dados e cache"
        hint=""
        open={openSection === 'data'}
        onToggle={() => toggleSection('data')}
      >
        <div className="cfg-row">
          <span className="cfg-row__label">Limpar caches<small>Seguro. Configs e biblioteca intactas.</small></span>
          <span className="cfg-row__actions">
            <button
              className="online-backup__button"
              onClick={handleClearCaches}
              disabled={maintBusy}
              title="Limpar caches"
            >
              <span className="material-symbols-outlined">mop</span>
              Limpar
            </button>
          </span>
        </div>
        {isDesktop && (
          <div className="cfg-row">
            <span className="cfg-row__label">
              {wipeArmed ? 'APAGA TUDO: biblioteca, downloads, repos e configs. Clique de novo p/ confirmar.' : 'Apagar todos os dados'}
              <small>{wipeArmed && wipeBytes ? `~${formatBytes(wipeBytes)} — JRE+JAR mantidos.` : 'JRE+JAR mantidos.'}</small>
            </span>
            <span className="cfg-row__actions">
              <button
                className="online-backup__button online-backup__button--primary"
                onClick={handleWipe}
                disabled={maintBusy}
                title="Apagar todos os dados"
              >
                <span className="material-symbols-outlined">{wipeArmed ? 'warning' : 'delete_forever'}</span>
                {wipeArmed ? 'Confirmar' : 'Apagar'}
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
