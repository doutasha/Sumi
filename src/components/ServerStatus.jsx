import React, { useCallback, useEffect, useRef, useState } from 'react';
import { checkHealth, getSuwayomiConfig } from '../lib/parser/connection.js';
import { refreshServerSources } from '../lib/parser/sources.js';
import { clearServerSourceCache } from '../lib/sourceRegistry.js';
import { t } from '../lib/i18n.js';

/**
 * ServerStatus — chip de estado do motor Suwayomi + refresh das fontes.
 * Monta → health-check → atualiza cache → invalida impls do registry.
 * Offline/desligado: silencioso (modo leve segue); só informa.
 */
export default function ServerStatus({ onChange }) {
  const [state, setState] = useState({ phase: 'checking' });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState({ phase: 'checking' });
    try {
      const config = getSuwayomiConfig();
      if (config.enabled === false) {
        setState({ phase: 'disabled' });
        onChangeRef.current?.({ online: false });
        return;
      }
      const health = await checkHealth(config);
      if (!health.online) {
        setState({ phase: 'offline', code: health.code });
        onChangeRef.current?.({ online: false });
        return;
      }
      const res = await refreshServerSources(config);
      clearServerSourceCache();
      setState({ phase: 'online', sources: res.sources.length, latencyMs: health.latencyMs });
      onChangeRef.current?.({ online: true, sources: res.sources.length });
    } catch {
      setState({ phase: 'offline', code: 'UNKNOWN' });
      onChangeRef.current?.({ online: false });
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (state.phase === 'checking') {
    return <span className="mono-cap">{t('srv.checking')}</span>;
  }
  if (state.phase === 'online') {
    return (
      <span className="mono-cap" title={`${state.latencyMs}ms`}>
        {t('srv.online')} · {state.sources} {t('srv.sources')}
      </span>
    );
  }
  if (state.phase === 'disabled') {
    return <span className="mono-cap">{t('srv.disabled')}</span>;
  }
  return (
    <button type="button" className="mono-cap" onClick={refresh} title={`${t('srv.retry')} (${state.code ?? ''})`}>
      {t('srv.offline')}
    </button>
  );
}
