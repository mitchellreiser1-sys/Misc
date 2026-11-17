"""Regulatory screening score. A Bravo internal screening aid, NOT a CMS figure
and not a credit risk measure.

Version 3. A transparent points score whose components add to exactly 100;
higher means more regulatory risk. Every input is a published CMS value or a
simple count of published rows. Weights are set here in one place.

It was tested against three years of outcomes (tools/validate_risk.py,
seed/risk_validation.json). It ranks facilities correctly about 69% of the
time, against 67% for CMS's weighted health survey score alone. Changing the
weights within reason does not change that accuracy, so the weights reflect
underwriting judgment:
  - CMS's weighted health survey score is used directly
  - severe citations count less the older the inspection cycle, and a single
    recent severe citation outweighs the repeat flag
  - one recent immediate jeopardy citation counts at least as much as a
    1-star staffing rating once its effect on the survey score is included
  - fines and payment denials count less as they age (version 3.1)
"""

NAME = "Regulatory screening score"
VERSION = "Version 3.1"
CYCLE_WEIGHTS = (1.0, 0.5, 0.25)   # most recent inspection cycle first
AGE_WEIGHTS = (1.0, 0.5, 0.25)     # penalties: last 12 months, 12 to 24 months, older

# (key, label, how points are assigned, maximum points). Maximums add to 100.
COMPONENTS = [
    ("survey", "Health survey score", "0 to 24 points by national percentile of CMS's total weighted health survey score (24 at the worst)", 24),
    ("sff", "Special Focus status", "16 points for SFF, 10 for SFF candidate", 16),
    ("ij", "Immediate jeopardy citations", "6 points each in the most recent inspection cycle, 3 in the prior cycle, 1.5 in the oldest, up to 15", 15),
    ("penalties", "Fines and payment denials", "Payment denial: 6 points if the most recent is within 12 months, 3 if 12 to 24 months old, 1.5 if older. Fines are grouped by the same ages; a group totaling $25,000 or more is worth 8 and a smaller amount 4, counted in full, at half, or at a quarter by age, and the highest group is used", 14),
    ("staffing", "Staffing rating", "10 points for 1 star, 5 for 2 stars", 10),
    ("harm", "Actual harm citations", "3 points each in the most recent inspection cycle, 1.5 in the prior cycle, 0.75 in the oldest, up to 7", 7),
    ("chow", "Change of ownership", "4 points when CMS flags a change of ownership in the last 12 months", 4),
    ("abuse", "Abuse icon", "3 points", 3),
    ("qm", "Quality measure rating", "2 points for 1 or 2 stars", 2),
    ("repeat", "Repeat severe citation", "2 points when the same tag is cited at actual harm or above in more than one inspection cycle", 2),
    ("turnover", "Nursing staff turnover", "1 point when total nursing turnover exceeds 60%", 1),
    ("contract", "Contract staffing", "1 point when contract staff exceed 20% of nurse hours", 1),
    ("rn", "RN coverage", "1 point when any day in the quarter had no RN hours reported", 1),
]

# Review tiers. Labels describe what to do, not a verdict on the facility.
TIERS = [(0, 14, "Low"), (15, 29, "Moderate"), (30, 44, "Elevated"), (45, 100, "Review recommended")]


def tier(total):
    for lo, hi, label in TIERS:
        if lo <= total <= hi:
            return label
    return TIERS[-1][2]


def _half_up(x):
    return int(x + 0.5)


def recency_weighted(cycles):
    """Citation count with older inspection cycles discounted."""
    return sum((c or 0) * w for c, w in zip(cycles or (0, 0, 0), CYCLE_WEIGHTS))


def score(survey_pct=None, ij_cycles=(0, 0, 0), harm_cycles=(0, 0, 0), repeat_severe=0, sff=0, abuse=False,
          staffing=None, turnover=None, contract_share=None, zero_rn_days=None, fines_by_age=(0, 0, 0),
          denials_by_age=(0, 0, 0), qm=None, chow=False):
    """Return (total, {component: points}).

    survey_pct: share of facilities nationally with a lower (better) weighted
    health survey score, 0 to 1; None when CMS publishes no score.
    ij_cycles / harm_cycles: counts for inspection cycles 1, 2, 3.
    fines_by_age / denials_by_age: fine dollars and denial counts for the
    last 12 months, 12 to 24 months, and older.
    sff: 0 none, 1 candidate, 2 SFF."""
    p = {
        "survey": _half_up(24 * survey_pct) if survey_pct is not None else 0,
        "sff": 16 if sff == 2 else 10 if sff == 1 else 0,
        "ij": min(15, _half_up(6 * recency_weighted(ij_cycles))),
        "penalties": penalty_points(fines_by_age, denials_by_age),
        "staffing": 10 if staffing == 1 else 5 if staffing == 2 else 0,
        "harm": min(7, _half_up(3 * recency_weighted(harm_cycles))),
        "chow": 4 if chow else 0,
        "abuse": 3 if abuse else 0,
        "qm": 2 if qm in (1, 2) else 0,
        "repeat": 2 if (repeat_severe or 0) > 0 else 0,
        "turnover": 1 if turnover is not None and turnover > 60 else 0,
        "contract": 1 if contract_share is not None and contract_share > 0.20 else 0,
        "rn": 1 if zero_rn_days is not None and zero_rn_days > 0 else 0,
    }
    return min(100, sum(p.values())), p


def penalty_points(fines_by_age, denials_by_age):
    """Fines and payment denials, discounted by age. Up to 14 points."""
    denial = max([6 * w for n, w in zip(denials_by_age or (), AGE_WEIGHTS) if (n or 0) > 0] or [0])
    fine = max([(8 if amt >= 25000 else 4) * w for amt, w in zip(fines_by_age or (), AGE_WEIGHTS) if (amt or 0) > 0] or [0])
    return _half_up(denial) + _half_up(fine)


def lower_share(values):
    """Map each value to the share of values strictly lower than it (0 to 1)."""
    ordered = sorted(values)
    n = len(ordered)
    first = {}
    for i, v in enumerate(ordered):
        first.setdefault(v, i)
    return {v: first[v] / n for v in first} if n else {}


def percentiles(scores):
    """Map each score to the percent of facilities with a strictly lower score (0-100)."""
    return {s: round(100 * share) for s, share in lower_share(scores).items()}


def score_snapshot_row(row, survey_pct):
    """Score a facility from one release-history row. Contract staffing and RN
    coverage are not stored in the history, so they are left out."""
    from .history import F
    return score(survey_pct=survey_pct, ij_cycles=(row[F["ij1"]], row[F["ij2"]], row[F["ij3"]]),
                 harm_cycles=(row[F["harm1"]], row[F["harm2"]], row[F["harm3"]]), repeat_severe=row[F["repeat_severe"]],
                 sff=row[F["sff"]], abuse=row[F["abuse"]], staffing=row[F["staffing"]], turnover=row[F["turnover"]],
                 fines_by_age=(row[F["fine1"]], row[F["fine2"]], row[F["fine3"]]),
                 denials_by_age=(row[F["den1"]], row[F["den2"]], row[F["den3"]]), qm=row[F["qm"]], chow=row[F["chow"]])


def backtest(history_snapshots, as_of, later):
    """Ongoing check, rerun at every refresh: did high scores at `as_of`
    precede serious regulatory events by `later`?

    Serious event here means the facility's immediate jeopardy count rose,
    its payment denial count rose, or it became an SFF or SFF candidate,
    comparing two releases. This is a rougher outcome than the dated study in
    seed/risk_validation.json, because older events roll out of CMS's
    reporting windows. Returns rows of [quarter label, facilities, share with
    a serious event, lowest score, highest score].
    """
    from .history import F
    a, b = history_snapshots[as_of], history_snapshots[later]
    pct = lower_share([r[F["weighted"]] for r in a.values() if r[F["weighted"]] is not None])
    scored = []
    for ccn, r in a.items():
        n = b.get(ccn)
        if n is None:
            continue
        s, _ = score_snapshot_row(r, pct.get(r[F["weighted"]]))
        event = n[F["ij"]] > r[F["ij"]] or n[F["denials"]] > r[F["denials"]] or n[F["sff"]] > r[F["sff"]]
        scored.append((s, event))
    scored.sort(key=lambda x: x[0])
    n = len(scored)
    if n < 100:
        return None
    rows = []
    for i, label in enumerate(["Lowest quarter of scores", "Second quarter", "Third quarter", "Highest quarter of scores"]):
        part = scored[i * n // 4:(i + 1) * n // 4]
        rows.append([label, len(part), sum(1 for x in part if x[1]) / len(part), part[0][0], part[-1][0]])
    return {"as_of": as_of, "later": later, "facilities": n, "rows": rows}
