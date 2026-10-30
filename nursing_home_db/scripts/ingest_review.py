"""Turn an external review (findings.csv in the review template layout) plus Claude's own
source re-verification (admin_checks.csv) into a state_administrators-style file.

Only rows whose proposed administrator was found on the cited public source are imported at
their stated confidence. Rows from a source Claude could not open are imported with
match_confidence "low" and a note, so they rank as medium in the build and are clearly labeled.

Usage: python3 -I scripts/ingest_review.py <admin_checks.csv> <out.csv> [--as-of YYYY-MM-DD]
"""
import argparse, pandas as pd, re, urllib.parse

STATE_AGENCY_HOSTS = ("llcs.dph.illinois.gov", "dia-hfd.iowa.gov", "vita-vdh.my.site.com", "apps.health.pa.gov", "datahealth.ri.gov",
                      "dhss.delaware.gov", "azcarecheck.azdhs.gov", "ltclicensing.oregon.gov", "www.michigan.gov", "www.nj.gov",
                      "portal.ct.gov", "www.cms.gov", "health.hawaii.gov", "dhhs.ne.gov", "healthapps.nj.gov", "nvdpbh.aithent.com",
                      "publicapps.odh.ohio.gov", "ohflac.wvdhhr.org", "fortress.wa.gov", "apps.hhs.texas.gov", "gateway.maine.gov",
                      "cohealthviz.dphe.state.co.us", "doh.sd.gov", "dlp.vermont.gov", "statelicensing.apps.lara.state.mi.us", "www.nj.gov",
                      "healthweb-back.health.ny.gov", "mgaleg.maryland.gov", "health.ri.gov", "datahealth.ri.gov")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("checks"); ap.add_argument("out"); ap.add_argument("--as-of", default="2026-10-30")
    ap.add_argument("--skip-hosts", default="", help="comma-separated hosts to ignore (e.g. a portal already imported as a state file)")
    a = ap.parse_args()
    d = pd.read_csv(a.checks, dtype=str, keep_default_na=False)
    rows = []
    skip_hosts = set(a.skip_hosts.split(",")) if a.skip_hosts else set()
    for r in d.itertuples(index=False):
        if r.check not in ("NAME_FOUND", "SKIP_PORTAL", "UNREACHABLE"):
            continue
        host = urllib.parse.urlparse(r.source_url.split(" | ")[0]).netloc
        if host in skip_hosts:
            continue
        confirmed = str(getattr(r, "note", "")).startswith("CONFIRMED")
        if r.check == "NAME_FOUND":
            # a second independent public source naming the same person, or a state agency source, ranks high
            conf = "high" if (confirmed or (host in STATE_AGENCY_HOSTS and r.confidence == "high")) else "medium"
            method, note = "ccn_direct", ("confirmed by a second public source, checked by Claude" if confirmed else "name confirmed on cited source by Claude re-check")
        elif confirmed:
            continue  # an unverifiable confirmation adds nothing
        else:
            conf, method, note = "low", "manual", "reported by external review from a source Claude could not open; not independently verified"
        name = r.proposed_value.strip()
        if "," in name and not re.search(r"\b(JR|SR|II|III)\b", name.upper()):
            last, first = name.split(",", 1); name = f"{first.strip()} {last.strip()}"
        name = re.sub(r"\s+", " ", name).title() if name.isupper() else name
        rows.append({"ccn": r.ccn, "state": r.state, "facility_name": r.facility_name, "address": "", "city": "", "zip": "",
                     "state_license_number": "", "administrator_name": name, "administrator_title": "Administrator",
                     "administrator_phone": "", "administrator_email": "", "source_name": r.source_name,
                     "source_url": r.source_url.split(" | ")[0], "source_date": (r.source_date or a.as_of)[:10],
                     "match_method": method, "match_confidence": conf})
    out = pd.DataFrame(rows)
    out.to_csv(a.out, index=False)
    print(len(out), "rows written;", out.groupby(["state", "match_confidence"]).size().to_dict())


if __name__ == "__main__":
    main()
