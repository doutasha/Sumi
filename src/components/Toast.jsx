import React, { useEffect, useState } from 'react';
import '../styles/toast.css';

let pushFn = null;
let confirmFn = null;

/** Aviso flutuante (some sozinho). type: 'info' | 'success' | 'error'. */
export function toast(text, type = 'info') {
  try {
    pushFn?.({ id: Date.now() + Math.random(), text: String(text), type });
  } catch {
    /* sem host: ignora */
  }
}

/**
 * Confirmação no padrão Sumi (sem popup nativo).
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar' }) {
  try {
    if (typeof confirmFn === 'function') {
      return confirmFn({ title, body, confirmLabel, cancelLabel });
    }
  } catch {
    /* cai no fallback */
  }
  return Promise.resolve(
    // eslint-disable-next-line no-alert -- fallback fora da árvore React (sem host montado)
    window.confirm(`${title}\n\n${body || ''}`),
  );
}

/** Montar 1x na raiz (OnlineReader). */
export function ToastHost() {
  const [items, setItems] = useState([]);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    pushFn = (item) => {
      setItems((prev) => [...prev.slice(-2), item]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
      }, 5000);
    };
    confirmFn = ({ title, body, confirmLabel, cancelLabel }) =>
      new Promise((resolve) => {
        setConfirm({ title, body, confirmLabel, cancelLabel, resolve });
      });
    return () => {
      pushFn = null;
      confirmFn = null;
    };
  }, []);

  const answer = (value) => {
    try {
      confirm?.resolve(value);
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast--${item.type}`}>
            <span className="material-symbols-outlined">
              {item.type === 'error' ? 'error' : item.type === 'success' ? 'check_circle' : 'info'}
            </span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
      {confirm && (
        <div className="toast-scrim" onClick={() => answer(false)}>
          <div className="toast-dialog" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <h3 className="toast-dialog__title">{confirm.title}</h3>
            {confirm.body && <p className="toast-dialog__body">{confirm.body}</p>}
            <div className="toast-dialog__actions">
              <button className="online-backup__button" onClick={() => answer(false)} type="button">
                {confirm.cancelLabel}
              </button>
              <button className="online-backup__button online-backup__button--primary" onClick={() => answer(true)} type="button">
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
