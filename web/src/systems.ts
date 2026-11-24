// Named threat systems (HGVs, air-launched, scramjet cruise, FOBS) with a notional flight model and scripted maneuvers.
// Descriptive fields follow the HGV Data Comp (17 Jul 2025); the `m` parameters are notional and derived from them.
// km/s ≈ Mach × 0.3 at these altitudes.
import type { Place } from './config';
import { D2R, R2D, RE } from './constants';
import type { Phase, Vec3 } from './types';
import { dot, llv, toLL, unit } from './vec';

export type Profile = 'glide' | 'mid' | 'air' | 'cruise' | 'fobs';
export type Maneuver = 'straight' | 'dogleg' | 'weave' | 'jink' | 'sharp' | 'terminal' | 'porpoise';
interface Model {
  profile: Profile; Tb: number; h0?: number; hB: number; hG?: number; hE?: number; apo?: number; orbit?: number;
  vG?: number; vMid?: number; vEnd: number; vTerm?: number; glideKm?: number; sT?: number; man: Maneuver; cross: number; label?: string; launchTxt: string;
}
export interface ThreatSystem {
  name: string; desig: string; country: string; ready: string; platform: string; alt: string; speed: string; range: string;
  glide: string; tested: string; maneuver: string; src: string; maxKm: number | null; m: Model;
}

export const MANEUVERS: Record<Maneuver, string> = {
  straight: 'Straight (no maneuver)', dogleg: 'Dogleg (one cross-range turn)', weave: 'Weave (S-turns)',
  jink: 'Course and altitude jinks', sharp: 'Sharp turns, varying altitude and heading', terminal: 'Terminal-phase maneuver only', porpoise: 'Terminal porpoising (vertical)',
};

export const SYS: Record<string, ThreatSystem> = {
  AVANGARD: { name: 'Avangard', desig: 'Project 4202', country: 'Russia', ready: 'Operational (2019)', platform: 'RS-28 Sarmat ICBM / SS-19 (silo-based)',
    alt: 'Boost to 100 km; glide 40–100 km', speed: 'Up to Mach 27', range: '6,000 km+ (intercontinental)', glide: '~7 min during reentry (uncertain)',
    tested: '2018 · Orenburg Oblast to Kamchatka', maneuver: 'High: unpredictable high-G maneuvers in altitude and azimuth; course and altitude jinks',
    src: 'https://missilethreat.csis.org/missile/avangard/', maxKm: null,
    m: { profile: 'glide', Tb: 180, h0: 0, hB: 100, hG: 95, hE: 42, vG: 7.9, vEnd: 2.4, man: 'jink', cross: 700, launchTxt: 'SS-19 ICBM launch carrying Avangard glide vehicle' } },
  KINZHAL: { name: 'Kinzhal', desig: 'Kh-47M2', country: 'Russia', ready: 'Operational (2018)', platform: 'Air launch (MiG-31K)',
    alt: 'Released at ~18 km; minimal glide, rapid descent', speed: 'Mach 10', range: '2,000 km', glide: 'Short (air launch)', tested: '—',
    maneuver: 'Some: can change trajectory in terminal guidance; generally quasi-ballistic',
    src: 'https://www.armyupress.army.mil/Journals/Military-Review/English-Edition-Archives/March-2024/Hypersonic-Capabilities/', maxKm: 2000,
    m: { profile: 'air', Tb: 25, h0: 18, hB: 30, apo: 50, vMid: 3.0, vEnd: 2.2, glideKm: 0, sT: 120, man: 'terminal', cross: 40, label: 'Quasi-ballistic', launchTxt: 'MiG-31K releases Kinzhal at ~18 km altitude' } },
  ZIRCON: { name: 'Zircon', desig: '3M22 · Tsirkon · SS-N-33', country: 'Russia', ready: 'Operational (2025)', platform: 'Ship launch (scramjet cruise missile)',
    alt: 'Cruise ~20 km (scramjet needs air); descent in terminal phase', speed: 'Mach 9', range: '1,000 km', glide: 'Powered cruise, not a glide',
    tested: 'Mar 2022, Mar 2023, May 2023, Feb 2024', maneuver: 'Moderate–high: powered maneuver in cruise; terminal porpoising', src: '', maxKm: 1000,
    m: { profile: 'cruise', Tb: 25, h0: 0, hB: 28, hG: 24, hE: 20, vG: 2.6, vEnd: 2.7, vTerm: 3.0, sT: 60, man: 'porpoise', cross: 30, launchTxt: 'Surface combatant launches Zircon' } },
  DFZF: { name: 'DF-ZF', desig: 'WU-14', country: 'China', ready: 'Operational (2019)', platform: 'DF-17 MRBM',
    alt: 'Mach 5–10 at 100 km; glide 40–100 km', speed: 'Up to Mach 10', range: '2,000 km', glide: 'Several minutes (1,800–2,500 km)', tested: 'Since 2014',
    maneuver: 'High: sharp turns and unpredictable paths; varies altitude and heading in final phase',
    src: 'https://missiledefenseadvocacy.org/missile-threat-and-proliferation/todays-missile-threat/china/', maxKm: 2000,
    m: { profile: 'glide', Tb: 70, h0: 0, hB: 100, hG: 70, hE: 40, vG: 3.0, vEnd: 1.6, man: 'sharp', cross: 150, launchTxt: 'DF-17 MRBM launch carrying DF-ZF glide vehicle' } },
  DF27: { name: 'DF-27', desig: '"Carrier killer" · CSS-X-24', country: 'China', ready: 'Developmental', platform: 'DF-27 ballistic missile',
    alt: 'Glide 30–80 km', speed: '>Mach 8.6', range: 'Vehicle 5,000–8,000 km; HGV ~2,100 km in ~12 min', glide: 'Extended (several minutes)', tested: 'Vehicle 28 Feb 2023',
    maneuver: 'Aerodynamic lift and control surfaces', src: 'https://missiledefenseadvocacy.org/missile-threat-and-proliferation/todays-missile-threat/china/df-27/', maxKm: 2100,
    m: { profile: 'glide', Tb: 110, h0: 0, hB: 95, hG: 80, hE: 30, vG: 3.3, vEnd: 2.4, man: 'dogleg', cross: 250, launchTxt: 'DF-27 launch carrying glide vehicle' } },
  FOBS: { name: 'FOBS', desig: 'Fractional orbital bombardment with glide vehicle', country: 'China', ready: 'Experimental', platform: 'DF-41 ICBM',
    alt: '160–2,000 km (orbital)', speed: '~Mach 23 in fractional orbit', range: '40,000 km (~100 min)', glide: '—', tested: '—', maneuver: '—', src: '', maxKm: null,
    m: { profile: 'fobs', Tb: 330, h0: 0, hB: 180, orbit: 180, vMid: 7.6, glideKm: 2200, hG: 60, hE: 35, vG: 6.6, vEnd: 2.4, man: 'dogleg', cross: 300, label: 'Fractional orbit', launchTxt: 'DF-41 launch into a southbound fractional orbit' } },
  HS8: { name: 'Hwasong-8', desig: '—', country: 'North Korea', ready: 'Developmental', platform: 'Hwasong-16B IRBM',
    alt: 'Not given', speed: 'Mach 5–6', range: 'IRBM 4,000–5,000 km; HGV glide < 200 km', glide: 'Moderate', tested: 'Sep 2021', maneuver: 'Not given', src: '', maxKm: 5000,
    m: { profile: 'mid', Tb: 150, h0: 0, hB: 100, apo: 620, vMid: 3.7, glideKm: 190, hG: 50, hE: 30, vG: 1.8, vEnd: 1.5, man: 'weave', cross: 40, label: 'Midcourse', launchTxt: 'Hwasong-16B IRBM launch carrying Hwasong-8 glide vehicle' } },
  FATTAH2: { name: 'Fattah-2', desig: '—', country: 'Iran', ready: 'Developmental (Oct 2024)', platform: 'Ballistic missile (Fattah)',
    alt: 'Not given', speed: 'Mach 13–15', range: '1,400 km', glide: 'Extended', tested: 'Unknown', maneuver: 'Not given', src: '', maxKm: 1400,
    m: { profile: 'glide', Tb: 70, h0: 0, hB: 90, hG: 60, hE: 30, vG: 4.2, vEnd: 1.8, man: 'weave', cross: 120, launchTxt: 'Fattah booster launch carrying Fattah-2 glide vehicle' } },
};
export const PROFILE_LABEL: Record<Profile, string> = { glide: 'boost-glide', mid: 'ballistic midcourse, then short glide', air: 'air-launched, quasi-ballistic', cruise: 'scramjet cruise', fobs: 'fractional orbit, then glide' };

/** Systems offered for each launch region. */
export const REGION_SYS: Record<string, string[]> = { nk: ['HS8'], ir: ['FATTAH2'], cn: ['DFZF', 'DF27', 'FOBS'], ru: ['AVANGARD', 'KINZHAL', 'ZIRCON'] };
/** Systems that launch from, or aim at, places other than the region's ICBM sites and aimpoints (approximate, notional). */
export const SYS_GEO: Record<string, { launch?: Place[]; targets?: Place[] }> = {
  DFZF: { launch: [['Southeastern China', 25.5, 117.0]], targets: [['Kadena AB', 26.36, 127.77]] },
  DF27: { launch: [['Southern China', 26.0, 112.5]], targets: [['CSG · Philippine Sea', 22.0, 131.5], ['Kadena AB', 26.36, 127.77]] },
  KINZHAL: { launch: [['MiG-31K · Kaliningrad', 54.7, 20.5]], targets: [['Ramstein AB', 49.44, 7.60]] },
  ZIRCON: { launch: [['Frigate · Norwegian Sea', 69.6, 8.0]], targets: [['CSG · Norwegian Sea', 64.6, 1.5]] },
  FATTAH2: { launch: [['Western Iran', 34.3, 47.1]], targets: [['Nevatim AB', 31.21, 35.01]] },
};

/** One flight sample per second from launch. lat = cross-range offset (km) from the nominal path. */
export interface Sample { p: Vec3; h: number; ph: Phase; label: string; lat: number; v: number }
export interface SysFlight { profile: Profile; samples: Sample[]; total: number; Tb: number; tGlide: number; tTerm: number; tEngage: number; tCommit: number; rangeKm: number; cross: number; apo: number; vG: number; ev: { t: number; txt: string; kind: 'phase' | 'maneuver' }[] }

function destPoint(lat: number, lon: number, brg: number, ang: number): [number, number] {
  const la = lat * D2R, lo = lon * D2R, b = brg * D2R, d = ang * D2R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [la2 * R2D, ((lo2 * R2D + 540) % 360) - 180];
}
function bearingAt(la1: number, lo1: number, la2: number, lo2: number): number {
  const a = la1 * D2R, b = la2 * D2R, d = (lo2 - lo1) * D2R;
  return (Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) * R2D + 360) % 360;
}
function pathFn(L: [number, number], T: [number, number], longWay: boolean) {
  const A = unit(llv(L[0], L[1])), B = unit(llv(T[0], T[1])), c = Math.max(-1, Math.min(1, dot(A, B))), psi = Math.acos(c);
  let U = unit([B[0] - c * A[0], B[1] - c * A[1], B[2] - c * A[2]]);
  const ang = longWay ? 2 * Math.PI - psi : psi; if (longWay) U = [-U[0], -U[1], -U[2]];
  return { ang, ll: (f: number): [number, number] => { const th = ang * f, q = toLL([A[0] * Math.cos(th) + U[0] * Math.sin(th), A[1] * Math.cos(th) + U[1] * Math.sin(th), A[2] * Math.cos(th) + U[2] * Math.sin(th)]); return [q[0], q[1]]; } };
}
const PHASE_OF: Record<string, Phase> = { Boost: 'boost', Midcourse: 'mid', 'Quasi-ballistic': 'mid', 'Fractional orbit': 'mid', Reentry: 'reentry', 'Pull-down': 'reentry', Glide: 'glide', Cruise: 'glide', Terminal: 'terminal' };

/** Fly a named system from L to T (lat, lon) with a scripted maneuver. */
export function flySystem(L: [number, number], T: [number, number], sysKey: string, man: Maneuver): SysFlight {
  const m = SYS[sysKey].m, pr = m.profile, path = pathFn(L, T, pr === 'fobs'), S = path.ang * RE;
  const Tb = m.Tb, h0 = m.h0 || 0, hB = m.hB, vG = m.vG || m.vMid!, vEnd = m.vEnd, vMid = m.vMid || vG;
  const sB = Math.min(0.2 * S, pr === 'fobs' ? 900 : pr === 'air' ? 20 : pr === 'cruise' ? 15 : 60 + 3.0 * Tb);
  const sT = Math.min(m.sT || 70, 0.12 * S), hasMid = pr === 'mid' || pr === 'fobs' || pr === 'air';
  const sP = pr === 'air' ? 0 : Math.min(0.12 * S, pr === 'cruise' ? 20 : pr === 'mid' ? 300 : pr === 'fobs' ? 600 : 400);
  const glideLen = hasMid ? Math.min(m.glideKm || 0, S - sB - sP - sT) : S - sB - sP - sT;
  const midLen = hasMid ? Math.max(0, S - sB - sP - glideLen - sT) : 0;
  const sM = sB + midLen, sR = sM + sP, sGe = S - sT, hG = m.hG ?? hB, hE = m.hE ?? hG;
  const A = Math.min(m.cross || 0, 0.25 * S);
  const fgOf = (sd: number) => glideLen + sT > 0 ? Math.max(0, Math.min(1, (sd - sR) / (S - sR))) : 0;
  const lateral = (sd: number) => {
    if (sd < sR || man === 'straight') return 0;
    const f = fgOf(sd), env = Math.sin(Math.PI * f);
    if (man === 'dogleg') return A * Math.pow(env, 1.4);
    if (man === 'weave') return A * 0.55 * Math.sin(3 * Math.PI * f) * env;
    if (man === 'sharp') return A * 0.6 * Math.tanh(4 * Math.sin(2.5 * Math.PI * f)) * env;
    if (man === 'jink') return A * 0.45 * Math.tanh(5 * Math.sin(4 * Math.PI * f)) * env;
    if (man === 'terminal') { const u = Math.max(0, (f - 0.6) / 0.4); return A * Math.sin(Math.PI * u) * (u > 0 ? 1 : 0); }
    return 0;
  };
  const altAt = (sd: number) => {
    if (sd < sB) return h0 + (hB - h0) * Math.pow(sd / sB, 0.8);
    if (sd < sM) { const u = (sd - sB) / midLen; if (pr === 'fobs') return m.orbit!; return hB + (m.apo! - hB) * Math.sin(Math.PI * u); }
    const hStart = pr === 'fobs' ? m.orbit! : hB;
    if (sd < sR) { const u = (sd - sM) / sP; return hG + (hStart - hG) * (0.5 + 0.5 * Math.cos(Math.PI * u)); }
    const hEndArc = pr === 'air' ? hB : hE;
    if (sd <= sGe) {
      const fg = glideLen > 0 ? (sd - sR) / glideLen : 1;
      let h = (pr === 'air' ? hB : hG - (hG - hE) * fg) + (pr === 'cruise' ? 0 : 4 * Math.sin(2 * Math.PI * (sd - sR) / 1100) * (1 - fg));
      if (man === 'jink') h += 8 * Math.tanh(4 * Math.sin(3 * Math.PI * fg)) * Math.sin(Math.PI * fg);
      return h;
    }
    const u = (sd - sGe) / sT; let h = hEndArc * Math.pow(1 - u, 1.6);
    if (man === 'porpoise') h += 4 * Math.sin(3 * Math.PI * u) * (1 - u);
    return Math.max(0, h);
  };
  const vAt = (sd: number) => {
    if (sd < sM) return vMid;
    if (sd < sR) return vMid + (vG - vMid) * (sd - sM) / Math.max(1, sP);
    if (sd <= sGe) return vG - (vG - vEnd) * Math.pow(Math.min(1, (sd - sR) / Math.max(1, sGe - sR)), 0.8);
    return m.vTerm || vEnd;
  };
  const phaseName = (sd: number) => sd < sM ? (m.label || 'Midcourse') : sd < sR ? (hasMid ? 'Reentry' : 'Pull-down') : sd <= sGe ? (pr === 'cruise' ? 'Cruise' : pr === 'air' ? m.label! : 'Glide') : 'Terminal';
  const point = (sd: number, alt: number, ph: string, v: number): Sample => {
    const f = sd / S, [la, lo] = path.ll(f), [la2, lo2] = path.ll(Math.min(1, f + 0.0005)), off = lateral(sd);
    const [a, b] = off ? destPoint(la, lo, bearingAt(la, lo, la2, lo2) + 90, off / RE * R2D) : [la, lo];
    return { p: llv(a, b, alt), h: alt, ph: PHASE_OF[ph] || 'glide', label: ph, lat: off, v };
  };
  const samples: Sample[] = []; let sd = 0, t = 0;
  while (t < 20000) {
    let ph: string, v: number;
    if (t <= Tb) { sd = sB * Math.pow(t / Tb, 2); ph = 'Boost'; v = vMid * t / Tb; }
    else { v = vAt(sd); sd += v; ph = phaseName(sd); }
    if (sd >= S) { samples.push(point(S, 0, 'Terminal', m.vTerm || vEnd)); break; }
    samples.push(point(sd, Math.max(0.3, altAt(sd)), ph, v)); t++;
  }
  const total = samples.length - 1, apo = samples.reduce((mx, x) => Math.max(mx, x.h), 0);
  const first = (lbl: string) => { const i = samples.findIndex(x => x.label === lbl); return i < 0 ? undefined : i; };
  const glidePh = pr === 'cruise' ? 'Cruise' : pr === 'air' ? m.label! : 'Glide';
  const tGlide = first(glidePh) ?? Tb, tTerm = first('Terminal') ?? total;
  const ev: SysFlight['ev'] = [];
  const E = (tt: number | undefined, txt: string, kind: 'phase' | 'maneuver' = 'phase') => { if (tt !== undefined && isFinite(tt)) ev.push({ t: Math.round(tt), txt, kind }); };
  const mach = (v: number) => Math.round(v / 0.3);
  if (pr === 'air') E(Tb, `Motor burnout · quasi-ballistic arc peaking near ${Math.round(apo)} km at ~Mach ${mach(vMid)}`);
  else if (pr === 'cruise') E(Tb, `Booster separates · scramjet cruise at ~${hG} km, ~Mach ${mach(vG)}`);
  else if (pr === 'fobs') {
    E(Tb, `Fractional orbit at ~${m.orbit} km, ~Mach ${mach(vMid)}, heading away from the target`);
    const tq = samples.findIndex(x => toLL(x.p)[0] < -60); if (tq > 0) E(tq, 'Passes over Antarctica, then turns north toward the target');
    E(first('Reentry'), 'Deorbit · glide vehicle reenters well short of the target');
  } else if (pr === 'mid') { E(Tb, `Booster burnout · ballistic midcourse, apogee near ${Math.round(apo)} km`); E(first('Reentry'), 'Reentry · glide vehicle pulls up into a short glide'); }
  else E(Tb, `Booster burnout · glider separates near ${hB} km`);
  if (pr === 'glide' || pr === 'mid' || pr === 'fobs') E(tGlide, `Glider established at ~${Math.round(samples[tGlide] ? samples[tGlide].h : hG)} km · ~Mach ${mach(vG)}`);
  if (man !== 'straight' && A > 0) { const tm = man === 'terminal' || man === 'porpoise' ? tTerm - 30 : tGlide + (tTerm - tGlide) * 0.3; E(Math.max(tGlide, tm), `${MANEUVERS[man]} · up to ~${Math.round(A)} km off the predicted track`, 'maneuver'); }
  E(tTerm, pr === 'cruise' ? 'Terminal phase · accelerates and porpoises toward the target' : 'Terminal dive');
  return { profile: pr, samples, total, Tb, tGlide, tTerm, tEngage: hasMid ? Tb + 10 : tGlide, tCommit: hasMid ? Tb + 10 : tGlide + 20, rangeKm: S, cross: A, apo, vG, ev };
}
