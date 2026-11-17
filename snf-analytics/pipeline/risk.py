"""Bravo risk score. A Bravo internal judgment, NOT a CMS figure.

Version 2. A transparent points score, 0 to 100, higher is more regulatory
risk. Every input is a published CMS value or a simple count of published
rows. Weights are set here in one place so they can be reviewed and changed.

Version 2 was chosen by testing against three years of outcomes (see
tools/validate_risk.py and seed/risk_validation.json):
  - CMS's weighted health survey score is used directly, since it predicts
    later events better than counts of individual citations
  - staffing and penalties carry more weight than in version 1
  - severe citations count less the older the inspection cycle
  - the rating trend was removed (it did not predict later events)
  - repeat citations count only at actual harm or above
"""

VERSION = "Version 2"
CYCLE_WEIGHTS = (1.0, 0.5, 0.25)   # most recent inspection cycle first

# (key, label, how points are assigned)
COMPONENTS = [
    ("survey", "Health survey score", "0 to 30 points by national percentile of CMS's total weighted health survey score (30 at the worst)"),
    ("staffing", "Staffing rating", "16 points for 1 star, 8 for 2 stars"),
    ("penalties", "Fines and payment denials", "9 points for any payment denial; fines in the last 3 years: 10 points at $25,000 or more, 6 for any smaller amount"),
    ("sff", "Special Focus status", "25 points for SFF, 15 for SFF candidate"),
    ("ij", "Immediate jeopardy citations", "4 points each in the most recent inspection cycle, 2 in the prior cycle, 1 in the oldest, up to 14"),
    ("harm", "Actual harm citations", "2 points each in the most recent inspection cycle, 1 in the prior cycle, 0.5 in the oldest, up to 8"),
    ("repeat", "Repeat severe citations", "5 points when the same tag is cited at actual harm or above in more than one inspection cycle"),
    ("chow", "Change of ownership", "6 points when CMS flags a change of ownership in the last 12 months"),
    ("abuse", "Abuse icon", "4 points"),
    ("qm", "Quality measure rating", "4 points for 1 or 2 stars"),
    ("turnover", "Nursing staff turnover", "3 points when total nursing turnover exceeds 60%"),
    ("contract", "Contract staffing", "2 points when contract staff exceed 20% of nurse hours"),
    ("rn", "RN coverage", "2 points when any day in the quarter had no RN hours reported"),
]


def _half_up(x):
    return int(x + 0.5)


def recency_weighted(cycles):
    """Citation count with older inspection cycles discounted."""
    return sum((c or 0) * w for c, w in zip(cycles or (0, 0, 0), CYCLE_WEIGHTS))


def score(survey_pct=None, ij_cycles=(0, 0, 0), harm_cycles=(0, 0, 0), repeat_severe=0, sff=0, abuse=False,
          staffing=None, turnover=None, contract_share=None, zero_rn_days=None, denials=0, fine_total=0,
          qm=None, chow=False):
    """Return (total, {component: points}).

    survey_pct: share of facilities nationally with a lower (better) weighted
    health survey score, 0 to 1; None when CMS publishes no score.
    ij_cycles / harm_cycles: counts for inspection cycles 1, 2, 3.
    sff: 0 none, 1 candidate, 2 SFF."""
    p = {
        "survey": _half_up(30 * survey_pct) if survey_pct is not None else 0,
        "staffing": 16 if staffing == 1 else 8 if staffing == 2 else 0,
        "penalties": (9 if (denials or 0) > 0 else 0)
                     + (10 if (fine_total or 0) >= 25000 else 6 if (fine_total or 0) > 0 else 0),
        "sff": 25 if sff == 2 else 15 if sff == 1 else 0,
        "ij": min(14, _half_up(4 * recency_weighted(ij_cycles))),
        "harm": min(8, _half_up(2 * recency_weighted(harm_cycles))),
        "repeat": 5 if (repeat_severe or 0) > 0 else 0,
        "chow": 6 if chow else 0,
        "abuse": 4 if abuse else 0,
        "qm": 4 if qm in (1, 2) else 0,
        "turnover": 3 if turnover is not None and turnover > 60 else 0,
        "contract": 2 if contract_share is not None and contract_share > 0.20 else 0,
        "rn": 2 if zero_rn_days is not None and zero_rn_days > 0 else 0,
    }
    return min(100, sum(p.values())), p


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
                 denials=row[F["denials"]], fine_total=row[F["fine_total"]], qm=row[F["qm"]], chow=row[F["chow"]])


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
