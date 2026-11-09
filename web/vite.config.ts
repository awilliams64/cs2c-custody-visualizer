import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds one self-contained dist/index.html (scripts, styles and coastline data inlined),
// so the site still works from GitHub Pages, a file share, or offline.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2020', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
});
