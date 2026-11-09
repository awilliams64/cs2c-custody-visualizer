// Coastline and border outlines (Natural Earth 50m via world-atlas), as unit vectors.
import raw from './data/world-outlines.txt?raw';
import { D2R } from './constants';

export const WORLD: Float32Array[] = raw.trim().split('|').map(l => {
  const pts = l.split(' '), a = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    const c = p.indexOf(','), lo = +p.slice(0, c) * D2R, la = +p.slice(c + 1) * D2R, cl = Math.cos(la);
    a[i * 3] = cl * Math.cos(lo); a[i * 3 + 1] = cl * Math.sin(lo); a[i * 3 + 2] = Math.sin(la);
  });
  return a;
});

/** Coarse copy for zoomed-out or moving views (points at least 0.6 deg apart). */
export const WORLD_LO: Float32Array[] = WORLD.map(a => {
  const out = [a[0], a[1], a[2]]; let lx = a[0], ly = a[1], lz = a[2]; const c = Math.cos(0.6 * D2R);
  for (let i = 3; i < a.length; i += 3) {
    if (a[i] * lx + a[i + 1] * ly + a[i + 2] * lz < c || i === a.length - 3) { out.push(a[i], a[i + 1], a[i + 2]); lx = a[i]; ly = a[i + 1]; lz = a[i + 2]; }
  }
  return new Float32Array(out);
}).filter(a => a.length > 3);
