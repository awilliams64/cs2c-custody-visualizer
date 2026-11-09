// 3D manipulation: drag = tumble, shift/right-drag = roll, wheel/pinch = zoom, two-finger twist = roll,
// double-click = reset, arrow keys / Q / E / +/- for keyboard users.
import { qLook, qaxis, qmul, qnorm, setDist, view } from './camera';
import { REGIONS } from './config';
import { $ } from './dom';
import { globeCanvas as cv, hits } from './render';
import { S } from './state';
import type { Focus, Vec3 } from './types';

interface Drag { x: number; y: number; moved: boolean; roll: boolean; pd?: number; pa?: number; lt?: number }
let drag: Drag | null = null;
const ptrs = new Map<number, { x: number; y: number }>();
export const isDragging = () => !!drag;

const followOff = () => { S.follow = false; $('#follow').setAttribute('aria-pressed', 'false'); };

export function initInput(onFocus: (f: NonNullable<Focus>) => void, togglePlay: () => void): void {
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' || !ptrs.size) { ptrs.clear(); drag = null; }
    try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) drag = { x: e.clientX, y: e.clientY, moved: false, roll: e.shiftKey || e.button === 2 };
    S.cam.vel = null; S.cam.qTarget = null;
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag.pd = Math.hypot(b.x - a.x, b.y - a.y); drag.pa = Math.atan2(b.y - a.y, b.x - a.x); drag.moved = true; }
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || !ptrs.has(e.pointerId)) return;
    drag.lt = e.timeStamp;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = S.cam;
    if (ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(b.x - a.x, b.y - a.y), an = Math.atan2(b.y - a.y, b.x - a.x);
      if (drag.pd) { setDist(c.d * drag.pd / d); c.q = qnorm(qmul(c.q, qaxis([0, 0, 1], an - (drag.pa || 0)))); }
      drag.pd = d; drag.pa = an; return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) { drag.moved = true; cv.classList.add('drag'); if (c.pivot === 'earth') followOff(); }
    if (!drag.moved) return;
    if (drag.roll) { c.q = qnorm(qmul(c.q, qaxis([0, 0, 1], dx * 0.006))); c.vel = null; }
    else {
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const k = c.pivot === 'earth' ? 1 / Math.max(60, view.RPX) : 1 / (0.45 * Math.min(view.W, view.H));
        const axis: Vec3 = [-dy / len, -dx / len, 0], ang = len * k;
        c.q = qnorm(qmul(c.q, qaxis(axis, ang))); c.vel = { axis, ang: ang * 0.6 };
      }
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const endPtr = (e: PointerEvent) => {
    const was = drag; ptrs.delete(e.pointerId);
    if (was && !was.moved && e.type === 'pointerup') {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let best: typeof hits[number] | null = null, bd = 16;
      hits.forEach(h => { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } });
      if (best) onFocus((best as typeof hits[number]).f);
    }
    if (!ptrs.size) { if (drag && S.cam.vel && e.timeStamp - (drag.lt || e.timeStamp) > 80) S.cam.vel = null; drag = null; cv.classList.remove('drag'); }
    else if (drag) { const p = [...ptrs.values()][0]; drag.x = p.x; drag.y = p.y; drag.pd = 0; }
  };
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('lostpointercapture', e => { if (ptrs.has(e.pointerId)) endPtr(e); });
  window.addEventListener('blur', () => { ptrs.clear(); drag = null; cv.classList.remove('drag'); });
  cv.addEventListener('dblclick', () => {
    const c = REGIONS[S.region].center; S.cam.pivot = 'earth';
    [...$('#pivot').children].forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === 'earth')));
    S.cam.vel = null; S.cam.d = 60000; S.cam.qTarget = qLook(c[0], c[1]); followOff();
  });
  cv.addEventListener('wheel', e => { e.preventDefault(); setDist(S.cam.d * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  window.addEventListener('keydown', e => {
    const tgt = e.target as Element | null;
    if (e.code === 'Space' && !tgt?.closest?.('input,button,summary')) { e.preventDefault(); togglePlay(); return; }
    if (tgt?.closest?.('input,button')) return;
    const c = S.cam, a = 0.06; let ax: Vec3 | null = null;
    if (e.key === 'ArrowLeft') ax = [0, 1, 0]; else if (e.key === 'ArrowRight') ax = [0, -1, 0];
    else if (e.key === 'ArrowUp') ax = [1, 0, 0]; else if (e.key === 'ArrowDown') ax = [-1, 0, 0];
    else if (e.key === 'q' || e.key === 'Q') { c.q = qnorm(qmul(c.q, qaxis([0, 0, 1], -a))); return; }
    else if (e.key === 'e' || e.key === 'E') { c.q = qnorm(qmul(c.q, qaxis([0, 0, 1], a))); return; }
    else if (e.key === '+' || e.key === '=') { setDist(c.d / 1.2); return; }
    else if (e.key === '-') { setDist(c.d * 1.2); return; }
    if (ax) { e.preventDefault(); c.q = qnorm(qmul(c.q, qaxis(ax, -a))); if (c.pivot === 'earth') followOff(); }
  });
}
