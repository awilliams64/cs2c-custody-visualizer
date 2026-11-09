// Application state (user controls + camera) and simulation state (rebuilt per scenario).
import { D2R } from './constants';
import type { Focus, Group, ModelFeed, Outage, Pulse, Quat, Sat, SimEvent, Site, Source, StepStat, Summary, Threat, Track, Vec3 } from './types';

export const S = {
  region: 'nk', salvo: 10, mix: 'mixed', arch: 't2',
  layers: { LEO: true, MEO: true, GEO: true, HEO: true } as Record<Group, boolean>,
  rings: true, allLos: false, loop: true, errant: true,
  t: 0, playing: !matchMedia('(prefers-reduced-motion: reduce)').matches, speed: 30,
  focus: { kind: 'site', i: 0 } as Focus, autoFocus: true, follow: true,
  cam: {
    q: [1, 0, 0, 0] as Quat, d: 60000, pivot: 'earth' as 'earth' | 'focus', T: [0, 0, 0] as Vec3, fov: 18 * D2R,
    vel: null as { axis: Vec3; ang: number } | null, qTarget: null as Quat | null, inited: false,
  },
};

export const sim = {
  sats: [] as Sat[], threats: [] as Threat[], sites: [] as Site[],
  dur: 0, nstep: 0,
  siteRec: [] as Track[], thrRec: [] as Track[],
  stats: [] as (StepStat | null)[],
  summary: { stereo: 0, avgV: 0, agree: 1, tasked: 0, slots: 0, fit: 0, fit0: 0, gapThreats: 0, longest: 0, maxV: 1, deprioritized: 0, svMinFreed: 0, valueStereo: 0 } as Summary,
  stepTask: [] as ({ svs: number; picks: number } | undefined)[],
  events: [] as SimEvent[], outages: [] as Outage[], pulses: [] as Pulse[],
};

/** Where custody picks come from. 'file' covers a loaded file, the JS API and the live Python link. */
export const MODEL = { src: 'sim' as Source, file: null as ModelFeed | null };
