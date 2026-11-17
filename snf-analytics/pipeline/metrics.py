"""Metric definitions. One function per metric, used by every screen and check.

Published CMS values are always displayed as published. The functions here
either parse published values or recompute them as an independent check.
"""


def num(value):
    """Parse a CMS numeric string. Blank or non-numeric means not available (None)."""
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if s == "":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() and "." not in s else f


def text(value):
    s = (value or "").strip()
    return s or None


def flag(value):
    """CMS Y/N style flags. Returns True, False, or None when not reported."""
    s = (value or "").strip().upper()
    if s in ("Y", "YES"):
        return True
    if s in ("N", "NO"):
        return False
    return None


def overall_rating_steps(health, staffing, qm):
    """Rebuild the CMS overall rating from its three component ratings.

    Rule (CMS Five-Star Technical Users' Guide): start with the health
    inspection rating; add one star if staffing is 5, subtract one if staffing
    is 1; add one star if QM is 5, subtract one if QM is 1; the result stays
    within 1 to 5 at each step; a missing staffing or QM rating makes no
    adjustment; a facility with a 1-star health inspection
    rating cannot be upgraded by more than one star overall.

    Returns a list of (label, adjustment, running rating), or None when the
    health inspection rating is missing. Used only to explain and cross-check the
    published rating, never to replace it.
    """
    if health is None:
        return None
    steps = [("Health inspection rating", None, health)]
    r = health
    for name, rating in (("Staffing", staffing), ("Quality measure", qm)):
        if rating is None:
            steps.append((f"{name} rating not available, no adjustment", 0, r))
            continue
        adj = 1 if rating == 5 else -1 if rating == 1 else 0
        r = max(1, min(5, r + adj))
        steps.append((f"{name} rating of {rating}", adj, r))
    if health == 1 and r > 2:
        r = 2
        steps.append(("Cap: 1-star health inspection limits upgrade to one star", None, r))
    return steps


def recomputed_overall(health, staffing, qm):
    steps = overall_rating_steps(health, staffing, qm)
    return steps[-1][2] if steps else None


def weighted_health_score(cycle1_total, cycle23_total):
    """CMS total weighted health survey score: 3/4 cycle 1 plus 1/4 cycles 2/3.

    With no cycle 2/3 score the cycle 1 score stands alone.
    """
    if cycle1_total is None:
        return None
    if cycle23_total is None:
        return float(cycle1_total)
    return 0.75 * cycle1_total + 0.25 * cycle23_total


def occupancy(avg_residents, certified_beds):
    """Derived, not published by CMS: average residents per day / certified beds."""
    if avg_residents is None or not certified_beds:
        return None
    return avg_residents / certified_beds
