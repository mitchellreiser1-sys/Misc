# Northeast agent – NOTES (NY, MA, CT, RI, NH, VT, ME, PR, GU)

Agent: northeast. Pulled 2026-10-30. Facility key counts (CMS-certified, from facility_key.csv):
NY 592, MA 341, CT 191, RI 72, NH 73, VT 33, ME 78, PR 9, GU 1 (total 1,390).

Deliverable: `administrators.csv` in this directory – 295 rows (CT 181, ME 78, VT 36), 291 with a CCN,
275 with an administrator name. Scripts in `scripts/` (run as `python3 -I scripts/<name>.py <args>`
from this directory): parse_me.py / build_me.py (Maine), ct_download.py / parse_ct.py / build_ct.py /
cleanup_ct.py (Connecticut), vt_scrape.py / build_vt.py (Vermont), matchlib.py (CCN matching),
assemble.py (final CSV). Raw downloads are under `downloads/<state>_*/`.

## Summary

| State | Source | Facilities in source | Matched to CCN | Coverage vs key |
|---|---|---|---|---|
| NY | none – no public administrator-by-facility source found | – | 0 | 0 / 592 (0%) |
| MA | blocked – mass.gov returns 403 to this container; no alternate host carries administrators | – | 0 | 0 / 341 (0%) |
| CT | DSS Annual Report of Long-Term Care Facility (Medicaid cost report), cost year 2025 (CSP-1 page 1, "Printed Name (Administrator)") | 181 (after dropping 4 closed + 1 RCH) | 180 | 180 / 191 (94.2%); 160 with both CCN and a name |
| RI | blocked – health.ri.gov sits behind a Cloudflare challenge (403) | – | 0 | 0 / 72 (0%) |
| NH | blocked – dhhs.nh.gov and forms.nh.gov return Akamai "Access Denied" (403) | – | 0 | 0 / 73 (0%) |
| VT | DAIL/DLP survey-results letters (addressed to the facility administrator, carry CMS Provider ID) | 36 licensed nursing homes | 33 | 33 / 33 (100%) |
| ME | DHHS DLC Licensed Provider Search, provider type Nursing Home ("Administrator" field) | 78 | 78 | 78 / 78 (100%) |
| PR | none – no public list of licensed SNFs with administrators found | – | 0 | 0 / 9 (0%) |
| GU | none – single facility (Guam Memorial Hospital Authority SNF); no licensing roster | – | 0 | 0 / 1 (0%) |

Environment constraints that shaped this run: (1) three state hosts (mass.gov, health.ri.gov,
dhhs.nh.gov/forms.nh.gov) return 403 to both curl and the WebFetch tool – they are WAF/bot-protected;
(2) the session's permission classifier refused a headless-browser (Playwright) fetch of those pages as
"bot check circumvention", so I did not retry; (3) web.archive.org is unreachable through the container
proxy (connection reset), so archived copies could not be used. Each of those states can be completed in
minutes from a normal browser using the URLs below.

## New York (592 in key) – no public administrator source

Checked, none list the administrator:
- NYS Health Profiles nursing-home pages (https://profiles.health.ny.gov/nursing_home/view/<id>,
  overview tab loaded from /nursing_home/tab_overview/<id>). The "Administrative" block shows only the
  operator, PFI, operating certificate and regional office. The printable directory
  (https://profiles.health.ny.gov/directory/nursing_homes, 598 homes) has name/address/phone only.
- Health Data NY "Nursing Home Profile" bulk zip (https://health.data.ny.gov/d/dypu-nabu, NY_Profiles.zip,
  updated 2026-09-25): Facility_Info.csv (name, address, phone, operator, MEDICARE_NUMBER = CCN) and
  NH_Operator_Members.csv (operator/owner members and titles – only 4 members carry the title
  "ADMINISTRATOR" and those are owners). No administrator-of-record field.
- Health Facility General Information (vn5v-hh5r), Health Facility Certification Information
  (2g9y-7kqm, attribute types are only Bed/County Served/Service), Nursing Home Weekly Bed Census
  (izta-vnpq), Nursing Home Cost Report RHCF 2024 (6y9g-9rz5): the RHCF data dictionary
  (NHCRData_Dictionary.xlsx, 550k rows) has no administrator-name field (only "Administrative Services"
  cost lines). Socrata catalog searches on health.data.ny.gov and data.ny.gov for "nursing home
  administrator" return nothing relevant.
- NYSDOH Licensed NHA page (https://www.health.ny.gov/professionals/nursing_home_administrator/licensed_nha/master_lnha.htm)
  is text only: it says to call the Bureau of Professional Credentialing (1-877-877-1827,
  profcred@health.ny.gov) to verify a licensee. No roster and no facility of employment.
Conclusion: New York does not publish an administrator-by-facility list. The Health Data NY
Facility_Info.csv is the best public CCN<->PFI crosswalk if another source is found later.

## Massachusetts (341 in key) – blocked at mass.gov; no accessible administrator source

- mass.gov (including https://www.mass.gov/info-details/find-information-about-licensed-or-certified-health-care-facilities,
  which carries the monthly XLSX "List of health care facilities licensed or certified by the division")
  returns HTTP 403 "Not allowed | Mass Gov" to curl and WebFetch from this container. Re-pull from a
  browser: open that page, download the XLSX, and check whether it has an administrator column (the
  page text only promises bed counts).
- DPH Nursing Home Survey Performance Tool (https://eohhs.ehs.state.ma.us/nursehome/default.aspx,
  search by city, then FacilityInfo.aspx?Facility=<id>) is reachable but shows only name, address,
  phone and survey results – no administrator.
- MassGIS Long-Term Care Residences feature layer
  (https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Long_Term_Care_Residences/FeatureServer/0,
  data edited 2026-05) has only FAC_NAME, FAC_TYPE, ADDRESS, MAIL_CITY, ZIPCODE, REGION, MAD_ID.
- CHIA SNF cost-report pages (chiamass.gov) expose no per-facility administrator dataset.
- The Board of Registration of Nursing Home Administrators licenses individuals; its lookup does not
  show the facility of employment.
Conclusion: no accessible public administrator-by-facility source; mass.gov XLSX needs a browser check.

## Connecticut (191 in key) – DSS Medicaid cost reports (priority-4 source), 180 / 191 matched

Source: CT DSS "Nursing Facility Cost Reports"
https://portal.ct.gov/dss/health-and-home-care/medicaid-nursing-home-reimbursement/nursing-facility-cost-reports/cost-report
– one PDF per facility per cost year (links labelled "<year> Cost Report <facility>"). Page 1 (form CSP-1,
"Administrator's/Owner's Certification") prints the administrator's name under "Printed Name
(Administrator)", plus licensed facility name, address, CCNH licence number and "Medicare Provider"
number. Cost year 2025 = year ended 2025-09-30 (filed Feb 2026), 179 facilities; 5 facilities only have
a 2024 report and 3 only 2023 (closed). source_date = the report's fiscal-year-end date.

How to re-pull: `python3 -I scripts/ct_download.py downloads/ct_probe/ct_cost_links.csv downloads/ct_cost2025`
(ct_cost_links.csv = latest-year link per facility, extracted from the page above), then
`parse_ct.py`, `build_ct.py`, `cleanup_ct.py`. 187 PDFs downloaded sequentially (0.6 s pause); all parsed
with pdftotext (none were image-only).

Matching: CCN typed on the report (167 ccn_direct). Four reports carried a wrong/transposed Medicare
number (Apple Rehab Mystic, Bayview, Northbridge, Laurel Ridge) – for those the street address + zip
was used (match_method=address) and the typed CCN ignored; 8 more had no Medicare number and matched
on address. One ccn_direct is medium (Bloomfield Healthcare Center, name differs from key).

Gaps / caveats:
- 11 key facilities have no DSS cost report (CCRC / private-pay health centers that do not take
  Medicaid): 075294 Whispering Pines, 075301 Caleb Hitchcock, 075318 Pomperaug Woods, 075322 Essex
  Meadows, 075362 Evergreen Woods, 075412 Lord Chamberlain, 075421 Edgehill, 075429 Ridge Crest at
  Meadow Ridge, 075437 Avalon at Stoneridge, 075440 The Springs at 3030 Park, 075443 John L. Levitow.
- 20 rows have a blank administrator (certification page left blank, name not printed, or marked
  "No longer at facility"). One row is "Acting Administrator (Director of Nursing)".
- The name is the administrator who signed the FY2025 report (Dec 2025 - Feb 2026), not necessarily
  today's administrator; treat as 8-12 months old. 1 row uses the DSS 2025 link but has no parsable
  FYE and shows 2026-10-30 as source_date.
- Dropped: 4 closed facilities (Abbott Terrace, Countryside Manor, Farmington Care Center, Mattatuck)
  and 1 residential care home filed under a nursing-home link (Whispering Winds RCH).
- Other CT sources checked without administrators: data.ct.gov Nursing Facility Registry (rm6f-b9qj,
  has Federal Provider Number but no administrator), DPH FLIS nursing-home pages
  (portal.ct.gov/dph/.../nursing-home-site/<facility>, survey findings only), eLicense lookup
  (CAPTCHA-gated; roster generator lists licensees only).

## Rhode Island (72 in key) – blocked

RIDOH Licensee Lists (https://health.ri.gov/licensing/licensee-lists and https://health.ri.gov/lists/licensees/)
are the right source: the page describes downloadable licensee data with "Owner/Manager Name",
licence number, status, business address and, for nursing facilities, bed counts. Every health.ri.gov
URL returns a Cloudflare "Just a moment..." challenge (HTTP 403) to curl and WebFetch here. No mirror on
a Socrata/ArcGIS host exists (data.ri.gov is not a Socrata domain; no RI licensee dataset found).
Re-pull from a browser: Licensee Lists -> profession "Nursing Facility" (or Health Care Facilities ->
Nursing Facility) -> download Excel; map "Owner/Manager Name" to administrator and match on
facility name/zip (72 key facilities). Nothing was written for RI.

## New Hampshire (73 in key) – blocked

NH DHHS Health Facilities Administration publishes "NH Health Facilities Licensed under RSA 151"
(https://www.dhhs.nh.gov/sites/g/files/ehbemt476/files/documents2/licensedfacilities.pdf, listing page
https://www.dhhs.nh.gov/documents/health-facilities-listing) with columns facility, administrator,
phone, licence effective/expiration, beds, county (search snippets show the indexed copy dated
4/1/2024), and the live "NH Online Licensing / License Verification" search
(https://forms.nh.gov/licenseverification/, profession = Health Facilities, type = Nursing Home).
Both hosts answer "Access Denied" (Akamai, HTTP 403) to curl and WebFetch from this container, and
web.archive.org is unreachable through the proxy. Re-pull from a browser: download the PDF (or run
the verification search with licence type Nursing Home and export), then match on name/city/phone.
Nothing was written for NH.

## Vermont (33 in key) – DAIL/DLP survey letters, 33 / 33 matched

DLP's facility lists (https://dlp.vermont.gov/sites/dlp/files/documents/nh_list_by_county.pdf,
created 2026-01-15, 37 nursing homes incl. 2 non-certified) do NOT carry an administrator. However
every survey/investigation result posted on dlp.vermont.gov is a letter from the Division addressed
to the administrator by name ("Ms. Jane Doe, Administrator", facility, address, "Provider ID #:
475xxx"). I used the most recent posted letter per facility:
county pages https://dlp.vermont.gov/survey-cert/facilities-<county>-county -> "Nursing Home" section
-> /tags/<facility> -> first (newest) item -> PDF under /sites/dlp/files/documents/.
Re-pull: `python3 -I scripts/vt_scrape.py downloads/vt_surveys` then `build_vt.py`.

36 facilities found (one county page lists the same home under two names; three are non-certified
or no longer in the key: Arbors Nursing Home, Merten's House, Green Mountain Nursing and
Rehabilitation [letter shows Provider ID 475040, absent from the key]). All 33 key CCNs matched via the
Provider ID in the letter (ccn_direct). Letter dates: 31 of 36 are Aug-Oct 2026; the oldest is
2025-11 (Green Mountain) and 2026-05. source_date = the letter date. administrator_title is taken
from the salutation (all "Administrator"). Caveat: this is point-in-time correspondence, not a
roster – a facility that changed administrators since its last survey letter will be stale.

## Maine (78 in key) – DHHS DLC Licensed Provider Search, 78 / 78 matched

Source: https://gateway.maine.gov/dhhs-apps/aspen/index.asp ("Licensed Provider Search - Updated:
10/30/2026"). Steps: provider type NURSING HOME (type_pop_services.asp?types=2, POST
CSRFToken+types=2) -> county_town.asp (POST all 16 counties to facility_list.asp) -> select all
providers (POST which=[id] x78 to aspen_details.asp). The detail report prints name, address, phone,
provider type and "Administrator: First Last" for each facility; a "Download Spreadsheet"
(make_excel.asp) button is also offered. Parsed with scripts/parse_me.py -> downloads/me_list/me_nursing_homes.csv.
78 nursing homes in the source, 78 in the key, 78 matched (phone / exact address / name+city, all
high). The licence-number field is blank on the site. source_date 2026-10-30 (site's update stamp).
Names shown in ALL CAPS on the site were title-cased.

## Puerto Rico (9 in key) – no public source

The Departamento de Salud SARAFS page (https://www.salud.pr.gov/CMS/187) lists "Unidades de Cuidado
Prolongado" among licensed facility types but links no registry; searches found only the ASSMCA
behavioural-health registry (docs.pr.gov/files/ASSMCA/Registro_de_Facilidades_Licenciadas_2023.pdf)
and Departamento de la Familia elder-home locators, neither covering SNFs/administrators.
Nothing written.

## Guam (1 in key) – no public source

The only facility is Guam Memorial Hospital Authority's Skilled Nursing Facility (CCN 655000). GMHA's
leadership page (https://www.gmha.org/?p=19734) does not list the SNF administrator; the Guam Board of
Allied Health Examiners publishes no facility roster. Nothing written (a name would have to come
from a GMHA press release/job posting, which is not a licensing source).
