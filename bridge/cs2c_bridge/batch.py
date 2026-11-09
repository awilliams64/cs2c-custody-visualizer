"""Offline runs: observations file in, picks file out.

In the visualizer, Custody selection -> CS2C -> Export observations (.json). Then:

    python -m cs2c_bridge.batch cs2c-observations-nk-10-mixed-t2.json -o picks.json --model my_pkg.cs2c:CS2CModel

and load picks.json with "Load CS2C output (.json)".
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from .io import run_batch, write_picks
from .model import load_model


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m cs2c_bridge.batch", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("observations", help="file exported from the visualizer")
    ap.add_argument("-o", "--out", default="picks.json")
    ap.add_argument("--model", default="cs2c_bridge.demo:DemoModel", help='"package.module:ClassName"')
    args = ap.parse_args(argv)
    model = load_model(args.model)
    picks = run_batch(model, json.loads(Path(args.observations).read_text(encoding="utf-8")))
    out = write_picks(args.out, picks, model.name)
    print(f"{len(picks)} picks from {model.name} -> {out}")


if __name__ == "__main__":
    main()
