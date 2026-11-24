// Missile defense layer: element laydown, radar fans and a notional engagement timeline driven by CS2C custody.
// Everything is notional and built from public information. Performance figures are round, public-ballpark planning numbers
// for visualization, not system specifications. Ship positions are notional or user-placed, not tracked.
//
// How it connects to custody: a threat gets a fire-control-quality space track once the custody selection (simulated feed,
// baseline rule or CS2C) has held stereo custody on it for STEREO_HOLD_S. Ground and ship radars can supply the track too.
// The earliest track starts the C2BMC fire-control solution; better custody means earlier, deeper engagement windows.
import { proj, pt, view } from './camera';
import { DT, R2D, RE } from './constants';
import { $ } from './dom';
import { esc, fmtN, fmtT } from './format';
import { S, sim } from './state';
import { C } from './theme';
import { threatState } from './threats';
import type { Phase, SimEvent, Threat, Vec3 } from './types';
import { dot, llv, mulberry, norm, toLL, unit } from './vec';

/* ---------- element types (notional parameters) ---------- */
type Cls = 'shooter' | 'radar' | 'c2';
type Col = 'gbi' | 'sm3' | 'thaad' | 'pac3' | 'sm6' | 'gpi' | 'radar' | 'c2';
interface ElType { cls: Cls; name: string; col: Col; v?: number; maxR?: number; alt?: [number, number]; delay?: number; defend?: number; only?: ('bal' | 'hgv')[]; phases?: string[]; range?: number }
const TYPES: Record<string, ElType> = {
  GBI: { cls: 'shooter', name: 'GMD · Ground-Based Interceptor', col: 'gbi', v: 6.0, maxR: 6000, alt: [150, 2000], delay: 60 },
  SM3: { cls: 'shooter', name: 'Aegis · SM-3', col: 'sm3', v: 3.5, maxR: 2200, alt: [100, 1200], delay: 30 },
  THAAD: { cls: 'shooter', name: 'THAAD', col: 'thaad', v: 2.5, maxR: 200, alt: [40, 150], delay: 15, defend: 200 },
  PAC3: { cls: 'shooter', name: 'PATRIOT PAC-3 MSE', col: 'pac3', v: 1.4, maxR: 60, alt: [5, 35], delay: 8, defend: 40 },
  SM6: { cls: 'shooter', name: 'Aegis · SM-6 (Sea-Based Terminal)', col: 'sm6', v: 1.2, maxR: 200, alt: [8, 35], delay: 10, defend: 250 },
  GPI: { cls: 'shooter', name: 'Glide Phase Interceptor (in development)', col: 'gpi', v: 3.0, maxR: 800, alt: [40, 70], delay: 20, only: ['hgv'], phases: ['Glide'] },
  UEWR: { cls: 'radar', name: 'Upgraded Early Warning Radar', col: 'radar', range: 4800 },
  LRDR: { cls: 'radar', name: 'Long Range Discrimination Radar', col: 'radar', range: 5000 },
  CDANE: { cls: 'radar', name: 'Cobra Dane', col: 'radar', range: 3200 },
  TPY2: { cls: 'radar', name: 'AN/TPY-2 (forward-based)', col: 'radar', range: 2000 },
  SBX: { cls: 'radar', name: 'Sea-Based X-band Radar', col: 'radar', range: 4000 },
  SPY: { cls: 'radar', name: 'Aegis SPY radar', col: 'sm3', range: 1000 },
  C2: { cls: 'c2', name: 'C2BMC node', col: 'c2' },
};
interface ElDef { id: string; type: string; name: string; lat: number; lon: number; note?: string; ashore?: boolean; az?: number; w?: number; hdg?: number }
interface El extends ElDef { p: Vec3; ship?: boolean; onShip?: boolean }
// Fixed sites at publicly known locations (coordinates approximate)
const SITES: ElDef[] = [
  { id: 'FGA', type: 'GBI', name: 'Fort Greely, AK', lat: 63.95, lon: -145.73, note: 'GMD interceptor field' },
  { id: 'VSFB', type: 'GBI', name: 'Vandenberg SFB, CA', lat: 34.75, lon: -120.58, note: 'GMD interceptor site' },
  { id: 'DEV', type: 'SM3', name: 'Aegis Ashore Deveselu, Romania', lat: 44.08, lon: 24.41, ashore: true },
  { id: 'RDZ', type: 'SM3', name: 'Aegis Ashore Redzikowo, Poland', lat: 54.48, lon: 17.10, ashore: true },
  { id: 'THG', type: 'THAAD', name: 'THAAD · Guam', lat: 13.58, lon: 144.93 },
  { id: 'THK', type: 'THAAD', name: 'THAAD · Seongju, ROK', lat: 35.98, lon: 128.20 },
  { id: 'THI', type: 'THAAD', name: 'THAAD · Israel (location notional)', lat: 31.25, lon: 34.95 },
  { id: 'BEA', type: 'UEWR', name: 'UEWR Beale AFB, CA', lat: 39.14, lon: -121.35, az: 265, w: 240 },
  { id: 'CCD', type: 'UEWR', name: 'UEWR Cape Cod SFS, MA', lat: 41.75, lon: -70.54, az: 47, w: 240 },
  { id: 'CLR', type: 'UEWR', name: 'UEWR Clear SFS, AK', lat: 64.29, lon: -149.19, az: 300, w: 240 },
  { id: 'PIT', type: 'UEWR', name: 'UEWR Pituffik SB, Greenland', lat: 76.57, lon: -68.30, az: 350, w: 240 },
  { id: 'FYL', type: 'UEWR', name: 'UEWR RAF Fylingdales, UK', lat: 54.36, lon: -0.67, az: 0, w: 360 },
  { id: 'LRD', type: 'LRDR', name: 'LRDR Clear SFS, AK', lat: 64.33, lon: -149.10, az: 270, w: 240 },
  { id: 'CDN', type: 'CDANE', name: 'Cobra Dane, Shemya AK', lat: 52.72, lon: 174.11, az: 319, w: 120 },
  { id: 'SHA', type: 'TPY2', name: 'AN/TPY-2 Shariki, Japan', lat: 40.88, lon: 140.34, az: 265, w: 120 },
  { id: 'KYO', type: 'TPY2', name: 'AN/TPY-2 Kyogamisaki, Japan', lat: 35.77, lon: 135.21, az: 300, w: 120 },
  { id: 'KUR', type: 'TPY2', name: 'AN/TPY-2 Kürecik, Türkiye', lat: 38.33, lon: 37.88, az: 110, w: 120 },
  { id: 'NEG', type: 'TPY2', name: 'AN/TPY-2 Negev, Israel', lat: 30.93, lon: 34.48, az: 75, w: 120 },
  { id: 'SCH', type: 'C2', name: 'C2BMC · Schriever SFB, CO', lat: 38.80, lon: -104.52 },
  { id: 'RAM', type: 'C2', name: 'C2BMC · Ramstein AB, Germany', lat: 49.44, lon: 7.60 },
];
const HOMEPORTS = [
  { name: 'Yokosuka, Japan', lat: 35.29, lon: 139.66 }, { name: 'Rota, Spain', lat: 36.62, lon: -6.33 },
  { name: 'Pearl Harbor, HI', lat: 21.35, lon: -157.97 }, { name: 'San Diego, CA', lat: 32.68, lon: -117.13 }, { name: 'Norfolk, VA', lat: 36.95, lon: -76.33 },
];
interface ShipDef { name: string; lat: number; lon: number; hdg: number }
/** Notional Aegis BMD ship, PAC-3 and SBX laydown for each launch region (real positions aren't public). */
const LAYDOWN: Record<string, { ships: ShipDef[]; pac3: { name: string; lat: number; lon: number }[]; sbx?: [number, number] }> = {
  nk: { ships: [{ name: 'DDG (BMD) · Sea of Japan', lat: 39.6, lon: 134.2, hdg: 60 }, { name: 'DDG (BMD) · North Pacific', lat: 46.0, lon: 160.0, hdg: 80 },
    { name: 'DDG (BMD) · off Guam', lat: 14.4, lon: 143.9, hdg: 330 }, { name: 'DDG (BMD) · off Oahu', lat: 22.6, lon: -160.2, hdg: 300 }],
    pac3: [{ name: 'PAC-3 battery · Guam (notional)', lat: 13.55, lon: 144.88 }], sbx: [47.0, 176.0] },
  cn: { ships: [{ name: 'DDG (BMD) · off Okinawa', lat: 26.9, lon: 126.6, hdg: 270 }, { name: 'DDG (BMD) · East China Sea', lat: 27.8, lon: 123.6, hdg: 250 },
    { name: 'DDG escort · CSG screen north', lat: 22.5, lon: 131.1, hdg: 90 }, { name: 'DDG escort · CSG screen west', lat: 21.8, lon: 130.9, hdg: 90 },
    { name: 'DDG (BMD) · Philippine Sea', lat: 18.5, lon: 140.5, hdg: 20 }, { name: 'DDG (BMD) · North Pacific', lat: 46.0, lon: 160.0, hdg: 80 },
    { name: 'DDG (BMD) · off Oahu', lat: 21.8, lon: -158.9, hdg: 300 }],
    pac3: [{ name: 'PAC-3 battery · Kadena (notional)', lat: 26.35, lon: 127.75 }, { name: 'PAC-3 battery · Guam (notional)', lat: 13.55, lon: 144.88 }], sbx: [45.0, 172.0] },
  ru: { ships: [{ name: 'DDG (BMD) · Baltic Sea', lat: 55.2, lon: 16.0, hdg: 90 }, { name: 'DDG escort · CSG screen north', lat: 65.1, lon: 2.0, hdg: 30 },
    { name: 'DDG escort · CSG screen east', lat: 64.7, lon: 2.6, hdg: 30 }, { name: 'DDG (BMD) · North Atlantic', lat: 58.0, lon: -25.0, hdg: 240 }],
    pac3: [{ name: 'PAC-3 battery · Ramstein (notional)', lat: 49.40, lon: 7.66 }] },
  ir: { ships: [{ name: 'DDG (BMD) · Eastern Med', lat: 34.4, lon: 27.0, hdg: 270 }, { name: 'DDG (BMD) · Eastern Med south', lat: 33.0, lon: 33.6, hdg: 90 },
    { name: 'DDG (BMD) · Aegean', lat: 38.4, lon: 25.2, hdg: 0 }, { name: 'DDG (BMD) · Red Sea', lat: 27.5, lon: 34.6, hdg: 330 }],
    pac3: [{ name: 'PAC-3 battery · Bavaria (notional)', lat: 48.25, lon: 11.45 }] },
};

export const OUTCOMES = { kill1: 'First round kills', miss1: 'First round misses, next round kills', leak: 'Every round misses (leaker)', pk: 'Probabilistic · per-round Pk' } as const;
type Outcome = keyof typeof OUTCOMES;
// Shot doctrine (notional): SLS = shoot-look-shoot, SSL = shoot-shoot-look (two-round ripple, then assess). Salvo spacing in seconds.
export const DOC_TYPES = { THAAD: 'THAAD', SM3: 'SM-3', SM6: 'SM-6' } as const;
type DocType = keyof typeof DOC_TYPES;
const SALVO_GAP: Record<DocType, number> = { THAAD: 4, SM3: 6, SM6: 4 }, LOOK_S = 12, ROUNDS_MAX = 4, ENG_MAX = 4;
const DOC_NAME = { SLS: 'shoot-look-shoot', SSL: 'shoot-shoot-look' };
// Magazines: GMD, THAAD battery and Aegis Ashore counts public; ship and PAC-3 loads notional
const INV: Record<string, number> = { SM3: 8, SM6: 8, GPI: 4, THAAD: 48, PAC3: 16, ASHORE: 24, FGA: 40, VSFB: 4 };
// C2BMC timing (notional)
const C2_BASE = 15, C2_PER_ACTIVE = 6, C2_PER_LAUNCH = 8, C2_DENSITY_S = 120, C2_MIN_GAP = 8, C2_PER_COLOC = 6, CLASS_RESOLVE_S = 15, CHANNEL_S = 4;
/** Stereo custody must be held this long before the space track counts as fire-control quality (notional). */
export const STEREO_HOLD_S = 30;

const roundName = (t: string) => t === 'SM3' ? 'SM-3' : t === 'SM6' ? 'SM-6' : t === 'GPI' ? 'GPI (future)' : t === 'GBI' ? 'GBI' : t === 'PAC3' ? 'PAC-3 MSE' : TYPES[t].name;
const invOf = (e: El) => e.type === 'GBI' ? INV[e.id] || 4 : e.ashore ? INV.ASHORE : INV[e.type] || 8;

/* ---------- user state ---------- */
export const MDA = {
  engage: true,
  on: { gmd: true, ships: true, ashore: true, thaad: true, pac3: true, gpi: true, radars: true, c2: true, rings: false, ports: false } as Record<string, boolean>,
  doctrine: { THAAD: 'SLS', SM3: 'SLS', SM6: 'SLS' } as Record<DocType, 'SLS' | 'SSL'>,
  outcome: 'kill1' as Outcome, pk: 0.7, seed: 1,
  fans: 'focus' as 'focus' | 'tracking' | 'all' | 'none', fanEl: 3,
  userShips: [] as ShipDef[], placing: false,
};

/* ---------- geometry ---------- */
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function destPoint(lat: number, lon: number, brg: number, ang: number): [number, number] {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180, b = brg * Math.PI / 180, d = ang * Math.PI / 180;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [la2 * R2D, ((lo2 * R2D + 540) % 360) - 180];
}
const enuCache = new Map<string, { o: Vec3; n: Vec3; e: Vec3; u: Vec3 }>();
function enu(e: { lat: number; lon: number }) {
  const k = e.lat.toFixed(3) + ',' + e.lon.toFixed(3); let c = enuCache.get(k); if (c) return c;
  const o = llv(e.lat, e.lon), n = unit(sub(llv(e.lat + 0.01, e.lon), o)), ea = unit(sub(llv(e.lat, e.lon + 0.01), o));
  c = { o, n, e: ea, u: unit(o) }; enuCache.set(k, c); return c;
}
const sector = (r: El) => ({ az: r.az || 0, w: r.w || 360 });
function azOf(r: El, p: Vec3) { const f = enu(r), d = sub(p, f.o); return (Math.atan2(dot(d, f.e), dot(d, f.n)) * R2D + 360) % 360; }
function inSector(r: El, p: Vec3) { const sc = sector(r); if (sc.w >= 360) return true; let d = Math.abs(azOf(r, p) - sc.az) % 360; if (d > 180) d = 360 - d; return d <= sc.w / 2; }
const elev = (site: Vec3, p: Vec3) => Math.asin(dot(unit(site), unit(sub(p, site)))) * R2D;
const sees = (r: El, p: Vec3) => dist(r.p, p) <= TYPES[r.type].range! && elev(r.p, p) >= 0.5 && inSector(r, p);
function fanPoint(r: El, az: number, el: number, R: number): Vec3 {
  const f = enu(r), a = az * Math.PI / 180, e = el * Math.PI / 180, ce = Math.cos(e), se = Math.sin(e), sa = Math.sin(a), ca = Math.cos(a);
  return [0, 1, 2].map(i => f.o[i] + R * (ce * (sa * f.e[i] + ca * f.n[i]) + se * f.u[i])) as Vec3;
}
export function ring(lat: number, lon: number, ang: number, n = 64): Vec3[] { const o: Vec3[] = []; for (let i = 0; i <= n; i++) { const [a, b] = destPoint(lat, lon, i / n * 360, ang); o.push(llv(a, b)); } return o; }

/* ---------- the element set in play ---------- */
let elCache: { key: string; els: El[] } | null = null;
export function activeElements(): El[] {
  const on = MDA.on, key = S.region + JSON.stringify(on) + MDA.userShips.length;
  if (elCache && elCache.key === key) return elCache.els;
  const els: El[] = [];
  SITES.forEach(s => {
    const T = TYPES[s.type];
    if ((s.type === 'GBI' && on.gmd) || (s.ashore && on.ashore) || (s.type === 'THAAD' && on.thaad) || (T.cls === 'radar' && on.radars) || (s.type === 'C2' && on.c2)) els.push({ ...s, p: llv(s.lat, s.lon) });
  });
  const L = LAYDOWN[S.region];
  if (on.ships) [...L.ships, ...MDA.userShips].forEach((sh, i) => {
    const id = 'SHIP' + i, p = llv(sh.lat, sh.lon);
    els.push({ ...sh, id, type: 'SM3', ship: true, p });
    els.push({ id: id + '-sm6', type: 'SM6', name: sh.name, lat: sh.lat, lon: sh.lon, p, onShip: true });
    if (on.gpi) els.push({ id: id + '-gpi', type: 'GPI', name: sh.name, lat: sh.lat, lon: sh.lon, p, onShip: true });
    if (on.radars) els.push({ id: id + '-spy', type: 'SPY', name: sh.name + ' · SPY', lat: sh.lat, lon: sh.lon, p, onShip: true });
  });
  if (on.pac3) L.pac3.forEach((b, i) => els.push({ ...b, id: 'PAC' + i, type: 'PAC3', p: llv(b.lat, b.lon) }));
  if (L.sbx && on.radars) els.push({ id: 'SBX', type: 'SBX', name: 'SBX (notional position)', lat: L.sbx[0], lon: L.sbx[1], p: llv(L.sbx[0], L.sbx[1]) });
  elCache = { key, els };
  return els;
}

/* ---------- per-threat flight samples (1 s) ---------- */
interface Pt { p: Vec3; alt: number; ph: string }
const PH_NAME: Record<Phase, string> = { boost: 'Boost', mid: 'Midcourse', reentry: 'Re-entry', glide: 'Glide', terminal: 'Terminal', watch: 'Boost' };
const flightCache = new WeakMap<Threat, Pt[]>();
function flight(th: Threat): Pt[] {
  let f = flightCache.get(th); if (f) return f;
  f = [];
  for (let t = 0; t <= Math.floor(th.TOF); t++) {
    const st = threatState(th, th.tL + Math.min(t, th.TOF - 0.01))!;
    const label = th.flight ? th.flight.samples[Math.min(t, th.flight.samples.length - 1)].label : PH_NAME[st.phase];
    f.push({ p: st.p, alt: st.h, ph: label === 'Cruise' ? 'Glide' : label });
  }
  flightCache.set(th, f); return f;
}
const kindOf = (th: Threat): 'bal' | 'hgv' => th.type === 'B' ? 'bal' : 'hgv';

/* ---------- plan ---------- */
export interface Shot { sh: El; j: number; tL: number; ti: number; p: Vec3; alt: number; ph: string; d: number; kill: boolean; wasted: boolean; n: number; eng: number; doc: string; type: string }
export interface ThreatPlan {
  j: number; tTrack: number | null; trackBy: string | null; tSpace: number | null; acq: Record<string, number>; tSol: number | null; solNote: string;
  shots: Shot[]; killed: boolean; tKill: number | null; held: boolean; why: string;
}
export const plan = { threats: [] as ThreatPlan[], shots: [] as Shot[], acq: {} as Record<string, number>, rounds: 0, used: [] as [string, number][], expLeak: 0, ran: false };

/** Absolute scenario time a threat was destroyed, or null. */
export const killedAt = (j: number): number | null => { if (!MDA.engage) return null; const p = plan.threats[j]; return p && p.killed ? p.tKill : null; };
export const isDestroyed = (j: number, t: number) => { const k = killedAt(j); return k !== null && t >= k; };

/** First time (absolute) the custody selection has held stereo on threat j for STEREO_HOLD_S. */
function spaceTrack(j: number): number | null {
  const rec = sim.thrRec[j], need = Math.ceil(STEREO_HOLD_S / DT);
  let run = 0;
  for (let k = 0; k < rec.length; k++) {
    const r = rec[k];
    run = r && r.status === 2 ? run + 1 : 0;
    if (run > need) return k * DT;
  }
  return null;
}

/** Recompute the engagement timeline for the current salvo and custody. Returns the defense events. */
export function planDefense(): SimEvent[] {
  plan.threats = []; plan.shots = []; plan.acq = {}; plan.rounds = 0; plan.used = []; plan.expLeak = 0; plan.ran = true;
  const els = activeElements(), radars = els.filter(e => TYPES[e.type].cls === 'radar'), shooters = els.filter(e => TYPES[e.type].cls === 'shooter');
  const ev: SimEvent[] = [], E = (t: number, j: number, kind: SimEvent['kind'], text: string) => ev.push({ t, j, kind, text });
  const name = (id: string) => (els.find(e => e.id === id) || { name: id }).name;

  // 1. sensing: radar acquisitions and the CS2C fire-control space track
  const tps: ThreatPlan[] = sim.threats.map((th, j) => {
    const f = flight(th), acq: Record<string, number> = {};
    radars.forEach(r => { for (let t = 0; t < f.length; t += 2) { const m = f[t]; if (m.alt < 5) continue; if (sees(r, m.p)) { acq[r.id] = th.tL + t; break; } } });
    const tSpace = spaceTrack(j);
    let tTrack: number | null = null, trackBy: string | null = null;
    Object.entries(acq).forEach(([id, t]) => { if (tTrack === null || t < tTrack) { tTrack = t; trackBy = name(id); } });
    if (tSpace !== null && (tTrack === null || tSpace <= tTrack)) { tTrack = tSpace; trackBy = 'CS2C stereo custody'; }
    Object.entries(acq).forEach(([id, t]) => { if (plan.acq[id] === undefined || t < plan.acq[id]) plan.acq[id] = t; });
    return { j, tTrack, trackBy, tSpace, acq, tSol: null, solNote: '', shots: [], killed: false, tKill: null, held: false, why: '' };
  });
  plan.threats = tps;
  tps.forEach(tp => {
    if (tp.tSpace !== null) E(tp.tSpace, tp.j, 'track', `Fire-control track from CS2C stereo custody (held ${STEREO_HOLD_S} s)`);
    Object.entries(tp.acq).sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([id, t]) => E(t, tp.j, 'track', `${name(id)} acquires track`));
    if (tp.tTrack === null) tp.why = `no fire-control track (no ${STEREO_HOLD_S} s stereo hold, no radar)`;
  });
  if (!MDA.engage) return [];

  // 2. C2BMC fire-control solutions: base time + correlation load + raid density + co-located launches + classification + serial queue
  let prev = -1e9;
  tps.filter(tp => tp.tTrack !== null).sort((a, b) => a.tTrack! - b.tTrack!).forEach(tp => {
    const th = sim.threats[tp.j], ft = tp.tTrack!;
    const act = sim.threats.filter((o, k) => k !== tp.j && o.tL <= ft && o.tEnd > ft).length;
    const dens = sim.threats.filter((o, k) => k !== tp.j && Math.abs(o.tL - th.tL) <= C2_DENSITY_S).length;
    const colo = sim.threats.filter((o, k) => k !== tp.j && o.site === th.site && Math.abs(o.tL - th.tL) <= 60).length;
    // a glide vehicle's booster looks ballistic until the path departs from a ballistic arc
    const pr = th.flight ? th.flight.profile : 'glide';
    const tClass = th.type !== 'H' ? 0 : pr === 'fobs' ? th.tL + th.tb + 60 : pr === 'glide' ? th.tL + (th.flight ? th.flight.tGlide : th.tb) + 5 : 0;
    const rawLoad = ft + C2_BASE + C2_PER_ACTIVE * act + C2_PER_LAUNCH * dens + C2_PER_COLOC * colo, rawCls = tClass ? tClass + CLASS_RESOLVE_S : 0;
    const raw = Math.max(rawLoad, rawCls), clsWait = Math.round(Math.max(0, rawCls - rawLoad)), sol = Math.max(raw, prev + C2_MIN_GAP); prev = sol;
    tp.tSol = sol;
    const parts = [`${C2_BASE} s base`];
    if (act) parts.push(`${C2_PER_ACTIVE * act} s correlating ${act} other track${act > 1 ? 's' : ''}`);
    if (dens) parts.push(`${C2_PER_LAUNCH * dens} s raid density`);
    if (colo) parts.push(`${C2_PER_COLOC * colo} s separating ${colo + 1} launches from one site`);
    if (clsWait) parts.push(`${clsWait} s classifying the glider`);
    if (sol > raw) parts.push(`${Math.round(sol - raw)} s in queue`);
    tp.solNote = parts.join(' + ');
    E(sol, tp.j, 'c2', `C2BMC fire-control solution · ${Math.round(sol - ft)} s after first track (${tp.solNote})`);
  });

  // 3. weapon-target assignment: most urgent impact first, shared magazines and launcher channels
  const prio = tps.filter(tp => tp.tSol !== null).sort((a, b) => sim.threats[a.j].tEnd - sim.threats[b.j].tEnd);
  const run = (mode: Outcome, rand: (() => number) | null, record: boolean) => {
    const fired = new Map<string, number>(), busy = new Map<string, number[]>(), emptied = new Set<string>(), out = new Map<ThreatPlan, ReturnType<typeof engage>>();
    function engage(tp: ThreatPlan) {
      const th = sim.threats[tp.j], f = flight(th), kind = kindOf(th), tgt = llv(...latLon(th.b)), shots: Shot[] = [], evs: SimEvent[] = [];
      const fl = th.flight, tMin = kind === 'hgv' ? (fl ? fl.tEngage : th.tb) : th.tb + 10, tCommit = kind === 'hgv' ? (fl ? fl.tCommit : th.tb + 20) : 0;
      let held = false;
      const free = (sh: El, tAbs: number) => !(busy.get(sh.id) || []).some(b => Math.abs(b - tAbs) < CHANNEL_S);
      const lowAt = (tAbs: number) => { const r = sim.thrRec[tp.j][Math.min(sim.nstep - 1, Math.round(tAbs / DT))]; return !!r && !!r.assess && r.assess.priority === 'Low'; };
      function earliest(sh: El, notBefore: number) {
        const P = TYPES[sh.type];
        if (P.defend && dist(sh.p, tgt) > P.defend) return null;
        if (P.only && !P.only.includes(kind)) return null;
        if ((fired.get(sh.id) || 0) >= invOf(sh)) return null;
        const ready = tp.tSol! - th.tL + P.delay!;
        for (let ti = Math.ceil(Math.max(tMin, ready + 20)); ti <= f.length - 3; ti++) {
          const m = f[ti];
          if (m.alt < P.alt![0] || m.alt > P.alt![1]) continue;
          if (P.phases && !P.phases.includes(m.ph)) continue;
          const d = dist(sh.p, m.p); if (d > P.maxR!) continue;
          const tL = ti - (d / P.v! + 10);
          if (tL < Math.max(ready, notBefore, tCommit)) continue;
          if (!free(sh, th.tL + tL)) continue;
          if (lowAt(th.tL + tL)) { held = true; return null; } // IPP clear of every defended area: hold fire
          return { sh, ti, tL, m, d };
        }
        return null;
      }
      let notBefore = 0, roundN = 0, engN = 0, killed = false, tKill: number | null = null;
      const per = new Map<string, number>();
      const roundKills = () => mode === 'kill1' ? true : mode === 'miss1' ? roundN >= 2 : mode === 'leak' ? false : rand!() < MDA.pk;
      while (!killed && engN < ENG_MAX) {
        const opts = shooters.filter(sh => (per.get(sh.id) || 0) < ROUNDS_MAX).map(sh => earliest(sh, notBefore)).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => x.ti - y.ti);
        if (!opts.length) break;
        const o = opts[0], doc = o.sh.type in DOC_TYPES ? MDA.doctrine[o.sh.type as DocType] : 'SLS', nm = roundName(o.sh.type); engN++;
        const fire = (r: typeof o) => { fired.set(o.sh.id, (fired.get(o.sh.id) || 0) + 1); per.set(o.sh.id, (per.get(o.sh.id) || 0) + 1); if (!busy.has(o.sh.id)) busy.set(o.sh.id, []); busy.get(o.sh.id)!.push(th.tL + r.tL); };
        const salvo = [o]; fire(o);
        if (doc === 'SSL') { const o2 = earliest(o.sh, o.tL + SALVO_GAP[o.sh.type as DocType]); if (o2 && o2.tL - o.tL <= 20) { salvo.push(o2); fire(o2); } }
        let killT: number | null = null;
        salvo.forEach((r, i) => {
          roundN++; const wasted = killT !== null, kill = !wasted && roundKills(), ph = r.m.ph.toLowerCase();
          shots.push({ sh: o.sh, j: tp.j, tL: th.tL + r.tL, ti: th.tL + r.ti, p: r.m.p, alt: r.m.alt, ph: r.m.ph, d: r.d, kill, wasted, n: roundN, eng: engN, doc, type: o.sh.type });
          evs.push({ t: th.tL + r.tL, j: tp.j, kind: 'shoot', text: i === 0 ? `${o.sh.name} · engagement ${engN} (${o.sh.type in DOC_TYPES ? DOC_NAME[doc as 'SLS'] : 'single round'}) · launches ${nm}, round ${roundN}` : `${o.sh.name} ripples a second ${nm} · round ${roundN}` });
          if (wasted) evs.push({ t: th.tL + r.ti, j: tp.j, kind: 'miss', text: `Round ${roundN} arrives after the kill · expended` });
          else evs.push({ t: th.tL + r.ti, j: tp.j, kind: kill ? 'kill' : 'miss', text: kill ? `Intercept · ${nm} round ${roundN} destroys it in ${ph} at ${Math.round(r.m.alt)} km` : `Round ${roundN} misses (${ph}, ${Math.round(r.m.alt)} km)` });
          if (kill) killT = th.tL + r.ti;
        });
        if (record && (fired.get(o.sh.id) || 0) >= invOf(o.sh) && !emptied.has(o.sh.id)) { emptied.add(o.sh.id); evs.push({ t: th.tL + salvo[salvo.length - 1].tL, j: tp.j, kind: 'c2', text: `${o.sh.name}: magazine empty (load ${invOf(o.sh)})` }); }
        const last = th.tL + salvo[salvo.length - 1].ti;
        if (killT !== null) { killed = true; tKill = killT; evs.push({ t: killT + LOOK_S, j: tp.j, kind: 'c2', text: `Kill assessment confirms destruction · ${roundN} round${roundN > 1 ? 's' : ''} · custody released` }); }
        else { evs.push({ t: last + LOOK_S, j: tp.j, kind: 'c2', text: `Kill assessment: survives · re-engage` }); notBefore = last + LOOK_S - th.tL; }
      }
      return { shots, evs, killed, tKill, rounds: roundN, held };
    }
    prio.forEach(tp => out.set(tp, engage(tp)));
    return { out, fired };
  };
  const main = run(MDA.outcome, mulberry(MDA.seed * 7919 + 17), true);
  prio.forEach(tp => {
    const r = main.out.get(tp)!; r.evs.forEach(e => ev.push(e));
    Object.assign(tp, { shots: r.shots, killed: r.killed, tKill: r.tKill, held: r.held && !r.shots.length });
  });
  tps.forEach(tp => {
    const th = sim.threats[tp.j];
    if (tp.killed) return;
    // a threat assessed as clear of every defended area by the end of flight is not engaged on purpose
    if (!tp.shots.length && !tp.held) { const last = sim.thrRec[tp.j].filter(r => r).pop(); if (last && last.assess && last.assess.priority === 'Low') tp.held = true; }
    if (tp.held) { tp.why = 'fire withheld: predicted impact clear of defended areas'; E(th.tEnd, tp.j, 'leak', 'Not engaged · predicted impact clear of every defended area'); return; }
    if (!tp.why) tp.why = tp.shots.length ? 'every round missed' : noWindowWhy(th, shooters);
    E(th.tEnd, tp.j, 'leak', tp.shots.length ? `Leaker · reaches ${th.errant ? th.impactName : th.target}` : `Not engaged · ${tp.why}`);
  });
  plan.shots = tps.flatMap(tp => tp.shots);
  plan.rounds = plan.shots.length;
  plan.used = [...main.fired.entries()];
  // expected leakers with independent per-round Pk, from the all-miss plan (every engagement the battlespace allows)
  { const full = run('leak', null, false), q = 1 - MDA.pk; let leak = 0;
    tps.forEach(tp => { const r = full.out.get(tp); leak += r ? Math.pow(q, r.rounds) : (tp.held ? 0 : 1); });
    plan.expLeak = leak; }
  return ev;
}
function latLon(b: Vec3): [number, number] { const q = toLL([b[0] * RE, b[1] * RE, b[2] * RE]); return [q[0], q[1]]; }
function noWindowWhy(th: Threat, shooters: El[]): string {
  const tgt = llv(...latLon(th.b));
  if (th.type === 'H') {
    const why: string[] = [];
    if (!shooters.some(e => e.type === 'GPI')) why.push('no GPI in play');
    if (!shooters.some(e => (e.type === 'SM6' || e.type === 'PAC3' || e.type === 'THAAD') && dist(e.p, tgt) <= TYPES[e.type].defend!)) why.push('no terminal defense near the target');
    return why.length ? why.join(', ') + ' (SM-3 and GBI cannot reach a vehicle flying inside the atmosphere)' : 'no engagement window before impact';
  }
  return 'no shooter in range at an altitude it can engage';
}

/** Merge defense events into the CS2C feed: drop custody events for a threat after it is destroyed. */
export function mergeDefense(events: SimEvent[]): SimEvent[] {
  const dev = planDefense();
  const kept = events.filter(e => { const k = killedAt(e.j); return k === null || e.t <= k || e.kind === 'launch'; });
  return [...kept, ...dev].sort((a, b) => a.t - b.t);
}

/* ---------- drawing ---------- */
type Label = (g: CanvasRenderingContext2D, txt: string, x: number, y: number, col: string, size: number, bold?: boolean) => void;
const P = pt(), Q = pt();
const col = (c: Col) => C[('mda-' + c) as 'mda-gbi'] || C.ink;
function strokePts(g: CanvasRenderingContext2D, pts: Vec3[]) {
  let pen = false; g.beginPath();
  for (const p of pts) { proj(p[0], p[1], p[2], P); if (!P[3]) { if (pen) g.lineTo(P[0], P[1]); else g.moveTo(P[0], P[1]); pen = true; } else pen = false; }
  g.stroke();
}
function glyph(g: CanvasRenderingContext2D, type: string, x: number, y: number, c: string, ship: boolean, hdg = 0) {
  g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 1.4; g.beginPath();
  if (ship) { g.save(); g.translate(x, y); g.rotate(hdg * Math.PI / 180); g.moveTo(0, -7); g.lineTo(3.5, 4); g.lineTo(0, 2.5); g.lineTo(-3.5, 4); g.closePath(); g.fill(); g.restore(); return; }
  if (type === 'GBI') { g.moveTo(x, y - 6); g.lineTo(x + 5, y + 4); g.lineTo(x - 5, y + 4); g.closePath(); g.fill(); }
  else if (type === 'SM3') { g.rect(x - 4.5, y - 4.5, 9, 9); g.fill(); }
  else if (type === 'THAAD' || type === 'PAC3') { g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); }
  else if (TYPES[type].cls === 'radar') { g.arc(x, y + 2, 6, Math.PI, 0); g.closePath(); g.stroke(); g.beginPath(); g.arc(x, y + 2, 1.6, 0, Math.PI * 2); g.fill(); }
  else if (type === 'C2') { for (let i = 0; i < 10; i++) { const r = i % 2 ? 2.4 : 6, a = i * Math.PI / 5 - Math.PI / 2; if (i) g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); else g.moveTo(x + r * Math.cos(a), y + r * Math.sin(a)); } g.closePath(); g.fill(); }
}
function interceptorPos(sh: Shot, t: number): { p: Vec3; s: number } | null {
  const s = (t - sh.tL) / (sh.ti - sh.tL); if (s < 0) return null;
  const u = Math.min(1.25, s), e = u < 1 ? 1 - Math.pow(1 - u, 1.6) : u;
  const sp = sh.sh.p, tp = sh.p, loft = Math.min(800, 0.12 * sh.d);
  const mid: Vec3 = [sp[0] + (tp[0] - sp[0]) * e, sp[1] + (tp[1] - sp[1]) * e, sp[2] + (tp[2] - sp[2]) * e];
  const up = unit(mid), k = loft * Math.sin(Math.PI * Math.min(1, e)) * (1 - Math.min(1, e) * 0.6);
  return { p: [mid[0] + up[0] * k, mid[1] + up[1] * k, mid[2] + up[2] * k], s };
}
/** Clickable/hoverable defense objects drawn last frame, for the tooltip. */
let tipHits: { x: number; y: number; tip: () => string }[] = [];

/** Radar fans, coverage rings, homeports and elements: drawn under the threats. */
export function drawDefenseUnder(g: CanvasRenderingContext2D, t: number, label: Label): void {
  tipHits = [];
  const els = activeElements();
  if (MDA.on.ports && MDA.on.ships) HOMEPORTS.forEach(h => {
    const p = llv(h.lat, h.lon); proj(p[0], p[1], p[2], P); if (P[3]) return;
    g.strokeStyle = col('sm3'); g.globalAlpha = 0.55; g.lineWidth = 1; g.beginPath(); g.arc(P[0], P[1], 5, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
    tipHits.push({ x: P[0], y: P[1], tip: () => `<b>${esc(h.name)}</b><br>Aegis BMD homeport` });
  });
  if (MDA.on.rings) els.forEach(e => {
    const T = TYPES[e.type], R = T.range || T.maxR; if (!R || e.onShip && T.cls !== 'radar') return;
    g.strokeStyle = col(T.col); g.globalAlpha = 0.25; g.lineWidth = 1; g.setLineDash([3, 4]); strokePts(g, ring(e.lat, e.lon, R / RE * R2D)); g.setLineDash([]); g.globalAlpha = 1;
  });
  // radar fans: surveillance sheet at low elevation out to max range, bounded by the face sector
  const fj = S.focus && S.focus.kind === 'threat' ? S.focus.i : -1, ftp = fj >= 0 ? plan.threats[fj] : null;
  const showFan = (r: El) => MDA.fans === 'all' || (MDA.fans === 'tracking' && plan.acq[r.id] !== undefined) || (MDA.fans === 'focus' && !!ftp && ftp.acq[r.id] !== undefined);
  els.filter(e => TYPES[e.type].cls === 'radar' && showFan(e)).forEach(r => {
    const T = TYPES[r.type], sc = sector(r), R = T.range!, n = Math.max(12, Math.round(sc.w / 6)), c = col(T.col);
    const live = plan.acq[r.id] !== undefined && t >= plan.acq[r.id];
    const a0 = sc.az - sc.w / 2, arc: Vec3[] = [], gnd: Vec3[] = [];
    for (let i = 0; i <= n; i++) { const q = fanPoint(r, a0 + sc.w * i / n, MDA.fanEl, R); arc.push(q); const ll = toLL(q); gnd.push(llv(ll[0], ll[1])); }
    proj(r.p[0], r.p[1], r.p[2], P); const rp = P[3] ? null : [P[0], P[1]];
    g.fillStyle = c; g.globalAlpha = live ? 0.07 : 0.035; g.beginPath(); let any = false;
    for (let i = 0; i < n; i++) {
      proj(arc[i][0], arc[i][1], arc[i][2], P); proj(arc[i + 1][0], arc[i + 1][1], arc[i + 1][2], Q);
      if (!rp || P[3] || Q[3]) continue; g.moveTo(rp[0], rp[1]); g.lineTo(P[0], P[1]); g.lineTo(Q[0], Q[1]); g.closePath(); any = true;
    }
    if (any) g.fill();
    g.strokeStyle = c; g.lineWidth = 1; g.globalAlpha = live ? 0.55 : 0.3; strokePts(g, arc);
    if (sc.w < 360) { strokePts(g, [r.p, arc[0]]); strokePts(g, [r.p, arc[n]]); }
    g.globalAlpha = 0.3; g.setLineDash([2, 4]); strokePts(g, gnd); g.setLineDash([]); g.globalAlpha = 1;
  });
  // elements
  els.forEach(e => {
    if (e.onShip) return;
    proj(e.p[0], e.p[1], e.p[2], P); if (P[3]) return;
    const T = TYPES[e.type], engaged = MDA.engage && plan.shots.some(s => (s.sh.id === e.id || s.sh.id.startsWith(e.id + '-')) && t >= s.tL && t <= s.ti);
    glyph(g, e.type, P[0], P[1], col(T.col), !!e.ship, e.hdg);
    if (engaged) { g.strokeStyle = C.ink; g.lineWidth = 1.2; g.beginPath(); g.arc(P[0], P[1], 10 + 2 * Math.sin(performance.now() / 120), 0, Math.PI * 2); g.stroke(); }
    if (view.RPX > 400 && (e.ship || e.ashore || e.type === 'GBI' || e.type === 'SBX' || e.type === 'THAAD' || e.type === 'PAC3')) label(g, e.name.replace(/ \(.*\)/, '').replace('DDG (BMD) · ', 'DDG · '), P[0] + 8, P[1] + 4, C.muted, 9);
    tipHits.push({ x: P[0], y: P[1], tip: () => elTip(e, t) });
  });
}

/** Sensor lines, interceptor flyouts and intercepts: drawn over the threats. */
export function drawDefenseOver(g: CanvasRenderingContext2D, t: number, label: Label): void {
  const els = activeElements();
  // radar track lines to threats in view
  sim.threats.forEach((th, j) => {
    const st = threatState(th, t); if (!st || isDestroyed(j, t)) return;
    const tp = plan.threats[j]; if (!tp) return;
    proj(st.p[0], st.p[1], st.p[2], Q); if (Q[3]) return;
    els.forEach(r => {
      if (tp.acq[r.id] === undefined || t < tp.acq[r.id] || !sees(r, st.p)) return;
      proj(r.p[0], r.p[1], r.p[2], P); if (P[3]) return;
      g.strokeStyle = col(TYPES[r.type].col); g.globalAlpha = 0.55; g.lineWidth = 1; g.setLineDash([2, 3]);
      g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(Q[0], Q[1]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    });
  });
  if (!MDA.engage) return;
  plan.threats.forEach(tp => {
    const tKill = tp.tKill;
    tp.shots.forEach(sh => {
      if (t < sh.tL) return; if (sh.wasted && tKill !== null && t > tKill + 1) return;
      const ip = interceptorPos(sh, t); if (!ip) return;
      const c = col(TYPES[sh.type].col), trail: Vec3[] = [];
      for (let k = 0; k <= 24; k++) { const q = interceptorPos(sh, sh.tL + (Math.min(t, sh.kill ? sh.ti : sh.ti + 0.25 * (sh.ti - sh.tL)) - sh.tL) * k / 24); if (q) trail.push(q.p); }
      g.strokeStyle = c; g.lineWidth = 1.6; g.globalAlpha = sh.kill || ip.s < 1 ? 0.9 : Math.max(0, 1 - (ip.s - 1) * 4); strokePts(g, trail);
      if (ip.s < 1) {
        proj(ip.p[0], ip.p[1], ip.p[2], P);
        if (!P[3]) {
          g.fillStyle = C.ink; g.beginPath(); g.arc(P[0], P[1], 2.6, 0, Math.PI * 2); g.fill();
          tipHits.push({ x: P[0], y: P[1], tip: () => `<b>${roundName(sh.type)} · round ${sh.n}</b><br>${esc(sim.threats[sh.j].id)} · engagement ${sh.eng} · ${sh.type in DOC_TYPES ? DOC_NAME[sh.doc as 'SLS'] : 'single round'}<br>${esc(sh.sh.name)}<br>${Math.round(Math.max(0, sh.ti - S.t))} s to intercept at ${Math.round(sh.alt)} km` });
        }
      }
      g.globalAlpha = 1;
      const dt = t - sh.ti;
      if (dt >= 0 && dt < 25) {
        proj(sh.p[0], sh.p[1], sh.p[2], P); if (P[3]) return;
        if (sh.kill) {
          g.strokeStyle = C.gold; g.globalAlpha = Math.max(0, 1 - dt / 25); g.lineWidth = 2; g.beginPath(); g.arc(P[0], P[1], 6 + dt * 2.2, 0, Math.PI * 2); g.stroke();
          g.fillStyle = C.gold; g.beginPath(); g.arc(P[0], P[1], Math.max(0, 7 - dt * 0.4), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
          if (dt < 12) label(g, `${sim.threats[sh.j].id} INTERCEPT`, P[0] + 10, P[1] + 14, C['gold-ink'], 11, true);
        } else if (dt < 10 && !sh.wasted) label(g, `ROUND ${sh.n} MISS`, P[0] + 10, P[1] + 14, C.muted, 10, true);
      }
    });
  });
}

function elTip(e: El, t: number): string {
  const T = TYPES[e.type]; let h = `<b>${esc(e.name)}</b><br>${esc(T.name)}${e.ship ? ' + SM-6' + (MDA.on.gpi ? ' + GPI (future)' : '') : ''}`;
  if (e.note) h += `<br><span class="mut">${esc(e.note)}</span>`;
  if (T.cls === 'shooter') {
    h += `<br>Envelope (notional): ${fmtN(T.maxR!)} km reach, ${T.alt![0]}–${T.alt![1]} km altitude`;
    if (T.defend) h += `<br>Defends targets within ~${T.defend} km`;
    if (e.ship) h += '<br><span class="warn">Position notional</span>';
    const sh = plan.shots.filter(x => x.sh.id === e.id || x.sh.id.startsWith(e.id + '-'));
    if (MDA.engage && sh.length) h += '<br>' + sh.map(x => `${esc(sim.threats[x.j].id)} · ${roundName(x.type)} round ${x.n}: launch T+${fmtT(x.tL)}, intercept T+${fmtT(x.ti)}${x.wasted ? ' (expended)' : x.kill ? ' · kill' : ' · miss'}`).join('<br>');
    const used = plan.used.filter(([id]) => id === e.id || id.startsWith(e.id + '-')).reduce((n, [, c]) => n + c, 0);
    if (used) h += `<br>${used} round${used > 1 ? 's' : ''} expended`;
  }
  if (T.cls === 'radar') {
    const sc = sector(e); h += `<br>Range ~${fmtN(T.range!)} km (notional) · ${sc.w >= 360 ? '360°' : `${sc.w}° face centered on ${sc.az}° az`}`;
    if (plan.acq[e.id] !== undefined) h += `<br>${t >= plan.acq[e.id] ? 'Tracking' : 'Acquires'} at T+${fmtT(plan.acq[e.id])}`;
  }
  return h;
}

/* ---------- panels ---------- */
/** Defense lines for the focus card of threat j. */
export function defenseHtml(j: number): string {
  const tp = plan.threats[j]; if (!tp) return '';
  const t = S.t, th = sim.threats[j];
  const trk = tp.tTrack === null ? '<span class="warn">none</span>' : t < tp.tTrack ? `T+${fmtT(tp.tTrack)} · ${esc(tp.trackBy!)}` : `${esc(tp.trackBy!)} <span class="src-tag">T+${fmtT(tp.tTrack)}</span>`;
  let res = '';
  if (!MDA.engage) res = '<span class="src-tag">engagements off</span>';
  else if (tp.killed) res = t >= tp.tKill! ? `<b class="ok">Destroyed</b> <span class="src-tag">T+${fmtT(tp.tKill!)}</span>` : `intercept planned T+${fmtT(tp.tKill!)}`;
  else res = t >= th.tEnd ? `<span class="warn">${tp.shots.length ? 'Leaker' : 'Not engaged'}</span>` : `<span class="warn">${tp.shots.length ? 'all rounds miss' : 'no engagement'}</span>`;
  const rounds = tp.shots.length ? [...new Set(tp.shots.map(s => roundName(s.type)))].join(', ') + ` × ${tp.shots.length}` : '—';
  return `<div class="why def"><div class="why-h">Missile defense <span class="src-tag">notional</span></div>
    <dl class="kv"><dt>Fire-control track</dt><dd>${trk}</dd>
    <dt>C2 solution</dt><dd>${tp.tSol !== null ? 'T+' + fmtT(tp.tSol) : '—'}</dd>
    <dt>Rounds</dt><dd>${rounds}</dd><dt>Result</dt><dd>${res}</dd></dl>
    ${!tp.killed && tp.why ? `<p class="why-alt">${esc(tp.why)}</p>` : ''}</div>`;
}

/** Summary line and per-threat table in the left panel. */
export function refreshDefensePanel(): void {
  const tps = plan.threats, n = tps.length;
  const killed = tps.filter(tp => tp.killed).length, bySpace = tps.filter(tp => tp.trackBy === 'CS2C stereo custody').length, byRadar = tps.filter(tp => tp.tTrack !== null && tp.trackBy !== 'CS2C stereo custody').length;
  const none = n - bySpace - byRadar;
  $('#mdaSum').innerHTML = !MDA.engage ? `Engagements off. First fire-control track: <b>CS2C stereo</b> on ${bySpace} of ${n} threats, radar on ${byRadar}${none ? `, none on ${none}` : ''}.`
    : `<b>${killed} of ${n}</b> threats destroyed · ${plan.rounds} round${plan.rounds === 1 ? '' : 's'}${MDA.outcome === 'pk' ? ` · expected leakers at Pk ${MDA.pk}: ${plan.expLeak.toFixed(1)}` : ''}<br>First fire-control track: <b>CS2C stereo</b> on ${bySpace}, radar on ${byRadar}${none ? `, <span class="warn">none on ${none}</span>` : ''}.`;
  $('#mdaTable').innerHTML = `<tr><th></th><th>1st track</th><th>C2 sol.</th><th>Rds</th><th>Result</th></tr>` + tps.map(tp => {
    const th = sim.threats[tp.j];
    const res = !MDA.engage ? '—' : tp.killed ? `<span class="ok">Kill ${fmtT(tp.tKill!)}</span>` : tp.held ? '<span class="mut" title="Predicted impact clear of every defended area">Held</span>' : `<span class="warn" title="${esc(tp.why)}">${tp.shots.length ? 'Leak' : 'No shot'}</span>`;
    return `<tr data-j="${tp.j}"><td><span class="chip ${th.type}">${th.id}</span></td><td title="${esc(tp.trackBy || 'no track')}">${tp.tTrack === null ? '—' : (tp.trackBy === 'CS2C stereo custody' ? 'CS2C ' : 'Radar ') + fmtT(tp.tTrack)}</td><td>${tp.tSol === null ? '—' : fmtT(tp.tSol)}</td><td>${tp.shots.length || '—'}</td><td>${res}</td></tr>`;
  }).join('');
  $('#mdaShips').innerHTML = MDA.userShips.length ? MDA.userShips.map((s, i) => `<li>${esc(s.name)} <button class="linkbtn" data-rm="${i}">remove</button></li>`).join('') : '';
}

/* ---------- tooltip and ship placement ---------- */
export function initDefenseInput(cv: HTMLCanvasElement, onChange: () => void): void {
  const tip = document.createElement('div'); tip.className = 'mtip'; tip.hidden = true; document.body.appendChild(tip);
  cv.addEventListener('pointermove', e => {
    if (e.buttons) { tip.hidden = true; return; }
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best: typeof tipHits[number] | null = null, bd = 12;
    tipHits.forEach(h => { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } });
    if (!best || MDA.placing) { tip.hidden = true; return; }
    tip.innerHTML = (best as typeof tipHits[number]).tip(); tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + 'px'; tip.style.top = Math.min(window.innerHeight - h - 8, e.clientY + 14) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  $('#mdaShips').addEventListener('click', e => { const b = (e.target as Element).closest<HTMLElement>('[data-rm]'); if (b) { MDA.userShips.splice(+b.dataset.rm!, 1); onChange(); } });
}
/** Ship placement: called with the clicked surface point; returns true if it consumed the click. */
export function placeAt(p: Vec3 | null): boolean {
  if (!MDA.placing) return false;
  MDA.placing = false; document.body.classList.remove('placing'); $('#mdaPlace').setAttribute('aria-pressed', 'false');
  if (!p || norm(p) < 1) return true;
  const [lat, lon] = toLL(p);
  MDA.userShips.push({ name: `DDG (BMD) · ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`, lat, lon, hdg: 0 });
  return true;
}
