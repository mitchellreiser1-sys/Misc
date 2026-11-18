"""Apply a portfolio change requested from the site.

The site has no server, so it cannot save a shared portfolio itself. Instead
it opens a pre-filled GitHub issue. When the repository owner submits it, the
"Portfolio update" workflow runs this script, which edits portfolios.json.

  python -m tools.apply_portfolio_request portfolios.json   (request text in $REQUEST_BODY)

Request text:
  action: save | delete
  name: <portfolio name>
  ccns: <comma-separated CCNs>      (save only)

Everything in the request is treated as data. Nothing in it is executed."""
import json
import os
import re
import sys

MAX_CCNS = 1500
MAX_NAME = 100


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "portfolio"


def parse(body):
    fields = {}
    for line in (body or "").replace("\r", "").split("\n"):
        m = re.match(r"^\s*(action|name|ccns)\s*:\s*(.*)$", line, re.I)
        if m and m.group(1).lower() not in fields:
            fields[m.group(1).lower()] = m.group(2).strip()
    action = fields.get("action", "").lower()
    if action not in ("save", "delete"):
        raise ValueError("The request must say 'action: save' or 'action: delete'.")
    name = re.sub(r"\s+", " ", fields.get("name", "")).strip()
    if not name or len(name) > MAX_NAME or re.search(r"[\x00-\x1f<>]", name):
        raise ValueError(f"The portfolio name must be 1 to {MAX_NAME} characters with no angle brackets.")
    ccns = []
    if action == "save":
        for c in re.split(r"[\s,;]+", fields.get("ccns", "")):
            c = c.strip().upper()
            if not c:
                continue
            if re.fullmatch(r"\d{1,5}", c):
                c = c.zfill(6)
            if not re.fullmatch(r"[0-9A-Z]{6}", c):
                raise ValueError(f"'{c}' is not a six-character CCN.")
            if c not in ccns:
                ccns.append(c)
        if not ccns:
            raise ValueError("A saved portfolio needs at least one CCN.")
        if len(ccns) > MAX_CCNS:
            raise ValueError(f"A portfolio can hold at most {MAX_CCNS} facilities.")
    return action, name, ccns


def apply(portfolios, action, name, ccns):
    """Return (new list, message). Portfolios are matched on their name, ignoring case and punctuation."""
    key = slug(name)
    others = [p for p in portfolios if slug(p["name"]) != key]
    existed = len(others) != len(portfolios)
    if action == "delete":
        if not existed:
            raise ValueError(f"No portfolio named '{name}' exists.")
        return others, f"Deleted the portfolio '{name}'."
    out = []
    placed = False
    for p in portfolios:
        if slug(p["name"]) == key:
            if not placed:
                out.append({"name": name, "ccns": ccns})
                placed = True
        else:
            out.append(p)
    if not placed:
        out.append({"name": name, "ccns": ccns})
    return out, (f"Updated '{name}' ({len(ccns)} facilities)." if existed else f"Added '{name}' ({len(ccns)} facilities).")


def main(path):
    try:
        action, name, ccns = parse(os.environ.get("REQUEST_BODY", ""))
        with open(path, encoding="utf-8") as f:
            portfolios = json.load(f)
        portfolios, message = apply(portfolios, action, name, ccns)
    except (ValueError, OSError) as e:
        print(f"REJECTED: {e}")
        return 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(portfolios, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(message)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
