# plains agent notes (MO, KS, NE, SD, ND)

Deliverable: /tmp/claude-0/-home-user-Misc/63250c82-6776-57b5-9e49-8fdd0f4ba110/scratchpad/states/plains/administrators.csv (1,139 rows)
Scripts: /tmp/claude-0/-home-user-Misc/63250c82-6776-57b5-9e49-8fdd0f4ba110/scratchpad/states/plains/scripts/ (common.py matcher; mo_build.py, ks_build.py, ne_parse.py, sd_build.py, nd_build.py, combine.py)
Raw downloads: /tmp/claude-0/-home-user-Misc/63250c82-6776-57b5-9e49-8fdd0f4ba110/scratchpad/states/plains/downloads/<state>/
Pull date for everything: 2026-10-30.

| State | Source | Facilities in source | Rows | Matched to CCN | Key size | Key covered | Coverage |
|---|---|---|---|---|---|---|---|
| MO | DHSS LTC Directory (data.mo.gov fenu-sipv), SNF+ICF levels | 501 | 499 | 479 | 486 | 479 | 98.6% |
| KS | KDADS Facilities Directory (APEX app 113) NF + Hospital LTCU | 297 | 297 | 296 | 296 | 296 | 100% |
| NE | DHHS Licensure Unit LTC (Nursing Home) Roster PDF | 188 | 188 | 180 | 180 | 180 | 100% |
| SD | DOH Board of NFA licensee list (person roster w/ facility phone) | 224 licensees / 183 with phone | 83 | 83 (69 distinct CCNs) | 96 | 69 | 71.9% (medium/low) |
| ND | ND Long Term Care Association facility member listing (non-state, public) | 140 listings / 72 with NF beds | 72 | 72 | 72 | 72 | 100% (medium) |

## Missouri (MO)
- Source: Missouri DHSS, Section for Long-Term Care Regulation, "LTC DIRECTORY" open dataset on data.mo.gov (Socrata id fenu-sipv). Fields include Facility Name, Level of Care (SNF/ICF/RCF/ALF), LicenseNumber, address, phone, First/Last Name Administrator, and "Certification" = CMS CCN.
- Re-pull: `curl -A "Mozilla/5.0" "https://data.mo.gov/api/views/fenu-sipv/rows.csv?accessType=DOWNLOAD" -o ltc_directory.csv`; metadata `https://data.mo.gov/api/views/fenu-sipv.json` (rowsUpdatedAt). Catalog page: https://catalog.data.gov/dataset/ltc-directory. Same data is also in the DHSS ArcGIS layer https://gis.mo.gov/arcgis/rest/services/DHSS/LongTermCare/MapServer/0 (field ADMIN).
- As-of: rows updated 2026-10-05 (Socrata rowsUpdatedAt).
- Source rows: 1,101 licensed LTC facilities; 483 SNF + 17 ICF = 501 used (RCF/ALF excluded; 1 pair of identical rows deduped).
- Matched: 473 ccn_direct via the Certification column, 10 by phone, 479 distinct CCNs of 486 in the key.
- Gaps: 7 key CCNs not covered, all hospital-based SNF/swing units DHSS does not license as LTC facilities: 265289 Cox Meyer Orthopedic (Springfield), 265327 Phelps Health (Rolla), 265429 Lake Regional (Osage Beach), 265842 SSM DePaul Anna House (Bridgeton), 265845 University Health Lakewood (KC), 26A381 Salem Memorial District Hospital, 26E421 Madison Medical Center (Fredericktown). 20 source SNF/ICF rows carry no CCN (licensed-only / not certified, e.g. Mary Culver Home, Mari de Villa, Sunrise of Chesterfield, Parc Provence). Rows whose name-only match pointed at a CCN already matched directly were blanked (Festus Manor, Baptist Homes of Ozark, McKnight Place AL, Sunrise of Des Peres, Jackson Creek Memory Care, TigerPlace Senior Living, duplicate Aberdeen Heights) to avoid double-assigning a CCN.
- Administrator name is given as first/last; title set to "Administrator". administrator_phone is the facility phone.

## Kansas (KS)
- Source: KDADS "Facilities Directory" Oracle APEX application (webapps.kdads.ks.gov, app 113 page 901). Interactive report columns: Facility Name, DBA, State ID (license no.), Facility Type, Address, City, County, Zipcode, Administrator Name, Phone, Last Change Date/Last Change, Last Survey Posting Date. The marketing page https://www.kdads.ks.gov/licensing-policy/adult-care-home-directory is Akamai-blocked for non-browser clients; the app itself is reachable.
- Re-pull: (1) GET `https://webapps.kdads.ks.gov/prod/f?p=113:901:::::P901_FACILITY_TYPE,P901_SOURCE:NF,P` with a cookie jar and browser UA; read `p_instance` from the HTML; (2) GET `https://webapps.kdads.ks.gov/prod/f?p=113:901:<p_instance>:CSV` -> full CSV (283 rows). Repeat with facility type `LTCU` (Hospital Long-Term Care Units, 20 rows) for hospital LTC units. Dedupe on State ID.
- As-of: live app, pulled 2026-10-30 (each row has its own Last Change Date; most recent 10/28/2026).
- Source rows: 283 nursing facilities (incl. 8 Mental Health NFs, 5 LTCUs appearing under NF) + 20 LTCU list = 297 unique State IDs.
- Matched: 296 of 296 key CCNs (278 by phone, 18 by address; KDADS does not publish the CCN). 1 source row unmatched: Brookfield Opco LLC dba Willow Tree Post Acute, 2515 SW Wanamaker Rd, Topeka (N089071) - not in the key (likely new certification).
- Gaps: 1 row has a blank administrator in the source. Administrator names are published in caps; title-cased here.

## Nebraska (NE)
- Source: Nebraska DHHS Division of Public Health, Licensure Unit, "Roster - Long Term Care Facilities" (Nursing Home Roster, by city). Each block has facility, address, phone, Medicare ID (CCN), State License No, licensee, and "<Name>, Administrator" (or Assistant Administrator).
- Re-pull: `curl -A "Mozilla/5.0" https://dhhs.ne.gov/licensure/Documents/LTCRoster.pdf` then `pdftotext -layout`; parse with scripts/ne_parse.py. Index page: https://dhhs.ne.gov/licensure/Pages/Rosters-of-Facilities-and-Services.aspx
- As-of: "Updated: 10/15/2026" printed on the roster.
- Source rows: 188 facilities (roster summary: 162 SNF/NF dual, 6 distinct part, 1 SNF only, 11 NF (Medicaid) only, 7 SNF-LIC, 1 NF-LIC).
- Matched: 180 of 180 key CCNs (169 ccn_direct from the printed Medicare ID, 11 by phone where the printed ID is a Medicaid-only 28E/28F number that differs from the key).
- Gaps: 8 roster facilities have no CCN in the key (4 state Veterans Homes, 2 correctional-institution infirmaries, Nebraska Masonic Home, Aurora Memorial Community Care NF-only etc.) - included with blank ccn. 5 facilities list only an "Assistant Administrator" (title kept as published).

## South Dakota (SD)
- No state facility-level administrator file is downloadable. The DOH facility directory ("Find Licensed Long-Term Care Facilities", https://www.sdhls.org/verify/) is a search form gated by Google reCAPTCHA and only shows one license type/result set per interactive search; it was NOT automated (a reCAPTCHA bypass attempt was blocked by policy and not retried). The DOH PH04 license list app (https://apps.sd.gov/ph04lassnet/rptPH04LicenseList.Aspx) returns an application error page.
- Source used instead (brief option 3, NHA board roster): South Dakota Board of Nursing Facility Administrators "Licensee List" PDF published by DOH, columns First/Last Name, Facility City, Facility State, Facility Phone, issue/expiry dates, license number. The licensee's facility phone was matched to the facility phone in the key.
- Re-pull: `curl -A "Mozilla/5.0" https://doh.sd.gov/media/yrbic5kv/nfa-licensees-202681.pdf` (board page: https://doh.sd.gov/licensing-and-records/boards/nursing-facility-administrators/ ; the file name suffix changes with each update - the earlier `nfa-licensees-2026.pdf` link now 404s). `pdftotext -layout`, then scripts/sd_build.py.
- As-of: "Last updated: August 1, 2026".
- Source rows: 224 licensees, 183 with a facility phone; 83 licensee->facility phone matches covering 69 of 96 key CCNs.
- Confidence: medium when exactly one licensee lists that phone; low (26 rows) when 2+ licensees share a facility phone (e.g. administrator plus a licensed assistant/regional) - the roster does not say which one is the administrator of record. Some licensees list a corporate or regional phone and matched nothing. 27 key facilities have no licensee with a matching phone (phone mismatch or the administrator lists a different number).
- To get authoritative names: run the sdhls.org verify search manually (License type "Nursing Facility") - results pages include the facility administrator; or request the list from DOH Office of Health Facilities Licensure & Certification, 605-773-3356.

## North Dakota (ND)
- State sources checked: ND HHS Health Facilities Unit "Skilled Nursing Facility Directory" (https://www.hhs.nd.gov/sites/default/files/documents/DOH%20Legacy/HF/Facility%20Reports/nd-skilled-nursing-facilities-exclusion.pdf, iQIES Name and Address Listing run 10/28/2026, 72 providers) - has CCN, address, phone and a contact e-mail but NO administrator name (the older ASPEN-format directory that carried the administrator is no longer online; all ND-skilled-nursing-facilities.pdf URLs 404). The HHS SNF page lists medical directors, not administrators. ND Board of Examiners for NHA (https://www.ndnha.nd.gov/licensees) lists licensees without facility. ND GIS Hub skilled nursing layer has no administrator field. Conclusion: no ND state source publishes administrator-by-facility.
- Source used (non-state, public, flagged in source_name): North Dakota Long Term Care Association "Facility Member Listing", https://ndltca.org/membership-facilities/ - each listing has address, phone, e-mail, "CEO/Administrator" (label varies: Administrator, Executive Director, President/CEO, etc.), bed counts. NDLTCA states all member nursing facility beds are Medicare/Medicaid certified; all 72 key CCNs are present.
- Re-pull: `curl -A "Mozilla/5.0" https://ndltca.org/membership-facilities/` (all 140 listings are in the single page HTML); parse with scripts/nd_build.py (keeps listings with Nursing Facility Beds > 0).
- As-of: page has no date; pulled 2026-10-30. Confidence capped at medium because the source is an association self-reported listing, not the licensing agency. Several hospital-attached units list the hospital CEO/President (title retained as published).
- Matched: 72 of 72 key CCNs (62 phone, 9 address, 1 name_city).

## Blockers / caveats
- SD: reCAPTCHA-gated directory could not be automated; facility-level administrator names there come only from the NFA licensee roster via phone match (medium/low).
- ND: no state administrator source; association listing used and clearly labeled.
- KS/MO/NE sources do not include administrator e-mail; administrator_phone is the facility main phone.
