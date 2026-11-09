// Copies the single-file build to the repo root, where GitHub Pages serves it.
import { copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../dist/index.html');
const dst = resolve(here, '../../index.html');
copyFileSync(src, dst);
console.log(`published ${dst} (${Math.round(statSync(dst).size / 1024)} KB)`);
