/**
 * i18n.js — PT/EN mínimo do Sumi (Fase 7, incremental).
 *
 * Regra: toda string NOVA de UI passa por `t()`. String sem tradução cai
 * pro PT (nunca em branco). Escolha em `sumi.locale` ('pt' | 'en' | 'auto').
 */

export const LOCALE_KEY = 'sumi.locale';
export const FIRST_RUN_KEY = 'sumi.welcomed';

const STRINGS = {
  'welcome.kicker': { pt: 'Bem-vindo', en: 'Welcome' },
  'welcome.hero': { pt: 'BEM-VINDO AO SUMI', en: 'WELCOME TO SUMI' },
  'welcome.steps': {
    pt: 'Para o primeiro acesso, siga as instruções abaixo.',
    en: 'For your first setup, follow the instructions below.',
  },
  'welcome.title': { pt: 'Sumi', en: 'Sumi' },
  'welcome.subtitle': {
    pt: 'Seu leitor local de mangás. Escolha o idioma para começar.',
    en: 'Your local manga reader. Choose a language to begin.',
  },
  'welcome.language': { pt: 'Idioma / Language', en: 'Language / Idioma' },
  'welcome.auto': { pt: 'Automático (sistema)', en: 'Automatic (system)' },
  'welcome.continue': { pt: 'Começar', en: 'Get started' },
  'welcome.empty': {
    pt: 'O app abre vazio: você adiciona repositórios e fontes.',
    en: 'The app starts empty: you add repositories and sources.',
  },
  'lang.title': { pt: 'Idioma', en: 'Language' },
  'lang.hint': { pt: 'Vale para telas novas; o resto migra aos poucos.', en: 'Applies to new screens; the rest migrates gradually.' },
  'lang.saved': { pt: 'Idioma salvo.', en: 'Language saved.' },
  'welcome.tour': { pt: 'Ver como usar', en: 'See how it works' },
  'tour.skip': { pt: 'Pular', en: 'Skip' },
  'tour.next': { pt: 'Próximo', en: 'Next' },
  'tour.done': { pt: 'Começar a usar', en: 'Start using' },
  'tour.of': { pt: 'de', en: 'of' },
  'tour.library.title': { pt: 'Biblioteca', en: 'Library' },
  'tour.library.text': {
    pt: 'Aqui ficam seus mangás favoritados. Simples: tudo que você salva aparece aqui.',
    en: 'Your favorited manga live here. Simple: everything you save shows up here.',
  },
  'tour.history.title': { pt: 'Histórico', en: 'History' },
  'tour.history.text': {
    pt: 'Acompanha seu progresso: onde parou em cada título.',
    en: 'Tracks your progress: where you stopped in each title.',
  },
  'tour.extensions.title': { pt: 'Extensões', en: 'Extensions' },
  'tour.extensions.text': {
    pt: 'Instaladas: suas fontes ativas. Catálogo: milhares de fontes para instalar. Atualizações: mantém tudo em dia.',
    en: 'Installed: your active sources. Catalog: thousands of sources to install. Updates: keeps everything current.',
  },
  'tour.search.title': { pt: 'Busca', en: 'Search' },
  'tour.search.text': {
    pt: 'Busca global por título em todas as fontes de uma vez.',
    en: 'Global title search across all sources at once.',
  },
  'tour.motor.title': { pt: 'Motor local', en: 'Local engine' },
  'tour.motor.text': {
    pt: 'O cérebro: endereço e conexão com o motor que serve as fontes.',
    en: 'The brain: address and connection to the engine serving sources.',
  },
  'tour.sidecar.title': { pt: 'Motor embutido', en: 'Embedded engine' },
  'tour.sidecar.text': {
    pt: 'Baixa, inicia e monitora o motor sozinho: oculto, com relançamento e kill ao fechar.',
    en: 'Downloads, starts and watches the engine alone: hidden, with relaunch and kill on close.',
  },
  'tour.repos.title': { pt: 'Repositórios', en: 'Repositories' },
  'tour.repos.text': {
    pt: 'Cole o link index.json do repositório (ex.: Keiyoushi) para carregar as extensões.',
    en: 'Paste the repository index.json link (e.g. Keiyoushi) to load extensions.',
  },
};

function systemLocale() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
    return /^pt\b/i.test(nav) ? 'pt' : 'en';
  } catch {
    return 'pt';
  }
}

/** 'pt' | 'en' | 'auto' (cru). */
export function getStoredLocale() {
  try {
    if (typeof localStorage === 'undefined') return 'auto';
    const v = localStorage.getItem(LOCALE_KEY);
    return v === 'pt' || v === 'en' || v === 'auto' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Idioma efetivo: resolve 'auto' pelo sistema. */
export function getLocale() {
  const stored = getStoredLocale();
  return stored === 'auto' ? systemLocale() : stored;
}

export function setLocale(value) {
  const v = value === 'pt' || value === 'en' ? value : 'auto';
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(LOCALE_KEY, v);
  } catch {
    /* segue */
  }
  return v === 'auto' ? systemLocale() : v;
}

/** Traduz; fallback PT; chave crua se nem PT existir. */
export function t(key) {
  const entry = STRINGS[key];
  if (!entry) return key;
  const locale = getLocale();
  return entry[locale] ?? entry.pt ?? key;
}

/** Primeiro boot já concluído? */
export function hasWelcomed() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(FIRST_RUN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markWelcomed() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    /* segue */
  }
}
