# CS2C Visualizer · Globe Shell

**UNCLASSIFIED · Prototype**

This branch (`globe-shell`) is the bare globe and interface from the CS2C Custody Visualizer, with all scenario content removed: no satellites, threats, custody logic, IR bands, event feed or CS2C file loading. Use it as a clean base for new views. The full visualizer lives on `main`.

The page is a single self-contained HTML file (`index.html`) with no server required. Open it in a browser, or serve it with GitHub Pages.

## What's included

- **Globe:** perspective-projected Earth with graticule and Natural Earth 50m coastlines and borders (coarse outlines while moving, full detail when still).
- **Camera:** quaternion orbit camera with tumble, roll, zoom, inertia, north-up leveling, Orbit Earth / Orbit focus pivot, and Follow.
- **Focus:** click the globe to drop a focus point; the right panel shows its position. Scenario layers can register their own clickable targets.
- **Interface shell:** classification banners, PatchPlus-branded left panel with Display options (graticule, coastlines, theme), right panel with focus card and camera readout, playback dock (play/pause, restart, loop, speed, scrubber, T+ clock), and camera tool buttons. Empty slots mark where scenario controls and lists go.
- **Theming:** light and dark from CSS tokens; follows the OS setting or the Theme toggle.
- **Phone layout:** panels stack under the globe below 860 px.

## Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Tumble globe | Drag | Arrow keys |
| Roll | Shift-drag or right-drag; two-finger twist | Q / E |
| Zoom | Scroll or pinch | + / − |
| Set focus | Click | |
| Reset view | Double-click | |
| Play / pause | ⏸ / ▶ button | Space |

## Adding content

Scenario code talks to the shell through `window.VIZ`:

```js
const site = VIZ.llv(39.66, 124.70);            // lat, lon (, altitude km) -> ECEF km
VIZ.addLayer((g, t, api) => {                     // runs every frame; g is the 2D canvas context, t is scenario seconds
  const p = api.proj(site[0], site[1], site[2], [0, 0, 0, 0]);  // [x, y, nearSide, hidden]
  if (p[3]) return;
  g.fillStyle = api.C().ink; g.fillRect(p[0] - 3, p[1] - 3, 6, 6);
  api.label(g, 'Sohae', p[0] + 7, p[1] - 6, api.C().muted, 10);
  api.hits().push({ x: p[0], y: p[1], f: { kind: 'launch site', name: 'Sohae', p: site } });  // clickable
});
VIZ.flyTo(40, 130);
VIZ.slots.left.innerHTML = '…';                   // left / right panel placeholders
```

Other members: `S` (state: `t`, `playing`, `focus`, `cam`), `DUR`, `RE`, `toLL`, `unproj`, vector helpers (`dot`, `norm`, `unit`, `cross`), `setFocus`, `removeLayer`. Scenario length (`DUR`) and the home view (`HOME`) are constants at the top of the script.

## Editing

Edit `src/visualizer.tpl.html`, then rebuild:

```bash
python3 build.py
```

`src/world-outlines.txt` holds the coastline and border outlines (Natural Earth 50m via the `world-atlas` package), injected at build time so `index.html` stays a single file.
