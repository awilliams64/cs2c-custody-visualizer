// Real sensor satellites on orbit today (public element sets), for the "Today" architecture.
// SDA Tracking Layer Tranche 0: 4 SpaceX and 4 L3Harris wide-field-of-view tracking satellites (TLEs of 2026-11-13).
// SBIRS GEO: 6 missile-warning satellites (elements of 19 Oct and 23 Nov 2026). SBIRS HEO payloads ride classified hosts with
// no public elements, so two representative Molniya-type orbits stand in. The rest of the SDA catalog is the Transport layer
// (communications, no IR sensors) and is not shown. Elements refresh from CelesTrak when it is reachable.
// pure-JS SGP4 modules only (the package root also pulls a WebAssembly build the single-file page can't bundle)
import { json2satrec, twoline2satrec } from '../node_modules/satellite.js/dist/io.js';
import { gstime, propagate } from '../node_modules/satellite.js/dist/propagation.js';
import { eciToEcf } from '../node_modules/satellite.js/dist/transforms.js';
import type { SatRec } from '../node_modules/satellite.js/dist/propagation/SatRec.js';
import type { Group, Layer } from './types';

export interface RealDef { id: string; name: string; group: Group; layer: Layer; rec: SatRec; epoch: number; norad: string; notional: boolean; note: string }

const T0 = [
  { id: 'T0-BB1', name: 'BB 1', maker: 'SpaceX', l1: '1 56171U 23050K   26315.44690441  .00002433  00000-0  48432-3 0  9995', l2: '2 56171  81.0013 290.4637 0014587 241.2225 118.7509 14.61772039182461' },
  { id: 'T0-BB2', name: 'BB 2', maker: 'SpaceX', l1: '1 56170U 23050J   26315.70402820  .00000885  00000-0  14862-3 0  9994', l2: '2 56170  81.0005 283.1957 0007859 208.6887 151.3884 14.68912691182927' },
  { id: 'T0-BB3', name: 'BB3', maker: 'SpaceX', l1: '1 57760U 23133D   26317.73029082  .00002363  00000-0  25899-3 0  9997', l2: '2 57760  80.9969 182.2692 0005251 185.6561 174.4593 14.87468897164199' },
  { id: 'T0-BB4', name: 'BB4', maker: 'SpaceX', l1: '1 57757U 23133B   26317.73419302  .00002746  00000-0  30115-3 0  9993', l2: '2 57757  81.0005 194.3203 0007736 227.8155 132.2402 14.87477486163484' },
  { id: 'T0-RAP1', name: 'RAPTOR1', maker: 'L3Harris', l1: '1 58957U 24028C   26317.72307911 -.00000055  00000-0  25032-4 0  9996', l2: '2 58957  39.9902  73.0964 0010714  36.6163 323.5315 13.74252108137629' },
  { id: 'T0-RAP2', name: 'RAPTOR2', maker: 'L3Harris', l1: '1 58959U 24028E   26317.75593014 -.00000060  00000-0  19841-4 0  9999', l2: '2 58959  39.9903  75.6711 0010309  37.5566 322.5899 13.70563704137592' },
  { id: 'T0-RAP3', name: 'RAPTOR3', maker: 'L3Harris', l1: '1 58958U 24028D   26317.72763611 -.00000057  00000-0  23368-4 0  9992', l2: '2 58958  39.9907  76.3008 0010130  34.3560 325.7840 13.70491773137589' },
  { id: 'T0-RAP4', name: 'RAPTOR4', maker: 'L3Harris', l1: '1 58956U 24028B   26315.66797285 -.00000082  00000-0 -31696-5 0  9998', l2: '2 58956  39.9899  83.1846 0014044  13.1615 346.9498 13.77371252137330' }
];
// catalog names, which swap GEO 3/4 relative to launch order
const OPIR_SNAP = [
  { n: 'SBIRS GEO 1 (USA 230)', cat: 37481, id: '2011-019A', ep: '26327.93241942', i: 4.8888, raan: 52.8770, e: 0.0001804, w: 196.0223, M: 201.4916, mm: 1.00271904, nd: 0.00000118 },
  { n: 'SBIRS GEO 2 (USA 241)', cat: 39120, id: '2013-011A', ep: '26327.49826450', i: 4.8361, raan: 52.3783, e: 0.0002469, w: 187.9957, M: 264.6898, mm: 1.00271436, nd: -0.00000125 },
  { n: 'SBIRS GEO 4 (USA 273)', cat: 41937, id: '2017-004A', ep: '26327.91794600', i: 2.5605, raan: 46.7240, e: 0.0002142, w: 198.8752, M: 126.5759, mm: 1.00270848, nd: -0.00000146 },
  { n: 'SBIRS GEO 3 (USA 282)', cat: 43162, id: '2018-009A', ep: '26327.86098086', i: 2.3287, raan: 19.0421, e: 0.0002316, w: 224.8391, M: 329.5325, mm: 1.00271660, nd: 0.00000148 },
  { n: 'SBIRS GEO 5 (USA 315)', cat: 48618, id: '2021-042A', ep: '26327.96356932', i: 4.9173, raan: 330.4815, e: 0.0002358, w: 270.5277, M: 262.6394, mm: 1.00271348, nd: -0.00000252 },
  { n: 'SBIRS GEO 6 (USA 336)', cat: 53355, id: '2022-092A', ep: '26292.57181428', i: 3.0633, raan: 319.7937, e: 0.0001902, w: 241.1166, M: 172.0195, mm: 1.00272128, nd: -0.00000292 }
];
const OPIR_NOTES: Record<number, string> = { 39120: 'Relocated to ~96.8°W in Sep 2026 (public tracking notice)', 41937: 'Relocated from ~22°E to ~21°W in Aug–Sep 2026 (public tracking notice)' };
const epIso = (ep: string) => { const yy = +ep.slice(0, 2), doy = +ep.slice(2); return new Date(Date.UTC(2000 + yy, 0, 1) + (doy - 1) * 864e5).toISOString().replace('Z', ''); };
type Omm = Parameters<typeof json2satrec>[0];
const snapOmm = (): Omm[] => OPIR_SNAP.map(x => ({ OBJECT_NAME: x.n, NORAD_CAT_ID: x.cat, OBJECT_ID: x.id, EPOCH: epIso(x.ep), MEAN_MOTION: x.mm, ECCENTRICITY: x.e, INCLINATION: x.i,
  RA_OF_ASC_NODE: x.raan, ARG_OF_PERICENTER: x.w, MEAN_ANOMALY: x.M, BSTAR: 0, MEAN_MOTION_DOT: x.nd, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999 }));
const recEpoch = (r: SatRec) => { const y = r.epochyr < 57 ? 2000 + r.epochyr : 1900 + r.epochyr; return Date.UTC(y, 0, 1) + (r.epochdays - 1) * 864e5; };

/** Live elements fetched from CelesTrak, by NORAD number. */
const live = new Map<string, Omm>();
export const catalogSrc = { text: 'Built-in snapshot · elements of 13–23 Nov 2026', live: 0 };

export function realSats(): RealDef[] {
  const out: RealDef[] = [];
  T0.forEach(s => {
    const norad = s.l1.slice(2, 7).trim(), o = live.get(norad);
    const rec = o ? json2satrec(o) : twoline2satrec(s.l1, s.l2);
    out.push({ id: s.id, name: `${s.name} · SDA Tracking T0 (${s.maker})`, group: 'LEO', layer: 'LEO', rec, epoch: recEpoch(rec), norad, notional: false, note: '' });
  });
  snapOmm().forEach((x, i) => {
    const norad = String(x.NORAD_CAT_ID), o = live.get(norad), rec = json2satrec(o || x);
    out.push({ id: `SBIRS-G${i + 1}`, name: String(x.OBJECT_NAME), group: 'GEO', layer: 'GEO', rec, epoch: recEpoch(rec), norad, notional: false, note: OPIR_NOTES[+norad] || '' });
  });
  const now = new Date().toISOString().replace('Z', '');
  [0, 180].forEach((raan, k) => {
    const o: Omm = { OBJECT_NAME: `SBIRS HEO host ${k + 1} (notional)`, OBJECT_ID: '—', NORAD_CAT_ID: 0, EPOCH: now, MEAN_MOTION: 2.00614, ECCENTRICITY: 0.72, INCLINATION: 63.4,
      RA_OF_ASC_NODE: raan + 40, ARG_OF_PERICENTER: 270, MEAN_ANOMALY: k ? 0 : 180, BSTAR: 0, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0, ELEMENT_SET_NO: 999 };
    const rec = json2satrec(o);
    out.push({ id: `SBIRS-H${k + 1}`, name: String(o.OBJECT_NAME), group: 'HEO', layer: 'HEO', rec, epoch: recEpoch(rec), norad: '—', notional: true, note: 'SBIRS HEO sensors ride classified hosts with no public elements; representative Molniya-type orbit' });
  });
  return out;
}

/** Earth-fixed position (km) at epoch ms, written into out[o..o+2]. Returns false if SGP4 fails. */
export function realPos(rec: SatRec, ms: number, out: Float64Array | number[], o: number): boolean {
  const d = new Date(ms), pv = propagate(rec, d);
  if (!pv || !pv.position || typeof pv.position === 'boolean') { out[o] = out[o + 1] = out[o + 2] = 0; return false; }
  const e = eciToEcf(pv.position, gstime(d));
  out[o] = e.x; out[o + 1] = e.y; out[o + 2] = e.z; return true;
}

const CACHE = 'cs2c-real-elements-v1', MIN_AGE = 2 * 3600e3; // CelesTrak updates every 2 h and blocks repeat pulls
/** Refresh elements from CelesTrak (cached for 2 h). Resolves true if anything new was loaded. */
export async function refreshElements(force = false): Promise<boolean> {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (c && Array.isArray(c.data) && (!force || Date.now() - c.t < MIN_AGE)) {
      c.data.forEach((o: Omm) => live.set(String(o.NORAD_CAT_ID), o));
      catalogSrc.text = `CelesTrak · fetched ${new Date(c.t).toISOString().slice(0, 16).replace('T', ' ')} UTC`; catalogSrc.live = c.data.length;
      if (Date.now() - c.t < MIN_AGE) return true;
    }
  } catch { /* storage unavailable */ }
  if (!force) return live.size > 0;
  const ids = [...T0.map(s => s.l1.slice(2, 7).trim()), ...OPIR_SNAP.map(x => String(x.cat))], got: Omm[] = [];
  for (const id of ids) {
    try {
      const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=JSON`, { cache: 'no-store' }), t = await r.text();
      if (r.ok && t.trim().startsWith('[')) { const j = JSON.parse(t); if (j[0]) got.push(j[0]); }
    } catch { /* unreachable: keep the snapshot */ }
  }
  if (!got.length) { catalogSrc.text = 'Built-in snapshot · elements of 13–23 Nov 2026 (CelesTrak unreachable)'; return false; }
  got.forEach(o => live.set(String(o.NORAD_CAT_ID), o));
  catalogSrc.text = `CelesTrak · ${got.length} of ${ids.length} element sets fetched ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`; catalogSrc.live = got.length;
  try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), data: got })); } catch { /* ignore */ }
  return true;
}
