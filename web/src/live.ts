// Live link to the CS2C Python model over WebSocket (python -m cs2c_bridge). Protocol: docs/protocol.md.
import { DT } from './constants';
import { $ } from './dom';
import { esc } from './format';
import { PROTOCOL_VERSION, observation, scenarioMessage } from './observations';
import { MODEL, S, sim } from './state';
import { mergePicks, parseSelections } from './tasking';

let ws: WebSocket | null = null;
let sent = new Set<number>();
let modelName = 'CS2C (live)';
let pending = false;
let onPicks: () => void = () => {};

const status = (html: string, cls = '') => { const el = $('#liveStatus'); el.innerHTML = html; el.className = 'arch-note live-status ' + cls; };
const setBtn = (txt: string) => { $('#liveBtn').textContent = txt; };
export const liveConnected = () => !!ws && ws.readyState === WebSocket.OPEN;

/** apply is called (throttled) whenever new picks arrive, so the page can re-apply the selection. */
export function initLive(apply: () => void): void {
  onPicks = apply;
  $('#liveBtn').onclick = () => { if (ws) disconnect(); else connect($<HTMLInputElement>('#liveUrl').value.trim()); };
}

function connect(url: string): void {
  if (!/^wss?:\/\//.test(url)) { status('Use a ws:// or wss:// address, for example ws://localhost:8765.', 'bad'); return; }
  try { ws = new WebSocket(url); } catch (e) {
    ws = null; status(`This page can't open a live connection here (${esc((e as Error).message)}). Open the GitHub Pages site or a local copy instead.`, 'bad'); return;
  }
  status(`Connecting to ${esc(url)}…`); setBtn('Cancel');
  ws.onopen = () => {
    setBtn('Disconnect'); status(`Connected to ${esc(url)}. Streaming each step to CS2C.`, 'ok');
    send({ type: 'hello', client: 'cs2c-visualizer', version: PROTOCOL_VERSION });
    scenarioChanged();
  };
  ws.onmessage = ev => handle(ev.data);
  ws.onerror = () => status(`Couldn't reach ${esc(url)}. Is <code>python -m cs2c_bridge</code> running? (Browsers block live links inside some embedded viewers.)`, 'bad');
  ws.onclose = () => { ws = null; setBtn('Connect'); if (!/bad/.test($('#liveStatus').className)) status('Disconnected.'); };
}
function disconnect(): void { ws?.close(); ws = null; setBtn('Connect'); status('Disconnected.'); }
function send(msg: unknown): void { if (liveConnected()) ws!.send(JSON.stringify(msg)); }

/** Call after a rebuild or outage change: restates the scenario and re-sends observations from scratch. */
export function scenarioChanged(): void {
  if (!liveConnected()) return;
  sent = new Set(); MODEL.file = null;
  send({ type: 'scenario', scenario: scenarioMessage() });
  tick(true);
}

/** Send the observation for the current step (and one step ahead so picks are ready on time). */
export function tick(force = false): void {
  if (!liveConnected() || MODEL.src !== 'file') return;
  const k = Math.min(sim.nstep - 1, Math.max(0, Math.floor(S.t / DT + 0.5)));
  for (const s of [k, k + 1]) {
    if (s >= sim.nstep || (sent.has(s) && !force)) continue;
    sent.add(s); send({ type: 'observe', ...observation(s) });
  }
}

function handle(data: unknown): void {
  let msg: { type?: string; model?: string; text?: string; selections?: unknown };
  try { msg = JSON.parse(String(data)); } catch { return; }
  if (msg.type === 'status' && msg.text) { status(esc(msg.text), 'ok'); return; }
  if (msg.type === 'error' && msg.text) { status('CS2C error: ' + esc(msg.text), 'bad'); return; }
  if (msg.type !== 'picks') return;
  if (typeof msg.model === 'string' && msg.model) modelName = msg.model;
  let feed;
  try { feed = parseSelections(msg, modelName); } catch { return; }
  const entries: Parameters<typeof mergePicks>[1] = [];
  feed.byKey.forEach((arr, key) => {
    const name = [...sim.sites.map(s => s.name), ...sim.threats.map(t => t.id)].find(n => n.toLowerCase() === key) || key;
    arr.forEach(pick => entries.push({ target: name, pick }));
  });
  mergePicks(`${modelName} (live)`, entries);
  if (!pending) { pending = true; setTimeout(() => { pending = false; onPicks(); }, 250); }
}
