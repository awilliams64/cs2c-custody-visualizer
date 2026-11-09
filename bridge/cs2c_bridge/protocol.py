"""Message types shared with the visualizer. See docs/protocol.md for the wire format."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

PROTOCOL_VERSION = 1
BANDS = ("SWIR", "MWIR", "LWIR")


@dataclass
class Candidate:
    """One SV that can see a target at this time step."""
    sv: str                       # SV ID as labeled on the globe, e.g. "T2-0304"
    layer: str                    # LEO | FC | MEO | GEO | HEO   (FC = LEO fire-control payload)
    range_km: float
    elevation_deg: float          # SV elevation above the target's local horizon
    background: str               # "space" (above the horizon) or "earth" (below)
    los: List[float]              # unit vector target -> SV, Earth-fixed
    access_s: float               # predicted remaining access time from orbit propagation
    band_fit: Dict[str, float]    # band -> notional suitability 0..1, only bands this SV carries

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Candidate":
        return cls(sv=str(d["sv"]), layer=str(d.get("layer", "")), range_km=float(d.get("range_km", 0)),
                   elevation_deg=float(d.get("elevation_deg", 0)), background=str(d.get("background", "space")),
                   los=[float(x) for x in d.get("los", [0.0, 0.0, 0.0])], access_s=float(d.get("access_s", 0)),
                   band_fit={str(k): float(v) for k, v in (d.get("band_fit") or {}).items()})


@dataclass
class Target:
    """A threat (B-01, H-03 ...) or a launch site under watch, with its candidate SVs."""
    target: str
    kind: str                     # "threat" or "site"
    phase: str                    # boost | mid | reentry | glide | terminal | watch
    lat: float
    lon: float
    alt_km: float
    candidates: List[Candidate] = field(default_factory=list)
    #: Visualizer's notional IPP assessment (threats only): priority High/Medium/Low, ipp_lat, ipp_lon,
    #: radius_km, nearest_defended, distance_km, reliable. CS2C may use it or apply its own prioritization.
    assessment: Optional[Dict[str, Any]] = None

    @property
    def priority(self) -> str:
        return str((self.assessment or {}).get("priority", "High"))

    @property
    def track_value(self) -> float:
        """V(q) in 0..1 = type weight x impact-location weight (1.0 if the visualizer sent no assessment)."""
        return float((self.assessment or {}).get("track_value", 1.0))

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Target":
        return cls(target=str(d["target"]), kind=str(d.get("kind", "threat")), phase=str(d.get("phase", "")),
                   lat=float(d.get("lat", 0)), lon=float(d.get("lon", 0)), alt_km=float(d.get("alt_km", 0)),
                   candidates=[Candidate.from_dict(c) for c in d.get("candidates", [])],
                   assessment=d.get("assessment"))


@dataclass
class Observation:
    """Everything the model sees at one time step."""
    t: float
    step: int
    targets: List[Target]
    outages: List[str] = field(default_factory=list)   # SVs knocked out by the operator

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Observation":
        return cls(t=float(d["t"]), step=int(d.get("step", 0)), targets=[Target.from_dict(x) for x in d.get("targets", [])],
                   outages=[str(x) for x in d.get("outages", [])])


@dataclass
class Scenario:
    """Scenario description sent once per connection and after every rebuild."""
    region: str
    salvo: int
    mix: str
    arch: str
    dt: float
    duration: float
    svs: List[Dict[str, Any]]       # {id, layer, group, bands, fov_half_deg}
    threats: List[Dict[str, Any]]   # {id, type, site, target, launch_t, impact_t}
    sites: List[Dict[str, Any]]     # {name, lat, lon}

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Scenario":
        return cls(region=str(d.get("region", "")), salvo=int(d.get("salvo", 0)), mix=str(d.get("mix", "")),
                   arch=str(d.get("arch", "")), dt=float(d.get("dt", 10)), duration=float(d.get("duration", 0)),
                   svs=list(d.get("svs", [])), threats=list(d.get("threats", [])), sites=list(d.get("sites", [])))


@dataclass
class Pick:
    """CS2C's custody tasking for one target from time t onward (until the next pick for that target)."""
    t: float
    target: str
    primary: Optional[str]
    partner: Optional[str] = None
    primary_band: Optional[str] = None
    partner_band: Optional[str] = None
    reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        for b in (self.primary_band, self.partner_band):
            if b is not None and b not in BANDS:
                raise ValueError(f"band must be one of {BANDS}, got {b!r}")
        d: Dict[str, Any] = {"t": self.t, "target": self.target, "primary": self.primary, "partner": self.partner}
        if self.primary_band: d["primaryBand"] = self.primary_band
        if self.partner_band: d["partnerBand"] = self.partner_band
        if self.reason: d["reason"] = self.reason[:240]
        return d


def picks_document(picks: List[Pick], model: str) -> Dict[str, Any]:
    """The JSON object the visualizer loads (file) or receives (live)."""
    return {"model": model, "selections": [p.to_dict() for p in picks]}
