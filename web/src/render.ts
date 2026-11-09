// Globe rendering: a static layer (Earth, graticule, coastlines) and a dynamic layer (SVs, threats, lines of sight).
import { proj, pt, setCam, updateCam, view, type ScreenPt } from './camera';
import { DT, R2D, RE } from './constants';
import { $ } from './dom';
import { allSatPos, ringPoint, satPos } from './orbits';
import { MODEL, S, sim } from './state';
import { C } from './theme';
import { threatState } from './threats';
import type { Band, CircSat, Focus, StepRec, Vec3 } from './types';
import { cross, llv, unit } from './vec';
import { WORLD, WORLD_LO } from './world';

const cv = $<HTMLCanvasElement>('#globe'), ctx = cv.getContext('2d')!;
const stat = $<HTMLCanvasElement>('#world'), sctx = stat.getContext('2d')!;
export const globeCanvas = cv;

let dprMax = 2, camKey = '', camMoved = 0, hiPending = true, staticDirty = true;
export const markStaticDirty = () => { staticDirty = true; };
export const lowerResolution = () => { if (dprMax > 1) { dprMax = 1; resize(); } };

export function resize(): void {
  const r = cv.getBoundingClientRect();
  view.DPR = Math.min(dprMax, window.devicePixelRatio || 1); view.W = r.width; view.H = r.height;
  cv.width = stat.width = Math.round(view.W * view.DPR); cv.height = stat.height = Math.round(view.H * view.DPR);
  staticDirty = true;
}

/** Clickable objects drawn last frame. */
export let hits: { x: number; y: number; f: NonNullable<Focus> }[] = [];

const P = pt(), Q = pt();
const satBuf = new Float64Array(3000 * 3);
let satScr: ScreenPt[] = [];

export function focusRec(k: number): StepRec | null {
  const f = S.focus; if (!f) return null;
  return (f.kind === 'site' ? sim.siteRec[f.i][k] : sim.thrRec[f.i][k]) || null;
}
export function focusPos(t: number): Vec3 | null {
  const f = S.focus; if (!f) return null;
  if (f.kind === 'site') return sim.sites[f.i].p;
  const st = threatState(sim.threats[f.i], t); return st ? st.p : null;
}
export const stepAt = (t: number) => Math.min(sim.nstep - 1, Math.max(0, Math.floor(t / DT + 0.5)));

function drawStatic(hi: boolean): void {
  const g = sctx, { W, H, DPR, EH, EE } = view;
  g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H);
  // Earth silhouette = projected limb circle
  const n = Math.sqrt(EE), cc = EH.map(v => v * RE * RE / n), rl = RE * Math.sqrt(Math.max(0, 1 - RE * RE / EE));
  const a1 = unit(cross(EH, Math.abs(EH[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), a2 = cross(EH, a1);
  g.beginPath();
  for (let i = 0; i <= 128; i++) {
    const th = i / 128 * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    proj(cc[0] + rl * (c * a1[0] + s * a2[0]), cc[1] + rl * (c * a1[1] + s * a2[1]), cc[2] + rl * (c * a1[2] + s * a2[2]), P);
    if (i) g.lineTo(P[0], P[1]); else g.moveTo(P[0], P[1]);
  }
  g.closePath(); g.fillStyle = C.globe; g.fill(); g.strokeStyle = C.line; g.lineWidth = 1; g.stroke();
  const ok = () => !P[3] && P[0] > -2000 && P[0] < W + 2000 && P[1] > -2000 && P[1] < H + 2000;
  const polyline = (fn: (i: number) => Vec3 | null, count: number) => {
    let pen = false;
    for (let i = 0; i < count; i++) {
      const v = fn(i); if (!v) continue; proj(v[0], v[1], v[2], P);
      if (ok()) { if (pen) g.lineTo(P[0], P[1]); else g.moveTo(P[0], P[1]); pen = true; } else pen = false;
    }
  };
  g.strokeStyle = C.grat; g.lineWidth = 0.7; g.beginPath();
  for (let lat = -75; lat <= 75; lat += 15) polyline(i => llv(lat, -180 + i * 3), 121);
  for (let lon = -180; lon < 180; lon += 15) polyline(i => llv(-88 + i * 3, lon), 59);
  g.stroke();
  g.strokeStyle = C.coast; g.lineWidth = 0.6; g.beginPath();
  for (const a of (hi && view.RPX >= 420 ? WORLD : WORLD_LO)) polyline(i => [a[i * 3] * RE, a[i * 3 + 1] * RE, a[i * 3 + 2] * RE], a.length / 3);
  g.stroke();
}

/** Keep an off-screen point visible by pinning it to the canvas edge along its direction from the centre. */
function edgeClamp(p: ScreenPt | undefined): ScreenPt | null {
  if (!p || p[3]) return null;
  const m = 14, { W, H, CX, CY } = view;
  if (p[0] >= m && p[0] <= W - m && p[1] >= m && p[1] <= H - m) return p;
  const dx = p[0] - CX, dy = p[1] - CY; let f = 1;
  if (p[0] < m) f = Math.min(f, (m - CX) / dx); if (p[0] > W - m) f = Math.min(f, (W - m - CX) / dx);
  if (p[1] < m) f = Math.min(f, (m - CY) / dy); if (p[1] > H - m) f = Math.min(f, (H - m - CY) / dy);
  const q = [CX + dx * f, CY + dy * f, p[2], 0] as ScreenPt; q.off = true; return q;
}
function bandChip(g: CanvasRenderingContext2D, band: Band, x: number, y: number): void {
  g.font = '600 9.5px "IBM Plex Mono",ui-monospace,monospace';
  const w = g.measureText(band).width + 8;
  g.fillStyle = C[band.toLowerCase() as 'swir' | 'mwir' | 'lwir']; g.beginPath();
  if (g.roundRect) g.roundRect(x, y - 10, w, 13, 3); else g.rect(x, y - 10, w, 13);
  g.fill(); g.fillStyle = '#fff'; g.fillText(band, x + 4, y);
}
function label(g: CanvasRenderingContext2D, txt: string, x: number, y: number, col: string, size: number, bold = false): void {
  g.font = `${bold ? 600 : 500} ${size}px "IBM Plex Mono",ui-monospace,monospace`;
  g.lineWidth = 3; g.strokeStyle = C.globe; g.lineJoin = 'round'; g.strokeText(txt, x, y); g.fillStyle = col; g.fillText(txt, x, y);
}

/** Draw one frame at simulation time t. */
export function render(t: number, k: number, dragging: boolean): void {
  // auto-focus: first threat to launch, then whichever is active
  if (S.autoFocus) {
    const f = S.focus, cur = f && f.kind === 'threat' ? sim.thrRec[f.i][k] : null;
    if (!cur) {
      const j = sim.threats.findIndex((_, j) => sim.thrRec[j][k]);
      if (j >= 0) S.focus = { kind: 'threat', i: j }; else if (!f || f.kind === 'threat') S.focus = { kind: 'site', i: 0 };
    }
  }
  const fp = focusPos(t);
  updateCam(fp, dragging); setCam();
  const key = [...S.cam.q.map(v => v.toFixed(5)), ...view.E.map(v => v.toFixed(1)), view.W, view.H].join();
  const nowT = performance.now();
  if (key !== camKey || staticDirty) { drawStatic(false); camKey = key; staticDirty = false; camMoved = nowT; hiPending = true; }
  else if (hiPending && nowT - camMoved > 220) { drawStatic(true); hiPending = false; }

  const g = ctx, { W, H, DPR } = view;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  hits = [];
  allSatPos(t, satBuf);
  const sats = sim.sats;

  // orbit rings
  if (S.rings) {
    g.lineWidth = 0.6; g.strokeStyle = C.sv; g.globalAlpha = 0.22;
    const planes = new Map<string, CircSat>();
    sats.forEach(s => { if (s.kind === 'c' && !planes.has(s.ring)) planes.set(s.ring, s); });
    const tmp = [0, 0, 0];
    planes.forEach(s => {
      g.beginPath(); let pen = false;
      for (let i = 0; i <= 96; i++) {
        satPos(ringPoint(s, i * 2 * Math.PI / 96), t, tmp, 0); proj(tmp[0], tmp[1], tmp[2], P);
        if (!P[3]) { if (pen) g.lineTo(P[0], P[1]); else g.moveTo(P[0], P[1]); pen = true; } else pen = false;
      }
      g.stroke();
    });
    g.globalAlpha = 1;
  }

  // which SVs are in view of what
  const inAny = new Set<number>(), bestAny = new Set<number>();
  // pre-launch default watch: no lines until a missile fires or the user picks a site
  const rec = (S.autoFocus && S.focus && S.focus.kind === 'site') ? null : focusRec(k);
  const thrNow = sim.thrRec.map(r => r[k]).filter((r): r is StepRec => !!r);
  const pool = thrNow.length ? thrNow : [...sim.siteRec.map(r => r[k]).filter((r): r is StepRec => !!r)];
  pool.forEach(r => { r.vis.forEach(v => inAny.add(v.s)); if (r.best >= 0) bestAny.add(r.best); });
  const inFocus = new Set(rec ? rec.vis.map(v => v.s) : []);
  satScr = sats.map((_, i) => proj(satBuf[i * 3], satBuf[i * 3 + 1], satBuf[i * 3 + 2], pt()));

  // lines of sight
  const drawLos = (r: StepRec | null, tp: Vec3 | null, strong: boolean) => {
    if (!r || !tp) return;
    proj(tp[0], tp[1], tp[2], Q); if (Q[3]) return;
    const tx = Q[0], ty = Q[1];
    r.vis.forEach(v => {
      if (v.s === r.best || v.s === r.partner) return;
      const sp = edgeClamp(satScr[v.s]); if (!sp) return;
      g.strokeStyle = C.gold; g.globalAlpha = strong ? 0.45 : 0.18; g.lineWidth = 0.8; g.beginPath(); g.moveTo(tx, ty); g.lineTo(sp[0], sp[1]); g.stroke();
    });
    g.globalAlpha = 1;
    if (r.partner >= 0) { const sp = edgeClamp(satScr[r.partner]); if (sp) { g.strokeStyle = C.blue; g.lineWidth = strong ? 2 : 1.2; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(tx, ty); g.lineTo(sp[0], sp[1]); g.stroke(); g.setLineDash([]); } }
    if (r.best >= 0) { const sp = edgeClamp(satScr[r.best]); if (sp) { g.strokeStyle = r.bestV ? C.gold : C.bad; g.lineWidth = strong ? 2.4 : 1.4; g.beginPath(); g.moveTo(tx, ty); g.lineTo(sp[0], sp[1]); g.stroke(); } }
  };
  if (S.allLos) sim.threats.forEach((th, j) => {
    if (S.focus && S.focus.kind === 'threat' && S.focus.i === j) return;
    const r = sim.thrRec[j][k], st = threatState(th, t); if (r && st) drawLos(r, st.p, false);
  });

  // satellites (highlighted ones are drawn last)
  for (let i = 0; i < sats.length; i++) {
    const p = satScr[i]; if (p[3]) continue; if (p[0] < -10 || p[0] > W + 10 || p[1] < -10 || p[1] > H + 10) continue;
    if (rec && (i === rec.best || i === rec.partner)) continue;
    g.globalAlpha = p[2] < 0 ? 0.45 : 1;
    let col = C.sv, r = 2.1;
    if (inFocus.has(i)) { col = C.gold; r = 3.2; } else if (inAny.has(i)) { col = C.gold; r = 2.4; g.globalAlpha *= 0.75; }
    g.beginPath(); if (sats[i].layer === 'FC') g.rect(p[0] - r, p[1] - r, r * 2, r * 2); else g.arc(p[0], p[1], r, 0, Math.PI * 2);
    g.fillStyle = col; g.fill();
    if (bestAny.has(i)) { g.lineWidth = 1.2; g.strokeStyle = C.ink; g.stroke(); }
    g.globalAlpha = 1;
  }
  // knocked-out SVs
  sim.outages.forEach(o => {
    if (t < o.t) return; const p = satScr[o.s]; if (!p || p[3]) return;
    g.strokeStyle = C.bad; g.lineWidth = 2; g.beginPath();
    g.moveTo(p[0] - 5, p[1] - 5); g.lineTo(p[0] + 5, p[1] + 5); g.moveTo(p[0] + 5, p[1] - 5); g.lineTo(p[0] - 5, p[1] + 5); g.stroke();
    label(g, `${sats[o.s].id} OUT`, p[0] + 8, p[1] - 6, C.bad, 9.5, true);
  });
  // launch sites
  sim.sites.forEach((s, j) => {
    proj(s.p[0], s.p[1], s.p[2], P); if (P[3]) return;
    const foc = !S.autoFocus && S.focus && S.focus.kind === 'site' && S.focus.i === j;
    g.fillStyle = C.ink; g.beginPath(); g.rect(P[0] - 3, P[1] - 3, 6, 6); g.fill();
    if (foc) { g.strokeStyle = C.gold; g.lineWidth = 2; g.beginPath(); g.arc(P[0], P[1], 9, 0, Math.PI * 2); g.stroke(); }
    label(g, s.name, P[0] + 7, P[1] - 6, C.muted, 10);
    hits.push({ x: P[0], y: P[1], f: { kind: 'site', i: j } });
  });
  // threat paths and aimpoints
  sim.threats.forEach((th, j) => {
    if (t < th.tL) return;
    const col = th.type === 'B' ? C.bal : C.hgv, foc = !!S.focus && S.focus.kind === 'threat' && S.focus.i === j;
    const cutoff = Math.min(th.path.length - 1, Math.floor((t - th.tL) / 5));
    g.lineWidth = foc ? 2 : 1.3; g.strokeStyle = col;
    for (let pass = 0; pass < 2; pass++) {
      g.globalAlpha = pass ? 0.3 : (foc ? 1 : 0.8); g.setLineDash(pass ? [3, 4] : []); g.beginPath(); let pen = false;
      const from = pass ? cutoff : 0, to = pass ? th.path.length - 1 : cutoff;
      for (let i = from; i <= to; i++) { const q = th.path[i]; proj(q[0], q[1], q[2], P); if (!P[3]) { if (pen) g.lineTo(P[0], P[1]); else g.moveTo(P[0], P[1]); pen = true; } else pen = false; }
      if (!pass && t < th.tEnd) { const st = threatState(th, t); if (st) { proj(st.p[0], st.p[1], st.p[2], P); if (!P[3]) g.lineTo(P[0], P[1]); } }
      g.stroke();
    }
    g.setLineDash([]); g.globalAlpha = 1;
    const ip = th.path[th.path.length - 1]; proj(ip[0], ip[1], ip[2], P);
    if (!P[3]) {
      g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath();
      g.moveTo(P[0] - 4, P[1] - 4); g.lineTo(P[0] + 4, P[1] + 4); g.moveTo(P[0] + 4, P[1] - 4); g.lineTo(P[0] - 4, P[1] + 4); g.stroke();
      if (foc || t >= th.tEnd) label(g, th.target, P[0] + 7, P[1] + 12, C.muted, 10);
    }
  });
  drawLos(rec, fp, true);
  // threat markers
  sim.threats.forEach((th, j) => {
    const st = threatState(th, t); if (!st) return;
    const r = sim.thrRec[j][k], col = th.type === 'B' ? C.bal : C.hgv, foc = !!S.focus && S.focus.kind === 'threat' && S.focus.i === j;
    proj(st.p[0], st.p[1], st.p[2], P); if (P[3]) return;
    const x = P[0], y = P[1];
    if (st.phase === 'boost') {
      const gr = g.createRadialGradient(x, y, 0, x, y, 12); gr.addColorStop(0, C.plume); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.globalAlpha = 0.8; g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    }
    const nx = threatState(th, Math.min(th.tEnd - 0.01, t + 8)); let heading = 0;
    if (nx) { proj(nx.p[0], nx.p[1], nx.p[2], Q); heading = Math.atan2(Q[1] - y, Q[0] - x); }
    g.save(); g.translate(x, y); g.rotate(heading); g.fillStyle = col; g.strokeStyle = C.globe; g.lineWidth = 1.2; g.beginPath();
    if (th.type === 'B') { g.moveTo(6, 0); g.lineTo(0, 4); g.lineTo(-6, 0); g.lineTo(0, -4); } else { g.moveTo(7, 0); g.lineTo(-5, 5); g.lineTo(-2, 0); g.lineTo(-5, -5); }
    g.closePath(); g.fill(); g.stroke(); g.restore();
    if (r) {
      g.strokeStyle = r.status === 2 ? C.ok : r.status === 1 ? C.gold : C.bad; g.lineWidth = foc ? 2.2 : 1.4;
      g.beginPath(); g.arc(x, y, foc ? 11 : 8.5, 0, Math.PI * 2); g.stroke();
      if (r.status === 0) { g.setLineDash([2, 3]); g.beginPath(); g.arc(x, y, 15, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    }
    label(g, th.id, x + 10, y - 9, foc ? C.ink : C.muted, foc ? 11.5 : 10, foc);
    if (foc && r && r.status === 2) label(g, `θ ${Math.round(r.theta * R2D)}°`, x + 10, y + 16, C.blue, 10.5, true);
    hits.push({ x, y, f: { kind: 'threat', i: j } });
  });

  // baseline ghost ring where the selection differs from the baseline rule
  if (rec && MODEL.src !== 'base' && rec.b.best >= 0 && rec.b.best !== rec.best) {
    const p = edgeClamp(satScr[rec.b.best]);
    if (p) { g.setLineDash([3, 3]); g.strokeStyle = C.ink; g.lineWidth = 1.4; g.beginPath(); g.arc(p[0], p[1], 8, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); label(g, 'baseline', p[0] + 10, p[1] - 6, C.muted, 9.5); }
  }
  // shared custody: thin lines from the focused threat's SVs to the other threats they hold
  if (rec && rec.picked === 'sim') {
    ([[rec.best, rec.shareP, C.gold], [rec.partner, rec.shareQ, C.blue]] as [number, number[], string][]).forEach(([si, share, col]) => {
      if (si < 0) return;
      const sp = edgeClamp(satScr[si]);
      if (sp && share.length) {
        g.strokeStyle = col; g.globalAlpha = 0.5; g.lineWidth = 1; g.setLineDash([2, 4]);
        share.forEach(j => { const st = threatState(sim.threats[j], t); if (!st) return; proj(st.p[0], st.p[1], st.p[2], P); if (P[3]) return; g.beginPath(); g.moveTo(sp[0], sp[1]); g.lineTo(P[0], P[1]); g.stroke(); });
        g.setLineDash([]); g.globalAlpha = 1;
      }
    });
  }
  // custody pick and stereo partner on top
  if (rec) {
    ([[rec.partner, 'p'], [rec.best, 'b']] as [number, 'p' | 'b'][]).forEach(([i, kind]) => {
      if (i < 0) return; const p = edgeClamp(satScr[i]); if (!p) return;
      g.beginPath(); g.arc(p[0], p[1], kind === 'b' ? 6 : 5, 0, Math.PI * 2);
      if (kind === 'b') { g.fillStyle = C.gold; g.fill(); g.lineWidth = 2; g.strokeStyle = C.ink; g.stroke(); }
      else { g.fillStyle = C.globe; g.fill(); g.lineWidth = 2.2; g.strokeStyle = C.blue; g.stroke(); g.beginPath(); g.arc(p[0], p[1], 2, 0, Math.PI * 2); g.fillStyle = C.blue; g.fill(); }
      const shN = rec.picked === 'sim' ? (kind === 'b' ? rec.shareP : rec.shareQ).length : 0;
      const txt = `${sats[i].id}${shN ? ' ×' + (shN + 1) : ''}${p.off ? ' ↗' : ''}`;
      label(g, txt, p[0] + 9, p[1] + 4, kind === 'b' ? C['gold-ink'] : C.blue, 11, true);
      const band = kind === 'b' ? rec.bandP : rec.bandQ;
      if (band) bandChip(g, band, p[0] + 13 + g.measureText(txt).width, p[1] + 4);
    });
  }
  // event pulses (slow, faint expanding rings)
  const nowP = performance.now();
  sim.pulses = sim.pulses.filter(pl => nowP - pl.start < 2000);
  sim.pulses.forEach(pl => {
    const f = (nowP - pl.start) / 2000; let x: number, y: number, col: string;
    if (pl.kind === 'sv' || pl.kind === 'out') { const p = edgeClamp(satScr[pl.s!]); if (!p) return; x = p[0]; y = p[1]; col = pl.kind === 'out' ? C.bad : C.gold; }
    else {
      const st = threatState(sim.threats[pl.j!], t); if (!st) return; proj(st.p[0], st.p[1], st.p[2], P); if (P[3]) return; x = P[0]; y = P[1];
      col = ({ launch: C.plume, phase: C.blue, maneuver: C.hgv, gap: C.bad, regain: C.ok, impact: C.muted } as Record<string, string>)[pl.kind] || C.gold;
    }
    g.globalAlpha = 0.55 * (1 - f) * (1 - f); g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 8 + f * 18, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  });
}
