// Canvas colours come from the CSS tokens so the globe follows light and dark mode.
const KEYS = ['bg', 'panel', 'ink', 'muted', 'line', 'globe', 'coast', 'grat', 'sv', 'gold', 'gold-ink', 'blue', 'bal', 'hgv', 'plume', 'ok', 'bad', 'swir', 'mwir', 'lwir'] as const;
export type Token = typeof KEYS[number];
export const C = {} as Record<Token, string>;

export function readTokens(): void {
  const cs = getComputedStyle(document.documentElement);
  KEYS.forEach(k => { C[k] = cs.getPropertyValue('--' + k).trim(); });
}

/** Call fn whenever the colour scheme or explicit theme changes. */
export function onThemeChange(fn: () => void): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', fn);
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
}
