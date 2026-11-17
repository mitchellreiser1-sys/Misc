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

from . import build as builder
from . import validate
from .sources import API, DATASETS

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
    for r in results:
        print(f"[{r['status'].upper():4}] {r['name']}: {r['detail']}")
    if not validate.passed(results):
        print("VALIDATION FAILED. Nothing was published; the prior data stays live.", file=sys.stderr)
        set_output("changed", "false")
        return 1

    built_at = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest = builder.build(data, meta, results, os.path.join(HERE, "site"), args.out, built_at,
                             os.environ.get("GITHUB_SHA", "local")[:7])
    print(f"Built {manifest['facility_count']:,} facility reports for CMS release {manifest['processing_date']}.")
    set_output("changed", "true")
    set_output("release", manifest["processing_date"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
