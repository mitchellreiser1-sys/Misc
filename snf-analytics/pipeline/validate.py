"""Reconciliation gates. A failed gate stops the refresh before anything publishes.

Levels:
  gate  the refresh fails and the previously published data stays live
  info  reported on the Data Status page but does not block publishing
"""
import statistics
from collections import Counter, defaultdict

from .metrics import num, recomputed_overall, weighted_health_score
from .sources import CCN, DATASETS

# Provider-level columns whose simple mean ties to the CMS State US Averages
# file. Columns in INFO_AVERAGES are known to differ slightly in a few states
# (CMS applies exclusions that are not published), so they are reported only.
GATE_AVERAGES = [
    "Overall Rating", "Health Inspection Rating", "QM Rating", "Staffing Rating",
    "Average Number of Residents per Day",
    "Reported Nurse Aide Staffing Hours per Resident per Day",
    "Reported LPN Staffing Hours per Resident per Day",
    "Reported RN Staffing Hours per Resident per Day",
    "Reported Licensed Staffing Hours per Resident per Day",
    "Reported Total Nurse Staffing Hours per Resident per Day",
    "Total number of nurse staff hours per resident per day on the weekend",
    "Registered Nurse hours per resident per day on the weekend",
    "Reported Physical Therapist Staffing Hours per Resident Per Day",
    "Total nursing staff turnover",
    "Number of administrators who have left the nursing home",
    "Number of Fines",
]
INFO_AVERAGES = [
    "Registered Nurse turnover", "Nursing Case-Mix Index",
    "Case-Mix RN Staffing Hours per Resident per Day",
    "Case-Mix Total Nurse Staffing Hours per Resident per Day",
    "Case-Mix Weekend Total Nurse Staffing Hours per Resident per Day",
]
PROVIDER_COUNT_RANGE = (13000, 17000)
MAX_PROVIDER_COUNT_CHANGE = 0.05


def _result(cid, name, level, ok, detail):
    status = "pass" if ok else ("fail" if level == "gate" else "warn")
    return {"id": cid, "name": name, "level": level, "status": status, "detail": detail}


def check_schema(headers):
    """headers: {dataset key: list of column names}"""
    missing = {}
    for key, spec in DATASETS.items():
        have = set(headers.get(key, []))
        gone = [c for c in spec["required"] if c not in have]
        if gone:
            missing[spec["title"]] = gone
    detail = "All required columns present in all files." if not missing else \
        "Missing columns: " + "; ".join(f"{t}: {', '.join(c)}" for t, c in missing.items())
    return _result("schema", "File layouts match what the pipeline expects", "gate", not missing, detail)


def check_release_consistency(meta, data):
    mods = {m["modified"] for m in meta.values()}
    dates = set()
    for key, rows in data.items():
        dates |= {r["Processing Date"] for r in rows}
    ok = len(mods) == 1 and len(dates) == 1
    detail = f"CMS release dates: {sorted(mods)}; processing dates in files: {sorted(dates)}."
    return _result("release", "All files come from the same CMS release", "gate", ok, detail)


def check_provider_count(providers, previous_count):
    n = len(providers)
    ccns = [r[CCN] for r in providers]
    dupes = len(ccns) - len(set(ccns))
    lo, hi = PROVIDER_COUNT_RANGE
    ok = lo <= n <= hi and dupes == 0
    detail = f"{n:,} facilities, {dupes} duplicate CCNs."
    if previous_count:
        change = abs(n - previous_count) / previous_count
        ok = ok and change <= MAX_PROVIDER_COUNT_CHANGE
        detail += f" Prior refresh had {previous_count:,} ({change:.2%} change)."
    return _result("count", "Facility count is plausible and CCNs are unique", "gate", ok, detail)


def check_orphans(data):
    known = {r[CCN] for r in data["provider"]}
    bad = {}
    for key in ("health_def", "fire_def", "qm_mds", "qm_claims", "ownership", "penalties"):
        orphans = {r[CCN] for r in data[key]} - known
        if orphans:
            bad[DATASETS[key]["title"]] = len(orphans)
    detail = "Every record in every file belongs to a facility in Provider Information." if not bad else \
        "Facilities missing from Provider Information: " + ", ".join(f"{t} ({n})" for t, n in bad.items())
    return _result("orphans", "Detail files tie to the facility list", "gate", not bad, detail)


def _average_misses(providers, averages, column):
    by_state = defaultdict(list)
    for r in providers:
        v = num(r.get(column))
        if v is not None:
            by_state[r["State"]].append(v)
            by_state["NATION"].append(v)
    misses, compared = [], 0
    for row in averages:
        area, published = row["State or Nation"], row.get(column, "")
        pub = num(published)
        if pub is None or not by_state.get(area):
            continue
        decimals = len(published.split(".")[1]) if "." in published else 0
        tolerance = 0.5 * 10 ** -decimals + 2e-5
        compared += 1
        if abs(statistics.fmean(by_state[area]) - pub) > tolerance:
            misses.append(area)
    return misses, compared


def check_averages(providers, averages):
    results = []
    failed, compared_total = {}, 0
    for col in GATE_AVERAGES:
        misses, compared = _average_misses(providers, averages, col)
        compared_total += compared
        if misses:
            failed[col] = misses
    detail = (f"{len(GATE_AVERAGES)} metrics recomputed from facility records for every state and the "
              f"nation ({compared_total:,} comparisons); all tie to CMS's published averages.") if not failed else \
        "Do not tie: " + "; ".join(f"{c} ({', '.join(m)})" for c, m in failed.items())
    results.append(_result("averages", "State and national averages tie to CMS", "gate", not failed, detail))
    notes = []
    for col in INFO_AVERAGES:
        misses, compared = _average_misses(providers, averages, col)
        if misses:
            notes.append(f"{col}: {len(misses)} of {compared} areas differ ({', '.join(misses)})")
    detail = "All tie." if not notes else "; ".join(notes) + ". CMS's published average is shown in the tool; this is noted for transparency."
    results.append(_result("averages_info", "Case-mix and RN turnover averages (informational)", "info", not notes, detail))
    return results


def check_star_rebuild(providers):
    rated = mismatched = 0
    examples = []
    for r in providers:
        published = num(r["Overall Rating"])
        if published is None:
            continue
        rated += 1
        rebuilt = recomputed_overall(num(r["Health Inspection Rating"]), num(r["Staffing Rating"]), num(r["QM Rating"]))
        if rebuilt != published:
            mismatched += 1
            if len(examples) < 10:
                examples.append(r[CCN])
    ok = rated > 0 and mismatched == 0
    detail = f"Overall rating rebuilt from component ratings for {rated:,} rated facilities; {rated - mismatched:,} match CMS."
    if examples:
        detail += " Mismatched CCNs: " + ", ".join(examples) + "."
    return _result("stars", "Overall star ratings rebuild to the published value", "gate", ok, detail)


def check_weighted_score(providers):
    checked = bad = 0
    for r in providers:
        published = num(r["Total Weighted Health Survey Score"])
        if published is None:
            continue
        checked += 1
        calc = weighted_health_score(num(r["Rating Cycle 1 Total Health Score"]), num(r["Rating Cycle 2/3 Total Health Score"]))
        if calc is None or abs(calc - published) > 0.01:
            bad += 1
    ok = checked > 0 and bad == 0
    return _result("weighted", "Weighted health survey scores tie to cycle scores", "gate", ok,
                   f"{checked:,} facilities checked; {bad} do not tie.")


def check_penalties(providers, penalties):
    fines, amount, denials = Counter(), Counter(), Counter()
    for p in penalties:
        if p["Penalty Type"] == "Fine":
            fines[p[CCN]] += 1
            amount[p[CCN]] += num(p["Fine Amount"]) or 0
        else:
            denials[p[CCN]] += 1
    bad = 0
    for r in providers:
        c = r[CCN]
        if (num(r["Number of Fines"]) or 0) != fines[c] or (num(r["Number of Payment Denials"]) or 0) != denials[c] \
                or abs((num(r["Total Amount of Fines in Dollars"]) or 0) - amount[c]) > 1:
            bad += 1
    return _result("penalties", "Penalty detail ties to facility penalty totals", "gate", bad == 0,
                   f"Fine counts, fine dollars, and payment denials compared for {len(providers):,} facilities; {bad} do not tie.")


CHAIN_RATINGS = [
    ("Chain Average Overall 5-star Rating", "Overall Rating"),
    ("Chain Average Health Inspection Rating", "Health Inspection Rating"),
    ("Chain Average Staffing Rating", "Staffing Rating"),
    ("Chain Average QM Rating", "QM Rating"),
]


def check_chain_rollups(providers):
    """Portfolio rollups use a simple average of rated facilities. CMS publishes
    the same figure for every chain, so the method is proven on each refresh."""
    chains = defaultdict(list)
    for r in providers:
        if r["Chain ID"].strip():
            chains[r["Chain ID"]].append(r)
    compared, bad = 0, []
    for cid, members in chains.items():
        count = num(members[0]["Number of Facilities in Chain"])
        if count is not None and count != len(members):
            bad.append(cid)
            continue
        for chain_col, col in CHAIN_RATINGS:
            published = num(members[0][chain_col])
            values = [v for v in (num(m[col]) for m in members) if v is not None]
            if published is None or not values:
                continue
            compared += 1
            if abs(statistics.fmean(values) - published) > 0.05 + 2e-5:
                bad.append(cid)
    ok = compared > 0 and not bad
    detail = (f"Facility counts and four average ratings rolled up for {len(chains):,} chains "
              f"({compared:,} comparisons); all tie to CMS's published chain figures.") if ok else \
        f"{len(set(bad))} chains do not tie: " + ", ".join(sorted(set(bad))[:10])
    return _result("chains", "Portfolio rollup method ties to CMS chain averages", "gate", ok, detail)


def check_cycle1_counts(providers, health_def):
    counts = Counter(d[CCN] for d in health_def if d["Inspection Cycle"] == "1")
    checked = diff = 0
    for r in providers:
        published = num(r["Rating Cycle 1 Total Number of Health Deficiencies"])
        if published is None:
            continue
        checked += 1
        if published != counts[r[CCN]]:
            diff += 1
    return _result("cycle1", "Cycle 1 deficiency counts versus the deficiency detail (informational)", "info", diff == 0,
                   f"{checked - diff:,} of {checked:,} facilities tie exactly. The rating cycle count and the detail "
                   f"file use different complaint survey windows, so some differences are expected. Both are shown as published.")


def run_all(headers, meta, data, previous_manifest=None):
    results = [check_schema(headers)]
    if results[0]["status"] == "fail":
        return results  # nothing else can be trusted if the layout changed
    prev_count = (previous_manifest or {}).get("facility_count")
    results.append(check_release_consistency(meta, data))
    results.append(check_provider_count(data["provider"], prev_count))
    results.append(check_orphans(data))
    results.extend(check_averages(data["provider"], data["averages"]))
    results.append(check_star_rebuild(data["provider"]))
    results.append(check_weighted_score(data["provider"]))
    results.append(check_penalties(data["provider"], data["penalties"]))
    results.append(check_chain_rollups(data["provider"]))
    results.append(check_cycle1_counts(data["provider"], data["health_def"]))
    return results


def passed(results):
    return all(r["status"] != "fail" for r in results)
