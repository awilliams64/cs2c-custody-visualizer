# CS2C ↔ Visualizer protocol (v1)

The visualizer owns the scenario (orbits, trajectories, who can see what). CS2C only decides **which SVs hold custody of each target, and in which IR band**. Everything is JSON. The same messages are used live (WebSocket) and offline (files).

All values are notional and unclassified.

## Live: WebSocket

The visualizer connects to `ws://localhost:8765` (configurable) when you press **Connect** under *Custody selection → CS2C*. `python -m cs2c_bridge` runs the server side.

| Direction | `type` | When |
|---|---|---|
| page → model | `hello` | once after connecting |
| page → model | `scenario` | after connecting and after every rebuild or outage change |
| page → model | `observe` | for each 10 s step as playback reaches it (current step plus one ahead) |
| model → page | `picks` | in reply to each `observe` |
| model → page | `status` / `error` | any time; shown under the Connect button |

### `hello`
```json
{ "type": "hello", "client": "cs2c-visualizer", "version": 1 }
```

### `scenario`
```json
{ "type": "scenario", "scenario": {
  "region": "nk", "salvo": 10, "mix": "mixed", "arch": "t2", "dt": 10, "duration": 2436.4,
  "svs":     [ { "id": "T2-0304", "layer": "LEO", "group": "LEO", "bands": ["SWIR","MWIR"], "fov_half_deg": 62 } ],
  "threats": [ { "id": "B-01", "type": "ballistic", "site": "Sohae", "target": "Guam", "launch_t": 120, "impact_t": 900.2 } ],
  "sites":   [ { "name": "Sohae", "lat": 39.66, "lon": 124.7 } ] } }
```
`layer` is `LEO` (wide field of view), `FC` (LEO fire-control), `MEO`, `GEO` or `HEO` (polar).

### `observe`
```json
{ "type": "observe", "t": 500, "step": 50, "outages": ["T1-0301"],
  "targets": [ {
    "target": "B-01", "kind": "threat", "phase": "mid", "lat": 31.2, "lon": 135.8, "alt_km": 805,
    "assessment": { "priority": "High", "ipp_lat": 13.6, "ipp_lon": 144.9, "radius_km": 180,
                    "nearest_defended": "Guam", "distance_km": 20, "reliable": true },
    "candidates": [ {
      "sv": "E1-0103", "layer": "MEO", "range_km": 7612, "elevation_deg": 64.8, "background": "earth",
      "los": [0.4121, 0.6232, 0.6648], "access_s": 300,
      "band_fit": { "SWIR": 0.15, "MWIR": 0.45 } } ] } ] }
```
- `kind`: `threat` or `site` (launch watch).
- `phase`: `boost`, `mid`, `reentry`, `glide`, `terminal`, `watch`.
- `candidates` are only SVs that can see the target now (line of sight clear of the Earth, inside the notional range). Knocked-out SVs are already removed and also listed in `outages`.
- `los` is the unit vector from the target to the SV, Earth-fixed. Use it for stereo angles.
- `access_s` is predicted remaining access from orbit propagation.
- `background`: `space` (target seen above the horizon) or `earth`.
- `band_fit`: notional suitability 0–1 for each band that SV carries.
- `assessment` (threats only): the visualizer's notional predicted-impact-point (IPP) estimate. `priority` is `High` while the uncertainty `radius_km` comes within 300 km of a defended area, `Medium` within a further 500 km, `Low` beyond. `reliable` is false in boost and for gliding HGVs. CS2C may use it or apply its own prioritization; in Python it is `target.assessment` and `target.priority`.

### `picks`
```json
{ "type": "picks", "t": 500, "model": "CS2C v0.3",
  "selections": [ { "t": 500, "target": "B-01",
    "primary": "E1-0103", "primaryBand": "MWIR",
    "partner": "T2-0602", "partnerBand": "MWIR",
    "reason": "MWIR against Earth; 69° stereo with T2-0602" } ] }
```
- One selection per target you want to task; omit a target to fall back to the baseline rule for that step.
- `partner` may be `null` (mono custody). Bands and `reason` are optional; `reason` is shown as the CS2C rationale.
- A pick holds until the next pick for the same target.
- The page flags a pick that names an SV that can't see the target ("not in view") or an SV ID that isn't in the constellation.

## Offline: files

1. In the page: **Custody selection → CS2C → Export observations (.json)**. The file is `{ "type": "cs2c-observations", "version": 1, "scenario": {…}, "steps": [ observe, observe, … ] }`.
2. `python -m cs2c_bridge.batch observations.json -o picks.json --model my_pkg.cs2c:CS2CModel`
3. In the page: **Load CS2C output (.json)** with `picks.json`, which is `{ "model": "…", "selections": [ … ] }` exactly as above.

A browser-side integration can also call `window.CS2C.load({ model, selections })`.
