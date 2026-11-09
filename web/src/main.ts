// CS2C Custody Visualizer: entry point. Wires controls, rebuilds scenarios and runs the animation loop.
import './style.css';
import { precompute } from './access';
import { drawChart, drawStrips } from './chart';
import { qLook, qNorthUp, setDist } from './camera';
import { ARCH, GROUP_LABEL, REGIONS } from './config';
import { $ } from './dom';
import { fireEvents } from './events';
import { initInput, isDragging } from './input';
import { initLive, scenarioChanged, tick } from './live';
import { exportObservations } from './observations';
import { buildSats } from './orbits';
import { lowerResolution, markStaticDirty, render, resize, stepAt } from './render';
import { MODEL, S, sim } from './state';
import { applySource, knockOut, parseSelections, recomputeSelection } from './tasking';
import { onThemeChange, readTokens } from './theme';
import { buildThreats } from './threats';
import type { Focus, Group, Source } from './types';
import { buildLists, forceUI, refreshSummary, setSource, updateArchPanel, updateUI } from './ui';

/* ---------- scenario rebuild ---------- */
function setFocus(f: NonNullable<Focus>): void {
  S.focus = f; S.autoFocus = false; S.follow = true; $('#follow').setAttribute('aria-pressed', 'true'); forceUI();
}
let rebuildTimer = 0;
function queueRebuild(keepTime: boolean): void {
  $('#bigN').textContent = '…'; $('#bigS').textContent = 'computing access…';
  clearTimeout(rebuildTimer); rebuildTimer = window.setTimeout(() => rebuild(keepTime), 20);
}
function rebuild(keepTime: boolean): void {
  buildSats(); buildThreats(); precompute(); buildLists(setFocus); updateArchPanel();
  if (!keepTime) S.t = 0;
  S.t = Math.min(S.t, sim.dur);
  if (!keepTime) {
    S.focus = { kind: 'site', i: 0 }; S.autoFocus = true; S.follow = true; $('#follow').setAttribute('aria-pressed', 'true');
    const c = REGIONS[S.region].center, q = qLook(c[0], c[1]);
    if (!S.cam.inited) { S.cam.q = q; S.cam.inited = true; } else S.cam.qTarget = q;
    S.cam.vel = null;
  }
  refreshSummary();
  scenarioChanged();
}
function afterOutageChange(): void { recomputeSelection(); refreshSummary(); forceUI(); scenarioChanged(); }

/* ---------- controls ---------- */
function seg<K extends 'salvo' | 'mix' | 'arch'>(el: HTMLElement, opts: [string | number, string][], key: K, onchange: () => void): void {
  el.innerHTML = opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${S[key] == v}">${l}</button>`).join('');
  el.onclick = e => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b) return;
    const raw = b.dataset.v!; (S as Record<K, unknown>)[key] = isNaN(+raw) ? raw : +raw;
    [...el.children].forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    onchange();
  };
}
const setPP = () => { $('#pp').textContent = S.playing ? '⏸' : '▶'; $('#pp').setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); };
const togglePlay = () => { if (!S.playing && S.t >= sim.dur) S.t = 0; S.playing = !S.playing; setPP(); };
let scrubbing = false;

$('#regions').innerHTML = Object.entries(REGIONS).map(([k, r]) => `<button class="region" data-v="${k}" aria-pressed="${S.region === k}"><b>${r.name}</b><span>${r.sites.length} sites · ${r.targets.length} aimpoints</span></button>`).join('');
$('#regions').onclick = e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b) return;
  S.region = b.dataset.v!; [...$('#regions').children].forEach(c => c.setAttribute('aria-pressed', String(c === b))); queueRebuild(false);
};
seg($('#salvo'), [[1, '1'], [5, '5'], [10, '10'], [20, '20']], 'salvo', () => queueRebuild(false));
seg($('#mix'), [['bal', 'Ballistic'], ['hgv', 'HGV'], ['mixed', 'Mixed']], 'mix', () => queueRebuild(false));
seg($('#arch-seg'), Object.entries(ARCH).map(([k, a]) => [k, `${a.label} <small style="opacity:.6">${a.year}</small>`]), 'arch', () => queueRebuild(true));
const groups = Object.keys(S.layers) as Group[];
$('#layers').innerHTML = groups.map(l => `<label><input type="checkbox" id="ly-${l}" checked> ${GROUP_LABEL[l]} <small></small></label>`).join('');
groups.forEach(l => { $<HTMLInputElement>('#ly-' + l).onchange = e => { S.layers[l] = (e.target as HTMLInputElement).checked; queueRebuild(true); }; });
$<HTMLInputElement>('#rings').onchange = e => { S.rings = (e.target as HTMLInputElement).checked; };
$<HTMLInputElement>('#alllos').onchange = e => { S.allLos = (e.target as HTMLInputElement).checked; };
$('#pp').onclick = togglePlay;
$('#restart').onclick = () => { S.t = 0; S.autoFocus = true; S.focus = { kind: 'site', i: 0 }; forceUI(); };
$('#loopb').onclick = () => { S.loop = !S.loop; $('#loopb').setAttribute('aria-pressed', String(S.loop)); $('#loopb').style.opacity = S.loop ? '1' : '0.4'; };
const SPEEDS = [10, 30, 60, 120];
$('#spd').onclick = () => { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; $('#spd').textContent = '×' + S.speed; };
$('#scrub').addEventListener('pointerdown', () => { scrubbing = true; });
window.addEventListener('pointerup', () => { scrubbing = false; });
$<HTMLInputElement>('#scrub').oninput = e => { S.t = +(e.target as HTMLInputElement).value / 1000 * sim.dur; forceUI(); };
$<HTMLInputElement>('#scrub').onchange = () => { scrubbing = false; };
$('#follow').onclick = () => { S.follow = !S.follow; $('#follow').setAttribute('aria-pressed', String(S.follow)); };
$('#zin').onclick = () => setDist(S.cam.d / 1.3);
$('#zout').onclick = () => setDist(S.cam.d * 1.3);
$('#north').onclick = () => { S.cam.vel = null; S.cam.qTarget = qNorthUp(); };
$('#pivot').onclick = e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b) return;
  S.cam.pivot = b.dataset.v as 'earth' | 'focus'; [...$('#pivot').children].forEach(c => c.setAttribute('aria-pressed', String(c === b)));
  S.cam.vel = null; S.cam.qTarget = null; S.follow = true; $('#follow').setAttribute('aria-pressed', 'true');
  if (S.cam.pivot === 'focus') S.cam.d = Math.min(S.cam.d, 14000); else setDist(Math.max(S.cam.d, 60000));
};
$('#focus').addEventListener('click', e => {
  const b = (e.target as Element).closest<HTMLElement>('[data-kill]');
  if (b && knockOut(+b.dataset.kill!)) { sim.pulses.push({ kind: 'out', s: +b.dataset.kill!, start: performance.now() }); refreshSummary(); forceUI(); scenarioChanged(); }
});
$('#feed').addEventListener('click', e => { const it = (e.target as Element).closest<HTMLElement>('[data-j]'); if (it) setFocus({ kind: 'threat', i: +it.dataset.j! }); });
$('#clearOut').onclick = () => { sim.outages = []; afterOutageChange(); };
(['foldSites', 'foldThreats'] as const).forEach(id => {
  const el = $<HTMLDetailsElement>('#' + id);
  try { const v = localStorage.getItem('cs2c-' + id); if (v !== null) el.open = v === '1'; } catch { /* storage unavailable */ }
  el.addEventListener('toggle', () => { try { localStorage.setItem('cs2c-' + id, el.open ? '1' : '0'); } catch { /* ignore */ } forceUI(); drawStrips(); });
});
$('#srcSeg').onclick = e => { const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (b) { setSource(b.dataset.v as Source); tick(true); } };

/* ---------- CS2C picks: file, JS API, live link, observation export ---------- */
function loadPicks(obj: unknown, name: string): void { MODEL.file = parseSelections(obj, name); setSource('file'); }
$<HTMLInputElement>('#modelFile').onchange = e => {
  const input = e.target as HTMLInputElement, f = input.files && input.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { loadPicks(JSON.parse(String(rd.result)), f.name); }
    catch (err) { $('#fileStatus').innerHTML = `<span style="color:var(--bad)">Couldn't read ${f.name.replace(/</g, '&lt;')}: ${(err as Error).message}</span>`; }
  };
  rd.readAsText(f); input.value = '';
};
$('#copySchema').onclick = () => {
  const txt = $('#schema').textContent || '';
  const ok = () => { $('#copySchema').textContent = 'Copied'; setTimeout(() => { $('#copySchema').textContent = 'Copy example'; }, 1500); };
  const fallback = () => { const r = document.createRange(); r.selectNodeContents($('#schema')); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); };
  try { navigator.clipboard.writeText(txt).then(ok, fallback); } catch { fallback(); }
};
$('#exportObs').onclick = () => {
  const blob = new Blob([JSON.stringify(exportObservations())], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cs2c-observations-${S.region}-${S.salvo}-${S.mix}-${S.arch}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('#exportNote').textContent = 'If nothing downloaded, this viewer blocks downloads; use the GitHub Pages site.';
};
let applyQueued = false;
initLive(() => { if (applyQueued) return; applyQueued = true; requestAnimationFrame(() => { applyQueued = false; applySource(); refreshSummary(); forceUI(); }); });
$('#liveBtn').addEventListener('click', () => { if (MODEL.src !== 'file') setSource('file'); });

// Integration hooks (also used by tests)
declare global { interface Window { CS2C: { load(obj: unknown): void; clear(): void }; __S: typeof S; __events: () => typeof sim.events } }
window.CS2C = { load: obj => loadPicks(obj, 'CS2C (API)'), clear: () => { MODEL.file = null; setSource('sim'); } };
window.__S = S;
window.__events = () => sim.events;

/* ---------- theme, resize, loop ---------- */
const retheme = () => { readTokens(); markStaticDirty(); drawChart(); drawStrips(); };
onThemeChange(retheme);
window.addEventListener('resize', () => { resize(); drawChart(); });
let last = performance.now(), perfAcc = 0, perfN = 0, lastStep = -1;
document.addEventListener('visibilitychange', () => { last = performance.now(); });
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const tPrev = S.t;
  if (S.playing) {
    S.t += dt * S.speed;
    if (S.t >= sim.dur) {
      if (S.loop) { S.t = 0; S.autoFocus = true; S.focus = { kind: 'site', i: 0 }; forceUI(); }
      else { S.t = sim.dur; S.playing = false; setPP(); }
    }
  }
  fireEvents(tPrev, S.t);
  // drop canvas resolution if this machine can't keep up
  perfAcc += dt; perfN++;
  if (perfAcc > 1.5) { if (perfAcc / perfN > 0.045) lowerResolution(); perfAcc = 0; perfN = 0; }
  requestAnimationFrame(loop);
  try {
    const k = stepAt(S.t);
    if (k !== lastStep) { lastStep = k; tick(); }
    render(S.t, k, isDragging());
    updateUI(k, scrubbing);
  } catch (err) { console.error(err); }
}

setSource('sim');
initInput(setFocus, togglePlay);
resize(); rebuild(false); retheme(); setPP();
requestAnimationFrame(loop);
