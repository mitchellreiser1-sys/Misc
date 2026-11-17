# SNF Analytics (proof of concept)

An in-house view of CMS nursing home data: facility search, a single-facility
report covering Five-Star ratings, health and fire safety surveys, staffing,
quality measures, penalties, and ownership, and a portfolio view for any list
of CCNs or any CMS chain. Public CMS data only.

Saved portfolios are kept in the browser's local storage only. Portfolio names
and lists are never uploaded; the shareable link carries CCNs only.

## How it stays accurate

- **Published values are shown as published.** Nothing CMS publishes is re-derived for display. The one derived figure (occupancy) is labeled.
- **Every refresh must pass reconciliation gates** (`pipeline/validate.py`) before anything publishes:
  file layouts, single CMS release across files, facility count, detail files tie to the facility list,
  state and national averages tie to CMS, overall star ratings rebuild to the published value,
  weighted survey scores tie to cycle scores, penalty detail ties to facility totals, and the
  portfolio rollup method ties to CMS's published averages for every chain.
- **Portfolio figures are derived and labeled as such.** The rollup logic is in `site/rollup.js`, tested in `tests/rollup.test.js`.
- **A failed gate publishes nothing.** The site keeps the last release that passed, the workflow run fails, and an issue is opened.
- **Raw CMS files are archived unmodified** as a GitHub Release per CMS release, with SHA-256 hashes.
- **Blank means "Not available,"** never zero. CMS footnotes are shown verbatim.
- The Data status page on the site shows the checks and source files for the release on display.

## How it stays live

`.github/workflows/snf-refresh.yml` runs daily, asks CMS whether new files exist, and rebuilds only when they do.
No one downloads anything. GitHub runs schedules only from the default branch.

One-time setup: repository Settings, Pages, Source: **GitHub Actions**.

## Run locally

```bash
cd snf-analytics
python -m unittest discover -s tests
node --test tests/rollup.test.js
python -m pipeline.run --force
python -m http.server 8000 -d dist
```

## Known limits

- CMS changes file layouts several times a year. The schema gate stops the refresh when that happens; `pipeline/sources.py` then needs updating.
- CMS's download servers reject some non-browser HTTP clients, so downloads use `curl`.
- Staffing figures are CMS's published Payroll-Based Journal measures, not the daily PBJ files.
- Not yet included: Medicare cost reports, SNF VBP and QRP, the SFF candidate list detail, market comparisons, risk rank, alerts.
