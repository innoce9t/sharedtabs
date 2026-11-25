// The card glow follows the mouse, at most once per frame.
let queued = false;
addEventListener('pointermove', (e) => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    const cards = [...document.querySelectorAll('.card')].map((c) => [c, c.getBoundingClientRect()]);
    for (const [c, r] of cards) {
      c.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
      c.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
    }
  });
}, { passive: true });
