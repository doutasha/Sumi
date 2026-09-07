import React, { useEffect, useState } from 'react';
import ServerStatus from './ServerStatus.jsx';
import { checkHealth, getSuwayomiConfig, saveSuwayomiConfig } from '../lib/parser/connection.js';
import { addExtensionRepo, listRepos, removeRepo, refreshServerExtensions } from '../lib/parser/extensions.js';
import { refreshServerSources } from '../lib/parser/sources.js';
import { clearServerSourceCache } from '../lib/sourceRegistry.js';
import { isTauriRuntime } from '../../desktop/frontend-integration/tauri-env.js';
import { sidecarStatus, sidecarStart, sidecarStop, sidecarDownload, sidecarSetKcef } from '../../desktop/frontend-integration/sidecar.js';
import { checkForUpdates, installUpdate, currentVersion } from '../../desktop/frontend-integration/updater.js';

/**
 * SettingsScreen — Configurações > Motor + Biblioteca > Repositórios.
 * O app sai vazio (sem repos, sem extensões): o usuário adiciona o
 * indexUrl do repo que quiser (Keiyoushi ou outro compatível com Mihon).
 *
 * Layout em sanfona: uma seção aberta por vez (motor / embutido / biblioteca).
 */
function Section({ icon, title, hint, open, onToggle, children }) {
  return (
    <section className="ext-manager__content">
      <button
        className="ext-manager__refresh"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? `Recolher ${title}` : `Expandir ${title}`}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <span className="material-symbols-outlined">{icon}</span>
        <span className="mono-cap" style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {hint && <span className="ext-manager__stat-label">{hint}</span>}
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
  const [appVersion, setAppVersion] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [upProgress, setUpProgress] = useState(null);

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
        icon="dns"
        title="Motor local"
        hint={health?.online ? `${health.sourceCount ?? '–'} fontes` : 'offline'}
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
        <div className="ext-manager__count">
          <span>Salvar e testar conexão</span>
          <span>
            <button className="ext-manager__refresh" onClick={handleSaveEngine} title="Salvar e testar">
              <span className="material-symbols-outlined">save</span>
            </button>{' '}
            <button className="ext-manager__refresh" onClick={handleToggleEngine} title={config.enabled ? 'Desligar motor (modo leve)' : 'Ligar motor'}>
              <span className="material-symbols-outlined">{config.enabled ? 'toggle_on' : 'toggle_off'}</span>
            </button>
          </span>
        </div>
      </Section>

      {isDesktop && (
        <Section
          icon="terminal"
          title="Motor embutido (desktop)"
          hint={sidecar?.running ? `PID ${sidecar.info?.pid}` : sidecar?.needsDownload ? 'baixar' : 'parado'}
          open={openSection === 'sidecar'}
          onToggle={() => toggleSection('sidecar')}
        >
          <p className="ext-manager__subtitle">
            {sidecar?.running
              ? `Rodando (PID ${sidecar.info?.pid}) em ${sidecar.dataDir}`
              : sidecar?.needsDownload
                ? 'JRE slim + JAR (~220MB) ainda não baixados. O download é sob demanda, com progresso e verificação SHA-256.'
                : 'Parado. O app fecha o processo junto (kill-on-close).'}
          </p>
          {dlProgress && (
            <p className="ext-manager__subtitle">{dlLabel()}</p>
          )}
          <div className="ext-manager__count">
            <span>{sidecar?.running ? 'Parar motor' : sidecar?.needsDownload ? 'Baixar motor' : 'Iniciar motor oculto'}</span>
            <span>
              <button
                className="ext-manager__refresh"
                onClick={sidecar?.running ? handleSidecarStop : sidecar?.needsDownload ? handleSidecarDownload : handleSidecarStart}
                disabled={sidecarBusy}
                title={sidecar?.running ? 'Parar motor' : sidecar?.needsDownload ? 'Baixar JRE + JAR' : 'Iniciar motor'}
              >
                <span className="material-symbols-outlined">{sidecar?.running ? 'stop' : sidecar?.needsDownload ? 'download' : 'play_arrow'}</span>
              </button>{' '}
              <button className="ext-manager__refresh" onClick={refreshSidecar} title="Atualizar status">
                <span className="material-symbols-outlined">refresh</span>
              </button>
            </span>
          </div>
          {!sidecar?.needsDownload && (
            <div className="ext-manager__count">
              <span title="Resolve Cloudflare em alguns sites (ex.: Comix). Baixa ~260MB de Chromium no primeiro uso.">
                WebView p/ Cloudflare {sidecar?.kcef ? '(ligado)' : '(desligado)'}
              </span>
              <span>
                <button
                  className="ext-manager__refresh"
                  onClick={handleSidecarKcef}
                  disabled={sidecarBusy}
                  title={sidecar?.kcef ? 'Desligar WebView' : 'Ligar WebView'}
                >
                  <span className="material-symbols-outlined">{sidecar?.kcef ? 'toggle_on' : 'toggle_off'}</span>
                </button>
              </span>
            </div>
          )}
        </Section>
      )}

      <Section
        icon="store"
        title="Biblioteca / repositório de extensões"
        hint={`${repos.length} repos`}
        open={openSection === 'library'}
        onToggle={() => toggleSection('library')}
      >
        <p className="ext-manager__subtitle">
          O Sumi sai vazio. Cole o link do <strong>index.json</strong> do repositório
          (Keiyoushi ou outro compatível com Mihon) para carregar as extensões.
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
          icon="system_update"
          title="Atualizações"
          hint={appVersion ? `v${appVersion}` : ''}
          open={openSection === 'updates'}
          onToggle={() => toggleSection('updates')}
        >
          <p className="ext-manager__subtitle">
            {updateInfo
              ? `Nova versão v${updateInfo.version} disponível${updateInfo.date ? ` (${updateInfo.date.slice(0, 10)})` : ''}.`
              : 'Verifica releases novas no GitHub e instala por cima (sem duplicar).'}
          </p>
          {updateInfo?.body && (
            <p className="ext-manager__subtitle">{updateInfo.body.slice(0, 600)}</p>
          )}
          {upProgress && (
            <p className="ext-manager__subtitle">{upLabel()}</p>
          )}
          <div className="ext-manager__count">
            <span>{updateInfo ? `Instalar v${updateInfo.version}` : 'Verificar agora'}</span>
            <span>
              <button
                className="ext-manager__refresh"
                onClick={updateInfo ? handleInstallUpdate : handleCheckUpdates}
                disabled={updateBusy}
                title={updateInfo ? 'Baixar e instalar' : 'Verificar atualizações'}
              >
                <span className="material-symbols-outlined">{updateInfo ? 'download' : 'refresh'}</span>
              </button>
            </span>
          </div>
        </Section>
      )}
    </div>
  );
}
