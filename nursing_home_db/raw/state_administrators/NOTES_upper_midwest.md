# upper_midwest (IL, WI, MN, IA) - nursing home administrator research notes

Pulled 2026-10-30. Deliverable: `administrators.csv` in this directory (WI, MN, IA rows; no IL rows - see Illinois).
Scripts: `scripts/match.py` (matching), `scripts/il_probe*.js` (Illinois portal probes). Raw downloads under `downloads/<state>/`.

Matching approach (all states): CCN carried by the state record (`ccn_direct`) > exact 10-digit phone match within
the state (`phone`) > normalized facility name within ZIP (`name_zip`) > street number + street name within ZIP/city
(`address`) > name within city (`name_city`). Fuzzy name matches (difflib ratio 0.60-0.85) are flagged `medium`.
State-licensed-only homes (no CCN in the key) are kept with `ccn` blank. Duplicate (CCN, administrator) pairs from
multiple state license records were collapsed into one row with license numbers joined by ";".

## Summary

| State | Source | Facilities in source | Matched to CCN | Key facilities | Coverage |
|---|---|---|---|---|---|
| IL | none accessible (see below) | - | 0 | 620 | 0% |
| WI | DHS DQA Nursing Home Provider Directory (Excel), dated 2026-10-22 | 334 (323 certified + 11 state-only) | 323 | 323 | 100% |
| MN | MDH Health Care Provider Directory API CSV export (Nursing Homes + Board & Care NF), updated daily | 342 | 336 | 337 | 99.7% |
| IA | DIAL Health Facility Database - Public Entity Report CSV export | 387 | 387 | 387 | 100% (343 rows carry an administrator name; 44 blank in source) |

## Wisconsin (WI)

- Source: Wisconsin DHS, Division of Quality Assurance, "Nursing Home Provider Directory" Excel.
  URL: https://www.dhs.wisconsin.gov/guide/nhdirexcel.xlsx (linked from https://www.dhs.wisconsin.gov/guide/nursing-home.htm;
  PDF twin at https://www.dhs.wisconsin.gov/guide/nhdir.pdf). Companion swing-bed directory:
  https://www.dhs.wisconsin.gov/guide/swingbeddirexcel.xlsx (hospitals; not used).
- Re-pull: `curl -L -o nhdirexcel.xlsx https://www.dhs.wisconsin.gov/guide/nhdirexcel.xlsx`. Sheet "NH Excel Directory";
  row 1 cell A1 is the as-of date (2026-10-22 on this pull); row 2 is the header.
- Columns used: PROVIDER, STREET, CITY, ZIP, TELEPHONE, LIC# (state license), CERTIFICATION (= CMS CCN, 6 digits for
  certified homes, e.g. 525435; "52A###" = Medicaid-only/other), ADMINISTRATOR ("Last, First" -> converted to "First Last").
- 334 facility rows; 319 carry a plain 6-digit CCN that is in the key (ccn_direct). 4 further certified rows were
  matched by facility phone because the sheet's CERTIFICATION cell was not a plain 6-digit number (high confidence).
  Result: 323/323 key CCNs, 334 rows, all with an administrator name.
- 11 rows are state-only / IMD / county behavioral-health nursing homes (Clearview Behavioral Health I-VIII, Hillview -
  State Only, Ravenwood Behavioral Health, Trempealeau County-IMD). In the sheet these rows use a shifted column layout
  (city sits in the ZIP column as "JUNEAU, WI", administrator in the CERTIFICATION column, administrator e-mail in the
  last column). They are included with `ccn` blank and `zip` blank; their administrators are the same people as the
  certified sibling facility at the same address.
- Gaps: none against the key. Administrator e-mail/phone are not published for certified homes (only facility phone/fax).

## Minnesota (MN)

- Source: Minnesota Department of Health, Health Regulation Division, "Health Care Provider Directory"
  (https://www.health.state.mn.us/facilities/regulation/directory/providerselect.html -> lookup page
  https://www.health.state.mn.us/facilities/regulation/directory/providersearch.html). The page is a JS front end over
  a public API at https://provider-profile-api.web.health.state.mn.us ; the page's own "Download CSV" button calls `/csv`.
  MDH states the data is updated daily; source_date = pull date 2026-10-30.
- Re-pull (exactly what the page's CSV button does):
  `curl -G "https://provider-profile-api.web.health.state.mn.us/csv" --data-urlencode "providerGroup=Nursing Homes" --data-urlencode "providerType=" --data-urlencode "county=" --data-urlencode "city=" --data-urlencode "name=" --data-urlencode "id=" --data-urlencode "zipCode=" --data-urlencode "miles=5" --data-urlencode "limit=0" -o nursing_homes.csv`
  and the same with `providerGroup=Board & Care Home` (keep rows with provider_type = NURSING FACILITY; these are the
  boarding-care homes that carry the 24E### CCNs). `GET /info` lists the provider groups/types.
- Columns used: license_name/provider_name, physical_address/city/zip, telephone, license_number (state license),
  medicare_number (= CCN), `adminstrator/authorized_agent` (sic) -> administrator_name, facility_email -> administrator_email
  only when the e-mail local part contains the administrator's surname (otherwise left blank).
- 334 Nursing Homes rows + 8 Board & Care "NURSING FACILITY" rows = 342 source rows. 336 of 337 key CCNs matched
  (328 ccn_direct, 8 by phone where medicare_number was blank/differs). One source record (Villas at Osseo, CCN 245629)
  appears under two license numbers with the same administrator and was collapsed into one row.
- Key CCN not found: 245289 THE TERRACE AT CRYSTAL LLC (Crystal) - not present in the MDH directory under any name,
  address or phone; presumably closed/de-licensed.
- 5 source rows have no CCN in the key and are kept with `ccn` blank: Beacon Haven (New Brighton), MN State Veterans
  Homes (Bemidji, Preston, Montevideo) and the State Operated Psychiatric Nursing Facility (St. Peter).

## Iowa (IA)

- Source: Iowa Department of Inspections, Appeals & Licensing (DIAL), "Direct Care Worker Registry & Health Facility
  Database" at https://dia-hfd.iowa.gov/ . Reports -> "Entity Report" (https://dia-hfd.iowa.gov/Report/ShowPublicEntityReportAjax)
  has a CSV button that exports every column shown in the table, including "Administrator/License" (administrator
  name + Iowa NHA license number), Phone, Fax, Email, URL.
- Re-pull: open the Entity Report page, choose entity types Free Standing NF (10), Free Standing NF/SNF (31),
  Free Standing SNF (30), HSP-NF (24), HSP-SNF (25), HSP-SNF/NF (26), click CSV. Programmatically (needs the site cookie):
  1. `GET https://dia-hfd.iowa.gov/Report/ShowPublicEntityReportAjax` with a cookie jar;
  2. `POST https://dia-hfd.iowa.gov/Report/PublicEntityReportCsv` form fields `tableSearchField=` and repeated
     `Search.EntityTypeIds=10|31|30|25|26|24` -> JSON `{"success":true,"fileName":"EntitySearch-....csv"}`;
  3. `GET https://dia-hfd.iowa.gov/Report/GetSessionCsv?fName=<fileName>` with the same cookie jar.
  The CSV does not quote addresses that contain commas (2 rows: Green Hills, Ruthven) - the script re-joins overflow fields.
- The export has no CCN; matched by phone (346), name within ZIP (38) and address (3). 387/387 key CCNs matched.
  One address-only match is flagged medium: "Foxglove Wellness and Rehabilitation" (Sigourney) at the key address of
  "Stone Cottage Care Center" - looks like a renamed facility.
- 44 nursing facilities have an empty Administrator/License field in the DIAL export (listed with blank administrator_name;
  do not infer). Zip in the export is 9 digits without hyphen (normalized to 5). Administrator e-mail copied only when
  the published entity e-mail contains the administrator's surname.
- source_date = pull date 2026-10-30 (the database is live; no as-of date is shown).

## Illinois (IL) - blocked, no rows delivered

- The only current public administrator-by-facility source is IDPH's new licensing portal "Listing of Illinois
  Nursing Homes" at https://llcs.dph.illinois.gov/ (a Salesforce Experience Cloud site that replaced the old
  idph.illinois.gov/healthca/nursinghometestjava.htm search, which now returns HTTP 500). The portal is JavaScript-only.
  In headless Chromium (Playwright) the page shell loads but every Salesforce `/s/sfsites/l/...` script/style request
  is answered with HTTP 400 and the app never renders ("Sorry to interrupt - CSS Error"). The same resource URLs
  return 200 to a plain curl / non-browser request, so the site appears to reject headless-browser requests. I did
  not attempt to disguise the browser (the sandbox policy refused those attempts), so the listing could not be pulled.
  A person with a normal browser can open the portal, search nursing homes and export/record the administrator field;
  that is the recommended follow-up.
- Other Illinois sources checked (no administrator or not current):
  - data.illinois.gov (Socrata domain illinois-edp.data.socrata.com) "IDPH - Skilled Nursing Facilities (Nursing Homes)"
    dataset 9nga-zrkc (https://illinois-edp.data.socrata.com/api/views/9nga-zrkc/rows.csv?accessType=DOWNLOAD):
    898 facilities with CCN (certification_number "14-####" style), license status, beds, phone - but NO administrator
    column and the content dates from 2013 (last_survey_date/expiration_date 2013). Saved at downloads/il/idph_snf_9nga-zrkc.csv
    for CCN cross-walks only. Other IDPH directories on the portal (hospice, home health, ESRD, hospital) have a
    "Contact Name" field but there is no nursing-home equivalent.
  - IDPH Long-Term Care Annual Report 2025 (July 2025, https://dph.illinois.gov/.../ltc-report-2025.pdf): statistics only.
  - HFSRB (Health Facilities & Services Review Board) LTC Facility Profiles (annual questionnaire PDFs,
    https://hfsrb.illinois.gov/inventories-data.html#ltc): latest edition is 2020, so not current; monthly LTC inventory
    update XLSX (May 2026) lists bed/ownership changes only.
  - Illinois Hospital Report Card (healthcarereportcard.illinois.gov) covers hospitals/ASTCs/LTACs, not nursing homes.
  - IDFPR Nursing Home Administrator license lookup does not list the facility of employment.
- Net: Illinois HAS a public administrator-by-facility source (LLCS portal) but it was not retrievable from this
  environment. Coverage delivered: 0 of 620 key facilities.
