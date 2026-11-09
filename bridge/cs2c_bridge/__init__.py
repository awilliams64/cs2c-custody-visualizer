"""cs2c_bridge: plug a CS2C custody model into the CS2C Custody Visualizer.

Write a model by subclassing :class:`CustodyModel` and implementing ``select``. Then either

* stream live:   ``python -m cs2c_bridge --model my_pkg.my_module:MyModel``  and press Connect in the page, or
* run offline:   ``python -m cs2c_bridge.batch observations.json -o picks.json --model my_pkg.my_module:MyModel``
  and load picks.json in the page.
"""
from .protocol import PROTOCOL_VERSION, Candidate, Observation, Pick, Scenario, Target, picks_document
from .model import CustodyModel, load_model
from .io import run_batch, write_picks

__all__ = [
    "PROTOCOL_VERSION", "Candidate", "Observation", "Pick", "Scenario", "Target", "picks_document",
    "CustodyModel", "load_model", "run_batch", "write_picks",
]
__version__ = "0.1.0"
