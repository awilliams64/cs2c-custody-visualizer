// 3D camera: a quaternion orbit around a pivot (Earth's centre or the focused object) with perspective projection.
import { REGIONS } from './config';
import { D2R, RE } from './constants';
import { S } from './state';
import type { Quat, Vec3 } from './types';
import { cross, dot, llv, norm, toLL, unit } from './vec';

export const qmul = (a: Quat, b: Quat): Quat => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
export const qaxis = (ax: Vec3, angle: number): Quat => { const s = Math.sin(angle / 2); return [Math.cos(angle / 2), ax[0] * s, ax[1] * s, ax[2] * s]; };
export const qnorm = (q: Quat): Quat => { const n = Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]; };
export const qrot = (q: Quat, v: Vec3): Vec3 => {
  const [w, x, y, z] = q;
  const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
  return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
};
export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(v => -v) as Quat; d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (b[i] - v) * t) as Quat);
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb) as Quat;
}
/** Quaternion from a camera basis (right, up, back). */
export function qBasis(r: Vec3, u: Vec3, b: Vec3): Quat {
  const m00 = r[0], m01 = u[0], m02 = b[0], m10 = r[1], m11 = u[1], m12 = b[1], m20 = r[2], m21 = u[2], m22 = b[2], tr = m00 + m11 + m22;
  let s: number;
  if (tr > 0) { s = Math.sqrt(tr + 1) * 2; return qnorm([s / 4, (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s]); }
  if (m00 > m11 && m00 > m22) { s = Math.sqrt(1 + m00 - m11 - m22) * 2; return qnorm([(m21 - m12) / s, s / 4, (m01 + m10) / s, (m02 + m20) / s]); }
  if (m11 > m22) { s = Math.sqrt(1 + m11 - m00 - m22) * 2; return qnorm([(m02 - m20) / s, (m01 + m10) / s, s / 4, (m12 + m21) / s]); }
  s = Math.sqrt(1 + m22 - m00 - m11) * 2; return qnorm([(m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, s / 4]);
}
/** Camera above (lat, lon) looking at Earth's centre, north up. */
export function qLook(lat: number, lon: number): Quat {
  const b = unit(llv(lat, lon));
  let u: Vec3 = [-Math.sin(lat * D2R) * Math.cos(lon * D2R), -Math.sin(lat * D2R) * Math.sin(lon * D2R), Math.cos(lat * D2R)];
  u = unit([u[0] - b[0] * dot(u, b), u[1] - b[1] * dot(u, b), u[2] - b[2] * dot(u, b)]);
  return qBasis(cross(u, b), u, b);
}
/** Level the horizon with north up, keeping the current viewing direction. */
export function qNorthUp(): Quat {
  const c = S.cam;
  if (c.pivot === 'earth') { const [la, lo] = toLL(qrot(c.q, [0, 0, 1]).map(v => v * RE) as Vec3); return qLook(la, lo); }
  const b = qrot(c.q, [0, 0, 1]), T = unit(c.T[0] || c.T[1] || c.T[2] ? c.T : [0, 0, 1]);
  let uu: Vec3 = [T[0] - b[0] * dot(T, b), T[1] - b[1] * dot(T, b), T[2] - b[2] * dot(T, b)];
  if (norm(uu) < 1e-3) uu = [0, 0, 1];
  let u = unit(uu); if (Math.abs(dot(u, b)) > 0.999) u = unit(cross(b, [1, 0, 0]));
  return qBasis(cross(u, b), u, b);
}

/** Viewport and camera frame for the current frame. */
export const view = {
  W: 0, H: 0, DPR: 1, CX: 0, CY: 0, F: 1, RPX: 1,
  CR: [1, 0, 0] as Vec3, CU: [0, 1, 0] as Vec3, CB: [0, 0, 1] as Vec3,
  E: [0, 0, 60000] as Vec3, EH: [0, 0, 1] as Vec3, EE: 1,
};

export function setCam(): void {
  const c = S.cam, v = view;
  v.CR = qrot(c.q, [1, 0, 0]); v.CU = qrot(c.q, [0, 1, 0]); v.CB = qrot(c.q, [0, 0, 1]);
  v.E = [c.T[0] + v.CB[0] * c.d, c.T[1] + v.CB[1] * c.d, c.T[2] + v.CB[2] * c.d];
  let n = norm(v.E);
  if (n < RE + 250) { v.E = v.E.map(x => x / n * (RE + 250)) as Vec3; n = RE + 250; }
  v.EH = [v.E[0] / n, v.E[1] / n, v.E[2] / n]; v.EE = n * n;
  v.CX = v.W > 860 ? v.W / 2 + 20 : v.W / 2; v.CY = v.H / 2; v.F = (Math.min(v.W, v.H) / 2) / Math.tan(c.fov / 2);
  v.RPX = v.F * Math.tan(Math.asin(Math.min(0.9999, RE / n)));
}

/** Screen point: [x, y, camera-side (+) / far-side (-) of Earth, hidden (1) by Earth or behind the camera]. */
export type ScreenPt = [number, number, number, number] & { off?: boolean };
export function proj(x: number, y: number, z: number, out: ScreenPt): ScreenPt {
  const v = view, vx = x - v.E[0], vy = y - v.E[1], vz = z - v.E[2];
  const zc = -(vx * v.CB[0] + vy * v.CB[1] + vz * v.CB[2]);
  if (zc < 1) { out[0] = out[1] = -1e5; out[2] = 0; out[3] = 1; return out; }
  out[0] = v.CX + v.F * (vx * v.CR[0] + vy * v.CR[1] + vz * v.CR[2]) / zc;
  out[1] = v.CY - v.F * (vx * v.CU[0] + vy * v.CU[1] + vz * v.CU[2]) / zc;
  out[2] = x * v.EH[0] + y * v.EH[1] + z * v.EH[2];
  const a = vx * vx + vy * vy + vz * vz, b = 2 * (v.E[0] * vx + v.E[1] * vy + v.E[2] * vz), c = v.EE - RE * RE, disc = b * b - 4 * a * c;
  out[3] = 0;
  if (disc > 0) { const t1 = (-b - Math.sqrt(disc)) / (2 * a); if (t1 > 0 && t1 < 0.9995) out[3] = 1; }
  return out;
}
export const pt = (): ScreenPt => [0, 0, 0, 0] as ScreenPt;

/** Inertia, animated re-orientation, follow mode and pivot easing. */
export function updateCam(fp: Vec3 | null, dragging: boolean): void {
  const c = S.cam;
  if (!c.q.every(Number.isFinite) || !c.T.every(Number.isFinite)) { resetCam(); }
  if (c.vel && !dragging) { c.q = qnorm(qmul(c.q, qaxis(c.vel.axis, c.vel.ang))); c.vel.ang *= 0.9; if (Math.abs(c.vel.ang) < 2e-4) c.vel = null; }
  if (c.qTarget) {
    c.q = qslerp(c.q, c.qTarget, 0.1);
    const d = Math.abs(c.q[0] * c.qTarget[0] + c.q[1] * c.qTarget[1] + c.q[2] * c.qTarget[2] + c.q[3] * c.qTarget[3]);
    if (d > 0.99999) c.qTarget = null;
  } else if (S.follow && fp && c.pivot === 'earth' && !dragging && !c.vel) {
    const [la, lo] = toLL(fp); c.q = qslerp(c.q, qLook(Math.max(-60, Math.min(70, la)), lo), 0.05);
  }
  const tgt: Vec3 = c.pivot === 'focus' && fp ? fp : [0, 0, 0];
  c.T = c.T.map((v, i) => v + (tgt[i] - v) * 0.12) as Vec3;
}

export function resetCam(): void {
  const r = REGIONS[S.region].center, c = S.cam;
  c.q = qLook(r[0], r[1]); c.T = [0, 0, 0]; c.vel = null; c.qTarget = null;
}

export const distLimits = (): [number, number] => S.cam.pivot === 'focus' ? [1500, 250000] : [RE + 900, 250000];
export const setDist = (d: number) => { const [a, b] = distLimits(); S.cam.d = Math.max(a, Math.min(b, d)); };
