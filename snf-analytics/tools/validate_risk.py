"""Validation study for the Bravo risk score.

  python -m tools.validate_risk <folder of CMS archive zips> <folder of PBJ files> seed/risk_validation.json

For each scoring date, every facility is scored with pipeline.risk.score using
only what CMS had published on that date. The following 12 months are then
checked, using survey and penalty dates in the later release, for a serious
regulatory event: an immediate jeopardy citation, a payment denial, or new
SFF or SFF candidate status.

Needs scikit-learn for the ranking statistic. It is a one-off study tool and
is not part of the daily refresh. Rerun it whenever the scoring rules change;
the site only shows a study whose version matches the live score.

PBJ files must be named pbj_<scoring date>.csv, for example pbj_2025-10-01.csv,
and hold the quarter CMS used for staffing in that release."""
import csv
import datetime
import io
import json
import os
import sys
import zipfile

from sklearn.metrics import roc_auc_score

from pipeline import extras, history, risk
from pipeline.metrics import num
from pipeline.sources import CCN

# (archive holding the scoring release, scoring date, archive holding the release 12 months later, that date)
PAIRS = [("2023-10-02", "2023-10-01", "2024-10-30", "2024-10-01"),
         ("2024-10-30", "2024-10-01", "2025-11-20", "2025-10-01"),
         ("2025-11-20", "2025-10-01", "2026-10-28", "2026-10-01")]
BANDS = [(0, 9), (10, 19), (20, 29), (30, 39), (40, 49), (50, 59), (60, 100)]


def read(z, token):
    name = [n for n in z.namelist() if token in n][0]
    with z.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def study_year(arch, pbj_dir, fa, da, fb, db):
    za, zb = zipfile.ZipFile(f"{arch}/{fa}.zip"), zipfile.ZipFile(f"{arch}/{fb}.zip")
    providers = read(za, "NH_ProviderInfo")
    sev = history.severity_counts(read(za, "NH_HealthCitations"))
    pens = history.penalty_ages(read(za, "NH_Penalties"), da)
    none = {"ij": [0, 0, 0], "harm": [0, 0, 0], "repeat_severe": 0}
    share = risk.lower_share([v for v in (num(p["Total Weighted Health Survey Score"]) for p in providers) if v is not None])
    pbj_path = os.path.join(pbj_dir, f"pbj_{da}.csv")
    pbj = extras.read_pbj(pbj_path)[0] if os.path.exists(pbj_path) else None

    later = {p[CCN]: p for p in read(zb, "NH_ProviderInfo")}
    event = set()
    for d in read(zb, "NH_HealthCitations"):
        if d["Survey Date"] > da and d["Scope Severity Code"] in ("J", "K", "L"):
            event.add(d[CCN])
    for x in read(zb, "NH_Penalties"):
        if x["Penalty Date"] > da and x["Penalty Type"] != "Fine":
            event.add(x[CCN])

    rows = []
    for p in providers:
        ccn = p[CCN]
        l = later.get(ccn)
        if l is None:
            continue
        s = sev.get(ccn, none)
        w = num(p["Total Weighted Health Survey Score"])
        m = extras.pbj_metrics(pbj.get(ccn)) if pbj else None
        sff = history.SFF_CODES.get(p["Special Focus Status"].strip(), 0)
        total, parts = risk.score(
            survey_pct=share.get(w) if w is not None else None, ij_cycles=s["ij"], harm_cycles=s["harm"],
            repeat_severe=s["repeat_severe"], sff=sff, abuse=p["Abuse Icon"] == "Y", staffing=num(p["Staffing Rating"]),
            turnover=num(p.get("Total nursing staff turnover")), contract_share=m["contract_share"] if m else None,
            zero_rn_days=m["zero_rn_days"] if m else None,
            fines_by_age=pens.get(ccn, history.NO_PENALTIES)["fines"], denials_by_age=pens.get(ccn, history.NO_PENALTIES)["denials"],
            qm=num(p["QM Rating"]),
            chow=p["Provider Changed Ownership in Last 12 Months"] == "Y")
        had = ccn in event or history.SFF_CODES.get(l["Special Focus Status"].strip(), 0) > sff
        rows.append((total, parts, int(had), share.get(w, 0.0) if w is not None else 0.0))
    return rows


def main(arch, pbj_dir, out):
    years, pooled = [], []
    for fa, da, fb, db in PAIRS:
        rows = study_year(arch, pbj_dir, fa, da, fb, db)
        pooled += rows
        y = [r[2] for r in rows]
        by_score = sorted(rows, key=lambda r: -r[0])
        n, events = len(rows), sum(y)
        top = by_score[:n // 10]
        years.append({
            "as_of": da, "through": db, "facilities": n, "event_rate": events / n,
            "auc": roc_auc_score(y, [r[0] for r in rows]), "auc_cms": roc_auc_score(y, [r[3] for r in rows]),
            "top10_share": sum(r[2] for r in top) / events, "top10_rate": sum(r[2] for r in top) / len(top),
            "bottom20_rate": sum(r[2] for r in by_score[-(n // 5):]) / (n // 5),
            "tiers": [[label, lo, hi, sum(1 for r in rows if lo <= r[0] <= hi),
                       (sum(r[2] for r in rows if lo <= r[0] <= hi) / max(1, sum(1 for r in rows if lo <= r[0] <= hi)))] for lo, hi, label in risk.TIERS],
            "bands": [[lo, hi, sum(1 for r in rows if lo <= r[0] <= hi),
                       (sum(r[2] for r in rows if lo <= r[0] <= hi) / max(1, sum(1 for r in rows if lo <= r[0] <= hi)))] for lo, hi in BANDS],
        })
        print(da, "->", db, f"n={n} events={events / n:.1%} AUC={years[-1]['auc']:.3f} CMS score AUC={years[-1]['auc_cms']:.3f}")
    y = [r[2] for r in pooled]
    base = roc_auc_score(y, [r[0] for r in pooled])
    components = []
    for key, label, *_ in risk.COMPONENTS:
        applies = sum(1 for r in pooled if r[1][key] > 0) / len(pooled)
        on = [r[2] for r in pooled if r[1][key] > 0]
        off = [r[2] for r in pooled if r[1][key] == 0]
        components.append({"key": key, "label": label, "applies": applies,
                           "rate_with": sum(on) / len(on) if on else None, "rate_without": sum(off) / len(off) if off else None,
                           "auc_without": roc_auc_score(y, [r[0] - r[1][key] for r in pooled]) - base})
    result = {
        "version": risk.VERSION, "run_date": datetime.date.today().isoformat(),
        "outcome": "An immediate jeopardy citation or payment denial dated in the 12 months after the scoring date, or new SFF or SFF candidate status",
        "years": years, "pooled_auc": base, "pooled_auc_cms": roc_auc_score(y, [r[3] for r in pooled]),
        "prior_versions": [{"name": "Version 3", "pooled_auc": 0.688}, {"name": "Version 2", "pooled_auc": 0.690},
                           {"name": "Draft v1", "pooled_auc": 0.678}],
        "components": components,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=1)
    print(f"pooled AUC {base:.3f}; CMS weighted health score alone {result['pooled_auc_cms']:.3f}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
