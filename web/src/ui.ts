// Side panels: focus card with the "why" breakdown, event feed, site and threat lists, summary.
import { drawChart, drawChartCursor, drawStrips } from './chart';
import { ARCH, LAYER_NAME, LAYER_SHORT, PHASE_LABEL, phaseClass } from './config';
import { R2D } from './constants';
import { $ } from './dom';
import { esc, fmtDur, fmtN, fmtT } from './format';
import { focusRec } from './render';
import { MODEL, S, sim } from './state';
import { applySource, fileStatusText } from './tasking';
import { threatState } from './threats';
import type { Band, Focus, Source, StepRec, Threat, ThreatState, Vis } from './types';

const STATUS_TXT = ['Custody gap', 'Mono custody', 'Stereo custody'];
const SRC_TXT: Record<Source, string> = { base: 'the baseline rule', sim: 'the simulated feed', file: 'CS2C' };
const SRC_NOTE: Record<Source, string> = {
  base: 'Stand-in rule: highest geometry score, then the best stereo partner. This is the logic CS2C will replace.',
  sim: 'Simulated feed that picks the stereo pair jointly, favors fire-control SVs on glide targets and avoids handovers. A placeholder to exercise the display, <b>not CS2C output</b>.',
  file: 'Shows custody picks from CS2C: a loaded file, the JavaScript API, or the live Python link. A dashed ring marks the baseline pick wherever the two differ.',
};

let lastUI = 0, lastFocusHtml = '', lastFeedKey = '';
export const forceUI = () => { lastUI = 0; };

const isLow = (r: StepRec | null) => !!r && !!r.assess && r.assess.priority === 'Low';
const pill = (r: StepRec | null, th: Threat | null) => r
  ? (isLow(r) && r.status > 0 ? '<span class="pill sl">Monitor</span>' : `<span class="pill s${r.status}">${STATUS_TXT[r.status]}</span>`)
  : `<span class="pill sx">${th && S.t >= th.tEnd ? 'Impacted' : 'Pre-launch'}</span>`;
const prioHtml = (r: StepRec | null) => r && r.assess ? `<span class="prio p-${r.assess.priority}">V ${r.assess.value.toFixed(2)}</span>` : '';
/** Track value with its breakdown: V(q) = type weight x location weight. */
function valueHtml(r: StepRec): string {
  const a = r.assess!;
  return `<span class="prio p-${a.priority}">${a.value.toFixed(2)}</span> <span class="src-tag">${a.typeClass} ${a.typeWeight.toFixed(2)} × ${a.locClass} ${a.locWeight.toFixed(2)}</span>`;
}
/** Where a threat is going, as far as the assessment can tell: errant RVs read "IPP refining" until cleared. */
function dest(th: Threat, r: StepRec | null): string {
  if (!th.errant) return th.target;
  return isLow(r) || S.t >= th.tEnd ? `open ocean (${th.impactName})` : 'IPP refining';
}
const round = (km: number, to: number) => fmtN(Math.round(km / to) * to);
function ippText(th: Threat, r: StepRec): string {
  const a = r.assess!;
  if (!a.reliable) return th.type === 'H' && r.phase !== 'boost' ? 'maneuvering, IPP not reliable' : 'boosting, IPP not yet reliable';
  return `~${round(a.nearestKm, 100)} km from ${a.nearest} ±${round(a.radiusKm, 10)} km`;
}
const bandHtml = (b: Band | null) => b ? `<span class="band ${b}">${b}</span>` : '<span class="band none">—</span>';
function layerMix(vis: Vis[]): string {
  const c: Record<string, number> = {};
  vis.forEach(v => { const l = LAYER_SHORT[sim.sats[v.s].layer]; c[l] = (c[l] || 0) + 1; });
  return Object.keys(c).length ? `<span style="color:var(--muted)">(${Object.entries(c).map(([l, n]) => l + ' ' + n).join(', ')})</span>` : '';
}
const minutes = (dw: number, long: string, short: string) => dw >= 600 ? long : dw >= 60 ? `~${Math.round(dw / 60)} min` : short;

function rationale(r: StepRec, st: ThreatState | null): string {
  const w = r.why!, B = r.bestV; if (!B) return '';
  const pc = phaseClass(st ? st.phase : 'watch'), b = r.bandP, out: string[] = [];
  if (r.assess && !w.monitor) out.push(`track value ${r.assess.value.toFixed(2)} (${r.assess.typeClass} → ${r.assess.locClass === 'open ocean' ? 'open ocean' : r.assess.nearest})`);
  if (w.monitor && r.assess) {
    const a = r.assess;
    out.push(`deprioritized to value ${a.value.toFixed(2)}: predicted impact ${a.nearestKm > 1500 ? 'in open ocean, ' : ''}~${round(a.nearestKm, 100)} km from ${a.nearest}, clear of every defended area`);
    out.push(`watched by one SV${r.shareP.length ? ` already tasked for ${r.shareP.slice(0, 3).map(j => sim.threats[j].id).join(', ')}` : ''} in ${b}`);
    out.push('stereo pair released to higher-priority threats');
    return out.join(' · ');
  }
  out.push(pc === 'boost' ? `${b} on the boost plume` : pc === 'mid' ? (B.bth ? `${b} against an Earth background` : `${b} on a cold RV against space`)
    : pc === 'reentry' ? `${b} on re-entry heating` : `${b} on the glide body's heating` + (B.bth ? ' against Earth' : ' against space'));
  out.push(w.mono ? 'mono only: no partner gives 15°+ separation' : `${Math.round(w.th * R2D / 5) * 5}° stereo with ${sim.sats[r.partner].id}${r.bandQ ? ' (' + r.bandQ + ')' : ''}`);
  out.push(`${minutes(B.dw, '10+ min', 'under a minute')} of access left`);
  if (w.p.fc > 0) out.push('fire-control sensor for the glide target');
  if (r.shareP.length) out.push(`${sim.sats[r.best].id} also holds ${r.shareP.length > 3 ? r.shareP.length + ' other threats' : r.shareP.map(j => sim.threats[j].id).join(', ')} in the same field of view and band`);
  if (w.p.cont > 0) out.push(w.held ? 'held to avoid an unnecessary handover' : 'kept on track to avoid a handover');
  return out.join(' · ');
}
function shareTxt(r: StepRec): string {
  const ids = [...new Set([...r.shareP, ...r.shareQ])].map(j => sim.threats[j].id);
  return ids.length ? `also holds ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ' +' + (ids.length - 3) : ''}` : 'dedicated';
}
function whyHtml(r: StepRec, st: ThreatState | null): string {
  const w = r.why!;
  const rows: [string, number, number][] = [['Geometry', w.p.geo, 0.65], ['Dwell', w.p.dwell, 0.35], ['IR band fit', w.p.band, 0.3], ['Fire-control', w.p.fc, 0.1], ['Continuity', w.p.cont, 0.2], ['Shared FOV', w.p.share, 0.15]];
  const margin = w.score > 0 ? (w.score - w.second) / w.score : 0;
  // for a monitored (Low-priority) threat, confidence is about the assessment: how clearly the IPP misses every defended area
  const clear = r.assess ? (r.assess.nearestKm - r.assess.radiusKm - 300) / Math.max(1, r.assess.nearestKm) : 0;
  const conf = w.monitor ? (clear > 0.5 ? 'High' : clear > 0.2 ? 'Medium' : 'Low')
    : w.alt ? (margin > 0.15 ? 'High' : margin > 0.05 ? 'Medium' : margin >= 0 ? 'Low' : 'Medium') : 'High';
  const altName = w.alt ? `${sim.sats[w.alt[0]].id}${w.alt[1] >= 0 ? ' + ' + sim.sats[w.alt[1]].id : ''}` : '';
  const pct = (m: number) => Math.max(1, Math.round(m * 20) * 5);
  const altTxt = !w.alt ? 'no alternative in view' : margin >= 0 ? `${altName} scored ${pct(margin)}% lower` : `${altName} scores ${pct(-margin)}% higher, below the 20% needed to justify a handover`;
  return `<div class="why"><div class="why-h">${w.monitor ? 'Why CS2C deprioritized this' : 'Why CS2C chose this'} <span class="src-tag">simulated</span><span class="conf c-${conf}">${conf} confidence</span></div>
    <p class="why-text">${rationale(r, st)}</p>
    <div class="why-bars">${rows.map(([n, v, m]) => `<span>${n}</span><i><b style="width:${Math.round(Math.min(1, v / m) * 10) * 10}%"></b></i>`).join('')}
    ${w.mono ? '' : `<span>Stereo angle</span><i><b class="st" style="width:${Math.round(Math.sin(w.th) * 10) * 10}%"></b></i>`}</div>
    <p class="why-alt">Runner-up: ${altTxt}</p></div>`;
}

function focusHtml(k: number): string {
  const f = S.focus, r = focusRec(k);
  if (!f) return '<div class="empty">Select a launch site or threat on the globe.</div>';
  const isT = f.kind === 'threat', th = isT ? sim.threats[f.i] : null, site = isT ? null : sim.sites[f.i];
  const st = th ? threatState(th, S.t) : null;
  const chip = th ? `<span class="chip ${th.type}">${th.id}</span>` : '<span class="chip S">SITE</span>';
  const title = th ? `${th.type === 'B' ? 'Ballistic RV' : 'Hypersonic glide vehicle'}<small>${th.siteName} → ${dest(th, r)}${th.errant && !isLow(r) && S.t < th.tEnd ? '' : ` · ${fmtN(th.D)} km`}</small>`
    : `${site!.name}<small>Launch watch · ${site!.lat.toFixed(2)}°, ${site!.lon.toFixed(2)}°</small>`;
  let html = `<div class="fh">${chip}<div class="name">${title}</div>${pill(r, th)}</div>`;
  if (th && !st) return html + `<dl class="kv"><dt>Status</dt><dd>${S.t < th.tL ? `Launch at T+${fmtT(th.tL)}` : 'Impacted'}</dd></dl>`;
  if (!r) return html;
  const B = r.bestV, bs = r.best >= 0 ? sim.sats[r.best] : null, ps = r.partner >= 0 ? sim.sats[r.partner] : null;
  const pickTag = ({ base: 'baseline', sim: 'simulated', file: 'CS2C', none: 'baseline · no CS2C pick' } as const)[r.picked];
  html += `<dl class="kv">
    <dt>Phase</dt><dd>${PHASE_LABEL[st ? st.phase : 'watch']}${st ? ` · ${fmtN(st.h)} km alt` : ''}</dd>
    ${th && r.assess ? `<dt>Track value</dt><dd>${valueHtml(r)}</dd><dt>Predicted impact</dt><dd>${ippText(th, r)}</dd>` : ''}
    <dt>SVs in view</dt><dd><b>${r.vis.length}</b> ${layerMix(r.vis)}</dd>
    <dt>Custody pick <span class="src-tag">${pickTag}</span></dt><dd class="best"><b>${bs ? bs.id : esc(r.pickId || '—')}</b>${bs ? ` · ${LAYER_NAME[bs.layer]}` : ''} ${bandHtml(r.bandP)}${r.best !== -1 && !r.pickInView ? ' <span class="warn">not in view</span>' : ''}</dd>
    ${MODEL.src !== 'base' ? `<dt>Baseline pick</dt><dd>${r.b.best >= 0 ? (r.b.best === r.best ? '<span class="src-tag">same</span>' : `<b>${sim.sats[r.b.best].id}</b>`) : '—'}</dd>` : ''}
    <dt>Range · elevation</dt><dd>${B ? `${fmtN(Math.round(B.R / 100) * 100)} km · ${Math.round(Math.asin(Math.max(-1, Math.min(1, B.se))) * R2D / 5) * 5}°` : '—'}</dd>
    <dt>Remaining dwell</dt><dd>${B ? minutes(B.dw, '> 10 min', '< 1 min') : '—'}</dd>
    <dt>Stereo partner</dt><dd class="pair"><b>${ps ? ps.id : esc(r.partnerId || '—')}</b>${ps ? ` · ${LAYER_NAME[ps.layer]}` : ''} ${r.partner !== -1 || r.partnerId ? bandHtml(r.bandQ) : ''}${!r.partnerInView ? ' <span class="warn">not in view</span>' : ''}</dd>
    <dt>Background</dt><dd>${B ? (B.bth ? 'Earth' : 'Space') : '—'}</dd>
    <dt>Band tasking</dt><dd>${({ fixed: 'fixed default', opt: 'optimized', model: 'CS2C' } as const)[r.bandMode]}</dd>
    ${isT ? `<dt>Shared FOV</dt><dd>${r.picked === 'sim' ? shareTxt(r) : '—'}</dd>` : ''}
    <dt>Stereo angle</dt><dd>${r.status === 2 ? Math.round(r.theta * R2D / 5) * 5 + '°' : r.status === 1 ? 'mono · no range' : '—'}</dd>
  </dl>`;
  if (r.why && r.picked === 'sim' && isT) html += whyHtml(r, st);
  else if (r.picked === 'file' && r.reason) html += `<div class="why"><div class="why-h">CS2C rationale</div><p class="why-text">${esc(r.reason)}</p></div>`;
  else html += `<div class="qbar" title="Geometry score of the custody pick"><i style="width:${B ? Math.round(B.q * 100) : 0}%"></i></div>`;
  if (isT && r.best >= 0) html += `<button class="kill" data-kill="${r.best}" title="Simulate a failure of this SV from now on and watch CS2C retask">Knock out ${sim.sats[r.best].id}</button>`;
  return html;
}

/** Refresh the panels. Cheap parts every frame; the rest about twice a second and only when content changes. */
export function updateUI(k: number, scrubbing: boolean): void {
  $('#clock').textContent = (S.t >= sim.dur && !S.playing ? 'End · ' : '') + 'T+' + fmtT(S.t);
  if (!scrubbing) $<HTMLInputElement>('#scrub').value = String(Math.round(S.t / sim.dur * 1000));
  const now = performance.now(); if (now - lastUI < 450) return; lastUI = now;

  const html = focusHtml(k);
  if (html !== lastFocusHtml) { $('#focus').innerHTML = html; lastFocusHtml = html; }

  // event feed: latest 3 events up to now (focused threat only, once the user picks one)
  const fj = S.focus && S.focus.kind === 'threat' && !S.autoFocus ? S.focus.i : -1;
  const evs = [] as typeof sim.events;
  for (let i = sim.events.length - 1; i >= 0 && evs.length < 3; i--) if (sim.events[i].t <= S.t && (fj < 0 || sim.events[i].j === fj)) evs.push(sim.events[i]);
  $('#feedScope').textContent = fj >= 0 ? sim.threats[fj].id + ' only' : 'all threats';
  const feedKey = evs.map(e => e.t + '|' + e.j + '|' + e.kind).join(',');
  if (feedKey !== lastFeedKey) {
    const isNew = !!lastFeedKey && evs.length > 0 && !lastFeedKey.startsWith(evs[0].t + '|' + evs[0].j);
    lastFeedKey = feedKey;
    $('#feed').innerHTML = evs.length ? evs.map((e, n) => {
      const th = sim.threats[e.j];
      return `<button class="ev ev-${e.kind}${n === 0 ? ' fresh' : ''}${n === 0 && isNew ? ' enter' : ''}" data-j="${e.j}"><span class="ev-t">T+${fmtT(e.t)}</span><span class="chip ${th.type}">${th.id}</span><span class="ev-x">${esc(e.text)}</span></button>`;
    }).join('') : '<div class="ev-empty">Launch watch · CS2C events appear here</div>';
  }
  $('#outLine').hidden = !sim.outages.length;
  $('#outN').textContent = sim.outages.length ? `${sim.outages.length} SV${sim.outages.length > 1 ? 's' : ''} knocked out (${sim.outages.map(o => sim.sats[o.s] ? sim.sats[o.s].id : '?').join(', ')})` : '';

  // collapsed-section summaries
  const act = sim.thrRec.map(r => r[k]).filter((r): r is StepRec => !!r), c = [0, 0, 0];
  act.forEach(r => c[r.status]++);
  $('#threatsSum').textContent = $<HTMLDetailsElement>('#foldThreats').open ? 'custody over flight' : (act.length ? `${act.length} airborne · ${c[2]} stereo · ${c[1]} mono · ${c[0]} gap` : `${sim.threats.length} queued`);
  $('#sitesSum').textContent = $<HTMLDetailsElement>('#foldSites').open ? 'SVs in view · best SV' : `${sim.sites.length} sites watched`;

  // rows
  const f = S.focus;
  sim.sites.forEach((s, j) => {
    const rr = sim.siteRec[j][k], el = document.getElementById('site-' + j); if (!el || !rr) return;
    el.querySelector('.rt')!.innerHTML = `${s.name} <small>${rr.vis.length} SVs · ${rr.best >= 0 ? sim.sats[rr.best].id : 'none'}</small>`;
    el.setAttribute('aria-pressed', String(!!f && f.kind === 'site' && f.i === j));
  });
  sim.threats.forEach((th, j) => {
    const rr = sim.thrRec[j][k], el = document.getElementById('thr-' + j); if (!el) return;
    const st = threatState(th, S.t);
    el.querySelector('.rt')!.innerHTML = `${th.siteName} → ${dest(th, rr)} <small>${st ? PHASE_LABEL[st.phase] + ' · ' + (rr ? rr.vis.length : 0) + ' SVs' : S.t < th.tL ? 'T+' + fmtT(th.tL) : 'impact'}</small>`;
    el.querySelector('.st')!.innerHTML = (st && rr && rr.assess ? prioHtml(rr) + ' ' : '') + (st && rr && rr.bandP ? bandHtml(rr.bandP) + ' ' : '') + pill(rr, th);
    el.setAttribute('aria-pressed', String(!!f && f.kind === 'threat' && f.i === j));
  });
  drawChartCursor(); drawStrips();
}

export function buildLists(onFocus: (f: NonNullable<Focus>) => void): void {
  $('#sites').innerHTML = sim.sites.map((_, j) => `<button class="row" id="site-${j}" aria-pressed="false"><span class="chip S">SITE</span><span class="rt"></span><span></span></button>`).join('');
  $('#threats').innerHTML = sim.threats.map((th, j) => `<button class="row" id="thr-${j}" aria-pressed="false"><span class="chip ${th.type}">${th.id}</span><span class="rt"></span><span class="st"></span><canvas width="300" height="12"></canvas></button>`).join('');
  sim.sites.forEach((_, j) => { $('#site-' + j).onclick = () => onFocus({ kind: 'site', i: j }); });
  sim.threats.forEach((_, j) => { $('#thr-' + j).onclick = () => onFocus({ kind: 'threat', i: j }); });
}

/** Architecture note and per-layer SV counts in the Sensor architecture section. */
export function updateArchPanel(): void {
  $('#archNote').innerHTML = ARCH[S.arch].note;
  (Object.keys(S.layers) as (keyof typeof S.layers)[]).forEach(l => {
    const sm = document.querySelector(`#ly-${l}~small`);
    if (sm) sm.textContent = S.layers[l] ? `${sim.sats.filter(s => s.group === l).length} SVs` : 'off';
  });
}

export function refreshSummary(): void {
  const sm = sim.summary;
  $('#bigN').textContent = Math.round(sm.valueStereo * 100) + '%';
  $('#bigIntro').textContent = MODEL.src === 'file' && !MODEL.file ? 'No CS2C picks yet, so the baseline rule is shown. Weighted by track value, it holds stereo custody of' : `Against this salvo, ${SRC_TXT[MODEL.src]} holds stereo custody of`;
  $('#bigS').textContent = `stereo on ${Math.round(sm.stereo * 100)}% of threat-time (Low-value excluded) · ${sim.sats.length} sensor SVs · avg ${sm.avgV.toFixed(1)} in view · ${sm.gapThreats ? `${sm.gapThreats} threat${sm.gapThreats > 1 ? 's' : ''} with gaps (longest ${fmtDur(sm.longest)})` : 'no custody gaps'}` +
    (MODEL.src === 'sim' || (MODEL.src === 'file' && MODEL.file) ? ` · same primary as baseline ${Math.round(sm.agree * 100)}% of the time · IR band fit ${Math.round(sm.fit * 100)}% vs ${Math.round(sm.fit0 * 100)}% on fixed default bands${sm.tasked ? ` · shared fields of view: avg ${sm.tasked.toFixed(1)} SVs tasked for ${sm.slots.toFixed(1)} custody slots` : ''}` : '')
    + (sm.deprioritized ? ` · ${sm.deprioritized} RV deprioritized (impact clear of defended areas)${MODEL.src === 'sim' ? `, freeing ~${Math.round(sm.svMinFreed)} SV-minutes` : ''}` : '');
  if (MODEL.src === 'file') $('#fileStatus').innerHTML = fileStatusText();
  lastUI = 0; drawChart();
}

export function setSource(src: Source): void {
  MODEL.src = src;
  [...$('#srcSeg').children].forEach(c => c.setAttribute('aria-pressed', String((c as HTMLElement).dataset.v === src)));
  $('#fileBox').hidden = src !== 'file';
  $('#srcNote').innerHTML = SRC_NOTE[src];
  $('#fileStatus').innerHTML = fileStatusText();
  if (sim.siteRec.length) { applySource(); refreshSummary(); }
}
