// Summary chart: SVs in view (min–max band and average) with a stereo/mono/gap strip, plus per-threat custody strips.
import { DT } from './constants';
import { $ } from './dom';
import { fmtT } from './format';
import { S, sim } from './state';
import { C } from './theme';

const ch = $<HTMLCanvasElement>('#chart'), chx = ch.getContext('2d')!;
let chartImg: ImageData | null = null;
let geom: { L: number; pw: number; T: number; sy: number; sh: number; w: number; d: number } | null = null;

export function drawChart(): void {
  if (!sim.stats.length || !C.ok) return;
  const d = Math.min(2, devicePixelRatio || 1), w = ch.clientWidth || 268, h = 118;
  ch.width = Math.round(w * d); ch.height = Math.round(h * d);
  const g = chx; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
  const L = 24, Rr = 4, T = 6, Bm = 30, ph = h - T - Bm, pw = w - L - Rr, ymax = Math.ceil(sim.summary.maxV / 10) * 10 || 10;
  const X = (t: number) => L + t / sim.dur * pw, Y = (v: number) => T + ph - v / ymax * ph;
  g.font = '10px "IBM Plex Mono",monospace'; g.fillStyle = C.muted; g.strokeStyle = C.line; g.lineWidth = 1;
  [0, ymax / 2, ymax].forEach(v => {
    g.globalAlpha = 0.7; g.beginPath(); g.moveTo(L, Y(v) + 0.5); g.lineTo(w - Rr, Y(v) + 0.5); g.stroke(); g.globalAlpha = 1;
    g.textAlign = 'right'; g.fillText(String(v), L - 4, Y(v) + 3);
  });
  type Pt = [number, NonNullable<typeof sim.stats[number]>];
  const runs: Pt[][] = []; let cur: Pt[] = [];
  sim.stats.forEach((s, k) => { if (s) cur.push([k * DT, s]); else if (cur.length) { runs.push(cur); cur = []; } });
  if (cur.length) runs.push(cur);
  g.fillStyle = C.gold; g.globalAlpha = 0.28;
  runs.forEach(r => {
    g.beginPath(); r.forEach(([t, s], i) => i ? g.lineTo(X(t), Y(s.max)) : g.moveTo(X(t), Y(s.max)));
    for (let i = r.length - 1; i >= 0; i--) g.lineTo(X(r[i][0]), Y(r[i][1].min));
    g.closePath(); g.fill();
  });
  g.globalAlpha = 1; g.strokeStyle = C.gold; g.lineWidth = 1.6;
  runs.forEach(r => { g.beginPath(); r.forEach(([t, s], i) => i ? g.lineTo(X(t), Y(s.avg)) : g.moveTo(X(t), Y(s.avg))); g.stroke(); });
  const sy = T + ph + 6, sh = 8;
  sim.stats.forEach((s, k) => {
    if (!s) return; const x0 = X(k * DT), x1 = X((k + 1) * DT); let y = sy;
    ([[2, C.ok], [1, C.gold], [0, C.bad]] as [0 | 1 | 2, string][]).forEach(([c, col]) => { const hh = s.c[c] / s.n * sh; if (hh > 0) { g.fillStyle = col; g.fillRect(x0, y, x1 - x0 + 0.5, hh); y += hh; } });
  });
  g.fillStyle = C.muted; g.textAlign = 'left'; g.fillText('T+00:00', L, h - 3); g.textAlign = 'right'; g.fillText('T+' + fmtT(sim.dur), w - Rr, h - 3);
  chartImg = g.getImageData(0, 0, ch.width, ch.height); geom = { L, pw, T, sy, sh, w, d };
  drawChartCursor();
}

export function drawChartCursor(): void {
  if (!chartImg || !geom) return;
  const g = chx, { L, pw, T, sy, sh, d, w } = geom;
  g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(chartImg, 0, 0); g.setTransform(d, 0, 0, d, 0, 0);
  const x = L + S.t / sim.dur * pw;
  g.strokeStyle = C.ink; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, sy + sh); g.stroke();
  const s = sim.stats[Math.min(sim.nstep - 1, Math.floor(S.t / DT + 0.5))];
  if (s) {
    g.font = '600 10px "IBM Plex Mono",monospace'; g.fillStyle = C.ink;
    const right = x > w * 0.6; g.textAlign = right ? 'right' : 'left';
    g.fillText(`avg ${s.avg.toFixed(1)}`, x + (right ? -4 : 4), T + 9);
  }
}

export function drawStrips(): void {
  if (!sim.threats.length || !C.ok) return;
  sim.threats.forEach((th, j) => {
    const el = document.querySelector<HTMLCanvasElement>(`#thr-${j} canvas`); if (!el) return;
    const w = el.clientWidth || 300, h = 6, d = Math.min(2, devicePixelRatio || 1);
    if (el.width !== Math.round(w * d)) { el.width = Math.round(w * d); el.height = Math.round(h * d); }
    const g = el.getContext('2d')!; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h); g.fillStyle = C.line; g.fillRect(0, 0, w, h);
    const k0 = Math.floor(th.tL / DT), k1 = Math.min(sim.nstep - 1, Math.ceil(th.tEnd / DT));
    for (let k = k0; k <= k1; k++) {
      const r = sim.thrRec[j][k]; if (!r) continue;
      const x0 = (k - k0) / (k1 - k0 + 1) * w, x1 = (k - k0 + 1) / (k1 - k0 + 1) * w;
      g.fillStyle = r.status === 2 ? C.ok : r.status === 1 ? C.gold : C.bad; g.fillRect(x0, 0, x1 - x0 + 0.5, h);
    }
    if (S.t >= th.tL && S.t <= th.tEnd) { const x = (S.t - th.tL) / (th.tEnd - th.tL) * w; g.fillStyle = C.ink; g.fillRect(x - 1, 0, 2, h); }
  });
}
