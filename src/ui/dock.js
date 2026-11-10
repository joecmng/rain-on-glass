// The control dock: a row of icons at the bottom of the window. Each icon opens its card
// above the dock; tapping the same icon again, tapping the glass or pressing Esc closes it.
// The Draw icon is different: it turns drawing on, and the dock swaps its icons for a
// one-row strip of drawing tools (body.draw-mode, set by src/logo/panel.js) so as little
// of the window as possible is covered while you draw.
//
// Cards can be dragged by their title bar to anywhere on screen (so the Logo card needn't
// cover the logo). They share one position: wherever you last put a card, the next card you
// open appears in the same place. It's remembered on this device as fractions of the window
// (so it survives resizes); double-click a title to send the cards back above the dock.

const $ = (id) => document.getElementById(id);
const KEY = 'rainCardPos2';   // { x, y } shared by all cards (null = above the dock)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function setupDock() {
  const cards = [...document.querySelectorAll('.dock-card')];
  const buttons = [...document.querySelectorAll('.dock-btn[data-open]')];
  let open = null;

  // ── remembered positions ──────────────────────────────────────────────────
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { pos = null; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pos)); } catch { /* ignore */ } };

  // put a card at (x, y) px, keeping its title bar on screen; a taller card than the one
  // that was dragged is nudged up so it doesn't run off the bottom
  const moveTo = (card, x, y, fit = false) => {
    const w = card.offsetWidth || 300, h = card.offsetHeight || 200;
    if (fit) y = Math.min(y, innerHeight - h - 8);
    card.style.left = `${clamp(x, 60 - w, innerWidth - 60)}px`;
    card.style.top = `${clamp(y, 0, innerHeight - 40)}px`;
  };
  const place = (card) => {
    if (!pos) { card.classList.remove('moved'); card.style.left = card.style.top = ''; return; }
    card.classList.add('moved');
    moveTo(card, pos.x * innerWidth, pos.y * innerHeight, true);
  };

  // ── opening / closing ─────────────────────────────────────────────────────
  const show = (name) => {
    open = name || null;
    for (const c of cards) {
      c.hidden = c.dataset.card !== open;
      if (!c.hidden) place(c);
    }
    for (const b of buttons) {
      const on = b.dataset.open === open;
      b.classList.toggle('on', on);
      b.setAttribute('aria-expanded', String(on));
    }
  };
  for (const b of buttons) b.addEventListener('click', () => show(open === b.dataset.open ? null : b.dataset.open));

  // tapping the glass closes an open card (the tap still reaches the window as usual)
  $('gl').addEventListener('pointerdown', () => { if (open) show(null); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) show(null); });
  addEventListener('resize', () => { for (const c of cards) if (!c.hidden) place(c); });

  // Draw: close any card (the strip's Done button turns drawing off: src/logo/panel.js)
  $('drawToggle').addEventListener('click', () => show(null));

  // ── dragging cards by their title bar ─────────────────────────────────────
  for (const card of cards) {
    const title = card.querySelector('.card-title');
    if (!title) continue;
    const grip = document.createElement('span');
    grip.className = 'grip'; grip.textContent = '⠿'; grip.setAttribute('aria-hidden', 'true');
    title.prepend(grip);
    title.title = 'Drag to move. Double-click to put it back.';
    let drag = null;
    title.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button, input, select, a')) return;
      const r = card.getBoundingClientRect();
      drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { title.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      card.classList.add('moved', 'dragging');
      moveTo(card, r.left, r.top);
      e.preventDefault();
    });
    title.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      moveTo(card, e.clientX - drag.dx, e.clientY - drag.dy);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      card.classList.remove('dragging');
      pos = { x: card.offsetLeft / innerWidth, y: card.offsetTop / innerHeight };   // all cards open here now
      save();
    };
    title.addEventListener('pointerup', end);
    title.addEventListener('pointercancel', end);
    title.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, input, select, a')) return;
      pos = null; save(); place(card);
    });
  }

  show(null);
  return { show, get open() { return open; } };
}
