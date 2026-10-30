# great_lakes_east — administrator research notes (OH, MI, IN, KY, WV)

Pulled 2026-10-30. Deliverable: `administrators.csv` in this directory (one row per state facility record; CCN blank where no confident match).
Scripts: `scripts/` (matchlib.py = shared normalizer/matcher; `<st>_build.py` per state; `combine.py`). Raw pulls: `downloads/<st>/`.

Matching: state record -> facility_key by (1) CCN when the state source carries the Medicare ID (OH), else (2) normalized name + ZIP/city, (3) street number + street similarity, (4) phone. When two state rows resolved to the same CCN, only the best-supported row kept the CCN (`finalize()` in matchlib). All matches at "medium" were eyeballed (they are renamed facilities at the same street address, e.g. INTERSECT HEALTHCARE OF BELDING = Mission Point of Belding).

## Summary

| State | Source | Facilities in source (rows) | Matched to CCN (distinct) | Key facilities | Coverage | Administrator present (matched) |
|---|---|---|---|---|---|---|
| OH | ODH EID "Health Care Provider Real-Time Information" certification detail pages | 928 (925 certified detail pages + 3 licensed-only) | 924 | 924 | 100% | 923 (99.9%) |
| MI | LARA State Licensing search + licensure survey/waiver letters | 429 | 421 | 422 | 99.8% | 298 (70.6%) — dated letters, see caveat |
| IN | IDOH LTC Facility Directory (QAMIS) | 506 | 506 | 507 | 99.8% | 506 (99.8%) |
| KY | CHFS OIG Long Term Care Directory (xlsx) | 296 (312 incl. ICF/IID) | 266 | 266 | 100% | 266 (100%) |
| WV | OHFLAC Health Care Facility Lookup | 125 | 123 | 123 | 100% | 94 (76.4%) |

---

## Ohio (OH)

**Source:** Ohio Department of Health, Enhanced Information Dissemination (EID) application — "Health Care Provider Real-Time Information" → Provider type *Nursing Home* → *Medicare/Medicaid Certification* → status ACTIVE. Each facility's `Detail_Certification.aspx` page shows Medicare ID, Medicaid ID, address, county, **Administrator**, phone, e-mail, certification status and survey list.
- Entry point: https://publicapps.odh.ohio.gov/eid/default.aspx (ASP.NET WebForms; the `http://` link on odh.ohio.gov returns 503 — use https).
- Re-pull: `node scripts/oh_eid_scrape.js <outdir> <COUNTY>` (Playwright; opens EID → Real-Time Information → Nursing Home / Certification / ACTIVE / county → iterates the DataGrid rows via `__doPostBack`, reads each detail page, `goBack`). `scripts/oh_run_all.sh` loops over the 88 counties; `scripts/oh_eid_scrape_by_id.js <outdir> <ids.json>` re-pulls specific Medicare IDs (search box "Medicare ID"). ~1–2 s per facility, 0.5–0.8 s pauses.
- Also pulled (same app, "Health Care Provider Report and Information Extract" → FACILITY LISTING → export CSV): `downloads/oh/oh_facility_listing_rbl1.csv` (Medicare/Medicaid-certified nursing homes, 925 with MCARE_ID; gives State ID = license number) and `oh_facility_listing_rbl0.csv` (State-of-Ohio-licensed nursing homes, 939). Neither listing carries the administrator; only the Real-Time detail page does. `node scripts/oh_eid_export.js <outdir> <0|1> csv`.
- As-of: the detail pages are live records (software release 01/27/2026); source_date = pull date 2026-10-30.
- Match: `ccn_direct` on the page's Medicare ID (= CCN).
- Facilities in source / matched / coverage: 925 certified nursing homes scraped (all 925 Medicare IDs in the EID certified listing; 860 via the county loop + 65 re-pulled by Medicare ID because the DataGrid pager only exposes 10 page links, so Cuyahoga pages 11+ were skipped on the first pass). 924 of 924 key CCNs matched (`ccn_direct`); the one extra EID record (725009 Overbrook Landing, Xenia) is a hospital-based unit not in the key. Administrator present for 923 of 924 (blank: 725011 Arcola Creek Health and Rehabilitation). 3 state-licensed-only nursing homes (House of Loreto, Canton; Kenwood by Senior Star, Cincinnati; Overbrook Landing, Xenia — the latter is the licensed twin of EID record 725009) are included with blank CCN and no administrator (the license listing has no administrator field; their "L" detail pages were not scraped).
- Known gaps: administrator value is whatever ODH has on file in the certification record (live, undated); 44 garbage rows from pager clicks were discarded during parsing. Licensed-only homes lack administrator.
- The Ohio Department of Aging LTC Quality Navigator (ltc.ohio.gov → aging.ohio.gov) and the ODH portal page "Long-Term Care Facility Search" (404) were not usable; ltcquality/nursinghomequality subdomains were blocked by the egress proxy. The EID app is the ODH system of record.
- ODH test records in the license listing ("HOME FOR RETIRED PROGRAMMERS", "ODH SNF FOR RETIRED PROGRAMMERS") were dropped.

## Michigan (MI)

**Source:** LARA Bureau of Community and Health Systems, State Licensing search (https://statelicensing.apps.lara.state.mi.us/). The license record itself has **no administrator field**. The public document list attached to each license (licensure survey letters "LS", survey-waiver determinations "SW", post-licensure survey "PLS") are letters addressed to "<Name>, Administrator" at the facility, so the administrator name was taken from the most recent letter that names one.
- Re-pull: `python3 -I scripts/mi_list.py <outdir>` — POST `home/search` with `{"licenseType":"NursingHome","primaryStatus":"ACTIVE","pageSize":100,...}` (429 active licenses), then GET `api/details/search/{licenseId}` for each (document list in `dmsDatas`). `python3 -I scripts/mi_docs.py details.json docs/` downloads each letter via `api/details/viewReport/{primaryKey}` (0.5 s pause). `python3 -I scripts/mi_parse.py` runs pdftotext and extracts `^Name, Administrator$` plus the letter date; `mi_build.py` picks the latest dated letter per license.
- As-of: license list is live (pulled 2026-10-30). **source_date on each MI row is the date of the letter that named the administrator** (2022: 46, 2023: 40, 2024: 40, 2025: 162, 2026: 14). Treat pre-2025 names as possibly stale; the row's `source_url` is the exact letter PDF.
- Numbers: 429 active nursing home licenses; 421 matched to CCN (key has 422; only *DJ Jacobetti Home for Veterans, Marquette* not matched — it is licensed under a different name/record). 351 licenses have at least one letter; 302 letters name an administrator with the explicit ", Administrator" title; 298 of those map to a CCN. Letters that only say "Dear Administrator" (2026 waiver approvals) or list an addressee without a title were **not** used (no guessing).
- Gaps: 124 CCN-matched facilities have no administrator (no public letter naming one). Michigan has no public administrator-by-facility directory; the Board of Nursing Home Administrators license lookup does not list employer. Unmatched state rows (8): Avenue at Holland / Avenue at Westshore (Holland), Cedarbrook of Bloomfield Hills, Harbor Hospice, King's Daughters Home (Midland), Marycrest Manor (Livonia), Oakland Nursing Center (Southfield), The Lakes at Portage — state-licensed only / not in the key.
- Also available but not used: LARA PDF "Nursing Homes Provider Directory" (State_Federal_-_Nursing_Homes_541954_7.pdf) — name/address only.

## Indiana (IN)

**Source:** Indiana Department of Health, Health Care Regulatory Services "LTC Facility Directory" (QAMIS): https://www.in.gov/health/reports/QAMIS/ltcdir/wdirLtc.htm (statewide page; also by city/county pages under /ltcdir/). Each block has name, dba, address, **Administrator**, Tel, Fax, License Number, license expiry, bed capacity and breakdown (SNF/NF/NCC/RCF).
- Re-pull: `curl -L` the URL (note the 301 to `wdirLtc.htm`), then `python3 -I scripts/in_build.py wdirltc.htm facility_key.csv out.csv recs.json`.
- As-of: page header "Posted to the Web on: 10/22/2026" → source_date 2026-10-22.
- Numbers: 506 comprehensive-care (nursing) facilities; 506 matched (505 name+ZIP high, 1 address high); 506 distinct CCNs of 507 in key. Only key facility not in the directory: 155620 ZIONSVILLE MEADOWS (Zionsville) — absent from the IDOH list (likely closed/relicensed).
- Administrator present on all 506. IDOH also has the ArcGIS "Consumer Reports" app (CR_Nursing_Homes feature layer) — it has no administrator field, only a link to the facility PDF report.

## Kentucky (KY)

**Source:** Cabinet for Health and Family Services, Office of Inspector General, Division of Health Care — "Long Term Care Directory" (Excel), updated the 1st of each month: https://www.chfs.ky.gov/agencies/os/oig/dhc/Documents/Long%20Term%20Care%20Directory.xlsx (page: https://www.chfs.ky.gov/agencies/os/oig/dhc/Pages/hcf.aspx). Columns: License #, Facility Name, Address, City, Zip, County, Telephone, **Adm First, Adm Last**, Owner, Certified Beds, NF/NH/ICF/ALZ/PC/ICF-IID flags, licensure dates, region.
- Re-pull: download the xlsx, `python3 -I scripts/ky_build.py <xlsx> facility_key.csv out.csv`.
- As-of: sheet tab "October 2026" → source_date 2026-10-01.
- Numbers: 312 rows; 296 kept (rows flagged NF/NH/ICF/ALZ; 16 ICF/IID-only rows excluded). 272 raw matches → 266 distinct CCNs after dedupe = 100% of the 266 key facilities. 30 state rows left without CCN: hospital-based NF/SNF units and swing-bed hospitals that are not separate CCNs in the key (Baptist Health Deaconess Madisonville, Baptist Health Paducah, Clark Regional, Flaget Memorial NF, Highlands ARH, King's Daughters, Pineville Community Hospital, Signature at U of L Mary & Elizabeth, Cardinal Hill SNF unit, St Elizabeth Ft Thomas SNF), state-licensed-only / non-certified homes (Eastern Star Home, Louisville Protestant Altenheim, Friendship Health & Rehab, Taylor Manor, Wesley Village, Westminster Terrace, Trinity Station, Bridgepointe at Ashgrove Woods, Covington's Convalescent, Shemwell, McDowell SNF, Maximum Healthcare of Pikeville, The Neighborhood NF, St Matthews Transitional Care, Signature at Meadowview / Tanbark / Glenview, Hillcreek, Mayfield Health and Rehab) and one duplicate row (Village of Lebanon listed twice with different license numbers).
- Administrator present on every kept row (Adm First + Adm Last).

## West Virginia (WV)

**Source:** OHFLAC Health Care Facility Lookup, https://ohflac.wvdhhr.org/Apps/Lookup/FacilitySearch/ — facility type "NURSING HOME (NH)". The DataTables grid has an **Administrator** column; each facility's detail page (`/Apps/Lookup/FacilityDetails/{id}`) repeats it ("Unknown" when not on file).
- Re-pull: POST JSON to `https://ohflac.wvdhhr.org/Apps/Lookup/FacilitySearch` with the DataTables payload in `downloads/wv/payload.json` (`FedCode":"02*"`, `StatusFilter":"active,pending"`, `CountyFilter":"All Counties"`, `length:-1`, columns named DT_RowId, Name, LegalName, Admin, StateKey, ...). Headers: `Content-Type: application/json; charset=utf-8`, `X-Requested-With: XMLHttpRequest`. (Headless Chromium through the session proxy got 502 from this host; curl works.) Then `python3 -I scripts/wv_build.py wv_nh_active.json facility_key.csv out.csv`.
- As-of: live database; source_date = pull date 2026-10-30.
- Numbers: 125 active nursing homes (110 SNF/NF dual, 6 NF-only, 5 SNF-only, 3 distinct part, 1 state-licensed). 123 distinct CCNs matched = 100% of the 123 key facilities. Unmatched: Elkins Rehabilitation & Care Center appears twice in OHFLAC (same State Key 104038; second copy left blank) and the WV Veterans Nursing Facility (Clarksburg) is state-licensed only.
- Administrator populated for 96 of 125 (29 show null/"Unknown"); 94 of the matched CCNs have a name.

## States with no public administrator-by-facility source
None of the five: all have one, but Michigan's is indirect (names only appear in dated licensure letters, ~70% coverage) and Ohio/West Virginia require per-facility pages/grid rather than a flat download.
