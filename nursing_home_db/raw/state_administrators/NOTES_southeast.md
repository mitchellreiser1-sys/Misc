# Southeast agent notes (FL, GA, NC, TN, AL, SC)

Agent: `southeast`. Pull date for everything below: 2026-10-30 (UTC).
Deliverable: `/tmp/claude-0/-home-user-Misc/63250c82-6776-57b5-9e49-8fdd0f4ba110/scratchpad/states/southeast/administrators.csv`
Scripts: `/tmp/claude-0/-home-user-Misc/63250c82-6776-57b5-9e49-8fdd0f4ba110/scratchpad/states/southeast/scripts/`
(`build.py` rebuilds the CSV from the cached downloads; `matchlib.py` holds the CCN matcher; `audit.py` prints
medium/low/unmatched rows.)
Raw downloads: `/tmp/claude-0/-home-user-Misc/63250c82-6776-57b5-9e49-8fdd0f4ba110/scratchpad/states/southeast/downloads/`

Matching approach (all states): a record that carries a CMS number is matched `ccn_direct` only when name, address
or phone also agree (SC's CMS id was wrong for one facility); otherwise street-number + street-name + ZIP
(`address`), then unique 10-digit phone (`phone`), then name-token similarity within ZIP / city
(`name_zip`, `name_city`), then address ignoring ZIP. If two source rows land on one CCN the better-supported one
keeps it and the other is left with a blank CCN. Administrator values of "N/A", "NONE", "TBD" are blanked.

## Summary

| State | Source | Facilities in source | With administrator | Matched to CCN | Key CCNs | Coverage |
|---|---|---|---|---|---|---|
| FL | AHCA FloridaHealthFinder profiles (694 nursing homes + 7 SNUs) | 701 | 692 | 693 | 694 | 99.9% |
| GA | DCH HFRD GaMap2Care feed | 369 | 360 | 356 | 356 | 100% |
| NC | DHSR Nursing Home Listing XLSX (10/13/2026) | 423 | 423 | 404 | 419 | 96.4% |
| TN | TN Health Care Facilities search | 305 | 305 | 303 | 303 | 100% |
| AL | ADPH Health Care Facilities Directory PDF | 232 | 232 | 224 | 224 | 100% |
| SC | SC DPH Find a Facility ArcGIS layer | 192 | 188 | 187 | 187 | 100% |

"Matched" counts distinct key CCNs that received a source row. Matched CCNs that also carry an administrator
name: FL 684, GA 348, NC 404, TN 303, AL 224, SC 183 (total 2,146 of 2,183 key CCNs). Match methods: ccn_direct (AL Medicare number,
SC CMSCERT_ID, FL SNU Medicare number), address (street number + street + ZIP), phone, name_zip/name_city.
Only 13 of the 2,222 rows are "medium" confidence (all are same-address / same-phone facilities whose name changed
between the CMS key and the state record, e.g. ownership changes); none are "low".


## Florida (FL) - key: 694 CCNs
- Source: AHCA FloridaHealthFinder (quality.healthfinder.fl.gov). The facility profile for every licensed nursing
  home shows an "Administrator" field (plus CFO, medical director, owner, management company).
- How to re-pull:
  1. The list of nursing homes comes from the Locate Facility search: open
     `https://quality.healthfinder.fl.gov/Facility-Search/FacilityLocateSearch`, choose facility type
     "Nursing Homes", submit with no other filters. The result page
     (`/Facility-Provider/Nursing-Home?&type=1`) embeds `const data = [[...]]` with every facility's LicenseID,
     license number, address, phone, bed count and license status (needs a browser/Playwright because the
     search is a POST with an anti-forgery token and the result is carried in TempData;
     script `scripts/fl_pw_probe.js` / `fl_pw_search.js`, extractor `scripts/fl_extract_list.py`).
     Same search with type "Skilled Nursing Unit" (`SNU`) gives the hospital-based SNUs (7, federally certified).
  2. For each LicenseID GET `https://quality.healthfinder.fl.gov/Facility-Provider/ProfilePreview?LID=<LicenseID>`
     (JSON; the first section "FacilityDetails" has `Administrator`). Pulled sequentially with a 0.5 s pause
     (`scripts/fl_fetch_profiles.py`), cached in `downloads/fl_profiles/<LID>.json`.
  Human-readable profile: `https://quality.healthfinder.fl.gov/Facility-Provider/Profile/?LID=<LicenseID>`.
- As-of: live licensing database as displayed on 2026-10-30 (no "last updated" stamp on the profile).
- No CCN in the FL licensing data (the SNU list uses the Medicare number as its license number, which is the CCN).
  Matching was by street address + ZIP / phone.
- Known gaps: the Administrator field is blank at the source for 2 nursing homes (Royal Oaks Nursing and Rehab
  Center, Titusville; Winter Haven Health and Rehabilitation Center) and for all 7 hospital skilled nursing units
  (AHCA does not record an administrator on SNU profiles: Tallahassee Memorial Extended Care, Shands
  Jacksonville, Northwest Florida Community Hospital SNU, Kindred Hollywood, Lee Memorial SNU, Gulf Coast Medical
  Center SNU, Skytop View Rehabilitation Center). Those CCNs are in the CSV with a blank administrator. The only
  key CCN with no source row is 106077 Moosehaven (Orange Park), which is not in the AHCA nursing-home or SNU
  lists. Eight licensed homes in the AHCA list have no CCN in the key (Glencove, Gulf Coast Rehabilitation,
  Heritage Park, Masonic Home of Florida, Monticello Post-Acute, Sailfish Cove, Sweet Bay, Westminster
  Bradenton) and are kept with a blank CCN.

## Georgia (GA) - key: 356 CCNs
- Source: DCH Healthcare Facility Regulation Division "GaMap2Care" facility finder
  (`https://forms.dch.georgia.gov/HFRD/GaMap2Care.html`), which has an ADMINISTRATOR column, facility e-mail,
  phone, HFRD facility id and license effective date.
- How to re-pull: single JSON call the page makes:
  `https://forms.dch.georgia.gov/HFRD/GetFacilitiesData.svc/GetData?FACTYPE=Nursing%20Home`
  (returns `{"GetFacilityDetailsResult": "<json string>"}`; cached in `downloads/ga_probe/nh.json`).
  Other types: replace FACTYPE with the checkbox values on the GaMap2Care page.
- As-of: live DCH licensing data on 2026-10-30 (no date stamp in the feed).
- No CCN in the feed; matched by address/phone. The feed contains a handful of legacy duplicates (5 rows with
  status "ACTIVE" in upper case and 1977-era license dates, e.g. "Pinewood Manor" next to "Pinewood Healthcare
  Center"); the duplicate was left with a blank CCN. State veterans homes, CCRC health centers and a few others
  (Canterbury Court, Wesley Woods, Thunderbolt Care Center...) are licensed but not Medicare/Medicaid certified.
- The newer DCH licensing portal (`gahles.dch.georgia.gov`, Power Apps) requires sign-in and was not used.

## North Carolina (NC) - key: 419 CCNs
- Source: DHSR "Nursing Home Listing Alphabetical" XLSX, which has an "Administrator Name" column.
  Page: `https://info.ncdhhs.gov/dhsr/reports.htm`; file: `https://info.ncdhhs.gov/dhsr/data/Nhlist_a.xlsx`
  (county-sorted twin: `Nhlist_co.xlsx`). As-of 10/13/2026 per the reports page ("As of 10/2026" in the file).
- Re-pull: download the XLSX; header row is the 5th row. Cached in `downloads/nc_probe/Nhlist_a.xlsx`.
- No CCN in the file; matched by address/phone.
- Gaps: the NC list covers facilities licensed as nursing homes (NH####). Hospital-based SNF units licensed under
  the hospital license (Person Memorial, Northern Regional, Iredell Memorial, Wilkes Regional, Novant
  Presbyterian, Transylvania Regional, UNC Rockingham, Rex Rehab, Kindred Greensboro), the state-operated
  neuro-medical treatment centers (Longleaf, Black Mountain, O'Berry), Stokes County Nursing Home, Brantwood and
  the tribal Tsali Care Center are not in it, so those CCNs have no administrator. About 20 licensed homes
  (CCRC health centers, state veterans home) have no CCN and are included with a blank CCN.

## Tennessee (TN) - key: 303 CCNs
- Source: Tennessee Health Facilities Commission / Dept. of Health "Health Care Facilities" search
  (`https://internet.health.tn.gov/FacilityListings`). Each result shows "Administrator: <name>", owner,
  state license number, status, beds, last survey date and management company.
- Re-pull: GET the page for the anti-forgery token, then POST to the same URL with
  `CurrentSearchModel.FacilityType=0532` (Nursing Home), `CurrentSearchModel.County=ALL`,
  `CurrentSearchModel.RadioGroup=Curr`, `CurrentSearchModel.AffiliateOnly=No`; one HTML page with all 305 current
  facilities (cached `downloads/tn_probe/results.html`, parsed by `scripts/tn_parse.py`).
- As-of: live database on 2026-10-30.
- No CCN on the page; matched by address/phone. Two licensed homes (Highpoint Health-Sewanee, The Nursing
  Center at Little Creek) are not Medicare certified.

## Alabama (AL) - key: 224 CCNs
- Source: ADPH Bureau of Health Provider Standards "Health Care Facilities Directory"
  (`https://dph1.adph.state.al.us/FacilitiesDirectory/`), report "Nursing Homes". Each entry shows Administrator,
  Fac ID, license status, Medicare number (= CCN, e.g. "01-5460") and Medicaid number.
- Re-pull: open the directory (cookieless ASP.NET session URL), select facility type "Nursing Homes", click
  "View Report"; the server renders a PDF at
  `https://dph1.adph.state.al.us/FacilitiesDirectoryReports/Reports/ReportDirectory-<timestamp>.pdf`.
  Automated in `scripts/al_fetch.py` (form post then GET `ReportView.aspx?Report=FacilitiesDirectory`), parsed
  from the two-column PDF by `scripts/al_parse.py`. Cached `downloads/al_probe/ReportDirectory-2026-10-30.pdf`.
- As-of: report generated 10/30/2026 06:06 (printed on the report).
- CCN matched directly from the Medicare number for 222 of 232 entries. The 10 entries without a Medicare number
  are the state veterans homes, two ICF/IID units and a facility whose administrator is "TBD"; they are included
  with a blank CCN.

## South Carolina (SC) - key: 187 CCNs
- Source: SC DPH "Find a Facility" map (`https://dph.sc.gov/professionals/healthcare-quality/find-facility`),
  an ArcGIS Experience whose data layer is the public feature service
  `https://services5.arcgis.com/G4BLIH7rTQoIjCFv/arcgis/rest/services/Health_Facilities/FeatureServer/0`.
  Fields used: `LF_NAME`, address, `LLF_BUSINESS_PHONE`, `LICENSE_NBR` (NCF-####), `ADMNAME_PHONE`
  ("LAST, FIRST PH#: ..."), `LF_ADM_EMAIL`, `CMSCERT_ID` (CCN) and `PERMIT_TYPE = HLNURSINGCARE`.
- Re-pull: `.../FeatureServer/0/query?where=PERMIT_TYPE%3D%27HLNURSINGCARE%27&outFields=*&returnGeometry=false&f=json`
  (`scripts/sc_fetch.py` pulls the whole layer, 3,513 facilities, cached `downloads/sc_probe/sc_health_facilities.json`).
- As-of: layer `dataLastEditDate` 2026-10-29.
- `CMSCERT_ID` is populated for only 86 of 192 nursing homes (and is wrong for one, "Physical Rehabilitation and
  Wellness Center of Spartanburg", which carries Magnolia Manor's number); the rest were matched by address/phone.
  Administrator names were converted from "LAST, FIRST" to "First Last" (case as published).
- Facilities with no CCN: CCRC health centers and the state veterans homes (Clemson Area Retirement Center,
  Methodist Manor, Covenant Place, Laurel Crest, Patriot's Village).

## States with no public administrator source
None of the six assigned states lacks a public source; all six publish administrator names per facility.
