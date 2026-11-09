"""A small stand-in model so the live link can be demonstrated before CS2C is ready.

It is deliberately simple and NOT CS2C: per target it picks the SV with the best mix of range, elevation,
remaining access and band fit, then the stereo partner with the widest useful separation. It holds a pick while
it stays good, so the display stays calm. Replace it with the real model via --model.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

from .model import CustodyModel
from .protocol import Candidate, Observation, Pick, Scenario

MIN_STEREO_DEG = 15.0


def _best_band(c: Candidate) -> Tuple[Optional[str], float]:
    if not c.band_fit:
        return None, 0.0
    band = max(c.band_fit, key=lambda b: c.band_fit[b])
    return band, c.band_fit[band]


def _score(c: Candidate) -> float:
    rng = 1.0 - min(c.range_km / 12000.0, 1.0)
    elev = max(0.0, min(1.0, (math.sin(math.radians(c.elevation_deg)) + 0.2) / 1.2))
    dwell = min(c.access_s, 300.0) / 300.0
    return 0.35 * rng + 0.2 * elev + 0.25 * dwell + 0.2 * _best_band(c)[1]


def _angle_deg(a: Candidate, b: Candidate) -> float:
    d = sum(x * y for x, y in zip(a.los, b.los))
    return math.degrees(math.acos(max(-1.0, min(1.0, d))))


class DemoModel(CustodyModel):
    name = "Demo model (stand-in, not CS2C)"

    def __init__(self) -> None:
        self._held: Dict[str, Tuple[str, Optional[str]]] = {}

    def on_scenario(self, scenario: Scenario) -> None:
        self._held.clear()

    def select(self, obs: Observation) -> List[Pick]:
        picks: List[Pick] = []
        for tgt in obs.targets:
            cands = [c for c in tgt.candidates if c.sv not in obs.outages]
            if not cands:
                self._held.pop(tgt.target, None)
                continue
            scored = sorted(cands, key=_score, reverse=True)
            by_id = {c.sv: c for c in cands}
            held = self._held.get(tgt.target)
            primary = scored[0]
            if held and held[0] in by_id and _score(by_id[held[0]]) >= 0.85 * _score(primary):
                primary = by_id[held[0]]
            partner, best = None, -1.0
            for c in cands:
                if c.sv == primary.sv:
                    continue
                ang = _angle_deg(primary, c)
                if ang < MIN_STEREO_DEG:
                    continue
                s = math.sin(math.radians(ang)) * (0.5 + 0.5 * _score(c))
                if held and held[1] == c.sv:
                    s *= 1.15  # mild preference for the current partner
                if s > best:
                    partner, best = c, s
            p_band, _ = _best_band(primary)
            q_band = _best_band(partner)[0] if partner else None
            where = "against space" if primary.background == "space" else "against Earth"
            reason = (f"{p_band} {where}; {_angle_deg(primary, partner):.0f}° stereo with {partner.sv}" if partner
                      else f"{p_band} {where}; mono, no partner with 15°+ separation")
            self._held[tgt.target] = (primary.sv, partner.sv if partner else None)
            picks.append(Pick(t=obs.t, target=tgt.target, primary=primary.sv, partner=partner.sv if partner else None,
                              primary_band=p_band, partner_band=q_band, reason=reason))
        return picks
