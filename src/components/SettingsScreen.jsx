import React, { useEffect, useState } from 'react';
import ServerStatus from './ServerStatus.jsx';
import { checkHealth, getSuwayomiConfig, saveSuwayomiConfig } from '../lib/parser/connection.js';
import { addExtensionRepo, listRepos, removeRepo, refreshServerExtensions } from '../lib/parser/extensions.js';
import { refreshServerSources } from '../lib/parser/sources.js';
import { clearServerSourceCache } from '../lib/sourceRegistry.js';

/**
 * SettingsScreen — Configurações > Motor + Biblioteca > Repositórios.
 * O app sai vazio (sem repos, sem extensões): o usuário adiciona o
 * indexUrl do repo que quiser (Keiyoushi ou outro compatível com Mihon).
 */
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

      <section className="ext-manager__content">
        <p className="mono-cap">Motor local</p>
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
      </section>

      <section className="ext-manager__content">
        <p className="mono-cap">Biblioteca / repositório de extensões</p>
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
      </section>
    </div>
  );
}
