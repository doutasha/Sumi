import React, { useRef, useState } from 'react';
import {
  createSumiBackup,
  getBackupSummary,
  importSumiBackup,
} from '../lib/onlineStorage.js';

const METRICS = [
  { key: 'favorites', label: 'biblioteca' },
  { key: 'history', label: 'historico' },
  { key: 'extensions', label: 'extensoes' },
  { key: 'categories', label: 'categorias' },
  { key: 'sources', label: 'fontes' },
];

function backupFileName() {
  const stamp = new Date().toISOString().slice(0, 10);
  return `sumi-backup-${stamp}.json`;
}

export default function OnlineBackup({ onRestore }) {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState(null);
  const summary = getBackupSummary();

  const handleExport = () => {
    try {
      const backup = createSumiBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus({ type: 'success', text: 'Backup exportado.' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message || 'Falha ao exportar backup.' });
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const confirmed = window.confirm(
        'Restaurar este backup vai substituir biblioteca, progresso, fontes e extensoes instaladas neste navegador. Continuar?'
      );

      if (!confirmed) return;

      const restored = importSumiBackup(backup);
      onRestore?.();
      setStatus({
        type: 'success',
        text: `Backup restaurado: ${restored.favorites} titulos, ${restored.extensions} extensoes.`,
      });
    } catch (err) {
      setStatus({ type: 'error', text: err.message || 'Falha ao restaurar backup.' });
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="online-backup">
      <section className="online-backup__summary">
        <div>
          <p className="mono-cap mono-cap-shu">Dados locais</p>
          <h2>Backup do Sumi</h2>
        </div>
        <div className="online-backup__metrics">
          {METRICS.map(metric => (
            <div key={metric.key} className="online-backup__metric">
              <span>{summary[metric.key]}</span>
              <small>{metric.label}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="online-backup__panel">
        <div className="online-backup__panel-main">
          <p className="mono-cap">Arquivo JSON local</p>
          <h3>Biblioteca, progresso, extensoes e status</h3>
          <p>
            O backup inclui os dados salvos neste navegador. Cache de catalogo e imagens temporarias nao entram no arquivo.
          </p>
        </div>

        <div className="online-backup__actions">
          <button className="online-backup__button online-backup__button--primary" onClick={handleExport} type="button">
            <span className="material-symbols-outlined">download</span>
            Exportar
          </button>
          <button className="online-backup__button" onClick={() => fileInputRef.current?.click()} type="button">
            <span className="material-symbols-outlined">upload_file</span>
            Restaurar
          </button>
          <input
            ref={fileInputRef}
            accept="application/json,.json"
            hidden
            onChange={handleImport}
            type="file"
          />
        </div>
      </section>

      {status && (
        <div className={`online-backup__status online-backup__status--${status.type}`}>
          <span className="material-symbols-outlined">
            {status.type === 'success' ? 'check_circle' : 'error'}
          </span>
          {status.text}
        </div>
      )}
    </div>
  );
}
