// Sensor access: which SVs can see each target at each time step, plus the baseline geometry rule.
import { LAYER_BANDS, RANGE, bandSuit, phaseClass } from './config';
import { DT, MIN_STEREO, RE } from './constants';
import { assessThreats } from './assess';
import { allSatPos } from './orbits';
import { sim } from './state';
import { applySource, saveBaseline } from './tasking';
import { threatState } from './threats';
import type { Band, Layer, Phase, PhaseClass, StepRec, Track, Vec3, Vis } from './types';
import { clamp1, norm } from './vec';

/** Line of sight clear of the Earth and inside the layer's notional range for this phase. */
function access(sp: Vec3, tp: Vec3, layer: Layer, pc: PhaseClass, s: number): Vis | null {
  const lim = RANGE[layer][pc]; if (!lim) return null;
  const dx = tp[0] - sp[0], dy = tp[1] - sp[1], dz = tp[2] - sp[2], R = Math.hypot(dx, dy, dz);
  if (R > lim) return null;
  let u = -(sp[0] * dx + sp[1] * dy + sp[2] * dz) / (R * R); u = u < 0 ? 0 : u > 1 ? 1 : u;
  const cx = sp[0] + u * dx, cy = sp[1] + u * dy, cz = sp[2] + u * dz;
  if (Math.hypot(cx, cy, cz) < RE - 0.01) return null;
  const tn = norm(tp), lx = -dx / R, ly = -dy / R, lz = -dz / R;
  const se = (tp[0] * lx + tp[1] * ly + tp[2] * lz) / tn;
  // background: does the line of sight continue past the target into the Earth?
  const ux = dx / R, uy = dy / R, uz = dz / R, bb = tp[0] * ux + tp[1] * uy + tp[2] * uz, cc = tn * tn - RE * RE, disc = bb * bb - cc;
  const bth = disc > 0 && (-bb - Math.sqrt(disc)) > 0;
  const v: Vis = { s, R, se, lx, ly, lz, bth, rf: 1 - R / Math.min(lim, 45000), band0: 'SWIR', bs0: 0, band: 'SWIR', bs: 0, dw: 0, qg: 0, qd: 0, q: 0 };
  bandsFor(v, layer, pc);
  return v;
}

/** Default band and best-fitting band for this SV on this target. */
function bandsFor(v: Vis, layer: Layer, pc: PhaseClass): void {
  const bs = LAYER_BANDS[layer];
  v.band0 = bs[0]; v.bs0 = bandSuit(pc, bs[0], v.bth);
  let bb: Band = bs[0], m = -1;
  bs.forEach(b => { const s = bandSuit(pc, b, v.bth); if (s > m) { m = s; bb = b; } });
  v.band = bb; v.bs = m;
}

function newRec(vis: Vis[], phase: Phase): StepRec {
  return {
    vis, vis0: vis, phase, assess: null, best: -1, partner: -1, bestV: null, partnerV: null, theta: 0, status: 0,
    b: { best: -1, partner: -1, theta: 0, status: 0, bestV: null, partnerV: null }, sim: [-1, -1], why: null, shareP: [], shareQ: [],
    picked: 'base', pickInView: true, partnerInView: true, pickId: null, partnerId: null, bandP: null, bandQ: null, bandMode: 'fixed', reason: null,
  };
}

export function precompute(): void {
  sim.nstep = Math.ceil(sim.dur / DT) + 1;
  const buf = new Float64Array(sim.sats.length * 3), sp: Vec3 = [0, 0, 0];
  sim.siteRec = sim.sites.map(() => new Array(sim.nstep).fill(null));
  sim.thrRec = sim.threats.map(() => new Array(sim.nstep).fill(null));
  dwellDone = new WeakSet();
  const scan = (tp: Vec3, pc: PhaseClass) => {
    const v: Vis[] = [];
    for (let i = 0; i < sim.sats.length; i++) {
      sp[0] = buf[i * 3]; sp[1] = buf[i * 3 + 1]; sp[2] = buf[i * 3 + 2];
      const a = access(sp, tp, sim.sats[i].layer, pc, i); if (a) v.push(a);
    }
    return v;
  };
  for (let k = 0; k < sim.nstep; k++) {
    const t = k * DT; allSatPos(t, buf);
    sim.sites.forEach((st, j) => { sim.siteRec[j][k] = newRec(scan(st.p, 'boost'), 'watch'); });
    sim.threats.forEach((th, j) => { const ts = threatState(th, t); sim.thrRec[j][k] = ts ? newRec(scan(ts.p, phaseClass(ts.phase)), ts.phase) : null; });
  }
  assessThreats();
  allTracks().forEach(selectGeometry);
  sim.outages = [];
  saveBaseline(); applySource();
}

export const allTracks = (): Track[] => [...sim.siteRec, ...sim.thrRec];

let dwellDone = new WeakSet<Track>();

/** Baseline rule: best geometry score, then the best stereo partner, with light hysteresis. */
export function selectGeometry(rec: Track): void {
  // remaining access ("dwell"), computed once from the full access lists so an injected outage is not foreseen
  if (!dwellDone.has(rec)) {
    let next = new Map<number, number>();
    for (let k = rec.length - 1; k >= 0; k--) {
      const r = rec[k], cur = new Map<number, number>();
      if (r) r.vis.forEach(v => { v.dw = ((next.get(v.s) || 0) + 1) * DT; cur.set(v.s, v.dw / DT); });
      next = cur;
    }
    dwellDone.add(rec);
  }
  let pb = -1, pp = -1;
  for (let k = 0; k < rec.length; k++) {
    const r = rec[k]; if (!r) { pb = pp = -1; continue; }
    const V = r.vis;
    if (!V.length) { r.best = r.partner = -1; r.bestV = r.partnerV = null; r.status = 0; r.theta = 0; pb = pp = -1; continue; }
    let mq = -1, bi = -1;
    V.forEach((v, i) => {
      v.qg = 0.40 * Math.max(0, v.rf) + 0.25 * Math.max(0, Math.min(1, (v.se + 0.2) / 1.2));
      v.qd = 0.35 * Math.min(v.dw, 300) / 300; v.q = v.qg + v.qd;
      if (v.q > mq) { mq = v.q; bi = i; }
    });
    const keep = V.findIndex(v => v.s === pb); if (keep >= 0 && V[keep].q >= 0.85 * mq) bi = keep;
    const B = V[bi]; let ms = -1, pi = -1, th = 0; const sc: number[] = [];
    V.forEach((v, i) => {
      if (i === bi) return;
      const a = Math.acos(clamp1(B.lx * v.lx + B.ly * v.ly + B.lz * v.lz));
      if (a < MIN_STEREO) { sc[i] = -1; return; }
      sc[i] = Math.sin(a) * (0.5 + 0.5 * v.q); if (sc[i] > ms) { ms = sc[i]; pi = i; }
    });
    const kp = V.findIndex(v => v.s === pp); if (kp >= 0 && kp !== bi && sc[kp] >= 0.85 * ms) pi = kp;
    if (pi >= 0) { const v = V[pi]; th = Math.acos(clamp1(B.lx * v.lx + B.ly * v.ly + B.lz * v.lz)); }
    r.best = B.s; r.bestV = B; r.partner = pi >= 0 ? V[pi].s : -1; r.partnerV = pi >= 0 ? V[pi] : null; r.theta = th; r.status = pi >= 0 ? 2 : 1;
    pb = B.s; pp = r.partner;
  }
}
