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
          "fines", "fine_total", "denials", "ij", "harm", "beds",
          "ij1", "ij2", "ij3", "harm1", "harm2", "harm3", "repeat_severe", "turnover",
          "fine1", "fine2", "fine3", "den1", "den2", "den3"]
F = {name: i for i, name in enumerate(FIELDS)}
MAX_RELEASES = 48
SFF_CODES = {"": 0, "SFF Candidate": 1, "SFF": 2}


def severity_counts(health_def_rows):
    """Per facility: immediate jeopardy (J-L) and actual harm (G-I) health
    citations by inspection cycle, and the number of tags cited at G or
    higher in more than one cycle. Returns {ccn: {"ij": [c1, c2, c3],
    "harm": [c1, c2, c3], "repeat_severe": n}}."""
    out, tags = {}, {}
    for d in health_def_rows:
        code = d["Scope Severity Code"]
        if code not in "GHIJKL" or not code:
            continue
        try:
            k = int(d["Inspection Cycle"]) - 1
        except (TypeError, ValueError):
            continue
        if not 0 <= k <= 2:
            continue
        c = out.setdefault(d[CCN], {"ij": [0, 0, 0], "harm": [0, 0, 0], "repeat_severe": 0})
        c["ij" if code in "JKL" else "harm"][k] += 1
        tags.setdefault(d[CCN], {}).setdefault(d["Deficiency Prefix"] + d["Deficiency Tag Number"], set()).add(k)
    for ccn, t in tags.items():
        out[ccn]["repeat_severe"] = sum(1 for cycles in t.values() if len(cycles) > 1)
    return out


def penalty_ages(penalty_rows, release_date):
    """Per facility: fine dollars and payment denial counts grouped by age at
    the release date: last 12 months, 12 to 24 months, older.
    Returns {ccn: {"fines": [a, b, c], "denials": [a, b, c]}}."""
    y, rest = int(release_date[:4]), release_date[4:]
    cut1, cut2 = f"{y - 1}{rest}", f"{y - 2}{rest}"
    out = {}
    for x in penalty_rows:
        d = x["Penalty Date"]
        k = 0 if d > cut1 else 1 if d > cut2 else 2
        c = out.setdefault(x[CCN], {"fines": [0.0, 0.0, 0.0], "denials": [0, 0, 0]})
        if x["Penalty Type"] == "Fine":
            c["fines"][k] += num(x["Fine Amount"]) or 0
        else:
            c["denials"][k] += 1
    return out


NO_PENALTIES = {"fines": [0.0, 0.0, 0.0], "denials": [0, 0, 0]}


def snapshot(provider_rows, health_def_rows, penalty_rows):
    sev = severity_counts(health_def_rows)
    pens = penalty_ages(penalty_rows, provider_rows[0]["Processing Date"]) if provider_rows else {}
    none = {"ij": [0, 0, 0], "harm": [0, 0, 0], "repeat_severe": 0}
    snap = {}
    for p in provider_rows:
        c = p[CCN]
        s = sev.get(c, none)
        pa = pens.get(c, NO_PENALTIES)
        snap[c] = [
            num(p["Overall Rating"]), num(p["Health Inspection Rating"]), num(p["Staffing Rating"]), num(p["QM Rating"]),
            SFF_CODES.get(p["Special Focus Status"].strip(), 0), 1 if p["Abuse Icon"] == "Y" else 0,
            1 if p["Provider Changed Ownership in Last 12 Months"] == "Y" else 0,
            num(p["Total Weighted Health Survey Score"]), num(p["Number of Fines"]) or 0,
            num(p["Total Amount of Fines in Dollars"]) or 0, num(p["Number of Payment Denials"]) or 0,
            sum(s["ij"]), sum(s["harm"]), num(p["Number of Certified Beds"]),
            s["ij"][0], s["ij"][1], s["ij"][2], s["harm"][0], s["harm"][1], s["harm"][2], s["repeat_severe"],
            num(p.get("Total nursing staff turnover")),
            pa["fines"][0], pa["fines"][1], pa["fines"][2], pa["denials"][0], pa["denials"][1], pa["denials"][2],
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
        # Written by an older pipeline version. The caller falls back to the seed.
        print(f"History file {path} has an older field layout and was not used.")
        return None
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
    """Published star ratings, Special Focus code, abuse icon, and citation counts
    for one facility across releases, oldest first."""
    ds = dates(history)[-limit:]
    keys = ("overall", "health", "staffing", "qm", "sff", "abuse", "ij", "harm")
    out = {"dates": ds}
    for k in keys:
        out[k] = []
    for d in ds:
        row = history["snapshots"][d].get(ccn)
        for k in keys:
            out[k].append(row[F[k]] if row else None)
    return out
