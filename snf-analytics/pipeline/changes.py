"""Change tracking between two CMS releases, from published values only."""
from .history import F

SFF_LABEL = {0: "None", 1: "SFF Candidate", 2: "SFF"}
RATINGS = [("overall", "Overall rating"), ("health", "Health inspection rating"),
           ("staffing", "Staffing rating"), ("qm", "Quality measure rating")]


def diff(prev, cur):
    """Return a list of [ccn, type, old, new] records.

    Types: overall/health/staffing/qm (rating changed, None means not rated),
    sff (status changed), abuse (icon gained or removed), chow (newly flagged as
    changed ownership), ij (more immediate jeopardy citations than last release),
    fines (more fines than last release; old and new are dollar totals),
    denials (more payment denials), added, dropped.
    """
    out = []
    for ccn, c in cur.items():
        p = prev.get(ccn)
        if p is None:
            out.append([ccn, "added", None, None])
            continue
        for key, _ in RATINGS:
            if p[F[key]] != c[F[key]]:
                out.append([ccn, key, p[F[key]], c[F[key]]])
        if p[F["sff"]] != c[F["sff"]]:
            out.append([ccn, "sff", SFF_LABEL[p[F["sff"]]], SFF_LABEL[c[F["sff"]]]])
        if p[F["abuse"]] != c[F["abuse"]]:
            out.append([ccn, "abuse", bool(p[F["abuse"]]), bool(c[F["abuse"]])])
        if c[F["chow"]] and not p[F["chow"]]:
            out.append([ccn, "chow", False, True])
        if c[F["ij"]] > p[F["ij"]]:
            out.append([ccn, "ij", p[F["ij"]], c[F["ij"]]])
        if c[F["fines"]] > p[F["fines"]]:
            out.append([ccn, "fines", p[F["fine_total"]], c[F["fine_total"]]])
        if c[F["denials"]] > p[F["denials"]]:
            out.append([ccn, "denials", p[F["denials"]], c[F["denials"]]])
    for ccn in prev:
        if ccn not in cur:
            out.append([ccn, "dropped", None, None])
    return out


def summarize(changes):
    s = {"up": 0, "down": 0}
    for _, kind, old, new in changes:
        s[kind] = s.get(kind, 0) + 1
        if kind == "overall" and old is not None and new is not None:
            s["up" if new > old else "down"] += 1
    return s
