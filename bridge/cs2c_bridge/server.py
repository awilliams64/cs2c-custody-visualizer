"""Live WebSocket link between a CS2C model and the visualizer.

    python -m cs2c_bridge                                   # demo model on ws://127.0.0.1:8765
    python -m cs2c_bridge --model my_pkg.cs2c:CS2CModel     # your model

In the visualizer: Custody selection -> CS2C -> Connect.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from typing import Any, Dict

import websockets

from .model import CustodyModel, load_model
from .protocol import PROTOCOL_VERSION, Observation, Scenario, picks_document

log = logging.getLogger("cs2c_bridge")


def handle_message(model: CustodyModel, msg: Dict[str, Any]) -> Dict[str, Any] | None:
    """Pure message handler (no I/O), so it can be tested directly. Returns the reply, if any."""
    kind = msg.get("type")
    if kind == "hello":
        if int(msg.get("version", PROTOCOL_VERSION)) != PROTOCOL_VERSION:
            return {"type": "error", "text": f"protocol version {msg.get('version')} not supported (bridge speaks {PROTOCOL_VERSION})"}
        return {"type": "status", "text": f"Connected to {model.name}."}
    if kind == "scenario":
        sc = Scenario.from_dict(msg.get("scenario", {}))
        model.on_scenario(sc)
        return {"type": "status", "text": f"{model.name}: scenario {sc.region.upper()} · {sc.salvo} missiles · {sc.arch.upper()} · {len(sc.svs)} SVs."}
    if kind == "observe":
        obs = Observation.from_dict(msg)
        started = time.perf_counter()
        picks = model.select(obs)
        log.debug("step %s: %d targets -> %d picks in %.1f ms", obs.step, len(obs.targets), len(picks), (time.perf_counter() - started) * 1e3)
        return {"type": "picks", "t": obs.t, **picks_document(picks, model.name)}
    return {"type": "error", "text": f"unknown message type {kind!r}"}


async def _session(model: CustodyModel, ws: Any) -> None:
    peer = getattr(ws, "remote_address", None)
    log.info("visualizer connected %s", peer)
    try:
        async for raw in ws:
            try:
                reply = handle_message(model, json.loads(raw))
            except Exception as exc:  # report model errors to the page instead of dropping the link
                log.exception("error handling message")
                reply = {"type": "error", "text": f"{type(exc).__name__}: {exc}"}
            if reply is not None:
                await ws.send(json.dumps(reply))
    finally:
        log.info("visualizer disconnected %s", peer)


async def serve(model: CustodyModel, host: str = "127.0.0.1", port: int = 8765) -> None:
    async with websockets.serve(lambda ws, *_: _session(model, ws), host, port, max_size=8 * 1024 * 1024):
        log.info("CS2C bridge (%s) listening on ws://%s:%d", model.name, host, port)
        await asyncio.Future()


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="python -m cs2c_bridge", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="cs2c_bridge.demo:DemoModel", help='model to run, "package.module:ClassName"')
    ap.add_argument("--host", default="127.0.0.1", help="interface to listen on (default: localhost only)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(message)s")
    try:
        asyncio.run(serve(load_model(args.model), args.host, args.port))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
