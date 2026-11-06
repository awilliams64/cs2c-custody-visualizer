# CS2C Custody Visualizer

**UNCLASSIFIED · Prototype**

A browser-based missile custody visualizer for the **Cognitive Sensor Satellite Control (CS2C)** AI model, built by PatchPlus Consulting. It shows which sensor satellites (SVs) can see a launch, which SV has the best collection geometry, and whether a stereo pair holds custody of a ballistic re-entry vehicle (RV) or hypersonic glide vehicle (HGV) through impact.

The page is a single self-contained HTML file (`index.html`) with no build tooling or server required. Open it in a browser, or serve it with GitHub Pages.

> All orbits, trajectories and sensor ranges are **notional and geometric**. Nothing here models real sensor performance. The custody picks shown by default come from a **simulated feed**, not CS2C output.

## What it shows

- **Sensor architecture (PWSA-based):** three build-outs drawn from public reporting:
  - **T1 (~2027):** SDA Tracking Layer Tranche 1 (35 LEO SVs, 5 planes, 1,000 km) + MEO Epoch 1 (12 SVs, 2 planes) + OPIR GEO + Next-Gen OPIR Polar.
  - **T1+T2 (~2029):** adds Tranche 2 (54 SVs: 48 wide field of view + 6 fire-control) and MEO Epoch 2 (10 SVs).
  - **T1–T3 (FY29+):** adds Tranche 3 (72 SVs, about half missile-defense / fire-control).
- **Threats:** salvos of 1, 5, 10 or 20 from North Korea, Iran, China or Russia launch sites; ballistic RVs (boost, midcourse, re-entry) and HGVs (boost, 35–70 km glide with cross-range maneuver, terminal dive).
- **Custody:** each threat is tagged stereo (two SVs, ≥15° separation), mono (one SV) or gap (none), with per-threat custody bars over the whole flight and a salvo-level stereo-custody percentage.
- **IR band tasking:** each tasked SV shows the band it collects in (SWIR, MWIR or LWIR) on the globe, in the focus card and in the threat list. The simulated feed chooses band and geometry together; the summary reports *IR band fit* against SVs left on their default bands.
- **Why this pick:** for the focused threat, the simulated feed explains its choice in plain language (band, background, stereo angle, dwell, handover avoidance), shows how much geometry, dwell, band fit, fire-control and continuity each contributed, names the runner-up pair and its margin, and rates confidence.
- **Shared fields of view:** the simulated feed tasks all threats at once. One SV can hold custody of several threats when they fit inside its field of view and call for the same IR band (notional half-angles: LEO WFOV 62°, fire-control 8°, MEO 26°, GEO 9°, polar 10°). Labels show ×n for the number of threats an SV holds, dotted lines link it to the others, and the summary reports SVs tasked versus custody slots.
- **Calm tasking:** the simulated feed holds a valid pair for at least 2 minutes and only hands over for a 20%+ improvement; when one SV of a pair is lost it keeps the survivor if possible. Panels refresh only when something meaningful changes, numbers are rounded, the event feed shows the latest 3 events, and pulses mark only the focused threat.
- **Event-driven retasking:** an event feed in the right panel logs launches, phase changes (burnout, pull-up, re-entry, terminal dive), HGV cross-range maneuvers, custody loss and regain, and every retask with its cause. Rings pulse on the globe as events fire. **Knock out** the current custody SV to simulate a failure and watch CS2C retask; the outage is not foreseen. Restore it from the Custody selection section.
- **Selection source:** *Simulated* (default placeholder feed) or *CS2C* (picks loaded from model output). A dashed ring marks the baseline geometry rule's pick wherever it differs.

## Globe shell

`globe-shell/index.html` is a copy of the bare globe and interface from the `globe-shell` branch, published at `/globe-shell/` on GitHub Pages. Rebuild it on that branch and copy its `index.html` here to update it.

## Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Tumble globe | Drag | Arrow keys |
| Roll | Shift-drag or right-drag; two-finger twist | Q / E |
| Zoom | Scroll or pinch | + / − |
| Reset view | Double-click | |
| Play / pause | ⏸ / ▶ button | Space |

**Orbit Earth / Orbit focus** switches the camera pivot between Earth's center and the selected threat or site. **N↑** levels the view, **Follow** keeps the camera on the focused object, and **↻** loops playback.

## Connecting CS2C

Choose **CS2C** under *Custody selection* and load a JSON file in this shape:

```json
{
  "model": "CS2C v0.1",
  "selections": [
    { "t": 120, "target": "B-01", "primary": "T2-0304", "primaryBand": "LWIR",
      "partner": "E1-0102", "partnerBand": "MWIR",
      "reason": "LWIR on cold RV vs space; 104° stereo" },
    { "t": 130, "target": "Sohae", "primary": "T1-0205", "partner": null }
  ]
}
```

- `t`: seconds from scenario start (T+).
- `target`: a threat ID (`B-01`, `H-03`) or a launch-site name.
- `primary` / `partner`: SV IDs as labeled on the globe (`T1-0101`, `T2-0304`, `E1-0102`, `GEO-1`, `NGP-2`). `partner` may be `null`.
- `primaryBand` / `partnerBand`: optional, `SWIR`, `MWIR` or `LWIR`. When present, the page shows CS2C's band choice.
- `reason`: optional short text; shown as the CS2C rationale in the focus card.
- Each pick holds until the next one for the same target.

For a live integration, call `window.CS2C.load(data)` with the same object; `window.CS2C.clear()` resets it. Picks that reference an SV that can't see the target are flagged "not in view"; unknown SV IDs are listed in the file status.

## Editing

Edit `src/visualizer.tpl.html`, then rebuild:

```bash
python3 build.py
```

`src/world-outlines.txt` holds the coastline and border outlines (Natural Earth 50m via the `world-atlas` package), injected at build time so `index.html` stays a single file.

## Model assumptions

| Notional slant range (km) | Boost | Midcourse | Re-entry | Glide |
|---|---|---|---|---|
| LEO wide field of view | 4,500 | 3,500 | 3,500 | 2,200 |
| LEO fire-control | 4,500 | 4,000 | 4,000 | 3,500 |
| MEO | 16,000 | 11,000 | 11,000 | — |
| GEO / Polar | line of sight | — | — | — |

IR bands (notional): LEO wide field of view SVs collect in SWIR (default) or MWIR; LEO fire-control in MWIR (default) or LWIR; MEO, GEO and polar in SWIR (default) or MWIR. Band fit by phase and background:

| Band fit | SWIR | MWIR | LWIR |
|---|---|---|---|
| Boost plume | 1.0 | 0.9 | 0.3 |
| Midcourse, against space | 0.25 | 0.55 | 1.0 |
| Midcourse, against Earth | 0.15 | 0.45 | 0.45 |
| Re-entry heating | 0.8 | 1.0 | 0.5 |
| Glide, against space | 0.55 | 1.0 | 0.75 |
| Glide, against Earth | 0.5 | 0.9 | 0.4 |

Assumed where no public figure exists: plane splits for Tranches 2 and 3, the 81° LEO inclination, the 8,000 km MEO altitude, and the GEO slot positions.

## Sources

- [SDA Tracking Layer fact sheet (Oct 2023)](https://www.sda.mil/wp-content/uploads/2023/11/Tracking-Layer-Fact-Sheet_FINAL_Oct-2023-1.pdf)
- [SDA: Tranche 2 Tracking Layer awards](https://www.sda.mil/space-development-agency-makes-awards-to-build-54-tranche-2-tracking-layer-satellites/)
- [Spaceflight Now: Tranche 3 Tracking awards](https://spaceflightnow.com/2025/12/20/space-development-agency-awards-roughly-3-5-billion-to-4-companies-for-72-missile-tracking-and-warning-satellites/)
- [Space Systems Command: MEO Epoch 2 design review](https://www.ssc.spaceforce.mil/Newsroom/Article/4428927/us-space-force-achieves-key-design-milestone-for-resilient-missile-warning-and)
- [Air & Space Forces: PWSA](https://www.airandspaceforces.com/weapons/pwsa/)
- [Next-Gen OPIR overview](https://en.wikipedia.org/wiki/Next-Generation_Overhead_Persistent_Infrared)

Visual concept inspired by Georgia Tech ESPL's [Optimizing Space-Based Missile Defense](https://espl.ae.gatech.edu/research/models/sbi/) model.
