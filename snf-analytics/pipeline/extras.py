"""Supplementary metrics built from published CMS rows.

Each function is small, deterministic, and unit tested. Anything derived is
labeled as derived on screen."""
import csv
import datetime
from collections import defaultdict

from .metrics import num
from .sources import CCN

NURSE_COLS = ["Hrs_RNDON", "Hrs_RNadmin", "Hrs_RN", "Hrs_LPNadmin", "Hrs_LPN", "Hrs_CNA", "Hrs_NAtrn", "Hrs_MedAide"]
RN_COLS = ["Hrs_RNDON", "Hrs_RNadmin", "Hrs_RN"]
PBJ_REQUIRED = ["PROVNUM", "CY_Qtr", "WorkDate", "MDScensus"] + NURSE_COLS + [c + "_ctr" for c in NURSE_COLS]


def repeat_tags(health_rows):
    """Health deficiency tags cited in more than one inspection cycle.

    health_rows: iterable of (tag, cycle). Returns a sorted list of tags."""
    cycles = defaultdict(set)
    for tag, cycle in health_rows:
        cycles[tag].add(cycle)
    return sorted(t for t, c in cycles.items() if len(c) > 1)


def parse_cut_points(rows):
    """State health inspection cut points: {state: [max score for 5, 4, 3, 2 stars]}."""
    out = {}
    for r in rows:
        out[r["State"]] = [float(r[k].split("-")[1]) for k in ("5 Stars", "4 Stars", "3 Stars", "2 Stars")]
    return out


def cut_point_band(score, thresholds):
    """Star band a weighted health score falls in under the state's current cut points."""
    if score is None or not thresholds:
        return None
    for stars, top in zip((5, 4, 3, 2), thresholds):
        if score <= top:
            return stars
    return 1


def band_position(score, thresholds):
    """Where a weighted health score sits inside its star band under the state's
    current cut points. Lower scores are better.

    Returns {band, lower, upper, to_better, to_worse, label}:
      to_better  points the score would need to fall to reach the next higher star (None at 5 stars)
      to_worse   points the score could rise before reaching the next lower star (None at 1 star)
      label      "High", "Mid", or "Low" within the band by thirds (None at 1 star, which has no floor)
    Pure arithmetic on two published numbers. It describes the current cut
    points only and is not a forecast."""
    band = cut_point_band(score, thresholds)
    if band is None:
        return None
    bounds = [0.0] + list(thresholds)            # upper edge of 5,4,3,2 star bands, preceded by zero
    i = 5 - band                                  # 0 for 5 stars ... 4 for 1 star
    lower = bounds[i]
    upper = bounds[i + 1] if band > 1 else None
    out = {"band": band, "lower": lower, "upper": upper,
           "to_better": round(score - lower, 3) if band < 5 else None,
           "to_worse": round(upper - score, 3) if upper is not None else None, "label": None}
    if upper is not None and upper > lower:
        share = (upper - score) / (upper - lower)   # 1.0 at the best edge of the band
        out["label"] = "High" if share >= 2 / 3 else "Low" if share < 1 / 3 else "Mid"
    return out


def read_pbj(path):
    """Roll the Payroll Based Journal daily file up to one row per facility.

    Returns ({ccn: {...}}, quarter, header). Hours follow CMS's nurse staffing
    definition: RN (including DON and administrative), LPN (including
    administrative), and nurse aides (including aides in training and
    medication aides)."""
    agg = {}
    quarter = None
    with open(path, encoding="latin-1", newline="") as fh:
        rd = csv.reader(fh)
        header = next(rd)
        if any(c not in header for c in PBJ_REQUIRED):
            return None, None, header
        ix = {c: i for i, c in enumerate(header)}
        nurse = [ix[c] for c in NURSE_COLS]
        ctr = [ix[c + "_ctr"] for c in NURSE_COLS]
        rn = [ix[c] for c in RN_COLS]
        for r in rd:
            a = agg.get(r[ix["PROVNUM"]])
            if a is None:
                a = agg[r[ix["PROVNUM"]]] = {"census": 0.0, "hours": 0.0, "rn": 0.0, "contract": 0.0, "days": 0,
                                             "zero_rn_days": 0, "we_census": 0.0, "we_hours": 0.0}
                quarter = quarter or r[ix["CY_Qtr"]]
            hours = sum(float(r[i] or 0) for i in nurse)
            rn_hours = sum(float(r[i] or 0) for i in rn)
            census = float(r[ix["MDScensus"]] or 0)
            a["census"] += census
            a["hours"] += hours
            a["rn"] += rn_hours
            a["contract"] += sum(float(r[i] or 0) for i in ctr)
            a["days"] += 1
            if rn_hours == 0:
                a["zero_rn_days"] += 1
            d = r[ix["WorkDate"]]
            if datetime.date(int(d[:4]), int(d[4:6]), int(d[6:8])).weekday() >= 5:
                a["we_census"] += census
                a["we_hours"] += hours
    return agg, quarter, header


def pbj_metrics(a):
    """Derived staffing detail for one facility from its PBJ rollup."""
    if not a or not a["hours"]:
        return None
    return {
        "hprd": a["hours"] / a["census"] if a["census"] else None,
        "contract_share": a["contract"] / a["hours"],
        "zero_rn_days": a["zero_rn_days"],
        "days": a["days"],
    }


def owner_index(ownership_rows, ccn_position):
    """Index of owner and manager names across all facilities.

    Names are matched exactly as CMS publishes them. Returns
    {"names": [...], "types": [...], "roles": [...], "links": [[ [facility index, role index, percent], ...], ...]}"""
    roles, role_ix = [], {}
    by_name = {}
    for r in ownership_rows:
        name = r["Owner Name"].strip()
        if not name:
            continue
        role = r["Role played by Owner or Manager in Facility"]
        if role not in role_ix:
            role_ix[role] = len(roles)
            roles.append(role)
        entry = by_name.setdefault(name, [r["Owner Type"][:1], []])
        entry[1].append([ccn_position[r[CCN]], role_ix[role], "" if r["Ownership Percentage"] == "NOT APPLICABLE" else r["Ownership Percentage"]])
    names = sorted(by_name)
    return {"names": names, "types": [by_name[n][0] for n in names], "roles": roles, "links": [by_name[n][1] for n in names]}


def load_shared_portfolios(path):
    """Portfolios published with the site, from portfolios.json in the repo.

    THE SITE IS PUBLIC: anything in that file is visible to anyone. Returns
    [{"id", "name", "ccns"}]. Raises ValueError on a malformed file so a typo
    stops the refresh instead of silently dropping a portfolio."""
    import json
    import os
    import re
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, list):
        raise ValueError("portfolios.json must be a list")
    out, seen = [], set()
    for p in raw:
        name = str(p.get("name", "")).strip() if isinstance(p, dict) else ""
        ccns = p.get("ccns") if isinstance(p, dict) else None
        if not name or not isinstance(ccns, list) or not ccns:
            raise ValueError("Each portfolio needs a name and a list of CCNs")
        clean = []
        for c in ccns:
            c = str(c).strip().upper()
            if not re.fullmatch(r"[0-9A-Z]{6}", c):
                raise ValueError(f"'{c}' in portfolio '{name}' is not a six-character CCN")
            if c not in clean:
                clean.append(c)
        pid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "portfolio"
        if pid in seen:
            raise ValueError(f"Two portfolios share the name '{name}'")
        seen.add(pid)
        out.append({"id": pid, "name": name, "ccns": clean})
    return out


VBP_REQUIRED = [CCN, "SNF VBP Program Ranking", "Performance Score", "Incentive Payment Multiplier"]


def vbp_by_ccn(rows):
    out = {}
    for r in rows:
        out[r[CCN]] = {"ranking": num(r["SNF VBP Program Ranking"]), "score": num(r["Performance Score"]),
                       "multiplier": num(r["Incentive Payment Multiplier"])}
    return out
