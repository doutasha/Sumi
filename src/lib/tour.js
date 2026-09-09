/**
 * tour.js — roteiro do tour guiado (Fase 7).
 *
 * Ordem hierárquica (sidebar de cima pra baixo) + Config em sub-passos.
 * Passos miram seletores ESTÁVEIS (navegação, seções) — nunca listas
 * dinâmicas (catálogo, resultados, capítulos). Textos via i18n.
 */

export const TOUR_START_EVENT = 'sumi:tour-start';
export const TOUR_SECTION_EVENT = 'sumi:tour-section';

export function startTour() {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
  } catch {
    /* sem tour */
  }
}

export function openTourSection(id) {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_SECTION_EVENT, { detail: id }));
  } catch {
    /* sem tour */
  }
}

/**
 * @param {boolean} isDesktop
 * @returns {Array<{id, view, section?, selector, titleKey, textKey}>}
 */
export function tourSteps(isDesktop) {
  const steps = [
    { id: 'library', view: 'library', selector: '[data-tour="nav-library"]', titleKey: 'tour.library.title', textKey: 'tour.library.text' },
    { id: 'history', view: 'history', selector: '[data-tour="nav-history"]', titleKey: 'tour.history.title', textKey: 'tour.history.text' },
    { id: 'extensions', view: 'extensions', selector: '[data-tour="nav-extensions"]', titleKey: 'tour.extensions.title', textKey: 'tour.extensions.text' },
    { id: 'search', view: 'search', selector: '[data-tour="nav-search"]', titleKey: 'tour.search.title', textKey: 'tour.search.text' },
    { id: 'motor', view: 'settings', section: 'motor', selector: '[data-tour="cfg-motor"]', titleKey: 'tour.motor.title', textKey: 'tour.motor.text' },
  ];
  if (isDesktop) {
    steps.push({ id: 'sidecar', view: 'settings', section: 'sidecar', selector: '[data-tour="cfg-sidecar"]', titleKey: 'tour.sidecar.title', textKey: 'tour.sidecar.text' });
  }
  steps.push({ id: 'repos', view: 'settings', section: 'library', selector: '[data-tour="cfg-library"]', titleKey: 'tour.repos.title', textKey: 'tour.repos.text' });
  return steps;
}
