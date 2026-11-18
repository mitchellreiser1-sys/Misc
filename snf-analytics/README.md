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

## What else it includes

- **Release history** (`pipeline/history.py`, `seed/history.json.gz`): published ratings and flags from each CMS release back to October 2023, seeded from CMS's own archives with `tools/backfill_history.py`. A gate confirms the archive copy of the current release matches the live files. Each refresh appends to the history and saves it to the `snf-state` GitHub release.
- **What changed** (`pipeline/changes.py`): differences between the two most recent releases, for every facility.
- **Email on new data** (`pipeline/notify.py`): sent when a new CMS release publishes. See "Email setup" below.
- **Owner lookup**: every owner, officer, and managing entity across all facilities, matched on the name exactly as CMS publishes it.
- **Repeat citations, cut point bands, rating history, daily staffing detail, and SNF VBP** (`pipeline/extras.py`).
- **Regulatory screening score** (`pipeline/risk.py`): an internal screening aid whose components add to 100, with review tiers. Not a CMS figure and not a credit risk measure. Weights live in one file. `tools/validate_risk.py` tests the score against three years of dated outcomes and writes `seed/risk_validation.json`, which the Risk score page displays. Rerun it whenever the scoring rules change; the page shows the study only when its version matches the live score.
- **Exports**: formatted Excel workbooks and a print layout for PDF, for facility, portfolio, owner, and change reports.
- **Lender narrative draft**: the Subject's State Surveys section, filled from CMS figures only, with `[TBD]` markers for anything CMS does not publish.

Supplementary sources (daily staffing, VBP) never block a refresh. If one is missing or fails its check, that section is left out and the Data status page says why.

## Portfolios (published with the site)

`portfolios.json` holds the shared portfolio list that everyone sees, and those facilities are tracked automatically in the change email. A portfolio created on the site is saved on that device only, because the site has no server yet. When the tool moves behind a login, every portfolio is to be saved for all users automatically, with no separate publishing step. **The site is public, so every name and CCN in that file is visible to anyone.** A malformed entry stops the refresh. Move this to a private store when the site moves behind a login.

## Email setup

Add these as repository secrets (Settings, Secrets and variables, Actions). Without them the email step does nothing.

| Secret | Value |
|---|---|
| `ALERT_TO` | Recipient address, or several separated by commas |
| `MAIL_FROM` | Sender, for example `Bravo Capital <noreply@bravocapital.com>` |
| `RESEND_API_KEY` | API key for the Resend account that sends for bravocapital.com (or use `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) |
| `WATCHLIST_CCNS` | Optional. CCNs to report on, separated by commas. Copy them from the Portfolios page |

The tracked list and recipients are never written to the run log. To test, run the workflow manually with "force" and "send_email" checked.

## How it stays live

`.github/workflows/snf-refresh.yml` runs daily, asks CMS whether new files exist, and rebuilds only when they do.
No one downloads anything. GitHub runs schedules only from the default branch.

One-time setup: repository Settings, Pages, Source: **GitHub Actions**.

## Run locally

```bash
cd snf-analytics
python -m unittest discover -s tests
node --test tests/rollup.test.js
python -m pipeline.run --force --state-out work/state_out/history.json.gz
python -m http.server 8000 -d dist
```

## Known limits

- CMS changes file layouts several times a year. The schema gate stops the refresh when that happens; `pipeline/sources.py` then needs updating.
- CMS's download servers reject some non-browser HTTP clients, so downloads use `curl`.
- Staffing figures are CMS's published Payroll-Based Journal measures, not the daily PBJ files.
- The regulatory screening score measures regulatory risk only and ranks facilities with about 69% accuracy; see the Screening score page. It has not been tested against credit outcomes.
- Owner names are not de-duplicated. The same person can appear under more than one spelling.
- Not included: Medicare cost reports, SNF QRP, market comparisons.
