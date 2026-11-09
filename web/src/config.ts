// Scenario and sensor configuration. Locations are public; aimpoints, ranges, bands and fields of view are notional.
import type { Band, Group, Layer, Phase, PhaseClass } from './types';

export type Place = [name: string, lat: number, lon: number];
export interface Region { name: string; center: [number, number]; sites: Place[]; targets: Place[] }

export const REGIONS: Record<string, Region> = {
  nk: { name: 'North Korea', center: [40, 140],
    sites: [['Sohae', 39.66, 124.70], ['Sinpo', 40.03, 128.18], ['Sunan', 39.20, 125.67], ['Kusong', 39.98, 125.24]],
    targets: [['Guam', 13.44, 144.79], ['Honolulu', 21.31, -157.86], ['Anchorage', 61.22, -149.90], ['Seattle', 47.61, -122.33], ['Los Angeles', 34.05, -118.24]] },
  ir: { name: 'Iran', center: [38, 40],
    sites: [['Semnan', 35.23, 53.92], ['Shahroud', 36.20, 55.33], ['Tabriz', 38.08, 46.29], ['Khorramabad', 33.49, 48.36]],
    targets: [['Rome', 41.90, 12.50], ['Berlin', 52.52, 13.40], ['Diego Garcia', -7.31, 72.41], ['London', 51.50, -0.12], ['Washington', 38.90, -77.04]] },
  cn: { name: 'China', center: [42, 150],
    sites: [['Jiuquan', 40.96, 100.29], ['Taiyuan', 38.85, 111.61], ['Delingha', 37.37, 97.37], ['Korla', 41.73, 86.17]],
    targets: [['Guam', 13.44, 144.79], ['Honolulu', 21.31, -157.86], ['Seattle', 47.61, -122.33], ['Washington', 38.90, -77.04], ['Anchorage', 61.22, -149.90]] },
  ru: { name: 'Russia', center: [65, -30],
    sites: [['Plesetsk', 62.93, 40.58], ['Kapustin Yar', 48.58, 45.82], ['Dombarovsky', 51.09, 59.84], ['Uzhur', 55.31, 89.83]],
    targets: [['Washington', 38.90, -77.04], ['New York', 40.71, -74.00], ['Chicago', 41.88, -87.63], ['Seattle', 47.61, -122.33], ['London', 51.50, -0.12]] },
};

/** Notional slant-range limits (km) by layer and phase. Infinity = line of sight only; 0 = cannot detect. */
export const RANGE: Record<Layer, Record<PhaseClass, number>> = {
  LEO: { boost: 4500, mid: 3500, reentry: 3500, glide: 2200 },
  FC: { boost: 4500, mid: 4000, reentry: 4000, glide: 3500 },
  MEO: { boost: 16000, mid: 11000, reentry: 11000, glide: 0 },
  GEO: { boost: Infinity, mid: 0, reentry: 0, glide: 0 },
  HEO: { boost: Infinity, mid: 0, reentry: 0, glide: 0 },
};
export const LAYER_NAME: Record<Layer, string> = { LEO: 'LEO WFOV', FC: 'LEO fire-control', MEO: 'MEO', GEO: 'GEO', HEO: 'Polar' };
export const LAYER_SHORT: Record<Layer, string> = { LEO: 'WFOV', FC: 'FC', MEO: 'MEO', GEO: 'GEO', HEO: 'Polar' };
export const GROUP_LABEL: Record<Group, string> = { LEO: 'SDA Tracking Layer · LEO', MEO: 'Resilient MW/MT · MEO', GEO: 'OPIR · GEO', HEO: 'Next-Gen OPIR · Polar' };

/** Walker shell: prefix, planes, SVs per plane, RAAN offset (fraction of spacing), fire-control rule. */
export type LeoShell = [pre: string, planes: number, perPlane: number, raanOff: number, isFC: (plane: number, slot: number) => boolean];
export type MeoShell = [pre: string, planes: number, perPlane: number, raanOff: number];
export interface Arch { label: string; year: string; leo: LeoShell[]; meo: MeoShell[]; note: string }

// PWSA build-outs. Counts are public; plane splits for T2/T3, inclination and MEO altitude are assumptions.
const T1: LeoShell = ['T1', 5, 7, 0, () => false];
const T2: LeoShell = ['T2', 6, 9, 0.5, (_j, k) => k === 0];
const T3: LeoShell = ['T3', 8, 9, 0.25, (j) => j % 2 === 0];
export const ARCH: Record<string, Arch> = {
  t1: { label: 'T1', year: '~2027', leo: [T1], meo: [['E1', 2, 6, 0]],
    note: '<b>Tranche 1</b>: 35 LEO tracking SVs in 5 planes, with <b>MEO Epoch 1</b> (12 SVs, 2 planes), GEO and polar. Near-global mono coverage, stereo where MEO overlaps.' },
  t2: { label: 'T1+T2', year: '~2029', leo: [T1, T2], meo: [['E1', 2, 6, 0], ['E2', 2, 5, 0.5]],
    note: '<b>Tranches 1 + 2</b>: 89 LEO SVs, 6 of them fire-control; <b>MEO Epochs 1 + 2</b>: 22 SVs. The fact sheet goal is near-global stereo custody with preliminary fire control.' },
  t3: { label: 'T1–T3', year: 'FY29+', leo: [T1, T2, T3], meo: [['E1', 2, 6, 0], ['E2', 2, 5, 0.5]],
    note: '<b>Tranches 1–3</b>: 161 LEO SVs, 42 of them fire-control (T3 is about half missile-defense payloads); MEO Epochs 1 + 2.' },
};

/** Open-ocean impact point for the errant RV in each region (notional). */
export const OCEAN_IMPACT: Record<string, Place> = {
  nk: ['Northwest Pacific', 35.0, 150.0],
  ir: ['Arabian Sea', 17.0, 63.0],
  cn: ['Philippine Sea', 28.0, 137.0],
  ru: ['North Atlantic', 52.0, -35.0],
};
/** A threat is High priority if its impact uncertainty comes within this distance of a defended area (km). */
export const DEFENDED_RADIUS_KM = 300;
/** Below High and within this extra margin it is Medium; beyond it, Low (km). */
export const MEDIUM_MARGIN_KM = 500;

export const BANDS: Band[] = ['SWIR', 'MWIR', 'LWIR'];
/** Sensor field of view, half-angle in degrees (notional). WFOV LEO sees the whole Earth disk; fire-control is narrow. */
export const FOV_HALF: Record<Layer, number> = { LEO: 62, FC: 8, MEO: 26, GEO: 9, HEO: 10 };
/** Bands each layer can collect in; the first is its default. */
export const LAYER_BANDS: Record<Layer, Band[]> = { LEO: ['SWIR', 'MWIR'], FC: ['MWIR', 'LWIR'], MEO: ['SWIR', 'MWIR'], GEO: ['SWIR', 'MWIR'], HEO: ['SWIR', 'MWIR'] };

/** Band suitability 0..1 by flight phase and background (bth = target seen against Earth, else against space). */
export function bandSuit(pc: PhaseClass, band: Band, bth: boolean): number {
  if (pc === 'boost') return { SWIR: 1, MWIR: 0.9, LWIR: 0.3 }[band];
  if (pc === 'reentry') return { SWIR: 0.8, MWIR: 1, LWIR: 0.5 }[band];
  if (pc === 'mid') return (bth ? { SWIR: 0.15, MWIR: 0.45, LWIR: 0.45 } : { SWIR: 0.25, MWIR: 0.55, LWIR: 1 })[band];
  return (bth ? { SWIR: 0.5, MWIR: 0.9, LWIR: 0.4 } : { SWIR: 0.55, MWIR: 1, LWIR: 0.75 })[band]; // glide / terminal
}

export const PHASE_LABEL: Record<Phase, string> = { boost: 'Boost', mid: 'Midcourse', reentry: 'Re-entry', glide: 'Glide', terminal: 'Terminal glide', watch: 'Launch watch' };
export const phaseClass = (ph: Phase): PhaseClass => ph === 'terminal' ? 'glide' : ph === 'watch' ? 'boost' : ph;
