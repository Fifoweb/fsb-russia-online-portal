// Optical decoration only: no account data, storage, network calls or render loop.
const surfaces = '.site-header,.mobile-menu,.portal-auth-card,.portal-profile-panel,.portal-gate,.portal-service,.portal-restoration,.portal-application,.portal-result,.portal-account-strip,.ref-structure-card,.ref-rank-card,.ref-candidate-panel,.document-card,.info-card,.search-dialog-panel';
const lenses = '.site-header,.portal-auth-card,.portal-profile-panel,.portal-gate,.ref-candidate-panel,.search-dialog-panel';
const reactive = '.portal-auth-card,.portal-profile-panel,.portal-gate,.ref-structure-card,.ref-candidate-panel';
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let frame = 0;
let point;
let active;

function enhance() {
  document.querySelectorAll(surfaces).forEach(element => element.classList.add('liquid-surface'));
  document.querySelectorAll(lenses).forEach(element => element.classList.add('glass-lens'));
  resetLight();
}
function resetLight() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  point = null;
  active?.style.removeProperty('--glass-light-x');
  active?.style.removeProperty('--glass-light-y');
  active = null;
}
document.addEventListener('pointermove', event => {
  if (!finePointer.matches || reducedMotion.matches || event.pointerType !== 'mouse') return;
  const surface = event.target instanceof Element ? event.target.closest(reactive) : null;
  if (!surface) { if (active) resetLight(); return; }
  if (active !== surface) { resetLight(); active = surface; }
  point = { x: event.clientX, y: event.clientY };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!active?.isConnected || !point) { resetLight(); return; }
    const rect = active.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(-1, Math.min(1, (point.x - rect.left) / rect.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (point.y - rect.top) / rect.height * 2 - 1));
    active.style.setProperty('--glass-light-x', `${(-x * 1.5).toFixed(2)}px`);
    active.style.setProperty('--glass-light-y', `${(-y * 1.5).toFixed(2)}px`);
  });
}, { passive: true });
document.addEventListener('pointerleave', resetLight);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetLight(); });
reducedMotion.addEventListener('change', resetLight);
finePointer.addEventListener('change', resetLight);
window.addEventListener('portal:content-ready', enhance);
enhance();
