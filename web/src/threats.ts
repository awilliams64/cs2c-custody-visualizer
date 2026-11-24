// Notional ballistic RV and hypersonic glide vehicle (HGV) trajectories.
import { LOCATION_CLASS, OCEAN_IMPACT, REGIONS, type Place } from './config';
import { FIRST_LAUNCH, RE } from './constants';
import { gcKm } from './assess';
import { SYS, SYS_GEO, flySystem, type Maneuver } from './systems';
import { pad } from './format';
import { S, sim } from './state';
import type { Phase, Threat, ThreatState, Vec3 } from './types';
import { cross, dot, hash, llv, mulberry, unit } from './vec';

/** Aimpoints for the current region and threat system (the defended areas used by the assessment). */
export function defendedAreas(): Place[] {
  const R = REGIONS[S.region], g = S.sys !== 'generic' ? SYS_GEO[S.sys] : undefined;
  return g && g.targets ? [...R.targets, ...g.targets.filter(t => !R.targets.some(r => r[0] === t[0]))] : R.targets;
}

export function buildThreats(): void {
  const R = REGIONS[S.region], rng = mulberry(hash(S.region + S.salvo + S.mix));
  sim.sites = R.sites.map(([name, lat, lon]) => ({ name, lat, lon, p: llv(lat, lon, 0.5) }));
  const nReg = sim.sites.length;
  // a named system may launch from its own point (air or sea launch, shorter-range sites) and aim at regional targets
  const sysKey = S.sys !== 'generic' && SYS[S.sys] ? S.sys : null, geo = sysKey ? SYS_GEO[sysKey] || {} : {};
  const sysSites: number[] = [];
  if (sysKey) (geo.launch || R.sites).forEach(([name, lat, lon]) => {
    let k = sim.sites.findIndex(s => s.name === name);
    if (k < 0) { sim.sites.push({ name, lat, lon, p: llv(lat, lon, 0.5) }); k = sim.sites.length - 1; }
    sysSites.push(k);
  });
  const sysTargets = sysKey ? defendedAreas() : [];
  const maxKm = sysKey ? SYS[sysKey].maxKm : null;
  const dist = (si: number, t: Place) => gcKm(sim.sites[si].lat, sim.sites[si].lon, t[1], t[2]);
  /** Targets inside the system's listed range from this launch point, or the nearest one if none is. */
  const reach = (si: number): Place[] => {
    // intercontinental systems (FOBS, Avangard) go for the continental U.S.
    const pool = maxKm === null && sysTargets.some(t => LOCATION_CLASS[t[0]] === 'CONUS') ? sysTargets.filter(t => LOCATION_CLASS[t[0]] === 'CONUS') : sysTargets;
    const ok = pool.filter(t => maxKm === null || dist(si, t) <= maxKm);
    return ok.length ? ok : [sysTargets.slice().sort((a, b) => dist(si, a) - dist(si, b))[0]];
  };
  // launch points with a target inside the listed range come first
  const inRange = (si: number) => maxKm === null || sysTargets.some(t => dist(si, t) <= maxKm);
  if (sysKey) { const ok = sysSites.filter(inRange); if (ok.length) sysSites.splice(0, sysSites.length, ...ok); }
  const threats: Threat[] = [];
  let nb = 0, nh = 0;
  for (let i = 0; i < S.salvo; i++) {
    const type: 'B' | 'H' = S.mix === 'bal' ? 'B' : S.mix === 'hgv' ? 'H' : (i % 2 ? 'H' : 'B');
    const named = type === 'H' && !!sysKey;
    const si = named ? sysSites[nh % sysSites.length] : i % nReg, site = sim.sites[si];
    let tg = named ? (() => { const r = reach(si); return r[Math.floor(nh / sysSites.length) % r.length]; })()
      : R.targets[(i + Math.floor(i / nReg)) % R.targets.length];
    const id = type === 'B' ? `B-${pad(++nb)}` : `H-${pad(++nh)}`;
    // the third launch of a salvo of 5+ is an off-nominal ballistic RV that falls short into open ocean
    const errant = S.errant && S.salvo >= 5 && i === 2 && type === 'B';
    const aimpoint = tg[0];
    if (errant) tg = OCEAN_IMPACT[S.region];
    const a = unit(llv(site.lat, site.lon)), b = unit(llv(tg[1], tg[2]));
    const Om = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))), D = Om * RE;
    const n = unit(cross(a, b));
    const tL = FIRST_LAUNCH + (S.salvo === 1 ? 0 : i * (150 / S.salvo) + (i ? rng() * 8 : 0));
    const th: Threat = { id, type, site: si, siteName: site.name, target: aimpoint, impactName: tg[0], errant, a, b, Om, D, n, tL, TOF: 0, tb: 0, tEnd: 0, H: 0, A: 0, A2: 0, path: [], sys: null, man: null, flight: null };
    if (type === 'B') { th.TOF = 240 + D / 6.5; th.H = Math.min(1300, 0.22 * D + 100); th.tb = D > 5500 ? 180 : 110; }
    else if (named) {
      const man = (S.man === 'auto' ? SYS[sysKey!].m.man : S.man) as Maneuver;
      const fl = flySystem([site.lat, site.lon], [tg[1], tg[2]], sysKey!, man);
      Object.assign(th, { sys: sysKey, man, flight: fl, TOF: fl.total, tb: fl.Tb, D: fl.rangeKm });
    }
    else { th.TOF = 200 + D / 4.0; th.tb = D > 4000 ? 150 : 100; th.A = Math.min(650, 0.08 * D) * (rng() < 0.5 ? -1 : 1); th.A2 = rng() < 0.5 ? -1 : 1; }
    th.tEnd = tL + th.TOF;
    threats.push(th);
  }
  sim.threats = threats;
  sim.dur = Math.max(...threats.map(t => t.tEnd)) + 90;
  threats.forEach(th => {
    for (let t = th.tL; t <= th.tEnd + 0.01; t += 5) { const st = threatState(th, t); if (st) th.path.push(st.p); }
    th.path.push(threatState(th, th.tEnd - 0.01)!.p);
  });
}

/** Point along the launch-to-aimpoint great circle at fraction s, offset cross-range by lat km. */
function gc(th: Threat, s: number, lat: number): Vec3 {
  const Om = th.Om, sn = Math.sin(Om) || 1e-9, f1 = Math.sin((1 - s) * Om) / sn, f2 = Math.sin(s * Om) / sn;
  let p: Vec3 = [f1 * th.a[0] + f2 * th.b[0], f1 * th.a[1] + f2 * th.b[1], f1 * th.a[2] + f2 * th.b[2]];
  if (lat) { const d = lat / RE, c = Math.cos(d), sd = Math.sin(d); p = [c * p[0] + sd * th.n[0], c * p[1] + sd * th.n[1], c * p[2] + sd * th.n[2]]; }
  return p;
}

const hgvCrossRange = (th: Threat, u: number) => th.A * Math.sin(Math.PI * u) + th.A2 * 0.35 * Math.abs(th.A) * Math.sin(3 * Math.PI * u) * u;

export function threatState(th: Threat, t: number): ThreatState | null {
  if (th.flight) {
    const x = t - th.tL, sm = th.flight.samples; if (x < 0 || x > th.TOF) return null;
    const i = Math.min(sm.length - 2, Math.floor(x)), f = x - i, a = sm[i], b = sm[i + 1];
    return { p: [a.p[0] + (b.p[0] - a.p[0]) * f, a.p[1] + (b.p[1] - a.p[1]) * f, a.p[2] + (b.p[2] - a.p[2]) * f], h: a.h + (b.h - a.h) * f, phase: sm[Math.round(x)].ph };
  }
  const tau = (t - th.tL) / th.TOF;
  if (tau < 0 || tau > 1) return null;
  const tb = th.tb / th.TOF;
  let s: number, h: number, lat = 0, phase: Phase;
  if (th.type === 'B') {
    s = Math.pow(tau, 1.3); h = 4 * th.H * tau * (1 - tau) + 0.5;
    phase = tau < tb ? 'boost' : h > 100 ? 'mid' : 'reentry';
  } else if (tau < tb) {
    const f = tau / tb; s = 0.05 * Math.pow(f, 1.6); h = 95 * Math.pow(Math.sin(f * Math.PI / 2), 0.8) + 0.5; phase = 'boost';
  } else {
    const u = (tau - tb) / (1 - tb); s = 0.05 + 0.95 * (1 - Math.pow(1 - u, 1.35));
    let g = 32 + 30 * Math.pow(1 - u, 0.6) + 8 * (1 - u) * Math.cos(6 * Math.PI * u);
    g = u < 0.04 ? 95 + (g - 95) * (u / 0.04) : g;
    if (u > 0.96) g *= (1 - u) / 0.04;
    h = Math.max(0.3, g);
    lat = hgvCrossRange(th, u);
    phase = u > 0.96 ? 'terminal' : 'glide';
  }
  const q = gc(th, s, lat), r = RE + h;
  return { p: [q[0] * r, q[1] * r, q[2] * r], h, phase };
}

/** Cross-range rate sign proxy for maneuver detection (0 outside the glide phase). */
export function hgvLatRate(th: Threat, t: number): number {
  if (th.type !== 'H') return 0;
  if (th.flight) { const sm = th.flight.samples, x = Math.round(t - th.tL); return x <= 0 || x >= sm.length - 1 ? 0 : sm[x + 1].lat - sm[x].lat; }
  const tau = (t - th.tL) / th.TOF, tb = th.tb / th.TOF;
  if (tau <= tb || tau >= 1) return 0;
  const u = (tau - tb) / (1 - tb);
  return hgvCrossRange(th, Math.min(1, u + 0.002)) - hgvCrossRange(th, u);
}
