"""Run a model over an exported observations document and write picks files."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from .model import CustodyModel
from .protocol import Observation, Pick, Scenario, picks_document


def run_batch(model: CustodyModel, observations: Dict[str, Any]) -> List[Pick]:
    """Run a model over every step of an exported observations document."""
    if observations.get("type") != "cs2c-observations":
        raise ValueError("not a CS2C observations export (missing type: cs2c-observations)")
    model.on_scenario(Scenario.from_dict(observations.get("scenario", {})))
    picks: List[Pick] = []
    for step in observations.get("steps", []):
        picks.extend(model.select(Observation.from_dict(step)))
    return picks


def write_picks(path: str | Path, picks: List[Pick], model: str = "CS2C") -> Path:
    """Write picks in the format the visualizer loads."""
    path = Path(path)
    path.write_text(json.dumps(picks_document(picks, model), indent=1), encoding="utf-8")
    return path
