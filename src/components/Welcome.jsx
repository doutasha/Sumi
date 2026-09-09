import React, { useState } from 'react';
import '../styles/welcome.css';
import { getStoredLocale, setLocale, markWelcomed, t } from '../lib/i18n.js';

/**
 * Welcome — primeiro boot: logo, idioma e começar. Centralizado, entrada
 * em etapas (respeita reduced-motion), botão vermelho bem visível.
 */
export default function Welcome({ onDone }) {
  const [, setTick] = useState(0);
  const stored = getStoredLocale();

  const pick = (value) => {
    setLocale(value);
    setTick((n) => n + 1);
  };

  const finish = (withTour = false) => {
    markWelcomed();
    onDone?.({ tour: withTour });
  };

  const options = [
    { value: 'auto', label: t('welcome.auto') },
    { value: 'pt', label: 'Português (BR)' },
    { value: 'en', label: 'English' },
  ];

  return (
    <div className="welcome">
      <img
        className="welcome__logo welcome__rise"
        style={{ '--d': '0ms' }}
        src="/icon.png"
        alt="Sumi"
      />
      <p className="welcome__kicker welcome__rise" style={{ '--d': '90ms' }}>
        {t('welcome.kicker')}
      </p>
      <h1 className="welcome__title welcome__rise" style={{ '--d': '160ms' }}>
        {t('welcome.hero')}
      </h1>
      <p className="welcome__subtitle welcome__rise" style={{ '--d': '230ms' }}>
        {t('welcome.steps')}
      </p>
      <p className="welcome__subtitle welcome__rise" style={{ '--d': '280ms' }}>
        {t('welcome.subtitle')}
      </p>

      <div className="welcome__langs welcome__rise" style={{ '--d': '340ms' }}>
        <p className="welcome__kicker">{t('welcome.language')}</p>
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`welcome__lang${stored === opt.value ? ' welcome__lang--active' : ''}`}
            onClick={() => pick(opt.value)}
            aria-pressed={stored === opt.value}
            type="button"
          >
            <span>{opt.label}</span>
            <span className="material-symbols-outlined">
              {stored === opt.value ? 'radio_button_checked' : 'radio_button_unchecked'}
            </span>
          </button>
        ))}
      </div>

      <p className="welcome__subtitle welcome__rise" style={{ '--d': '400ms' }}>
        {t('welcome.empty')}
      </p>

      <button
        className="online-backup__button online-backup__button--primary welcome__cta welcome__rise"
        style={{ '--d': '460ms' }}
        onClick={() => finish(false)}
        type="button"
      >
        {t('welcome.continue')}
      </button>

      <button
        className="online-backup__button welcome__cta welcome__rise"
        style={{ '--d': '520ms' }}
        onClick={() => finish(true)}
        type="button"
      >
        <span className="material-symbols-outlined">tour</span>
        {t('welcome.tour')}
      </button>
    </div>
  );
}
