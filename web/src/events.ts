// Event-driven retasking feed: launches, phase changes, maneuvers, custody changes and every retask with its cause.
import { DT } from './constants';
import { S, sim } from './state';
import { isOut } from './tasking';
import { hgvLatRate } from './threats';
import type { Band, Phase, StepRec } from './types';

const PHASE_EVT: Partial<Record<Phase, string>> = {
  mid: 'Burnout · RV in midcourse', reentry: 'Re-entry heating begins', glide: 'Pull-up · glide phase', terminal: 'Terminal dive',
};

type Snap = Pick<StepRec, 'best' | 'partner' | 'bandP' | 'bandQ' | 'phase' | 'status'>;
const snap = (r: StepRec): Snap => ({ best: r.best, partner: r.partner, bandP: r.bandP, bandQ: r.bandQ, phase: r.phase, status: r.status });

export function buildEvents(): void {
  const events = sim.events = [] as typeof sim.events;
  const id = (x: number) => x >= 0 ? sim.sats[x].id : '—';
  const bandTxt = (b: Band | null) => b ? ` ${b}` : '';
  sim.threats.forEach((th, j) => {
    let prev: Snap | null = null, lastMan = -1e9;
    sim.thrRec[j].forEach((r, k) => {
      const t = k * DT;
      if (!r) { if (prev) { events.push({ t, j, kind: 'impact', text: `Impact near ${th.target}` }); prev = null; } return; }
      const tasking = () => r.best >= 0 ? `${id(r.best)}${bandTxt(r.bandP)}${r.partner >= 0 ? ` + ${id(r.partner)}${bandTxt(r.bandQ)}` : ' (mono)'}` : 'no SV available';
      if (!prev) {
        events.push({ t, j, kind: 'launch', text: `Launch detected from ${th.siteName} · ${r.vis.length} SVs in view` });
        events.push({ t: t + 0.1, j, kind: 'task', sv: r.best, text: `CS2C tasks ${tasking()}` });
        prev = snap(r); return;
      }
      let cause: string | null = null;
      const phaseText = PHASE_EVT[r.phase];
      if (r.phase !== prev.phase && phaseText) { events.push({ t, j, kind: 'phase', text: phaseText }); cause = 'phase change'; }
      const lr0 = hgvLatRate(th, t - DT), lr1 = hgvLatRate(th, t);
      if (lr0 && lr1 && Math.sign(lr0) !== Math.sign(lr1) && t - lastMan > 60) { events.push({ t, j, kind: 'maneuver', text: 'Cross-range maneuver detected' }); lastMan = t; }
      // a swap of primary and partner roles is not a retask
      const setNow = [r.best, r.partner].sort().join(), setPrev = [prev.best, prev.partner].sort().join();
      const bandsNow = [r.best + ':' + r.bandP, r.partner + ':' + r.bandQ].sort().join(), bandsPrev = [prev.best + ':' + prev.bandP, prev.partner + ':' + prev.bandQ].sort().join();
      if (setNow !== setPrev || bandsNow !== bandsPrev) {
        const p = prev;
        const outHit = [p.best, p.partner].find(s => s >= 0 && isOut(s, t) && !isOut(s, t - DT));
        const left = [p.best, p.partner].find(s => s >= 0 && !r.vis.some(v => v.s === s) && !isOut(s, t));
        const why = outHit !== undefined ? `${id(outHit)} outage` : left !== undefined ? `${id(left)} leaving view` : cause ? cause
          : t - lastMan <= 40 ? 're-acquire after maneuver'
            : r.best === p.best && r.partner === p.partner ? 'better band fit'
              : r.status === 2 && p.status !== 2 ? 'stereo pair available' : 'better geometry';
        events.push({ t, j, kind: outHit !== undefined ? 'retask-out' : 'retask', sv: r.best, text: `Retask → ${tasking()} · ${why}` });
      }
      if (r.status === 0 && prev.status !== 0) events.push({ t, j, kind: 'gap', text: 'Custody lost · no SV can see it' });
      if (r.status !== 0 && prev.status === 0) events.push({ t, j, kind: 'regain', text: 'Custody regained' });
      prev = snap(r);
    });
  });
  events.sort((a, b) => a.t - b.t);
}

/** Queue globe pulses for events crossed during forward playback (focused threat and launches only). */
export function fireEvents(t0: number, t1: number): void {
  if (t1 < t0 || t1 - t0 > DT * 3) return; // not on big scrubs
  const fj = S.focus && S.focus.kind === 'threat' ? S.focus.i : -1;
  const now = performance.now();
  sim.events.forEach(e => {
    if (e.t > t0 && e.t <= t1 && (e.j === fj || e.kind === 'launch')) {
      if (e.sv !== undefined && e.sv >= 0 && (e.kind === 'task' || e.kind.startsWith('retask'))) sim.pulses.push({ kind: 'sv', s: e.sv, start: now });
      sim.pulses.push({ kind: e.kind, j: e.j, start: now });
    }
  });
}
