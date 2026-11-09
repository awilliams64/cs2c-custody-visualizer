// Custody selection: baseline rule, simulated CS2C feed (joint, multi-target), or picks from CS2C itself.
import { allTracks, selectGeometry } from './access';
import { BANDS, FOV_HALF, bandSuit, phaseClass } from './config';
import { DT, D2R, HOLD_MIN, MIN_STEREO, SWITCH_GAIN } from './constants';
import { buildEvents } from './events';
import { MODEL, S, sim } from './state';
import type { Band, PickEntry, StepRec, Track, Vis, WhyParts } from './types';
import { clamp1 } from './vec';

const ang = (a: Vis, b: Vis) => Math.acos(clamp1(a.lx * b.lx + a.ly * b.ly + a.lz * b.lz));
const isGlide = (r: StepRec) => r.phase === 'glide' || r.phase === 'terminal';

export function saveBaseline(): void {
  allTracks().forEach(rec => rec.forEach(r => {
    if (r) r.b = { best: r.best, partner: r.partner, theta: r.theta, status: r.status, bestV: r.bestV, partnerV: r.partnerV };
  }));
}

function setPick(r: StepRec, bi: number, pi: number, pid: string | null = null, qid: string | null = null): void {
  const V = r.vis, B = bi >= 0 ? V.find(v => v.s === bi) || null : null, Pv = pi >= 0 ? V.find(v => v.s === pi) || null : null;
  r.best = bi; r.partner = pi; r.bestV = B; r.partnerV = Pv; r.pickId = pid; r.partnerId = qid;
  r.pickInView = !!B; r.partnerInView = (pi === -1 && !qid) || !!Pv;
  if (B && Pv) { r.theta = ang(B, Pv); r.status = r.theta >= MIN_STEREO ? 2 : 1; }
  else { r.theta = 0; r.status = B ? 1 : 0; }
}

function fixedBands(r: StepRec): void {
  r.bandP = r.bestV ? r.bestV.band0 : null; r.bandQ = r.partnerV ? r.partnerV.band0 : null; r.bandMode = 'fixed';
}

/** Per-target hysteresis state for the simulated picker. */
interface Hold { pb: number; pp: number; holdK: number }
interface Pair { a: Vis; b: Vis; th: number; sc: number }

/**
 * One target, one step of the simulated picker. Scores every stereo pair, holds a valid pair for at least
 * HOLD_MIN seconds, hands over only for a SWITCH_GAIN improvement, and keeps the surviving SV when a pair breaks.
 */
function pickOne(r: StepRec, V: Vis[], k: number, s: Hold, shared: (v: Vis) => boolean): void {
  const glide = isGlide(r);
  const parts = (v: Vis): WhyParts => ({
    geo: v.qg || 0, dwell: v.qd || 0, band: 0.3 * (v.bs || 0),
    fc: glide && sim.sats[v.s].layer === 'FC' ? 0.1 : 0,
    cont: (v.s === s.pb || v.s === s.pp) ? 0.2 : 0,
    share: shared(v) ? 0.15 : 0,
  });
  const qq = (v: Vis) => { const p = parts(v); return p.geo + p.dwell + p.band + p.fc + p.cont + p.share; };
  const pairs: Pair[] = [];
  for (let i = 0; i < V.length; i++) for (let m = i + 1; m < V.length; m++) {
    const th = ang(V[i], V[m]); if (th < MIN_STEREO) continue;
    pairs.push({ a: V[i], b: V[m], th, sc: Math.sin(th) * (qq(V[i]) + qq(V[m])) / 2 });
  }
  pairs.sort((x, y) => y.sc - x.sc);
  if (pairs.length) {
    const cur = s.pb >= 0 && s.pp >= 0 ? pairs.find(c => (c.a.s === s.pb && c.b.s === s.pp) || (c.a.s === s.pp && c.b.s === s.pb)) || null : null;
    const keepOne = !cur ? pairs.find(c => [c.a.s, c.b.s].some(x => x >= 0 && (x === s.pb || x === s.pp))) || null : null;
    let pick: Pair;
    if (cur && ((k - s.holdK) * DT < HOLD_MIN || pairs[0].sc < cur.sc * SWITCH_GAIN)) pick = cur;
    else if (keepOne && pairs[0].sc < keepOne.sc * SWITCH_GAIN) { pick = keepOne; s.holdK = k; }
    else { pick = pairs[0]; if (pick !== cur) s.holdK = k; }
    let a = pick.a, b = pick.b;
    if (b.s === s.pb || (a.s !== s.pb && qq(b) > qq(a))) [a, b] = [b, a];
    const alt = pairs.find(c => c !== pick) || null;
    r.sim = [a.s, b.s];
    r.why = { p: parts(a), q: parts(b), th: pick.th, score: pick.sc, second: alt ? alt.sc : 0, alt: alt ? [alt.a.s, alt.b.s] : null, mono: false, held: pick !== pairs[0] };
  } else {
    const order = V.map(v => [qq(v), v] as [number, Vis]).sort((x, y) => y[0] - x[0]);
    let v = order[0][1]; const curV = V.find(x => x.s === s.pb);
    if (curV && ((k - s.holdK) * DT < HOLD_MIN || order[0][0] < qq(curV) * SWITCH_GAIN)) v = curV; else if (v.s !== s.pb) s.holdK = k;
    const alt = order.find(o => o[1] !== v);
    r.sim = [v.s, -1];
    r.why = { p: parts(v), q: null, th: 0, score: qq(v), second: alt ? alt[0] : 0, alt: alt ? [alt[1].s, -1] : null, mono: true, held: v !== order[0][1] };
  }
  s.pb = r.sim[0]; s.pp = r.sim[1];
}

/** Launch sites: independent per site (no shared-FOV constraint). */
function simPicksSite(rec: Track): void {
  const s: Hold = { pb: -1, pp: -1, holdK: 0 };
  rec.forEach((r, k) => {
    if (!r) return;
    r.why = null;
    if (!r.vis.length) { r.sim = [-1, -1]; s.pb = s.pp = -1; return; }
    pickOne(r, r.vis, k, s, () => false);
  });
}

/**
 * CS2C-style joint tasking over all threats. Each SV has one boresight and one band, so it can hold several
 * threats only if they all fit inside its field of view and want the same band.
 */
function simJoint(): void {
  const holds: Hold[] = sim.threats.map(() => ({ pb: -1, pp: -1, holdK: 0 }));
  const order = sim.threats.map((_, j) => j).sort((a, b) => sim.threats[a].tL - sim.threats[b].tL);
  sim.stepTask = new Array(sim.nstep);
  type Slot = { j: number; lx: number; ly: number; lz: number; band: Band };
  for (let k = 0; k < sim.nstep; k++) {
    const asg = new Map<number, Slot[]>(); let picks = 0;
    // incumbents first, so a held pair is not squeezed out by a newer threat
    const ord = order.slice().sort((a, b) => Number(holds[b].pb >= 0) - Number(holds[a].pb >= 0));
    ord.forEach(j => {
      const r = sim.thrRec[j][k], s = holds[j];
      if (!r) { s.pb = s.pp = -1; return; }
      r.why = null; r.shareP = []; r.shareQ = [];
      const fits = (v: Vis) => {
        const L = asg.get(v.s); if (!L) return true;
        const half = FOV_HALF[sim.sats[v.s].layer] * D2R;
        return L.every(o => o.band === v.band && Math.acos(clamp1(o.lx * v.lx + o.ly * v.ly + o.lz * v.lz)) <= 2 * half);
      };
      const V = r.vis.filter(fits);
      if (!V.length) { r.sim = [-1, -1]; s.pb = s.pp = -1; return; }
      pickOne(r, V, k, s, v => asg.has(v.s));
      const add = (si: number) => {
        if (si < 0) return;
        const v = V.find(x => x.s === si)!;
        if (!asg.has(si)) asg.set(si, []);
        asg.get(si)!.push({ j, lx: v.lx, ly: v.ly, lz: v.lz, band: v.band });
        picks++;
      };
      add(r.sim[0]); add(r.sim[1]);
    });
    // who shares each tasked SV
    order.forEach(j => {
      const r = sim.thrRec[j][k]; if (!r || r.sim[0] < 0) return;
      const others = (x: number) => x >= 0 ? (asg.get(x) || []).filter(o => o.j !== j).map(o => o.j) : [];
      r.shareP = others(r.sim[0]); r.shareQ = others(r.sim[1]);
      if (r.why) { r.why.p.share = r.shareP.length ? 0.15 : 0; if (r.why.q) r.why.q.share = r.shareQ.length ? 0.15 : 0; }
    });
    sim.stepTask[k] = { svs: asg.size, picks };
  }
}

function lookupPick(arr: PickEntry[] | undefined, t: number): PickEntry | null {
  if (!arr || !arr.length || arr[0].t > t) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m].t <= t) lo = m; else hi = m - 1; }
  return arr[lo];
}

const resetToBaseline = (r: StepRec, picked: 'base' | 'none') => {
  Object.assign(r, r.b);
  r.picked = picked; r.pickInView = true; r.partnerInView = true; r.pickId = r.partnerId = null; r.reason = null;
  fixedBands(r);
};

/** Apply the current selection source to every target and step, then refresh stats and events. */
export function applySource(): void {
  const idMap = new Map(sim.sats.map((s, i) => [s.id, i]));
  if (MODEL.src === 'sim') { sim.siteRec.forEach(simPicksSite); simJoint(); }
  const recs: [Track, string][] = [...sim.siteRec.map((r, j) => [r, sim.sites[j].name] as [Track, string]), ...sim.thrRec.map((r, j) => [r, sim.threats[j].id] as [Track, string])];
  recs.forEach(([rec, key]) => {
    const arr = MODEL.src === 'file' && MODEL.file ? MODEL.file.byKey.get(key.toLowerCase()) : undefined;
    rec.forEach((r, k) => {
      if (!r) return;
      if (MODEL.src === 'base') { resetToBaseline(r, 'base'); return; }
      if (MODEL.src === 'sim') {
        setPick(r, r.sim[0], r.sim[1]); r.picked = 'sim'; r.reason = null;
        r.bandP = r.bestV ? r.bestV.band : null; r.bandQ = r.partnerV ? r.partnerV.band : null; r.bandMode = 'opt';
        return;
      }
      const p = lookupPick(arr, k * DT);
      if (!p) { resetToBaseline(r, 'none'); return; }
      const bi = p.primary ? (idMap.get(p.primary) ?? -2) : -1, pi = p.partner ? (idMap.get(p.partner) ?? -2) : -1;
      setPick(r, bi, pi, p.primary, p.partner);
      r.picked = 'file'; r.bandP = p.primaryBand; r.bandQ = p.partnerBand; r.bandMode = 'model'; r.reason = p.reason; r.why = null;
    });
  });
  computeStats(); buildEvents();
}

export function computeStats(): void {
  sim.stats = [];
  let act = 0, st2 = 0, sumV = 0, agree = 0, fit = 0, fit0 = 0, nfit = 0, tSv = 0, tPk = 0, tN = 0;
  const gapRuns = sim.threats.map(() => ({ cur: 0, max: 0, any: false }));
  for (let k = 0; k < sim.nstep; k++) {
    let mn = Infinity, mx = 0, sm = 0, n = 0; const c: [number, number, number] = [0, 0, 0];
    sim.thrRec.forEach((rec, j) => {
      const r = rec[k]; if (!r) return;
      n++; const v = r.vis.length; mn = Math.min(mn, v); mx = Math.max(mx, v); sm += v; c[r.status]++;
      if (r.best === r.b.best) agree++;
      const pc = phaseClass(r.phase);
      if (r.bestV && r.bandP && r.b.bestV) { fit += bandSuit(pc, r.bandP, r.bestV.bth); fit0 += r.b.bestV.bs0; nfit++; }
      const g = gapRuns[j]; if (r.status === 0) { g.cur += DT; g.any = true; g.max = Math.max(g.max, g.cur); } else g.cur = 0;
    });
    sim.stats.push(n ? { n, min: mn, max: mx, avg: sm / n, c } : null);
    const task = sim.stepTask[k];
    if (n && MODEL.src === 'sim' && task) { tSv += task.svs; tPk += task.picks; tN++; }
    act += n; st2 += c[2]; sumV += sm;
  }
  sim.summary = {
    stereo: act ? st2 / act : 0, avgV: act ? sumV / act : 0, agree: act ? agree / act : 1,
    tasked: tN ? tSv / tN : 0, slots: tN ? tPk / tN : 0, fit: nfit ? fit / nfit : 0, fit0: nfit ? fit0 / nfit : 0,
    gapThreats: gapRuns.filter(g => g.any).length, longest: Math.max(0, ...gapRuns.map(g => g.max)),
    maxV: Math.max(1, ...sim.stats.filter((s): s is NonNullable<typeof s> => !!s).map(s => s.max)),
  };
}

/* ---------- CS2C picks: file, JS API or live stream ---------- */

const normBand = (b: unknown): Band | null => { const u = b ? String(b).toUpperCase() : null; return u && (BANDS as string[]).includes(u) ? u as Band : null; };

/** Parse a CS2C selections object ({ model, selections: [...] }) into a feed. Throws on a malformed object. */
export function parseSelections(obj: unknown, fallbackName: string) {
  const o = obj as { model?: unknown; selections?: unknown };
  if (!o || !Array.isArray(o.selections)) throw new Error('The file needs a "selections" array.');
  const byKey = new Map<string, PickEntry[]>(); let n = 0, bad = 0;
  (o.selections as Record<string, unknown>[]).forEach(e => {
    if (!e || typeof e.t !== 'number' || !e.target) { bad++; return; }
    const k = String(e.target).toLowerCase(); if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push({
      t: e.t, primary: e.primary ? String(e.primary) : null, partner: e.partner ? String(e.partner) : null,
      primaryBand: normBand(e.primaryBand), partnerBand: normBand(e.partnerBand),
      reason: e.reason ? String(e.reason).slice(0, 240) : null,
    });
    n++;
  });
  byKey.forEach(a => a.sort((x, y) => x.t - y.t));
  return { name: typeof o.model === 'string' && o.model ? o.model : fallbackName, byKey, n, bad };
}

/** Merge picks into the active feed (used by the live link, which streams picks a step at a time). */
export function mergePicks(name: string, entries: { target: string; pick: PickEntry }[]): void {
  if (!MODEL.file) MODEL.file = { name, byKey: new Map(), n: 0, bad: 0 };
  MODEL.file.name = name;
  entries.forEach(({ target, pick }) => {
    const key = target.toLowerCase(); const arr = MODEL.file!.byKey.get(key) || [];
    const at = arr.findIndex(p => p.t === pick.t);
    if (at >= 0) arr[at] = pick; else { arr.push(pick); arr.sort((x, y) => x.t - y.t); MODEL.file!.n++; }
    MODEL.file!.byKey.set(key, arr);
  });
}

export function fileStatusText(): string {
  const f = MODEL.file; if (!f) return 'No CS2C picks loaded.';
  const ids = new Set(sim.sats.map(s => s.id)), keys = new Set([...sim.sites.map(s => s.name.toLowerCase()), ...sim.threats.map(t => t.id.toLowerCase())]);
  const unknown = new Set<string>();
  f.byKey.forEach(a => a.forEach(e => { [e.primary, e.partner].forEach(id => { if (id && !ids.has(id)) unknown.add(id); }); }));
  const matched = [...f.byKey.keys()].filter(k => keys.has(k)).length;
  return `<b>${f.name.replace(/</g, '&lt;')}</b>: ${f.n.toLocaleString('en-US')} picks for ${f.byKey.size} targets (${matched} match this scenario).` +
    (unknown.size ? ` ${unknown.size} SV ID${unknown.size > 1 ? 's' : ''} not in this constellation (${[...unknown].slice(0, 3).join(', ').replace(/</g, '&lt;')}${unknown.size > 3 ? '…' : ''}).` : '') +
    (f.bad ? ` ${f.bad} rows skipped.` : '');
}

/* ---------- injected SV outages ---------- */

export const isOut = (s: number, t: number) => sim.outages.some(o => o.s === s && t >= o.t);

/** Re-run selection after the outage list changes. Outages are not foreseen: dwell is not recomputed. */
export function recomputeSelection(): void {
  allTracks().forEach(rec => rec.forEach((r, k) => {
    if (!r) return; const t = k * DT;
    r.vis = sim.outages.length ? r.vis0.filter(v => !isOut(v.s, t)) : r.vis0;
  }));
  allTracks().forEach(selectGeometry); saveBaseline(); applySource();
}

/** Knock out SV s from the next step onward. Returns false if it was already out. */
export function knockOut(s: number): boolean {
  if (s < 0 || sim.outages.some(o => o.s === s)) return false;
  sim.outages.push({ s, t: Math.ceil(S.t / DT) * DT });
  recomputeSelection();
  return true;
}
