// Sub-solar point for the day/night terminator (low-precision solar ephemeris, good to a fraction of a degree).
const D2R = Math.PI / 180;
export function subsolar(ms: number): [number, number] {
  const n = ms / 864e5 + 2440587.5 - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360, gA = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(gA) + 0.020 * Math.sin(2 * gA)) * D2R, eps = (23.439 - 0.0000004 * n) * D2R;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)), ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const gmst = ((280.46061837 + 360.98564736629 * n) % 360) * D2R;
  const lon = ((((ra - gmst) / D2R) % 360) + 540) % 360 - 180;
  return [dec / D2R, lon];
}
