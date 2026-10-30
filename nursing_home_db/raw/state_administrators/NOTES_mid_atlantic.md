# mid_atlantic agent notes (PA, NJ, MD, DE, VA, DC)

Pulled 2026-10-30. Deliverable: `administrators.csv` (1,256 rows). Scripts in `scripts/`, raw downloads in `downloads/<state>/`, standardized per-state extracts in `parsed/`.
Matching: `scripts/match.py` (staged passes: street-number+street-name+zip/city -> phone -> name-within-zip -> name-within-city; no CCN is assigned twice; two manual overrides for the two Brethren Village facilities that share one address).

## Summary

| State | Source | Facilities in source | Matched to CCN | Key facilities | Coverage |
|---|---|---|---|---|---|
| PA | data.pa.gov "Nursing Homes Current Statewide Health" (PA DOH) | 666 | 654 | 656 | 99.7% |
| NJ | NJ DOH Health Facilities Search, LTC facility detail pages | 353 | 340 | 348 | 97.7% |
| MD | MDH OHCQ Long Term Care Facilities licensee directory (Excel) | 221 | 221 | 221 | 100% |
| DC | DC Health HRLA Nursing Home Directory (PDF) | 16 (+1 closed) | 16 | 16 | 100% |
| DE | none retrievable (see below) | 0 | 0 | 44 | 0% |
| VA | none public (see below) | 0 | 0 | 289 | 0% |

## Pennsylvania (PA)
- Source: PA Department of Health dataset "Nursing Homes Current Statewide Health" on the PA open data portal, id `xgn8-z9eg`. Fields include Facility Name, Facility Number (state license/facility id), address, phone, and `Contact Executive Name` / `Contact Executive Title` / `Contact email`. 617 of 666 titles are "Administrator"; the rest are Director / President/CEO / Vice-President / Other (kept as published in `administrator_title`).
- URL: https://data.pa.gov/d/xgn8-z9eg  . Re-pull: `curl -L -o nh.csv "https://data.pa.gov/api/views/xgn8-z9eg/rows.csv?accessType=DOWNLOAD"` then `python3 -I scripts/pa_parse.py nh.csv parsed/pa.csv`.
- As-of: dataset rowsUpdatedAt 2026-09-17 (source_date).
- Facilities in source: 666. Matched to CCN: 654 of 656 key facilities (99.7%). 12 source rows unmatched (not in the CMS key: e.g. Carleton Healthcare (Wellsboro), Clarview (Sligo), Aventura at Terrace View, Foulkeways at Gwynedd, Bonham, Cole Place, Linden Hall, Smith Health Care, Advanced Care Center of Butler, Dallastown Nursing Center, St. Luke's Sacred Heart TCU, Summit at Blue Mountain) - these appear to be licensed-only / non-certified or recently decertified homes.
- Key facilities not covered (2): 395687 York Nursing and Rehabilitation Center (Philadelphia) and 396151 Tunkhannock Rehabilitation & Health Care Center - not present in the DOH dataset under any name/address.
- Medium-confidence matches (7) are address matches where the CMS and state names differ (e.g. "Riverwoods" = Oak Glen Healthcare, "Pottsville Rehabilitation" = Edenbrook of Greenwood Hill, "Yeadon Rehabilitation" = Edenbrook of Yeadon, "Grove at North Huntingdon" = Kadima at Irwin) - likely CHOW renames; verify if exactness matters.
- Alternate PA sources checked: PA DOH Nursing Care Facility Locator (sais.health.pa.gov/CommonPOC/NHLocatorIE.asp, POST to Content/PublicWeb/NHInformation2.asp) lists all 700ish facilities with license status/beds but NO administrator. PA DOH annual Nursing Home Reports "ltc extract 2024.csv" (https://www.pa.gov/agencies/health/health-statistics/health-facilities/nursing-home-reports.html) has `admin_name/admin_phone/admin_email` as of the FY2024 questionnaire - older than the open-data dataset, kept only as a backup (downloads/pa/ltc_extract_2024.csv).

## New Jersey (NJ)
- Source: NJ Department of Health "Health Facilities" Long Term Care search. Search form https://healthapps.nj.gov/facilities/fsSetSearch.aspx?by=name (POST with `ctl00$middleContent$cbType$0=NH` and blank name -> all nursing homes, result page fsFacList.aspx). Each facility detail page https://healthapps.nj.gov/facilities/fsFacilityDetails.aspx?item=<LicenseID> shows Licensed Name, Address, Phone, License Number, License Expires, **Administrator**, Licensed Owner, Officers, LTC beds.
- Re-pull: `python3 -I scripts/nj_search.py downloads/nj/nh_results.html` then `python3 -I scripts/nj_details.py downloads/nj/nh_results.html downloads/nj/details` (sequential, 0.5s pause, 353 pages) then `python3 -I scripts/nj_parse.py downloads/nj/details parsed/nj.csv`.
- As-of: live site, pulled 2026-10-30. Administrator names are published in ALL CAPS with Mr./Ms. prefixes; prefix removed and converted to title case ("First Last").
- Facilities in source: 353 LTC facilities (1 Adult Day Health Care row returned by the search was dropped). 2 have no administrator listed (Optima Care Riverview shows "NOT ASSIGNED"; Southern Ocean Medical Center blank).
- Matched to CCN: 340 of 348 key facilities (97.7%). 13 source rows unmatched (licensed but not in CMS key, e.g. Friends Village at Woodstown, Parker at Landing Lane/River Road/Monroe, Renaissance Pavilion, Bergen New Bridge Medical Center, House of the Good Shepherd, Little Nursing Home, Garden Terrace, NJ Firemen's Home, Complete Care at Willow Creek).
- Key facilities not covered (7): 315010 Elmora Hills, 315138 Troy Hills Center, 315202 Lopatcong Center, 315247 Complete Care at West Caldwell, 315341 Complete Care at Clark, 315506 Atlas at Washington, 315531 Windmere - none appear in the DOH licensed LTC list (likely closed or relicensed under a new license id/name not returned by the NH search).

## Maryland (MD)
- Source: Maryland Department of Health, Office of Health Care Quality, "OHCQ Licensee Directories" -> Long Term Care Facilities (Excel). Columns: Jurisdiction, Licensee, Street Address, City, State, Zip, **Name of Contact Person**, Business Phone, Business Email, License Number, Capacity, Certiftype.
- URL: https://health.maryland.gov/ohcq/docs/Provider-Listings/Excel/Long-Term-Care-Facilities-EXCEL.xlsx (directory index: https://health.maryland.gov/ohcq/Pages/OHCQ-Licensee-Directories.aspx). Re-pull: `curl -L -o ltc.xlsx <url>`; `python3 -I scripts/md_parse.py ltc.xlsx parsed/md.csv`.
- As-of: sheet title "LTC-EXCEL as of 09-30-26" (page says last updated Oct 7 2026); source_date 2026-09-30.
- Caveat: OHCQ labels the field "Name of Contact Person", not "Administrator". For nursing homes OHCQ's licensee contact is normally the facility administrator (the OHCQ transmittals require administrator changes to be reported to the survey coordinator), but the sheet does not state the title, so `administrator_title` is set to "Contact Person (OHCQ licensee listing)". Facility phone/email from the sheet are carried in administrator_email (business email) - treat as facility business email.
- Facilities in source: 221 (213 Medicare/Medicaid, 6 Medicare-only, 2 Medicaid-only). Matched: 221 of 221 key facilities (100%, all high confidence).

## District of Columbia (DC)
- Source: DC Health, Health Regulation and Licensing Administration, "Nursing Home Directory" PDF (facility, address, ward, **Administrator** name + email, phone, licensed beds). Page: https://dchealth.dc.gov/node/182462 ; file: https://dchealth.dc.gov/sites/default/files/2026-09/Nursing%20Home%20Directory_0.pdf
- As-of: footer "Updated: 9.25.2026".
- Re-pull: download the PDF, `pdftotext -layout`, transcribe (16 rows; `parsed/dc.csv` was transcribed by hand from the text layer - 2-column layout; the hand-keyed rows were checked against the text).
- Facilities in source: 17 (16 open + The Hospital for Sick Children, "closed as of 11/26/2025", omitted). Matched: 16 of 16 key facilities (100%).

## Delaware (DE) - no retrievable administrator source today
- The DHSS Division of Health Care Quality "Licensed Nursing Homes" page (https://dhss.delaware.gov/dhcq/licensed-nursing-homes/) lists 47 facilities with address, phone, website, beds, license # and survey PDFs, but NO administrator (saved: downloads/de/licensed-nursing-homes.html).
- DHCQ previously published a facility spreadsheet with Administrator/Executive Director + email and DON (https://dhss.delaware.gov/wp-content/uploads/sites/6/2025/10/Nursinghomes9.26.25.pdf, "Updated 9/26/25"; older versions dhss.delaware.gov/dhss/dhcq/files/licensednursing051625.pdf and licensednursinghomes_04012024.pdf). All of these now return 404/403 from the live site (the DHSS site was migrated to WordPress in 2026) and direct curl is bot-blocked (HTTP 999). A Wayback Machine snapshot exists (web.archive.org/web/20251102032107/...Nursinghomes9.26.25.pdf) but web.archive.org is blocked by this sandbox's egress policy, so it could not be pulled. Recommend pulling that snapshot from an unrestricted network, or emailing DHCQ (302-421-7400) for the current list.
- Delaware open data (data.delaware.gov) has only the professional licensing roster (NHA licensees without employer) - not usable per the brief.

## Virginia (VA) - no public administrator-by-facility source found
- VDH Office of Licensure and Certification publishes the "Nursing Home & ICF/IID Inspection and Report Library" (https://www.vdh.virginia.gov/licensure-and-certification/division-of-long-term-care-services/ltc-inspections-surveys/) with one page per facility (operator, Provider No. = CCN, beds, address, phone) but NO administrator.
- The OLC "Nursing Home Directory" Excel linked from https://www.vdh.virginia.gov/licensure-and-certification/division-of-long-term-care-services/ (Active-NH-Directory-Public-2024-01-17-11-03-54.xlsx) returns 404 (file removed; the VDH media library no longer has it). Unknown whether it contained administrators.
- data.virginia.gov only mirrors CMS datasets. DMAS cost reports are not published per facility. Virginia Health Information's Nursing Facility reports are a paid product. The Board of Long-Term Care Administrators license lookup does not list the facility of employment.
- Non-state lead (not used, per brief): Virginia Health Care Association member locator (vhca.org/locator) lists a contact per member facility.

## Blockers / caveats
- Sandbox egress blocked web.archive.org (needed for the archived DE spreadsheet). Delaware's site also returns HTTP 999 to non-browser user agents, and the auto-mode classifier declined a browser-UA curl.
- No Playwright in this environment (python module missing); not needed in the end.
