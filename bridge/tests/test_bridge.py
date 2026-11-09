import asyncio
import json
import socket

import pytest
import websockets

from cs2c_bridge import CustodyModel, Observation, Pick, load_model, picks_document, run_batch, write_picks
from cs2c_bridge.demo import DemoModel
from cs2c_bridge.server import handle_message, serve


def cand(sv, los, rng=2000, elev=30, access=600, bg="space", fit=None):
    return {"sv": sv, "layer": "LEO", "range_km": rng, "elevation_deg": elev, "background": bg, "los": los,
            "access_s": access, "band_fit": fit or {"SWIR": 0.25, "MWIR": 0.55}}


OBS = {
    "t": 300, "step": 30, "outages": [],
    "targets": [{"target": "B-01", "kind": "threat", "phase": "mid", "lat": 30, "lon": 140, "alt_km": 900,
                 "candidates": [cand("T1-0101", [1, 0, 0]), cand("T1-0202", [0, 1, 0], rng=3000),
                                cand("T2-0303", [0.999, 0.04, 0], rng=1500)]}],
}
SCENARIO = {"region": "nk", "salvo": 1, "mix": "bal", "arch": "t2", "dt": 10, "duration": 900, "svs": [], "threats": [], "sites": []}


def test_demo_picks_stereo_pair_with_bands_and_reason():
    picks = DemoModel().select(Observation.from_dict(OBS))
    assert len(picks) == 1
    p = picks[0]
    assert p.target == "B-01" and p.primary in {"T1-0101", "T2-0303"}
    assert p.partner == "T1-0202"                       # only candidate >= 15 deg away
    assert p.primary_band == "MWIR" and p.reason


def test_outaged_sv_is_never_picked():
    obs = dict(OBS, outages=["T1-0202"])
    p = DemoModel().select(Observation.from_dict(obs))[0]
    assert "T1-0202" not in (p.primary, p.partner)


def test_pick_serialisation_matches_visualizer_schema():
    doc = picks_document([Pick(t=10, target="H-01", primary="T1-0101", partner=None, primary_band="MWIR", reason="x")], "CS2C test")
    assert doc == {"model": "CS2C test", "selections": [{"t": 10, "target": "H-01", "primary": "T1-0101", "partner": None, "primaryBand": "MWIR", "reason": "x"}]}
    with pytest.raises(ValueError):
        Pick(t=0, target="B-01", primary="X", primary_band="VIS").to_dict()


def test_handle_message_protocol():
    m = DemoModel()
    assert handle_message(m, {"type": "hello", "version": 1})["type"] == "status"
    assert handle_message(m, {"type": "hello", "version": 99})["type"] == "error"
    assert handle_message(m, {"type": "scenario", "scenario": SCENARIO})["type"] == "status"
    reply = handle_message(m, {"type": "observe", **OBS})
    assert reply["type"] == "picks" and reply["selections"][0]["target"] == "B-01"


def test_batch_roundtrip(tmp_path):
    doc = {"type": "cs2c-observations", "version": 1, "scenario": SCENARIO, "steps": [OBS, dict(OBS, t=310, step=31)]}
    picks = run_batch(DemoModel(), doc)
    out = write_picks(tmp_path / "picks.json", picks, "Demo")
    data = json.loads(out.read_text())
    assert data["model"] == "Demo" and [s["t"] for s in data["selections"]] == [300, 310]


def test_load_model_spec():
    assert isinstance(load_model("cs2c_bridge.demo:DemoModel"), CustodyModel)
    with pytest.raises(ValueError):
        load_model("no_colon")


def test_live_server_roundtrip():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]

    async def run():
        task = asyncio.create_task(serve(DemoModel(), "127.0.0.1", port))
        await asyncio.sleep(0.3)
        async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
            await ws.send(json.dumps({"type": "hello", "version": 1}))
            assert json.loads(await ws.recv())["type"] == "status"
            await ws.send(json.dumps({"type": "observe", **OBS}))
            reply = json.loads(await ws.recv())
        task.cancel()
        return reply

    reply = asyncio.run(run())
    assert reply["type"] == "picks" and reply["selections"][0]["primaryBand"] == "MWIR"


def test_low_priority_target_gets_single_monitor_sv():
    obs = dict(OBS)
    obs["targets"] = [dict(OBS["targets"][0], assessment={"priority": "Low", "nearest_defended": "Guam", "distance_km": 2400})]
    p = DemoModel().select(Observation.from_dict(obs))[0]
    assert p.partner is None and "Low priority" in p.reason


def test_track_value_defaults_and_reads_assessment():
    t = Observation.from_dict(OBS).targets[0]
    assert t.track_value == 1.0
    obs = dict(OBS); obs["targets"] = [dict(OBS["targets"][0], assessment={"priority": "High", "track_value": 0.64})]
    assert Observation.from_dict(obs).targets[0].track_value == 0.64
