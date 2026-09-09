import React, { useRef, useState } from 'react';
import {
  createSumiBackup,
  getBackupSummary,
  importSumiBackup,
} from '../lib/onlineStorage.js';
import { parseTachibk } from '../lib/parser/tachibk.js';
import { importBackup, isLibraryEntry } from '../lib/parser/library.js';
import { confirmDialog } from './Toast.jsx';

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
  const tachibkInputRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [importProgress, setImportProgress] = useState(null);
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
      const confirmed = await confirmDialog({
        title: 'Restaurar backup?',
        body: 'Substitui biblioteca, progresso, fontes e extensões instaladas neste navegador.',
        confirmLabel: 'Restaurar',
      });

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

  const handleTachibkImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = await parseTachibk(await file.arrayBuffer());
      const favs = parsed.manga.filter((m) => isLibraryEntry(m)).length;
      const confirmed = await confirmDialog({
        title: 'Importar do Mihon?',
        body: `${favs} favoritos em ${parsed.manga.length} títulos. Só entra o que tiver fonte instalada.`,
        confirmLabel: 'Importar',
      });
      if (!confirmed) return;
      setImportProgress({ done: 0, total: favs, current: '' });
      const report = await importBackup(parsed, {
        onProgress: (p) => setImportProgress(p),
      });
      setImportProgress(null);
      onRestore?.();
      setStatus({ type: report.errors.length ? 'error' : 'success', text: reportText(report) });
    } catch (err) {
      setImportProgress(null);
      setStatus({ type: 'error', text: err.message || 'Falha ao importar .tachibk.' });
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

      <section className="online-backup__panel">
        <div className="online-backup__panel-main">
          <p className="mono-cap">Arquivo do Mihon (.tachibk)</p>
          <h3>Biblioteca, lidos e categorias no motor</h3>
          <p>
            Só favoritos com fonte instalada entram. Capítulos lidos e
            progresso voltam junto.
          </p>
          {importProgress && (
            <p>
              Importando {importProgress.done}/{importProgress.total}
              {importProgress.current ? `: ${importProgress.current}` : ''}…
            </p>
          )}
        </div>

        <div className="online-backup__actions">
          <button className="online-backup__button online-backup__button--primary" onClick={() => tachibkInputRef.current?.click()} type="button">
            <span className="material-symbols-outlined">upload_file</span>
            Importar Mihon
          </button>
          <input
            ref={tachibkInputRef}
            accept=".tachibk,.proto.gz"
            hidden
            onChange={handleTachibkImport}
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

function reportText(report) {
  const parts = [`${report.imported} títulos na biblioteca`, `${report.chaptersMarked} capítulos marcados`];
  if (report.missingSource.length) parts.push(`${report.missingSource.length} sem fonte instalada`);
  if (report.notFound.length) parts.push(`${report.notFound.length} não achados`);
  if (report.errors.length) parts.push(`${report.errors.length} erros`);
  return `Mihon importado: ${parts.join(', ')}.`;
}
