import React, { useRef, useState } from 'react';
import {
  createSumiBackup,
  getBackupSummary,
  importSumiBackup,
} from '../lib/onlineStorage.js';
import { parseTachibk } from '../lib/parser/tachibk.js';
import { importBackup, isLibraryEntry } from '../lib/parser/library.js';
import { confirmDialog } from './Toast.jsx';
import { t } from '../lib/i18n.js';

const METRICS = [
  { key: 'favorites', labelKey: 'bk.m.library' },
  { key: 'history', labelKey: 'bk.m.history' },
  { key: 'extensions', labelKey: 'bk.m.extensions' },
  { key: 'categories', labelKey: 'bk.m.categories' },
  { key: 'sources', labelKey: 'bk.m.sources' },
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
      setStatus({ type: 'success', text: t('bk.exported') });
    } catch (err) {
      setStatus({ type: 'error', text: err.message || t('bk.exportFail') });
    }
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      const confirmed = await confirmDialog({
        title: t('bk.restoreTitle'),
        body: t('bk.restoreBody'),
        confirmLabel: t('bk.restore'),
      });

      if (!confirmed) return;

      const restored = importSumiBackup(backup);
      onRestore?.();
      setStatus({
        type: 'success',
        text: `${t('bk.restoredCount')} ${restored.favorites} ${t('bk.m.library')}, ${restored.extensions} ${t('bk.m.extensions')}.`,
      });
    } catch (err) {
      setStatus({ type: 'error', text: err.message || t('bk.restoreFail') });
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
        title: t('bk.importTitle'),
        body: `${favs} ${t('bk.favorites')}. ${t('bk.mihonHint')}`,
        confirmLabel: t('bk.importConfirm'),
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
      setStatus({ type: 'error', text: err.message || t('bk.importFail') });
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div className="online-backup">
      <section className="online-backup__summary">
          <div>
            <p className="mono-cap mono-cap-shu">{t('bk.localData')}</p>
            <h2>{t('bk.title')}</h2>
          </div>
          <div className="online-backup__metrics">
            {METRICS.map(metric => (
              <div key={metric.key} className="online-backup__metric">
                <span>{summary[metric.key]}</span>
                <small>{t(metric.labelKey)}</small>
              </div>
            ))}
          </div>
      </section>

      <section className="online-backup__panel">
        <div className="online-backup__panel-main">
          <p className="mono-cap">{t('bk.fileTitle')}</p>
          <h3>{t('bk.fileSub')}</h3>
          <p>
            {t('bk.fileHint')}
          </p>
        </div>

        <div className="online-backup__actions">
          <button className="online-backup__button online-backup__button--primary" onClick={handleExport} type="button">
            <span className="material-symbols-outlined">download</span>
            {t('bk.export')}
          </button>
          <button className="online-backup__button" onClick={() => fileInputRef.current?.click()} type="button">
            <span className="material-symbols-outlined">upload_file</span>
            {t('bk.restore')}
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
          <p className="mono-cap">{t('bk.mihonFile')}</p>
          <h3>{t('bk.mihonSub')}</h3>
          <p>
            {t('bk.mihonHint')}
          </p>
          {importProgress && (
            <p>
              {t('bk.importing')} {importProgress.done}/{importProgress.total}
              {importProgress.current ? `: ${importProgress.current}` : ''}…
            </p>
          )}
        </div>

        <div className="online-backup__actions">
          <button className="online-backup__button online-backup__button--primary" onClick={() => tachibkInputRef.current?.click()} type="button">
            <span className="material-symbols-outlined">upload_file</span>
            {t('bk.importMihon')}
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
  const parts = [`${report.imported} ${t('bk.r.titles')}`, `${report.chaptersMarked} ${t('bk.r.chapters')}`];
  if (report.missingSource.length) parts.push(`${report.missingSource.length} ${t('bk.r.noSource')}`);
  if (report.notFound.length) parts.push(`${report.notFound.length} ${t('bk.r.notFound')}`);
  if (report.errors.length) parts.push(`${report.errors.length} ${t('bk.r.errors')}`);
  return `${t('bk.r.done')} ${parts.join(', ')}.`;
}
