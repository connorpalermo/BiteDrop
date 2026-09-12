/** Scrolls the window to top, instantly rather than smoothly for anyone with
 * prefers-reduced-motion set — the one JS-driven scroll in the app that the
 * global CSS reduced-motion rule (which only covers transitions/animations)
 * can't reach on its own. */
export function scrollToTopRespectingMotion() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}
