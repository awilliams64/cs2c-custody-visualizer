import { RE, D2R, R2D } from './constants';
import type { Vec3 } from './types';

export const llv = (lat: number, lon: number, h = 0): Vec3 => {
  const r = RE + h, la = lat * D2R, lo = lon * D2R;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
};
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** [lat deg, lon deg, altitude km] */
export const toLL = (p: Vec3): Vec3 => { const n = norm(p); return [Math.asin(p[2] / n) * R2D, Math.atan2(p[1], p[0]) * R2D, n - RE]; };
export const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

/** Deterministic PRNG so a scenario always replays the same way. */
export const mulberry = (seed: number) => () => {
  seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
export const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
