# National Nursing Home Owner / Operator / Administrator Database

One row per Medicare/Medicaid-certified nursing home in the United States (about 14,700 facilities),
with the facility administrator, the licensed operating entity, the management company, the disclosed
direct and indirect owners (individuals and organizations), officers and directors, REIT/landlord and
private equity parties, mortgage/security interest holders, and the Care Compare chain affiliation.
Everything comes from public government sources and every row carries its source.

The purpose is a quick "do I know anyone connected to this facility?" lookup:

* **People_Index** (sheet / `people_index.csv`): one row per unique person. Search a name and you get
  every facility where that person is disclosed, with their role(s) and title(s).
* **Facilities** (sheet / `facilities_master.csv`): one row per facility with the administrator and
  all owner / operator fields side by side.
* **Owners_Operators**: facility-level owner and operator roll-up.
* **Administrators**: best administrator per facility plus the other candidates found.
* `people_roles.csv.gz` / `nursing_homes.sqlite.gz` table `people_roles`: the full long table, every
  person and organization disclosed for every facility (about 500k rows).

## Current build (2026-10-30, after external review rounds 1 to 3 state exports)

| Measure | Count |
|---|---|
| Facilities (CCNs) | 14,881 |
| Facilities with an administrator name | 14,108 (95%) |
| of which high confidence | 12,915 (medium 965, low 228) |
| Disclosed person/organization roles | 551,887 |
| Unique people | 54,985 |
| Unique organizations | 16,095 |
| States with a state-directory administrator source | 42 plus DC |

States without a usable state source (administrator comes from PECOS/NPPES only): AK, CO, MA, MT, NM, NY, VA, PR, GU. See `raw/state_administrators/NOTES.md` for the per-state picture and how to
close those gaps with a normal browser.

## Outputs (`output/`)

| File | Contents |
|---|---|
| `nursing_homes.xlsx` | Excel workbook: Facilities, Administrators, Owners_Operators, People_Index, Organization_Index |
| `nursing_homes.sqlite.gz` | Same tables plus `people_roles`, `administrator_candidates`, `source_manifest`, indexed on name and CCN |
| `facilities_master.csv` | One row per CCN |
| `administrators.csv` / `administrator_candidates.csv` | Best administrator per facility, and every candidate |
| `owners_operators.csv` | Facility-level owner / operator / lender roll-up |
| `people_roles.csv.gz` | Long table, one row per person-or-org x facility x source |
| `people_index.csv` / `organization_index.csv` | Unique-name lookups |
| `build_summary.json` | Row counts and coverage from the last build |

## Sources

| Source | What it contributes | Refresh |
|---|---|---|
| CMS Care Compare, Nursing Home Provider Information (dataset `4pq5-n9py`) | Facility list, address, beds, ratings, ownership type, chain name | Monthly |
| CMS Care Compare, Nursing Home Ownership (dataset `y2hd-n93e`) | Owners, officers, directors, managing employees per facility | Monthly |
| CMS PECOS, Skilled Nursing Facility Enrollments (data.cms.gov) | Enrolled operating entity (legal name, DBA, entity type, for-profit flag, NPI, affiliated entity) | Monthly |
| CMS PECOS, Skilled Nursing Facility All Owners (data.cms.gov) | Every disclosed owner / managing party with role, title, ownership %, and flags for management company, REIT, private equity, holding company, lenders, additional disclosable parties (landlords, consultants) | Monthly |
| NPPES NPI Registry API | Authorized official for each facility NPI (name, title, phone) and state license number | On demand |
| State licensing directories (`raw/state_administrators/*.csv`) | Administrator of record by facility, where a state publishes it | Per state, see `raw/state_administrators/NOTES.md` |

## How the administrator is chosen

`administrator_confidence` on each facility:

1. **high**: a state licensing directory names the administrator (or licensee contact person), or a PECOS
   disclosure for that facility carries a title containing "Administrator" (most recent association date wins).
2. **medium**: a state directory contact published with a non-administrator title (for example President/CEO
   at a hospital-attached unit), or the NPI Registry authorized official for the facility is titled Administrator.
3. **low**: a W-2 or contracted managing employee is disclosed with no title (commonly, but not always, the administrator).
4. **none**: no candidate in any source. Other names found are listed in `other_candidates`.

PECOS ownership disclosures are only as current as the operator's last enrollment update, so treat a
PECOS administrator as "administrator as of the association date", not necessarily today's.

## Refreshing

```
python3 -I scripts/download_cms.py          # pulls the four CMS files into raw/
python3 -I scripts/nppes_pull.py            # pulls NPI Registry records (resumable, ~15 minutes)
python3 -I scripts/build_db.py              # rebuilds output/
```

State administrator files are produced separately (see `raw/state_administrators/NOTES.md` for the
source and re-pull steps per state) and dropped into `raw/state_administrators/` before the build.
Required columns: `ccn,state,facility_name,address,city,zip,state_license_number,administrator_name,
administrator_title,administrator_phone,administrator_email,source_name,source_url,source_date,match_method,match_confidence`.

## Known limits

* CMS data covers certified nursing homes (SNF/NF). Licensed-only facilities, assisted living and
  ICF/IID are not included.
* Ownership percentages are as reported in PECOS; indirect interests are not rolled up.
* The "landlord" is not a distinct CMS field. Look at `reit_or_landlord_orgs`,
  `additional_disclosable_parties_org` and `holding_or_parent_orgs`.
* Name matching in the People_Index uses first + last name only, so two different people with the same
  first and last name collapse into one row; check the facilities list before assuming identity.
