"""Download the current CMS nursing home source files into raw/.

Sources (all public, no login):
  1. Care Compare "Provider Information"  (provider-data id 4pq5-n9py)  -> raw/NH_ProviderInfo.csv
  2. Care Compare "Ownership"             (provider-data id y2hd-n93e)  -> raw/NH_Ownership.csv
  3. PECOS "Skilled Nursing Facility Enrollments" (data.cms.gov)       -> raw/SNF_Enrollments.csv
  4. PECOS "Skilled Nursing Facility All Owners"  (data.cms.gov)       -> raw/SNF_All_Owners.csv

Usage:  python3 -I scripts/download_cms.py [--raw-dir raw]
"""
import argparse, json, os, sys, urllib.request, datetime

PD_API = "https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/{id}"
DATA_JSON = "https://data.cms.gov/data.json"
UA = {"User-Agent": "Mozilla/5.0 (nursing-home-db refresh script)"}


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def download(url, dest):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    print(f"  {os.path.basename(dest)}: {os.path.getsize(dest):,} bytes")


def provider_data_url(dataset_id):
    meta = get_json(PD_API.format(id=dataset_id))
    return meta["distribution"][0]["downloadURL"], meta.get("modified")


def latest_data_cms_csv(title_prefix):
    cat = get_json(DATA_JSON)
    best = None
    for ds in cat["dataset"]:
        t = ds.get("title", "")
        if not t.startswith(title_prefix + " :"):
            continue
        for dist in ds.get("distribution", []):
            if dist.get("mediaType") == "text/csv" and dist.get("downloadURL"):
                key = (t.split(":")[-1].strip(), ds.get("modified", ""))
                if best is None or key > best[0]:
                    best = (key, dist["downloadURL"])
    if best is None:
        raise SystemExit(f"could not find {title_prefix} in data.cms.gov catalog")
    return best[1], best[0][0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", default=os.path.join(os.path.dirname(__file__), "..", "raw"))
    args = ap.parse_args()
    raw = os.path.abspath(args.raw_dir)
    os.makedirs(raw, exist_ok=True)
    manifest = {"downloaded_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")}

    print("Resolving Care Compare files...")
    for ds_id, name in (("4pq5-n9py", "NH_ProviderInfo.csv"), ("y2hd-n93e", "NH_Ownership.csv")):
        url, modified = provider_data_url(ds_id)
        print(f"  {name} <- {url} (modified {modified})")
        download(url, os.path.join(raw, name))
        manifest[name] = {"url": url, "modified": modified}

    print("Resolving PECOS files...")
    for prefix, name in (("Skilled Nursing Facility Enrollments", "SNF_Enrollments.csv"),
                         ("Skilled Nursing Facility All Owners", "SNF_All_Owners.csv")):
        url, version = latest_data_cms_csv(prefix)
        print(f"  {name} <- {url} (version {version})")
        download(url, os.path.join(raw, name))
        manifest[name] = {"url": url, "version": version}

    with open(os.path.join(raw, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("done")


if __name__ == "__main__":
    main()
