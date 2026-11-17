"""Refresh entry point.

  python -m pipeline.run --work work --out dist [--previous prev_manifest.json] [--force]

Exit codes: 0 built (or nothing new), 1 a validation gate failed, 2 download error.
Writes `changed=true|false` to $GITHUB_OUTPUT when running in GitHub Actions.
"""
import argparse
import csv
import datetime
import hashlib
import json
import os
import subprocess
import sys

import re

from . import build as builder
from . import changes as changes_mod
from . import extras, history, validate
from .metrics import num
from .sources import API, CATALOG, DATA_JSON, DATASETS, PBJ_TITLE, VBP_TITLE

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def _get(url, dest=None):
    """Download with curl. CMS's CDN rejects some non-browser HTTP clients
    (including Python's default client) but accepts curl, so curl is used
    for every request. Retries cover transient network errors."""
    target = (dest + ".part") if dest else "-"
    cmd = ["curl", "-sS", "--fail", "--location", "--max-time", "900",
           "--retry", "4", "--retry-delay", "5", "--retry-all-errors", "-o", target, url]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Download failed: {url}: {proc.stderr.decode(errors='replace').strip()}")
    if dest is None:
        return proc.stdout
    h = hashlib.sha256()
    with open(target, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    os.replace(target, dest)
    return h.hexdigest()


def fetch_metadata():
    meta = {}
    for key, spec in DATASETS.items():
        d = json.loads(_get(API.format(id=spec["id"])))
        meta[key] = {
            "id": spec["id"], "title": d["title"], "modified": d["modified"],
            "released": d.get("released"), "next_update": d.get("nextUpdateDate"),
            "url": d["distribution"][0]["downloadURL"],
            "file": d["distribution"][0]["downloadURL"].rsplit("/", 1)[-1],
        }
    return meta


def unchanged(meta, previous):
    if not previous:
        return False
    old = previous.get("datasets", {})
    return all(k in old and old[k]["modified"] == m["modified"] and old[k]["url"] == m["url"] for k, m in meta.items())


def find_vbp():
    """Latest fiscal year SNF VBP facility-level dataset, or None."""
    best = None
    for d in json.loads(_get(CATALOG)):
        m = re.match(VBP_TITLE, d.get("title", ""))
        if m and (best is None or int(m.group(1)) > best["fy"]):
            url = d["distribution"][0]["downloadURL"]
            best = {"fy": int(m.group(1)), "title": d["title"], "url": url, "file": url.rsplit("/", 1)[-1],
                    "modified": d.get("modified"), "released": d.get("released")}
    return best


def find_pbj(period_start):
    """PBJ daily staffing file for the calendar quarter starting on period_start (YYYY-MM-DD), or None.

    CMS's catalog dates for these files are inconsistent, so the file is
    matched on the quarter in its name (for example CY2026Q2). The quarter
    inside the file and the reconciliation check then confirm it is the right one."""
    y, m = int(period_start[:4]), int(period_start[5:7])
    token = f"cy{y}q{(m - 1) // 3 + 1}"
    for d in json.loads(_get(DATA_JSON)).get("dataset", []):
        if not d.get("title", "").startswith(PBJ_TITLE):
            continue
        for dist in d.get("distribution", []):
            url = dist.get("downloadURL") or ""
            if url.lower().endswith(".csv") and token in url.lower().replace("_", ""):
                return {"title": d["title"], "url": url, "file": url.rsplit("/", 1)[-1], "modified": dist.get("modified")}
    return None


def staffing_period(interval_rows):
    for r in interval_rows:
        if r["Measure Code"] == "STAFFING_LEVELS":
            m, d, y = r["Data Collection Period From Date"].split("/")
            return f"{y}-{m}-{d}", r["Data Collection Period From Date"] + " to " + r["Data Collection Period Through Date"]
    return None, None


def fetch_supplementary(kind, finder, raw, supp):
    """Locate and download one supplementary file. Never raises: a failure
    simply leaves that section out of the release."""
    try:
        m = finder()
        if not m:
            print(f"Supplementary source not found: {kind}")
            return
        print(f"Downloading {m['file']}")
        m["sha256"] = _get(m["url"], os.path.join(raw, m["file"]))
        supp[kind] = m
    except Exception as e:
        print(f"Supplementary source unavailable ({kind}): {e}")


def load(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        return reader.fieldnames or [], rows


def set_output(name, value):
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"{name}={value}\n")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.join(HERE, "work"))
    ap.add_argument("--out", default=os.path.join(HERE, "dist"))
    ap.add_argument("--previous", help="manifest.json from the currently published site")
    ap.add_argument("--force", action="store_true", help="rebuild even if CMS has not published new files")
    ap.add_argument("--offline", action="store_true", help="reuse files already in the work folder")
    ap.add_argument("--state-in", help="history.json.gz saved by the previous refresh")
    ap.add_argument("--state-out", help="where to write the updated history.json.gz")
    args = ap.parse_args(argv)

    previous = None
    if args.previous and os.path.exists(args.previous):
        try:
            with open(args.previous) as f:
                previous = json.load(f)
        except ValueError:
            previous = None

    raw = os.path.join(args.work, "raw")
    os.makedirs(raw, exist_ok=True)
    meta_path = os.path.join(args.work, "meta.json")
    try:
        if args.offline:
            with open(meta_path) as f:
                meta = json.load(f)
        else:
            meta = fetch_metadata()
            if unchanged(meta, previous) and not args.force:
                print("CMS has not published new files. Nothing to do.")
                set_output("changed", "false")
                return 0
            for key, m in meta.items():
                print(f"Downloading {m['file']}")
                m["sha256"] = _get(m["url"], os.path.join(raw, m["file"]))
            with open(meta_path, "w") as f:
                json.dump(meta, f, indent=1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    headers, data = {}, {}
    for key, m in meta.items():
        headers[key], data[key] = load(os.path.join(raw, m["file"]))
        m["rows"] = len(data[key])

    results = validate.run_all(headers, meta, data, previous)
    extra = {}
    if validate.passed(results):
        # --- supplementary sources -------------------------------------------
        supp_path = os.path.join(args.work, "supp.json")
        period_start, period_label = staffing_period(data["intervals"])
        if args.offline:
            supp = json.load(open(supp_path)) if os.path.exists(supp_path) else {}
        else:
            supp = {}
            fetch_supplementary("vbp", find_vbp, raw, supp)
            if period_start:
                fetch_supplementary("pbj", lambda: find_pbj(period_start), raw, supp)
            with open(supp_path, "w") as f:
                json.dump(supp, f, indent=1)

        pbj = quarter = None
        if "pbj" in supp:
            pbj, quarter, _ = extras.read_pbj(os.path.join(raw, supp["pbj"]["file"]))
        r = validate.check_pbj(data["provider"], pbj, quarter, period_label)
        results.append(r)
        if r["status"] == "pass":
            extra["pbj"], extra["pbj_quarter"], extra["pbj_period"] = pbj, quarter, period_label

        vbp = None
        if "vbp" in supp:
            vh, vrows = load(os.path.join(raw, supp["vbp"]["file"]))
            if all(c in vh for c in extras.VBP_REQUIRED):
                vbp = extras.vbp_by_ccn(vrows)
                supp["vbp"]["rows"] = len(vrows)
        r = validate.check_vbp(data["provider"], vbp, supp.get("vbp", {}).get("fy"))
        results.append(r)
        if r["status"] == "pass":
            extra["vbp"], extra["vbp_fy"] = vbp, supp["vbp"]["fy"]

        extra["cut_points"] = extras.parse_cut_points(data["cutpoints"])
        results.append(validate.check_cut_points(data["provider"], extra["cut_points"]))
        for k, m in supp.items():
            meta["supp_" + k] = dict(m, id="", released=m.get("released"), next_update=None, rows=m.get("rows"))

        # --- release history and change tracking -----------------------------
        seed = os.path.join(HERE, "seed", "history.json.gz")
        hist = history.load(args.state_in) or history.load(seed) or history.empty()
        date = data["provider"][0]["Processing Date"]
        snap = history.snapshot(data["provider"], data["health_def"])
        results.append(validate.check_history_seed(snap, hist["snapshots"].get(date)))
        history.add_release(hist, date, snap)
        extra["history"] = hist
        prev_date = history.previous_date(hist, date)
        if prev_date:
            items = changes_mod.diff(hist["snapshots"][prev_date], snap)
            extra["changes"] = {"from": prev_date, "to": date, "summary": changes_mod.summarize(items), "items": items}
    for r in results:
        print(f"[{r['status'].upper():4}] {r['name']}: {r['detail']}")
    if not validate.passed(results):
        print("VALIDATION FAILED. Nothing was published; the prior data stays live.", file=sys.stderr)
        set_output("changed", "false")
        return 1

    built_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = builder.build(data, meta, results, os.path.join(HERE, "site"), args.out, built_at,
                             os.environ.get("GITHUB_SHA", "local")[:7], extra)
    if args.state_out and "history" in extra:
        history.save(extra["history"], args.state_out)
    set_output("new_release", "true" if not previous or previous.get("processing_date") != manifest["processing_date"] else "false")
    print(f"Built {manifest['facility_count']:,} facility reports for CMS release {manifest['processing_date']}.")
    set_output("changed", "true")
    set_output("release", manifest["processing_date"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
