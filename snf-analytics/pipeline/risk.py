"""Bravo risk score. A Bravo internal judgment, NOT a CMS figure.

Draft methodology v1. A transparent points score, 0 to 100, higher is more
risk. Every input is a published CMS value or a simple count of published
rows. Weights are set here in one place so they can be reviewed and changed.
"""

VERSION = "Draft v1"

# (key, label, how points are assigned)
COMPONENTS = [
    ("ij", "Immediate jeopardy citations", "8 points each, last 3 inspection cycles, up to 24"),
    ("harm", "Actual harm citations", "4 points each, last 3 inspection cycles, up to 12"),
    ("repeat", "Repeat citations", "2 points per health tag cited in more than one inspection cycle, up to 10"),
    ("sff", "Special Focus status", "15 points for SFF, 10 for SFF candidate"),
    ("abuse", "Abuse icon", "8 points"),
    ("health", "Health inspection rating", "10 points for 1 star, 5 for 2 stars"),
    ("staffing", "Staffing rating", "8 points for 1 star, 4 for 2 stars"),
    ("turnover", "Nursing staff turnover", "4 points when total nursing turnover exceeds 60%"),
    ("contract", "Contract staffing", "3 points when contract staff exceed 20% of nurse hours"),
    ("penalties", "Fines and payment denials", "5 points for any payment denial; fines: 5 points at $100,000 or more, 3 at $25,000 or more, 1 for any"),
    ("trend", "Overall rating trend", "5 points for a decline of 2 or more stars over about 12 months, 2 for a decline of 1 star"),
]


def score(ij=0, harm=0, repeat=0, sff=0, abuse=False, health=None, staffing=None, turnover=None,
          contract_share=None, fine_total=0, denials=0, overall_now=None, overall_year_ago=None):
    """Return (total, {component: points}). sff: 0 none, 1 candidate, 2 SFF."""
    p = {
        "ij": min(24, 8 * (ij or 0)),
        "harm": min(12, 4 * (harm or 0)),
        "repeat": min(10, 2 * (repeat or 0)),
        "sff": 15 if sff == 2 else 10 if sff == 1 else 0,
        "abuse": 8 if abuse else 0,
        "health": 10 if health == 1 else 5 if health == 2 else 0,
        "staffing": 8 if staffing == 1 else 4 if staffing == 2 else 0,
        "turnover": 4 if turnover is not None and turnover > 60 else 0,
        "contract": 3 if contract_share is not None and contract_share > 0.20 else 0,
        "penalties": (5 if (denials or 0) > 0 else 0)
                     + (5 if (fine_total or 0) >= 100000 else 3 if (fine_total or 0) >= 25000 else 1 if (fine_total or 0) > 0 else 0),
        "trend": 0,
    }
    if overall_now is not None and overall_year_ago is not None:
        drop = overall_year_ago - overall_now
        p["trend"] = 5 if drop >= 2 else 2 if drop == 1 else 0
    return min(100, sum(p.values())), p


def percentiles(scores):
    """Map each score to the percent of facilities with a strictly lower score (0-100)."""
    ordered = sorted(scores)
    n = len(ordered)
    below = {}
    for i, s in enumerate(ordered):
        below.setdefault(s, i)
    return {s: round(100 * below[s] / n) for s in below} if n else {}


def backtest(history_snapshots, as_of, later):
    """Did high scores at `as_of` precede serious regulatory events by `later`?

    Uses only the inputs stored in release history (citations, SFF, abuse,
    health and staffing ratings, penalties), so it tests a reduced form of the
    score. Serious event: the facility gained immediate jeopardy citations,
    received a new payment denial, or became an SFF or SFF candidate. The share
    whose overall rating fell is reported alongside for transparency.
    Returns rows of [quarter label, facilities, share with a serious event,
    share with a lower overall rating, lowest score, highest score].
    """
    from .history import F
    a, b = history_snapshots[as_of], history_snapshots[later]
    scored = []
    for ccn, r in a.items():
        n = b.get(ccn)
        if n is None:
            continue
        s, _ = score(ij=r[F["ij"]], harm=r[F["harm"]], sff=r[F["sff"]], abuse=r[F["abuse"]], health=r[F["health"]],
                     staffing=r[F["staffing"]], fine_total=r[F["fine_total"]], denials=r[F["denials"]])
        event = n[F["ij"]] > r[F["ij"]] or n[F["denials"]] > r[F["denials"]] or n[F["sff"]] > r[F["sff"]]
        drop = r[F["overall"]] is not None and n[F["overall"]] is not None and n[F["overall"]] < r[F["overall"]]
        scored.append((s, event, drop))
    scored.sort(key=lambda x: x[0])
    n = len(scored)
    if n < 100:
        return None
    rows = []
    for i, label in enumerate(["Lowest quarter of scores", "Second quarter", "Third quarter", "Highest quarter of scores"]):
        part = scored[i * n // 4:(i + 1) * n // 4]
        rows.append([label, len(part), sum(1 for x in part if x[1]) / len(part), sum(1 for x in part if x[2]) / len(part),
                     part[0][0], part[-1][0]])
    return {"as_of": as_of, "later": later, "facilities": n, "rows": rows}
