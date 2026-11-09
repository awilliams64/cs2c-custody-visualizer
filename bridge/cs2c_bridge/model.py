"""The interface a CS2C model implements."""
from __future__ import annotations

import importlib
from typing import List

from .protocol import Observation, Pick, Scenario


class CustodyModel:
    """Subclass this and implement :meth:`select`.

    ``select`` is called once per time step (every 10 s of scenario time) with every active target and the SVs
    that can see it. Return one :class:`Pick` per target you want to task. Targets you leave out fall back to the
    visualizer's baseline rule for that step, so partial models are fine while CS2C is in development.
    """

    #: Shown in the visualizer next to each pick.
    name = "CS2C"

    def on_scenario(self, scenario: Scenario) -> None:
        """Called when the visualizer starts or changes a scenario. Reset any per-scenario state here."""

    def select(self, obs: Observation) -> List[Pick]:
        raise NotImplementedError


def load_model(spec: str) -> CustodyModel:
    """Instantiate a model from "package.module:ClassName"."""
    if ":" not in spec:
        raise ValueError('model must look like "package.module:ClassName"')
    mod_name, cls_name = spec.split(":", 1)
    cls = getattr(importlib.import_module(mod_name), cls_name)
    model = cls()
    if not isinstance(model, CustodyModel):
        raise TypeError(f"{spec} is not a CustodyModel subclass")
    return model
