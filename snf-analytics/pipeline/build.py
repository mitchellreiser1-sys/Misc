"""Build the static site data from validated CMS files."""
import json
import os
import shutil
from collections import defaultdict

from . import extras, history as history_mod, risk as risk_mod
from .history import F as HF
from .metrics import flag, num, occupancy, overall_rating_steps, text
from .sources import CCN, FOOTNOTES

STAFFING_ROWS = [
    # (label, provider column, footnote column, State US Averages column or None, decimals)
    ("Total nurse hours per resident day", "Reported Total Nurse Staffing Hours per Resident per Day", "Reported Staffing Footnote", "Reported Total Nurse Staffing Hours per Resident per Day", 2),
    ("RN hours per resident day", "Reported RN Staffing Hours per Resident per Day", "Reported Staffing Footnote", "Reported RN Staffing Hours per Resident per Day", 2),
    ("LPN hours per resident day", "Reported LPN Staffing Hours per Resident per Day", "Reported Staffing Footnote", "Reported LPN Staffing Hours per Resident per Day", 2),
    ("Nurse aide hours per resident day", "Reported Nurse Aide Staffing Hours per Resident per Day", "Reported Staffing Footnote", "Reported Nurse Aide Staffing Hours per Resident per Day", 2),
    ("Weekend total nurse hours per resident day", "Total number of nurse staff hours per resident per day on the weekend", "Reported Staffing Footnote", "Total number of nurse staff hours per resident per day on the weekend", 2),
    ("Weekend RN hours per resident day", "Registered Nurse hours per resident per day on the weekend", "Reported Staffing Footnote", "Registered Nurse hours per resident per day on the weekend", 2),
    ("Physical therapist hours per resident day", "Reported Physical Therapist Staffing Hours per Resident Per Day", "Physical Therapist Staffing Footnote", "Reported Physical Therapist Staffing Hours per Resident Per Day", 3),
    ("Case-mix adjusted total nurse hours per resident day", "Adjusted Total Nurse Staffing Hours per Resident per Day", "Reported Staffing Footnote", None, 2),
    ("Case-mix adjusted RN hours per resident day", "Adjusted RN Staffing Hours per Resident per Day", "Reported Staffing Footnote", None, 2),
    ("Nursing case-mix index", "Nursing Case-Mix Index", "Reported Staffing Footnote", "Nursing Case-Mix Index", 2),
    ("Total nursing staff turnover (%)", "Total nursing staff turnover", "Total nursing staff turnover footnote", "Total nursing staff turnover", 1),
    ("RN turnover (%)", "Registered Nurse turnover", "Registered Nurse turnover footnote", "Registered Nurse turnover", 1),
    ("Administrators who left", "Number of administrators who have left the nursing home", "Administrator turnover footnote", "Number of administrators who have left the nursing home", 1),
]


def _norm(s):
    return " ".join(s.lower().replace("-", " ").split())


def _group(rows):
    out = defaultdict(list)
    for r in rows:
        out[r[CCN]].append(r)
    return out


def _write(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def _risk_validation(site_src):
    """The dated validation study for the current score version, if it matches."""
    path = os.path.join(os.path.dirname(os.path.abspath(site_src)), "seed", "risk_validation.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        v = json.load(f)
    return v if v.get("version") == risk_mod.VERSION else None


def build(data, meta, results, site_src, out_dir, built_at, pipeline_version, extra=None):
    extra = extra or {}
    hist = extra.get("history")
    pbj, vbp, cut_points = extra.get("pbj"), extra.get("vbp"), extra.get("cut_points") or {}
    release_date = data["provider"][0]["Processing Date"]
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    shutil.copytree(site_src, out_dir)
    os.makedirs(os.path.join(out_dir, "data", "f"))

    # Version the script and style links so browsers never run a stale copy
    index_path = os.path.join(out_dir, "index.html")
    with open(index_path, encoding="utf-8") as f:
        html = f.read()
    stamp = f"{pipeline_version}-{built_at}".replace(":", "")
    for asset in ("styles.css", "rollup.js", "app.js"):
        html = html.replace(f'"{asset}"', f'"{asset}?v={stamp}"')
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(html)

    providers = data["provider"]
    averages = {r["State or Nation"]: r for r in data["averages"]}
    avg_cols = {_norm(c): c for c in data["averages"][0].keys()}

    # Measure catalogue and benchmark columns
    measures = {}
    for r in data["qm_mds"] + data["qm_claims"]:
        code = r["Measure Code"]
        if code not in measures:
            measures[code] = {
                "desc": r["Measure Description"], "type": r["Resident type"],
                "period": r["Measure Period"],
                "five_star": flag(r["Used in Quality Measure Five Star Rating"]),
                "source": "Claims" if "Adjusted Score" in r else "MDS",
                "avg_col": avg_cols.get(_norm(r["Measure Description"])),
            }

    benchmarks = {}
    for area, row in averages.items():
        b = {"staffing": {}, "qm": {}, "ratings": {}}
        for label, _, _, avg_col, _ in STAFFING_ROWS:
            if avg_col:
                b["staffing"][label] = num(row.get(avg_col))
        for code, m in measures.items():
            if m["avg_col"]:
                b["qm"][code] = num(row.get(m["avg_col"]))
        for k in ("Overall Rating", "Health Inspection Rating", "QM Rating", "Staffing Rating"):
            b["ratings"][k] = num(row.get(k))
        for k in ("Cycle 1 Total Number of Health Deficiencies", "Cycle 1 Total Number of Fire Safety Deficiencies",
                  "Average Number of Residents per Day", "Number of Fines", "Fine Amount in Dollars"):
            b[k] = num(row.get(k))
        benchmarks[area] = b

    # Shared deficiency description table keeps facility files small and exact
    desc_index, descs = {}, []

    def desc_id(description, category):
        key = (description, category)
        if key not in desc_index:
            desc_index[key] = len(descs)
            descs.append([description, category])
        return desc_index[key]

    health, fire = _group(data["health_def"]), _group(data["fire_def"])
    qm_mds, qm_claims = _group(data["qm_mds"]), _group(data["qm_claims"])
    owners, pens = _group(data["ownership"]), _group(data["penalties"])
    survey_dates = _group(data["survey_dates"])

    # National position of each facility's weighted health survey score (risk score input)
    survey_share = risk_mod.lower_share([v for v in (num(p["Total Weighted Health Survey Score"]) for p in providers) if v is not None])
    severity = history_mod.severity_counts(data["health_def"])
    penalty_age = history_mod.penalty_ages(data["penalties"], release_date)
    no_severe = {"ij": [0, 0, 0], "harm": [0, 0, 0], "repeat_severe": 0}
    index, chains, facs = [], {}, []
    for p in providers:
        ccn = p[CCN]
        beds, residents = num(p["Number of Certified Beds"]), num(p["Average Number of Residents per Day"])
        r_overall, r_health = num(p["Overall Rating"]), num(p["Health Inspection Rating"])
        r_staff, r_qm = num(p["Staffing Rating"]), num(p["QM Rating"])
        steps = overall_rating_steps(r_health, r_staff, r_qm) if r_overall is not None else None

        defs = []
        for kind, rows in (("H", health.get(ccn, [])), ("F", fire.get(ccn, []))):
            for d in rows:
                defs.append([
                    d["Survey Date"], kind, d["Deficiency Prefix"] + d["Deficiency Tag Number"],
                    d["Scope Severity Code"], d["Inspection Cycle"],
                    desc_id(d["Deficiency Description"], d["Deficiency Category"]),
                    1 if d["Standard Deficiency"] == "Y" else 0,
                    1 if d["Complaint Deficiency"] == "Y" else 0,
                    1 if d.get("Infection Control Inspection Deficiency") == "Y" else 0,
                    d["Deficiency Corrected"], d["Correction Date"],
                    1 if (d.get("Citation under IDR") == "Y" or d.get("Citation under IIDR") == "Y") else 0,
                    d.get("Survey Footnote", ""),
                ])
        defs.sort(key=lambda x: (x[0], x[3]), reverse=True)
        repeats = extras.repeat_tags((d[2], d[4]) for d in defs if d[1] == "H")
        harm = sum(1 for d in defs if d[1] == "H" and d[3] in "GHI")
        jeopardy = sum(1 for d in defs if d[1] == "H" and d[3] in "JKL")
        pm = extras.pbj_metrics(pbj.get(ccn)) if pbj else None
        sff_code = history_mod.SFF_CODES.get(p["Special Focus Status"].strip(), 0)
        sev = severity.get(ccn, no_severe)
        weighted = num(p["Total Weighted Health Survey Score"])
        rscore, rparts = risk_mod.score(
            survey_pct=survey_share.get(weighted) if weighted is not None else None,
            ij_cycles=sev["ij"], harm_cycles=sev["harm"], repeat_severe=sev["repeat_severe"],
            sff=sff_code, abuse=p["Abuse Icon"] == "Y", staffing=r_staff,
            turnover=num(p["Total nursing staff turnover"]),
            contract_share=pm["contract_share"] if pm else None, zero_rn_days=pm["zero_rn_days"] if pm else None,
            fines_by_age=penalty_age.get(ccn, history_mod.NO_PENALTIES)["fines"],
            denials_by_age=penalty_age.get(ccn, history_mod.NO_PENALTIES)["denials"],
            qm=r_qm, chow=p["Provider Changed Ownership in Last 12 Months"] == "Y")
        thresholds = cut_points.get(p["State"])

        fac = {
            "ccn": ccn, "name": p["Provider Name"], "legal_name": text(p["Legal Business Name"]),
            "address": p["Provider Address"], "city": p["City/Town"], "state": p["State"],
            "zip": p["ZIP Code"], "county": text(p["County/Parish"]), "phone": text(p["Telephone Number"]),
            "urban": flag(p["Urban"]), "ownership_type": text(p["Ownership Type"]),
            "provider_type": text(p["Provider Type"]), "in_hospital": flag(p["Provider Resides in Hospital"]),
            "certified": text(p["Date First Approved to Provide Medicare and Medicaid Services"]),
            "ccrc": flag(p["Continuing Care Retirement Community"]),
            "chain": {"name": text(p["Chain Name"]), "id": text(p["Chain ID"]),
                      "count": num(p["Number of Facilities in Chain"]),
                      "avg_overall": num(p["Chain Average Overall 5-star Rating"])} if text(p["Chain Name"]) else None,
            "sff": text(p["Special Focus Status"]), "abuse": flag(p["Abuse Icon"]),
            "high_performing": flag(p["High Performing Icon"]),
            "insp_over_2y": flag(p["Most Recent Health Inspection More Than 2 Years Ago"]),
            "chow_12m": flag(p["Provider Changed Ownership in Last 12 Months"]),
            "sprinklers": text(p["Automatic Sprinkler Systems in All Required Areas"]),
            "beds": beds, "residents": residents,
            "residents_fn": text(p["Average Number of Residents per Day Footnote"]),
            "occupancy": occupancy(residents, beds),
            "ratings": {
                "overall": [r_overall, text(p["Overall Rating Footnote"])],
                "health": [r_health, text(p["Health Inspection Rating Footnote"])],
                "staffing": [r_staff, text(p["Staffing Rating Footnote"])],
                "qm": [r_qm, text(p["QM Rating Footnote"])],
                "qm_long": [num(p["Long-Stay QM Rating"]), text(p["Long-Stay QM Rating Footnote"])],
                "qm_short": [num(p["Short-Stay QM Rating"]), text(p["Short-Stay QM Rating Footnote"])],
            },
            "star_steps": steps,
            "staffing": [[label, num(p[col]), text(p[fn]), dec] for label, col, fn, _, dec in STAFFING_ROWS],
            "survey": {
                "c1": {"date": text(p["Rating Cycle 1 Standard Survey Health Date"]),
                       "fn": text(p["Rating Cycle 1 Standard Survey Footnote"]),
                       "total": num(p["Rating Cycle 1 Total Number of Health Deficiencies"]),
                       "standard": num(p["Rating Cycle 1 Number of Standard Health Deficiencies"]),
                       "complaint": num(p["Rating Cycle 1 Number of Complaint Health Deficiencies"]),
                       "def_score": num(p["Rating Cycle 1 Health Deficiency Score"]),
                       "revisits": num(p["Rating Cycle 1 Number of Health Revisits"]),
                       "revisit_score": num(p["Rating Cycle 1 Health Revisit Score"]),
                       "score": num(p["Rating Cycle 1 Total Health Score"])},
                "c23": {"date": text(p["Rating Cycle 2 Standard Health Survey Date"]),
                        "fn": text(p["Rating Cycle 2 Standard Survey Footnote"]),
                        "total": num(p["Rating Cycle 2/3 Total Number of Health Deficiencies"]),
                        "standard": None,
                        "complaint": num(p["Rating Cycle 2/3 Number of Complaint Health Deficiencies"]),
                        "def_score": num(p["Rating Cycle 2/3 Health Deficiency Score"]),
                        "revisits": num(p["Rating Cycle 2/3 Number of Health Revisits"]),
                        "revisit_score": num(p["Rating Cycle 2/3 Health Revisit Score"]),
                        "score": num(p["Rating Cycle 2/3 Total Health Score"])},
                "weighted": num(p["Total Weighted Health Survey Score"]),
                "infection_citations": num(p["Number of Citations from Infection Control Inspections"]),
            },
            "deficiencies": defs,
            "penalties": {
                "fines": num(p["Number of Fines"]), "fine_total": num(p["Total Amount of Fines in Dollars"]),
                "denials": num(p["Number of Payment Denials"]),
                "rows": sorted(([x["Penalty Date"], x["Penalty Type"], num(x["Fine Amount"]),
                                 text(x["Payment Denial Start Date"]), num(x["Payment Denial Length in Days"])]
                                for x in pens.get(ccn, [])), key=lambda x: x[0], reverse=True),
            },
            "qm": [[x["Measure Code"], num(x["Four Quarter Average Score"]),
                    text(x["Footnote for Four Quarter Average Score"]),
                    [num(x[f"Q{i} Measure Score"]) for i in (1, 2, 3, 4)]] for x in qm_mds.get(ccn, [])]
                  + [[x["Measure Code"], num(x["Adjusted Score"]), text(x["Footnote for Score"]),
                      None, num(x["Observed Score"]), num(x["Expected Score"])] for x in qm_claims.get(ccn, [])],
            "owners": [[x["Role played by Owner or Manager in Facility"], text(x["Owner Type"]), text(x["Owner Name"]),
                        text(x["Ownership Percentage"]), text(x["Association Date"])] for x in owners.get(ccn, [])],
            "repeat": repeats,
            "surveys": sorted(([x["Survey Date"], x["Type of Survey"], x["Survey Cycle"]] for x in survey_dates.get(ccn, [])),
                              key=lambda x: (x[0], x[1]), reverse=True),
            "history": history_mod.series(hist, ccn) if hist else None,
            "cut": {"thresholds": thresholds,
                    "band": extras.cut_point_band(num(p["Total Weighted Health Survey Score"]), thresholds),
                    "pos": extras.band_position(num(p["Total Weighted Health Survey Score"]), thresholds)} if thresholds else None,
            "pbj": pm,
            "vbp": vbp.get(ccn) if vbp else None,
            "risk": {"score": rscore, "parts": rparts, "tier": risk_mod.tier(rscore),
                     "survey_pct": round(100 * survey_share[weighted]) if weighted is not None else None},
        }
        facs.append(fac)
        # Column order is mirrored in site/app.js (IX). Append only.
        index.append([ccn, p["Provider Name"], p["City/Town"], p["State"], p["ZIP Code"],
                      p["County/Parish"], p["Chain Name"], r_overall, beds,
                      p["Special Focus Status"], 1 if p["Abuse Icon"] == "Y" else 0,
                      r_health, r_staff, r_qm, residents,
                      num(p["Reported Total Nurse Staffing Hours per Resident per Day"]),
                      num(p["Reported RN Staffing Hours per Resident per Day"]),
                      num(p["Total nursing staff turnover"]),
                      num(p["Rating Cycle 1 Total Number of Health Deficiencies"]),
                      num(p["Total Weighted Health Survey Score"]),
                      num(p["Number of Fines"]), num(p["Total Amount of Fines in Dollars"]),
                      num(p["Number of Payment Denials"]),
                      1 if p["Provider Changed Ownership in Last 12 Months"] == "Y" else 0,
                      p["Chain ID"], harm, jeopardy, rscore, len(repeats)])
        if text(p["Chain ID"]) and p["Chain ID"] not in chains:
            chains[p["Chain ID"]] = {
                "name": p["Chain Name"], "count": num(p["Number of Facilities in Chain"]),
                "overall": num(p["Chain Average Overall 5-star Rating"]),
                "health": num(p["Chain Average Health Inspection Rating"]),
                "staffing": num(p["Chain Average Staffing Rating"]),
                "qm": num(p["Chain Average QM Rating"])}

    # Risk score percentiles need every facility's score, so facility files are written last
    us_pct = risk_mod.percentiles([f["risk"]["score"] for f in facs])
    by_state = defaultdict(list)
    for f in facs:
        by_state[f["state"]].append(f["risk"]["score"])
    state_pct = {s: risk_mod.percentiles(v) for s, v in by_state.items()}
    for f in facs:
        f["risk"]["pct_us"] = us_pct[f["risk"]["score"]]
        f["risk"]["pct_state"] = state_pct[f["state"]][f["risk"]["score"]]
        _write(os.path.join(out_dir, "data", "f", f"{f['ccn']}.json"), f)

    position = {row[0]: i for i, row in enumerate(index)}
    _write(os.path.join(out_dir, "data", "owners.json"), extras.owner_index(data["ownership"], position))
    if extra.get("changes"):
        _write(os.path.join(out_dir, "data", "changes.json"), extra["changes"])
    _write(os.path.join(out_dir, "data", "portfolios.json"),
           extras.load_shared_portfolios(os.path.join(os.path.dirname(os.path.abspath(site_src)), "portfolios.json")))

    # Backtest the score over each 12-month span the release history covers
    backtest = []
    if hist:
        ds = history_mod.dates(hist)
        months = lambda d: int(d[:4]) * 12 + int(d[5:7])
        end = release_date
        while True:
            earlier = [d for d in ds if abs(months(d) - (months(end) - 12)) <= 2]
            if not earlier:
                break
            start = min(earlier, key=lambda d: abs(months(d) - (months(end) - 12)))
            bt = risk_mod.backtest(hist["snapshots"], start, end)
            if bt:
                backtest.append(bt)
            end = start

    for m in measures.values():
        m.pop("avg_col")
    processing = providers[0]["Processing Date"]
    manifest = {
        "built_at": built_at, "pipeline_version": pipeline_version,
        "processing_date": processing, "facility_count": len(providers),
        "datasets": meta, "checks": results,
        "has_changes": bool(extra.get("changes")),
        # Lets the site open portfolio save and delete requests against this repository
        "repo": os.environ.get("GITHUB_REPOSITORY"),
        "changes_from": extra["changes"]["from"] if extra.get("changes") else None,
    }
    _write(os.path.join(out_dir, "data", "index.json"), index)
    _write(os.path.join(out_dir, "data", "lookups.json"),
           {"descs": descs, "measures": measures, "benchmarks": benchmarks, "footnotes": FOOTNOTES,
            "chains": chains,
            "risk": {"name": risk_mod.NAME, "version": risk_mod.VERSION, "components": risk_mod.COMPONENTS,
                     "tiers": risk_mod.TIERS, "backtest": backtest,
                     "us_percentiles": us_pct, "validation": _risk_validation(site_src)},
            "pbj": {"quarter": extra.get("pbj_quarter"), "period": extra.get("pbj_period")} if pbj else None,
            "vbp_fy": extra.get("vbp_fy"),
            "history_releases": len(history_mod.dates(hist)) if hist else 0})
    with open(os.path.join(out_dir, "data", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    return manifest
