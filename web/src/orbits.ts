// Sensor constellations: Walker shells (LEO/MEO), fixed GEO slots and Molniya-type polar SVs, in Earth-fixed coordinates.
import { ARCH } from './config';
import { realPos, realSats } from './catalog';
import { D2R, MU, RE, WE } from './constants';
import { pad } from './format';
import { S, sim } from './state';
import type { CircSat, Group, Sat } from './types';

export function buildSats(): void {
  const sats: Sat[] = [];
  const walker = (group: Group, pre: string, alt: number, inc: number, P: number, Sp: number, F: number, raanOff: number,
    fc: (j: number, k: number) => boolean) => {
    const a = RE + alt, n = Math.sqrt(MU / a ** 3), T = P * Sp;
    for (let j = 0; j < P; j++) for (let k = 0; k < Sp; k++) {
      const isFC = group === 'LEO' && fc(j, k);
      sats.push({ id: `${pre}-${pad(j + 1)}${pad(k + 1)}`, group, layer: isFC ? 'FC' : group, kind: 'c', idx: 0, a, n,
        ci: Math.cos(inc * D2R), si: Math.sin(inc * D2R), raan: 2 * Math.PI * (j + raanOff) / P,
        m0: 2 * Math.PI * k / Sp + 2 * Math.PI * F * j / T + raanOff, plane: j, ring: pre + j });
    }
  };
  const A = ARCH[S.arch];
  if (A.real) realSats().forEach(r => {
    if (!S.layers[r.group]) return;
    const nRad = r.rec.no / 60; // rad/s
    sats.push({ kind: 'r', id: r.id, group: r.group, layer: r.layer, idx: 0, a: r.rec.a * RE, rec: r.rec, name: r.name, norad: r.norad, epoch: r.epoch, notional: r.notional, note: r.note, period: 2 * Math.PI / nRad });
  });
  if (A.real) { sats.forEach((s, i) => { s.idx = i; }); sim.sats = sats; return; }
  if (S.layers.LEO) A.leo.forEach(([pre, P, Sp, off, fc]) => walker('LEO', pre, 1000, 81, P, Sp, 1, off, fc));
  if (S.layers.MEO) A.meo.forEach(([pre, P, Sp, off]) => walker('MEO', pre, 8000, 55, P, Sp, 1, off, () => false));
  if (S.layers.GEO) [10, 75, 140, -135, -60].forEach((lo, i) => sats.push({ id: `GEO-${i + 1}`, group: 'GEO', layer: 'GEO', kind: 'g', idx: 0, a: 42164, lon: lo * D2R }));
  if (S.layers.HEO) [0, 1].forEach(i => {
    const a = 26554;
    sats.push({ id: `NGP-${i + 1}`, group: 'HEO', layer: 'HEO', kind: 'e', idx: 0, a, e: 0.72, n: Math.sqrt(MU / a ** 3),
      ci: Math.cos(63.4 * D2R), si: Math.sin(63.4 * D2R), raan: (i ? 200 : 20) * D2R, w: 270 * D2R, m0: i ? Math.PI * 0.95 : Math.PI * 0.75 });
  });
  sats.forEach((s, i) => { s.idx = i; });
  sim.sats = sats;
}

/** Earth-fixed position (km) of satellite s at time t, written into out[o..o+2]. */
export function satPos(s: Sat, t: number, out: Float64Array | number[], o: number): void {
  if (s.kind === 'r') { realPos(s.rec, S.epoch + t * 1000, out, o); return; }
  if (s.kind === 'g') { out[o] = s.a * Math.cos(s.lon); out[o + 1] = s.a * Math.sin(s.lon); out[o + 2] = 0; return; }
  const cO = Math.cos(s.raan), sO = Math.sin(s.raan);
  let x: number, y: number, z: number;
  if (s.kind === 'c') {
    const u = s.m0 + s.n * t, cu = Math.cos(u), su = Math.sin(u);
    x = s.a * (cu * cO - su * s.ci * sO); y = s.a * (cu * sO + su * s.ci * cO); z = s.a * su * s.si;
  } else {
    const M = s.m0 + s.n * t; let E = M;
    for (let i = 0; i < 8; i++) E -= (E - s.e * Math.sin(E) - M) / (1 - s.e * Math.cos(E));
    const nu = 2 * Math.atan2(Math.sqrt(1 + s.e) * Math.sin(E / 2), Math.sqrt(1 - s.e) * Math.cos(E / 2)), r = s.a * (1 - s.e * Math.cos(E));
    const u = nu + s.w, cu = Math.cos(u), su = Math.sin(u);
    x = r * (cu * cO - su * s.ci * sO); y = r * (cu * sO + su * s.ci * cO); z = r * su * s.si;
  }
  const th = WE * t, c = Math.cos(th), sn = Math.sin(th);
  out[o] = x * c + y * sn; out[o + 1] = -x * sn + y * c; out[o + 2] = z;
}

export function allSatPos(t: number, buf: Float64Array): Float64Array {
  for (let i = 0; i < sim.sats.length; i++) satPos(sim.sats[i], t, buf, i * 3);
  return buf;
}

/** A copy of a circular-orbit SV shifted along its orbit (used to draw orbit rings). */
export const ringPoint = (s: CircSat, dm: number): CircSat => ({ ...s, m0: s.m0 + dm });

/** Orbit ring of a real SV at time t, in the Earth-fixed frame of that moment (n points over one period). */
export function realRing(s: Extract<Sat, { kind: 'r' }>, t: number, n = 96): number[][] {
  const pts: number[][] = [], tmp = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    const dt = s.period * i / n; realPos(s.rec, S.epoch + (t + dt) * 1000, tmp, 0);
    const th = WE * dt, c = Math.cos(th), sn = Math.sin(th); // undo Earth rotation over dt
    pts.push([tmp[0] * c - tmp[1] * sn, tmp[0] * sn + tmp[1] * c, tmp[2]]);
  }
  return pts;
}
