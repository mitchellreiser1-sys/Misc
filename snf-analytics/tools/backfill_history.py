"""One-time backfill of release history from CMS's public monthly archives.

  python -m tools.backfill_history <folder of nursing-homes_YYYY-MM-DD.zip> seed/history.json.gz

Each archive is CMS's own snapshot of a monthly release. The processing date
inside the Provider Information file identifies the release; when two archives
carry the same processing date the later archive is used."""
import csv
import io
import os
import sys
import zipfile

from pipeline import history


def read(z, token):
    name = [n for n in z.namelist() if token in n][0]
    with z.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def main(folder, out):
    h = history.empty()
    for fn in sorted(os.listdir(folder)):
        if not fn.endswith(".zip"):
            continue
        z = zipfile.ZipFile(os.path.join(folder, fn))
        if not all(any(t in n for n in z.namelist()) for t in ("NH_ProviderInfo", "NH_HealthCitations", "NH_Penalties")):
            print(fn, "-> skipped, archive is missing the provider or health citation file")
            continue
        providers = read(z, "NH_ProviderInfo")
        date = providers[0]["Processing Date"]
        snap = history.snapshot(providers, read(z, "NH_HealthCitations"), read(z, "NH_Penalties"))
        history.add_release(h, date, snap)
        print(fn, "->", date, len(snap), "facilities")
    history.save(h, out)
    print("releases:", history.dates(h))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
