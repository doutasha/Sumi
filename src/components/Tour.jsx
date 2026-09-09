import { useCallback, useEffect, useState } from 'react';
import '../styles/tour.css';
import { t } from '../lib/i18n.js';
import { openTourSection } from '../lib/tour.js';

/**
 * Tour — spotlight no elemento + cartão ao lado. Avança no Próximo ou
 * clicando no alvo; Pular sai. Se o alvo não aparece, pula o passo.
 */
export default function Tour({ steps, onNavigate, onDone }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const step = steps[Math.min(index, steps.length - 1)];

  const finish = useCallback(() => onDone?.(), [onDone]);
  const next = useCallback(() => {
    if (index + 1 >= steps.length) finish();
    else setIndex(index + 1);
  }, [index, steps.length, finish]);

  // Navega p/ a view e abre a seção do passo.
  useEffect(() => {
    if (!step) return;
    onNavigate?.(step.view);
    if (step.section) {
      const timer = setTimeout(() => openTourSection(step.section), 120);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [step, onNavigate]);

  // Localiza o alvo (com retries curtos p/ view montar).
  useEffect(() => {
    if (!step) return undefined;
    let alive = true;
    let tries = 0;
    const locate = () => {
      if (!alive) return;
      const el = document.querySelector(step.selector);
      if (el) {
        try {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        } catch {
          /* segue */
        }
        setRect(el.getBoundingClientRect().toJSON());
        const advance = () => next();
        el.addEventListener('click', advance, { once: true });
        const onMove = () => {
          const r = el.getBoundingClientRect();
          setRect(r.toJSON());
        };
        window.addEventListener('resize', onMove);
        window.addEventListener('scroll', onMove, true);
        cleanup.current = () => {
          el.removeEventListener('click', advance);
          window.removeEventListener('resize', onMove);
          window.removeEventListener('scroll', onMove, true);
        };
        return;
      }
      tries += 1;
      if (tries < 12) timer.current = setTimeout(locate, 250);
      else next(); // alvo sumiu: pula o passo
    };
    const cleanup = { current: null };
    const timer = { current: null };
    setRect(null);
    locate();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
      cleanup.current?.();
    };
  }, [step, next]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish]);

  if (!step) return null;
  const pad = 8;
  const cardBelow = rect ? rect.bottom + 16 : 16;
  const useTop = typeof window !== 'undefined' && cardBelow > window.innerHeight - 190;

  return (
    <>
      {rect && (
        <>
          <div className="tour-dim" style={{ left: 0, top: 0, right: 0, height: Math.max(0, rect.top - pad) }} />
          <div className="tour-dim" style={{ left: 0, top: rect.bottom + pad, right: 0, bottom: 0 }} />
          <div className="tour-dim" style={{ left: 0, top: rect.top - pad, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2 }} />
          <div className="tour-dim" style={{ left: rect.right + pad, top: rect.top - pad, right: 0, height: rect.height + pad * 2 }} />
          <div
            className="tour-ring"
            style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
          />
        </>
      )}
      <div
        className="tour-card"
        style={rect
          ? (useTop
            ? { left: 16, bottom: typeof window !== 'undefined' ? window.innerHeight - rect.top + 16 : 16 }
            : { left: 16, top: cardBelow })
          : { left: 16, top: 16 }}
      >
        <p className="tour-card__kicker">{`${index + 1} ${t('tour.of')} ${steps.length}`}</p>
        <h3 className="tour-card__title">{t(step.titleKey)}</h3>
        <p className="tour-card__text">{t(step.textKey)}</p>
        <div className="tour-card__row">
          <span className="tour-card__dots">{'●'.repeat(index + 1) + '○'.repeat(steps.length - index - 1)}</span>
          <span className="tour-card__actions">
            <button className="online-backup__button" onClick={finish} type="button">
              {t('tour.skip')}
            </button>
            <button className="online-backup__button online-backup__button--primary" onClick={next} type="button">
              {index + 1 >= steps.length ? t('tour.done') : t('tour.next')}
            </button>
          </span>
        </div>
      </div>
    </>
  );
}
