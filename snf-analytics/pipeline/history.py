"""Release history: a compact snapshot of key published values per facility
for each CMS release. Drives rating history, change tracking, and the risk
score backtest. Values are copied from CMS files, never derived, except the
two citation counts which are simple counts of published deficiency rows."""
import gzip
import json
import os

from .metrics import num
from .sources import CCN

FIELDS = ["overall", "health", "staffing", "qm", "sff", "abuse", "chow", "weighted",
          "fines", "fine_total", "denials", "ij", "harm", "beds"]
F = {name: i for i, name in enumerate(FIELDS)}
MAX_RELEASES = 48
SFF_CODES = {"": 0, "SFF Candidate": 1, "SFF": 2}


def severity_counts(health_def_rows):
    """Health citations at immediate jeopardy (J-L) and actual harm (G-I) per facility."""
    ij, harm = {}, {}
    for d in health_def_rows:
        code = d["Scope Severity Code"]
        if code in ("J", "K", "L"):
            ij[d[CCN]] = ij.get(d[CCN], 0) + 1
        elif code in ("G", "H", "I"):
            harm[d[CCN]] = harm.get(d[CCN], 0) + 1
    return ij, harm


def snapshot(provider_rows, health_def_rows):
    ij, harm = severity_counts(health_def_rows)
    snap = {}
    for p in provider_rows:
        c = p[CCN]
        snap[c] = [
            num(p["Overall Rating"]), num(p["Health Inspection Rating"]), num(p["Staffing Rating"]), num(p["QM Rating"]),
            SFF_CODES.get(p["Special Focus Status"].strip(), 0), 1 if p["Abuse Icon"] == "Y" else 0,
            1 if p["Provider Changed Ownership in Last 12 Months"] == "Y" else 0,
            num(p["Total Weighted Health Survey Score"]), num(p["Number of Fines"]) or 0,
            num(p["Total Amount of Fines in Dollars"]) or 0, num(p["Number of Payment Denials"]) or 0,
            ij.get(c, 0), harm.get(c, 0), num(p["Number of Certified Beds"]),
        ]
    return snap


def empty():
    return {"fields": FIELDS, "snapshots": {}}


def load(path):
    if not path or not os.path.exists(path):
        return None
    with gzip.open(path, "rt", encoding="utf-8") as f:
        h = json.load(f)
    if h.get("fields") != FIELDS:
        raise ValueError("History file has a different field layout than this pipeline expects.")
    return h


def save(history, path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as f:
        json.dump(history, f, separators=(",", ":"))


def add_release(history, date, snap):
    """Add or replace the snapshot for a processing date, keeping the newest MAX_RELEASES."""
    history["snapshots"][date] = snap
    for old in sorted(history["snapshots"])[:-MAX_RELEASES]:
        del history["snapshots"][old]
    return history


def dates(history):
    return sorted(history["snapshots"])


def previous_date(history, date):
    earlier = [d for d in dates(history) if d < date]
    return earlier[-1] if earlier else None


def series(history, ccn, limit=36):
    """Published star ratings for one facility across releases, oldest first."""
    ds = dates(history)[-limit:]
    out = {"dates": ds, "overall": [], "health": [], "staffing": [], "qm": []}
    for d in ds:
        row = history["snapshots"][d].get(ccn)
        for k in ("overall", "health", "staffing", "qm"):
            out[k].append(row[F[k]] if row else None)
    return out
