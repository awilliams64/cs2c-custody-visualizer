// Shared types for the CS2C Custody Visualizer.

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/** Sensor layer. FC = LEO fire-control (narrow field of view) payload. */
export type Layer = 'LEO' | 'FC' | 'MEO' | 'GEO' | 'HEO';
/** Constellation group used for the layer toggles. */
export type Group = 'LEO' | 'MEO' | 'GEO' | 'HEO';
export type Band = 'SWIR' | 'MWIR' | 'LWIR';
export type Phase = 'boost' | 'mid' | 'reentry' | 'glide' | 'terminal' | 'watch';
export type PhaseClass = 'boost' | 'mid' | 'reentry' | 'glide';
export type Source = 'base' | 'sim' | 'file';
/** 0 = custody gap, 1 = mono (one SV), 2 = stereo (two SVs, >= 15 deg apart). */
export type Status = 0 | 1 | 2;

interface SatBase { id: string; group: Group; layer: Layer; idx: number; a: number }
export interface CircSat extends SatBase { kind: 'c'; n: number; ci: number; si: number; raan: number; m0: number; plane: number; ring: string }
export interface GeoSat extends SatBase { kind: 'g'; lon: number }
export interface EllSat extends SatBase { kind: 'e'; e: number; n: number; ci: number; si: number; raan: number; w: number; m0: number }
export type Sat = CircSat | GeoSat | EllSat;

export interface Site { name: string; lat: number; lon: number; p: Vec3 }

export interface Threat {
  id: string; type: 'B' | 'H'; site: number; siteName: string; target: string;
  a: Vec3; b: Vec3; Om: number; D: number; n: Vec3;
  tL: number; TOF: number; tb: number; tEnd: number;
  H: number; A: number; A2: number;
  path: Vec3[];
  /** Off-nominal RV that falls short into open ocean (true impact is the ocean point, not the aimpoint). */
  errant: boolean;
  /** True impact point name: the aimpoint, or the ocean area for an errant RV. */
  impactName: string;
}
export interface ThreatState { p: Vec3; h: number; phase: Phase }

/** One SV's access to one target at one time step. */
export interface Vis {
  s: number; R: number; se: number; lx: number; ly: number; lz: number; bth: boolean; rf: number;
  band0: Band; bs0: number; band: Band; bs: number;
  dw: number; qg: number; qd: number; q: number;
}

export interface WhyParts { geo: number; dwell: number; band: number; fc: number; cont: number; share: number }
export interface Why {
  p: WhyParts; q: WhyParts | null; th: number; score: number; second: number;
  alt: [number, number] | null; mono: boolean; held: boolean;
  /** Low-priority threat watched by a single (preferably shared) SV instead of a stereo pair. */
  monitor?: boolean;
}
export interface Baseline { best: number; partner: number; theta: number; status: Status; bestV: Vis | null; partnerV: Vis | null }

/** Everything known about one target at one time step. */
export type Priority = 'High' | 'Medium' | 'Low';
/** Predicted impact point (IPP) assessment for a threat at one step. */
export interface Assessment {
  priority: Priority; ippLat: number; ippLon: number; radiusKm: number;
  nearest: string; nearestKm: number; reliable: boolean;
  /** Track value V(q) in 0..1 = threat-type weight x impact-location weight (notional). */
  value: number; typeWeight: number; locWeight: number; typeClass: string; locClass: string;
}

export interface StepRec {
  vis: Vis[]; vis0: Vis[]; phase: Phase;
  /** Threat assessment (null for launch sites). */
  assess: Assessment | null;
  best: number; partner: number; bestV: Vis | null; partnerV: Vis | null; theta: number; status: Status;
  b: Baseline;
  sim: [number, number];
  why: Why | null;
  shareP: number[]; shareQ: number[];
  picked: 'base' | 'sim' | 'file' | 'none';
  pickInView: boolean; partnerInView: boolean; pickId: string | null; partnerId: string | null;
  bandP: Band | null; bandQ: Band | null; bandMode: 'fixed' | 'opt' | 'model';
  reason: string | null;
}
export type Track = (StepRec | null)[];

export interface StepStat { n: number; min: number; max: number; avg: number; c: [number, number, number] }
export interface Summary {
  stereo: number; avgV: number; agree: number; tasked: number; slots: number; fit: number; fit0: number;
  gapThreats: number; longest: number; maxV: number;
  /** Threats demoted to Low priority at some point, and SV-minutes freed versus a dedicated stereo pair. */
  deprioritized: number; svMinFreed: number;
  /** Stereo custody weighted by track value: sum(V * stereo) / sum(V) over threat-steps. */
  valueStereo: number;
}

export type EventKind = 'launch' | 'task' | 'phase' | 'maneuver' | 'priority' | 'retask' | 'retask-out' | 'gap' | 'regain' | 'impact';
export interface SimEvent { t: number; j: number; kind: EventKind; text: string; sv?: number }
export interface Outage { s: number; t: number }
export interface Pulse { kind: EventKind | 'sv' | 'out'; s?: number; j?: number; start: number }

/** One custody pick from CS2C (file, API or live stream). */
export interface PickEntry {
  t: number; primary: string | null; partner: string | null;
  primaryBand: Band | null; partnerBand: Band | null; reason: string | null;
}
export interface ModelFeed { name: string; byKey: Map<string, PickEntry[]>; n: number; bad: number }

export type Focus = { kind: 'site' | 'threat'; i: number } | null;
