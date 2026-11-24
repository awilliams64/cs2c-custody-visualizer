// Threat assessment: predicted impact point (IPP) with shrinking uncertainty, and a tasking priority.
// Notional: the uncertainty model stands in for a real IPP estimator fed by the tracks.
import { DEFENDED_RADIUS_KM, LOCATION_CLASS, LOCATION_WEIGHT, MEDIUM_MARGIN_KM, REACH_FACTOR, TYPE_WEIGHT } from './config';
import { SYS } from './systems';
import { defendedAreas } from './threats';
import { D2R, DT, RE } from './constants';
import { S, sim } from './state';
import type { Assessment, Priority, Threat } from './types';
import { cross, dot, hash, llv, toLL, unit } from './vec';

/** Great-circle distance (km) between two lat/lon points in degrees. */
export function gcKm(la1: number, lo1: number, la2: number, lo2: number): number {
  const a = la1 * D2R, b = la2 * D2R, dl = (lo2 - lo1) * D2R;
  return RE * Math.acos(Math.max(-1, Math.min(1, Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dl))));
}

/**
 * IPP uncertainty (km): large in boost, shrinking after burnout; HGVs stay unpredictable until the dive.
 * radius is the equal-area size; ratio is downrange : cross-range of the ellipse (notional). Velocity error
 * throws a ballistic impact long or short far more than sideways, so the footprint is stretched along the path,
 * most of all just after burnout. An HGV's glide range is uncertain, but it can also turn, so its footprint is rounder.
 */
function uncertaintyKm(th: Threat, t: number, phase: string): { radius: number; reliable: boolean; ratio: number } {
  const tBurn = th.tL + th.tb;
  if (th.type === 'H') return phase === 'terminal' ? { radius: 60, reliable: true, ratio: 1.3 } : { radius: t < tBurn ? 2500 : 1500, reliable: false, ratio: t < tBurn ? 2.5 : 1.6 };
  if (t < tBurn) return { radius: 2500, reliable: false, ratio: 2.5 };
  return { radius: 40 + 3000 * Math.exp(-(t - tBurn) / 200), reliable: true, ratio: 2 + 1.5 * Math.exp(-(t - tBurn) / 300) };
}
/** Initial great-circle bearing (deg) from point 1 to point 2. */
function bearing(la1: number, lo1: number, la2: number, lo2: number): number {
  const a = la1 * D2R, b = la2 * D2R, d = (lo2 - lo1) * D2R;
  return Math.atan2(Math.sin(d) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(d)) / D2R;
}
/** Distance (km) from the ellipse centre to its edge in direction brg (deg). */
export function ellipseReach(a: { alongKm: number; crossKm: number; headingDeg: number }, brg: number): number {
  const f = (brg - a.headingDeg) * D2R, A = a.alongKm, B = a.crossKm;
  return A * B / Math.hypot(B * Math.cos(f), A * Math.sin(f));
}

export function assessThreats(): void {
  const defended = defendedAreas();
  sim.threats.forEach((th, j) => {
    const [tLat, tLon] = toLL([th.b[0] * RE, th.b[1] * RE, th.b[2] * RE]);
    const phase0 = (hash(th.id + S.region) / 4294967296) * Math.PI * 2;
    let prev: Priority = 'High';
    sim.thrRec[j].forEach((r, k) => {
      if (!r) { prev = 'High'; return; }
      const t = k * DT, { radius, reliable, ratio } = uncertaintyKm(th, t, r.phase);
      // predicted centre wanders around the true impact point by up to 25% of the uncertainty
      const ang = phase0 + (t - th.tL) / 400, off = reliable ? 0.25 * radius : 0;
      const ippLat = Math.max(-89, Math.min(89, tLat + off * Math.cos(ang) / 111.2));
      const ippLon = tLon + off * Math.sin(ang) / (111.2 * Math.max(0.2, Math.cos(tLat * D2R)));
      // the ellipse lies along the flight path: heading of the launch-to-aimpoint great circle at the IPP
      const cu = unit(llv(ippLat, ippLon)), dv = unit(cross(th.n, cu)), east = unit(cross([0, 0, 1], cu)), north = cross(cu, east);
      const headingDeg = Math.atan2(dot(dv, east), dot(dv, north)) / D2R, k2 = Math.sqrt(ratio);
      const ell = { alongKm: Math.min(4500, radius * k2), crossKm: radius / k2, headingDeg };
      let nearest = defended[0][0], nearestKm = Infinity, nearLa = 0, nearLo = 0;
      defended.forEach(([name, la, lo]) => { const d = gcKm(ippLat, ippLon, la, lo); if (d < nearestKm) { nearestKm = d; nearest = name; nearLa = la; nearLo = lo; } });
      // how far the ellipse reaches toward the nearest defended area
      const margin = nearestKm - ellipseReach(ell, bearing(ippLat, ippLon, nearLa, nearLo));
      let priority: Priority = margin < DEFENDED_RADIUS_KM ? 'High' : margin < DEFENDED_RADIUS_KM + MEDIUM_MARGIN_KM ? 'Medium' : 'Low';
      if (prev === 'Low' && priority === 'Medium') priority = 'Low'; // hysteresis: once cleared, stay cleared unless it could hit
      prev = priority;
      // track value V(q): type weight x location weight; an RV clear of every defended area is valued as an open-ocean event
      const typeClass = th.sys ? SYS[th.sys].name : th.type === 'H' ? 'HGV' : th.D > 5500 ? 'ICBM' : 'ballistic missile';
      const typeWeight = th.type === 'H' ? TYPE_WEIGHT.hgv : th.D > 5500 ? TYPE_WEIGHT.icbm : TYPE_WEIGHT.ballistic;
      const cls = LOCATION_CLASS[nearest] || 'Allied';
      const locClass = priority === 'Low' ? 'open ocean' : cls;
      const locWeight = Math.max(LOCATION_WEIGHT['open ocean'], LOCATION_WEIGHT[cls] * REACH_FACTOR[priority]);
      const value = Math.round(typeWeight * locWeight * 100) / 100;
      const a: Assessment = { priority, ippLat, ippLon, radiusKm: radius, ...ell, nearest, nearestKm, reliable, value, typeWeight, locWeight, typeClass, locClass };
      r.assess = a;
    });
  });
}

export const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
/** Track value of a threat at a step (0 when unassessed). */
export const trackValue = (r: { assess: Assessment | null } | null | undefined) => r && r.assess ? r.assess.value : 0;
