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
import { MANEUVERS, PROFILE_LABEL, REGION_SYS, SYS } from './systems';
import { esc } from './format';
import { DOC_TYPES, MDA, OUTCOMES, initDefenseInput, placeAt } from './mda';
import { buildEvents } from './events';
import { globeCanvas } from './render';
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
  S.region = b.dataset.v!; [...$('#regions').children].forEach(c => c.setAttribute('aria-pressed', String(c === b)));
  if (!REGION_SYS[S.region].includes(S.sys)) S.sys = 'generic';
  sysUI(); queueRebuild(false);
};
/* threat system and maneuver */
function sysUI(): void {
  $('#sysSel').innerHTML = `<option value="generic">Generic glide vehicle</option>` + REGION_SYS[S.region].map(k => `<option value="${k}">${esc(SYS[k].name)} · ${esc(SYS[k].platform)}</option>`).join('');
  $<HTMLSelectElement>('#sysSel').value = S.sys;
  const sys = S.sys !== 'generic' ? SYS[S.sys] : null;
  $('#manWrap').hidden = !sys; $('#sysCard').hidden = !sys;
  if (sys) {
    $('#manSel').innerHTML = `<option value="auto">System default · ${esc(MANEUVERS[sys.m.man])}</option>` + Object.entries(MANEUVERS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $<HTMLSelectElement>('#manSel').value = S.man;
    const rows: [string, string][] = [['Designation', sys.desig], ['Country', sys.country], ['Status', sys.ready], ['Platform', sys.platform], ['Profile', PROFILE_LABEL[sys.m.profile]],
      ['Altitude', sys.alt], ['Speed', sys.speed], ['Range', sys.range], ['Glide', sys.glide], ['Tested', sys.tested], ['Maneuver', sys.maneuver]];
    $('#sysBody').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('') + (sys.src ? `<dt>Source</dt><dd><a href="${esc(sys.src)}" target="_blank" rel="noopener">link ↗</a></dd>` : '');
  }
  $('#sysHint').innerHTML = sys && S.mix === 'bal' ? 'Pick <b>HGV</b> or <b>Mixed</b> to fly this system.' : sys ? `HGV threats fly the ${esc(sys.name)} profile (${PROFILE_LABEL[sys.m.profile]}).` : '';
}
$<HTMLSelectElement>('#sysSel').onchange = e => { S.sys = (e.target as HTMLSelectElement).value; S.man = 'auto'; sysUI(); queueRebuild(false); };
$<HTMLSelectElement>('#manSel').onchange = e => { S.man = (e.target as HTMLSelectElement).value; queueRebuild(false); };
seg($('#salvo'), [[1, '1'], [5, '5'], [10, '10'], [20, '20']], 'salvo', () => queueRebuild(false));
seg($('#mix'), [['bal', 'Ballistic'], ['hgv', 'HGV'], ['mixed', 'Mixed']], 'mix', () => { sysUI(); queueRebuild(false); });
$<HTMLInputElement>('#errant').onchange = e => { S.errant = (e.target as HTMLInputElement).checked; queueRebuild(false); };
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

/* ---------- missile defense ---------- */
function replanDefense(): void { buildEvents(); refreshSummary(); forceUI(); }
$<HTMLInputElement>('#mdaEngage').onchange = e => { MDA.engage = (e.target as HTMLInputElement).checked; replanDefense(); };
$('#mdaOut').innerHTML = Object.entries(OUTCOMES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
$<HTMLSelectElement>('#mdaOut').value = MDA.outcome;
$<HTMLSelectElement>('#mdaOut').onchange = e => { MDA.outcome = (e.target as HTMLSelectElement).value as typeof MDA.outcome; $('#mdaPkRow').hidden = MDA.outcome !== 'pk'; replanDefense(); };
$<HTMLInputElement>('#mdaPk').onchange = e => { const v = +(e.target as HTMLInputElement).value; if (v > 0 && v < 1) { MDA.pk = v; replanDefense(); } };
$('#mdaReroll').onclick = () => { MDA.seed++; replanDefense(); };
$('#mdaDoc').innerHTML = Object.entries(DOC_TYPES).map(([k, l]) => `<span>${l}</span><div class="seg" data-doc="${k}"><button data-v="SLS" aria-pressed="true" title="Shoot-look-shoot: one round, assess, then re-engage">S-L-S</button><button data-v="SSL" aria-pressed="false" title="Shoot-shoot-look: ripple two rounds, then assess">S-S-L</button></div>`).join('');
$('#mdaDoc').onclick = e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button'), sg = b && b.closest<HTMLElement>('[data-doc]'); if (!b || !sg) return;
  MDA.doctrine[sg.dataset.doc as keyof typeof DOC_TYPES] = b.dataset.v as 'SLS' | 'SSL';
  [...sg.children].forEach(c => c.setAttribute('aria-pressed', String(c === b))); replanDefense();
};
const CHIPS: [string, string, string][] = [['gmd', 'GMD', 'gbi'], ['ships', 'Aegis ships', 'sm3'], ['ashore', 'Aegis Ashore', 'sm3'], ['thaad', 'THAAD', 'thaad'], ['pac3', 'PAC-3', 'pac3'],
  ['gpi', 'GPI (future)', 'gpi'], ['radars', 'Radars', 'radar'], ['c2', 'C2BMC', 'c2'], ['rings', 'Coverage rings', 'radar'], ['ports', 'Homeports', 'sm3']];
$('#mdaOn').innerHTML = CHIPS.map(([k, l, c]) => `<button data-k="${k}" aria-pressed="${MDA.on[k]}"><i style="background:var(--mda-${c})"></i>${l}</button>`).join('');
$('#mdaOn').onclick = e => {
  const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b) return;
  const k = b.dataset.k!; MDA.on[k] = !MDA.on[k]; b.setAttribute('aria-pressed', String(MDA.on[k]));
  if (k !== 'rings' && k !== 'ports') replanDefense();
};
$('#mdaFans').onclick = e => { const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b) return; MDA.fans = b.dataset.v as typeof MDA.fans; [...$('#mdaFans').children].forEach(c => c.setAttribute('aria-pressed', String(c === b))); };
$('#mdaFanEl').onclick = e => { const b = (e.target as Element).closest<HTMLButtonElement>('button'); if (!b) return; MDA.fanEl = +b.dataset.v!; [...$('#mdaFanEl').children].forEach(c => c.setAttribute('aria-pressed', String(c === b))); };
$('#mdaPlace').onclick = () => { MDA.placing = !MDA.placing; document.body.classList.toggle('placing', MDA.placing); $('#mdaPlace').setAttribute('aria-pressed', String(MDA.placing)); };
$('#mdaClear').onclick = () => { MDA.userShips = []; replanDefense(); };
$('#mdaTable').addEventListener('click', e => { const tr = (e.target as Element).closest<HTMLElement>('[data-j]'); if (tr) setFocus({ kind: 'threat', i: +tr.dataset.j! }); });
initDefenseInput(globeCanvas, replanDefense);
$<HTMLInputElement>('#sun').onchange = e => { S.sun = (e.target as HTMLInputElement).checked; };
/* light / dark: follows the system until the user picks one */
const applyTheme = (v: string | null) => { if (v) document.documentElement.setAttribute('data-theme', v); else document.documentElement.removeAttribute('data-theme'); };
try { applyTheme(localStorage.getItem('cs2c-theme')); } catch { /* storage unavailable */ }
$('#theme').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark'; applyTheme(next);
  try { localStorage.setItem('cs2c-theme', next); } catch { /* ignore */ }
};

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

sysUI();
setSource('sim');
initInput(setFocus, togglePlay, p => { if (!placeAt(p)) return false; replanDefense(); return true; });
resize(); rebuild(false); retheme(); setPP();
requestAnimationFrame(loop);
