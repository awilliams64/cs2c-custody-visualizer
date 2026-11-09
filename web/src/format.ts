export const pad = (n: number, w = 2) => String(n).padStart(w, '0');
export const fmtT = (t: number) => { t = Math.max(0, Math.round(t)); return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
export const fmtDur = (t: number) => t >= 60 ? `${Math.floor(t / 60)}m ${pad(Math.round(t % 60))}s` : `${Math.round(t)} s`;
export const fmtN = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
export const esc = (s: unknown) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
