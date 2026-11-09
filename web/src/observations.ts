// What CS2C gets to see: the scenario and, per time step, every target with its candidate SVs.
// Shared by the live WebSocket link and the "Export observations" file. Schema: docs/protocol.md.
import { FOV_HALF, LAYER_BANDS, bandSuit, phaseClass } from './config';
import { DT } from './constants';
import { S, sim } from './state';
import { isOut } from './tasking';
import { threatState } from './threats';
import type { StepRec } from './types';
import { toLL } from './vec';

export const PROTOCOL_VERSION = 1;
const r1 = (x: number) => Math.round(x * 10) / 10, r3 = (x: number) => Math.round(x * 1000) / 1000, r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function scenarioMessage() {
  return {
    region: S.region, salvo: S.salvo, mix: S.mix, arch: S.arch, dt: DT, duration: r1(sim.dur),
    svs: sim.sats.map(s => ({ id: s.id, layer: s.layer, group: s.group, bands: LAYER_BANDS[s.layer], fov_half_deg: FOV_HALF[s.layer] })),
    threats: sim.threats.map(th => ({ id: th.id, type: th.type === 'B' ? 'ballistic' : 'hgv', site: th.siteName, target: th.target, launch_t: r1(th.tL), impact_t: r1(th.tEnd) })),
    sites: sim.sites.map(s => ({ name: s.name, lat: s.lat, lon: s.lon })),
  };
}

function targetObs(name: string, kind: 'site' | 'threat', r: StepRec, pos: [number, number, number]) {
  const pc = phaseClass(r.phase);
  return {
    target: name, kind, phase: r.phase, lat: r3(pos[0]), lon: r3(pos[1]), alt_km: r1(Math.max(0, pos[2])),
    candidates: r.vis.map(v => {
      const sv = sim.sats[v.s];
      return {
        sv: sv.id, layer: sv.layer, range_km: Math.round(v.R),
        elevation_deg: r1(Math.asin(Math.max(-1, Math.min(1, v.se))) * 180 / Math.PI),
        background: v.bth ? 'earth' : 'space',
        los: [r4(v.lx), r4(v.ly), r4(v.lz)],          // unit vector, target -> SV, Earth-fixed
        access_s: v.dw,                                 // predicted remaining access from orbit propagation
        band_fit: Object.fromEntries(LAYER_BANDS[sv.layer].map(b => [b, bandSuit(pc, b, v.bth)])),
      };
    }),
  };
}

/** Observation for step k: every active target and its candidate SVs (knocked-out SVs excluded). */
export function observation(k: number) {
  const t = k * DT, targets: ReturnType<typeof targetObs>[] = [];
  sim.sites.forEach((s, j) => { const r = sim.siteRec[j][k]; if (r) targets.push(targetObs(s.name, 'site', r, [s.lat, s.lon, 0])); });
  sim.threats.forEach((th, j) => {
    const r = sim.thrRec[j][k], st = threatState(th, t);
    if (r && st) targets.push(targetObs(th.id, 'threat', r, toLL(st.p)));
  });
  return { t, step: k, targets, outages: sim.outages.filter(o => isOut(o.s, t)).map(o => sim.sats[o.s].id) };
}

/** Whole scenario for offline runs: python -m cs2c_bridge.batch observations.json -o picks.json */
export function exportObservations() {
  return {
    type: 'cs2c-observations', version: PROTOCOL_VERSION, scenario: scenarioMessage(),
    steps: Array.from({ length: sim.nstep }, (_, k) => observation(k)).filter(o => o.targets.length),
  };
}
