"""Pull NPPES (NPI Registry) records for every SNF NPI in raw/SNF_Enrollments.csv.

The NPI record's "authorized official" is frequently the facility administrator and carries a
title, phone and the state license number. Output is appended to raw/nppes_raw.jsonl and the
script is resumable (already-pulled NPIs are skipped).

Usage:  python3 -I scripts/nppes_pull.py [--raw-dir raw] [--workers 6]
"""
import argparse, concurrent.futures as cf, csv, json, os, time, urllib.request

API = "https://npiregistry.cms.hhs.gov/api/?number={npi}&version=2.1"


def fetch(npi):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(API.format(npi=npi), timeout=30) as r:
                return {"npi": npi, "resp": json.load(r)}
        except Exception:
            time.sleep(2 * (attempt + 1))
    return {"npi": npi, "resp": None, "error": "failed"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=os.path.join(os.path.dirname(__file__), "..", "raw"))
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    raw = os.path.abspath(args.raw_dir)
    out = os.path.join(raw, "nppes_raw.jsonl")
    npis = set()
    with open(os.path.join(raw, "SNF_Enrollments.csv"), encoding="latin1", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("NPI"):
                npis.add(row["NPI"].strip())
    done = set()
    if os.path.exists(out):
        with open(out) as f:
            for line in f:
                try:
                    d = json.loads(line)
                    if d.get("resp") is not None:
                        done.add(d["npi"])
                except json.JSONDecodeError:
                    pass
    todo = sorted(npis - done)
    print(f"{len(npis)} NPIs, {len(done)} already pulled, {len(todo)} to do", flush=True)
    with open(out, "a") as f, cf.ThreadPoolExecutor(args.workers) as ex:
        for i, res in enumerate(ex.map(fetch, todo), 1):
            f.write(json.dumps(res) + "\n")
            if i % 500 == 0:
                print(i, flush=True)
                f.flush()
    print("done")


if __name__ == "__main__":
    main()
