# State administrator sources: coverage summary (pulled 2026-10-30)

Each `<group>.csv` here was pulled from the state licensing agency (or, where noted, the best public
substitute) and matched to CMS CCNs. Per-state detail, exact re-pull URLs and known gaps are in the
`NOTES_<group>.md` file for that group. "Coverage" is key CCNs matched that carry an administrator name.

| State | Group file | Source | Coverage | Notes |
|---|---|---|---|---|
| AL | southeast | ADPH Health Care Facilities Directory (Nursing Homes PDF, carries Medicare #) | 224/224 | |
| AK | west | DOH HFLC Health Facilities List xlsx | 0/20 | State list has no administrator column |
| AZ | west | ADHS AZ Care Check ("Chief Administrative Officer") | 130/140 | 3 tribal facilities not ADHS-licensed |
| AR | south_central | DHS/OLTC facility profile pages | 221/222 | |
| CA | west | CHHS Open Data Licensed & Certified Healthcare Facility Listing (FACADMIN) | 1,097/1,165 | 63 facilities blank at source |
| CO | west | CDPHE Find & Compare export | 0/210 | State export has no administrator field |
| CT | northeast | DSS Medicaid cost reports FY2025, page 1 "Printed Name (Administrator)" | 160/191 | 8 to 12 months old; private-pay CCRCs file no report |
| DC | mid_atlantic | DC Health HRLA Nursing Home Directory PDF | 16/16 | |
| DE | none | DHCQ list no longer shows administrators; prior PDF moved and server blocks non-browser clients | 0/44 | Pull from a normal browser |
| FL | southeast | AHCA FloridaHealthFinder facility profiles | 684/694 | Hospital SNUs blank at source |
| GA | southeast | DCH HFRD GaMap2Care feed | 348/356 | |
| HI | west | DOH OHCA SNF/ICF list | 43/43 | |
| ID | west | DHW Bureau of Facility Standards LTC/SNF list PDF | 80/80 | Idaho Code 74-120 notice: not to be used as a mailing/telephone list; contact fields dropped |
| IL | none | IDPH LLCS licensing portal rejects headless browsers; no other current public source | 0/664 | Pull from a normal browser (listing shows administrator) |
| IN | great_lakes_east | IDOH LTC Facility Directory (QAMIS) | 506/507 | |
| IA | upper_midwest | DIAL Health Facility Database export | 343/387 | 44 blank at source |
| KS | plains | KDADS Facilities Directory export | 296/296 | |
| KY | great_lakes_east | CHFS OIG Long Term Care Directory xlsx | 266/266 | |
| LA | south_central | LDH HSS Licensed Providers Report xlsx | 264/265 | |
| ME | northeast | DHHS DLC Licensed Provider Search | 78/78 | |
| MD | mid_atlantic | MDH OHCQ LTC licensee Excel ("Contact Person") | 221/221 | Published as licensee contact, not explicitly administrator |
| MA | none | mass.gov blocks automated access | 0/341 | Pull from a normal browser |
| MI | great_lakes_east | LARA license letters addressed "<Name>, Administrator" | 298/422 | Dated letters (2022 to 2026); partial |
| MN | upper_midwest | MDH Health Care Provider Directory API | 336/337 | |
| MS | south_central | MSDH Directory of Mississippi Health Facilities PDF | 201/202 | |
| MO | plains | DHSS LTC Directory open data (data.mo.gov) | 479/486 | Hospital-based units not licensed as LTC |
| MT | none | mt-reports.com portal uses an anti-bot form; not pursued | 0/61 | Pull from a normal browser |
| NE | plains | DHHS Licensure Unit LTC roster PDF | 180/180 | 5 list only an Assistant Administrator |
| NV | west | HCQC facility search (Primary Contact = Administrator) | 58/66 | Hospital-based units excluded |
| NH | none | dhhs.nh.gov licensed facilities PDF blocked (403) | 0/73 | PDF has an administrator column; pull from a normal browser |
| NJ | mid_atlantic | NJ DOH Health Facilities Search detail pages | 340/348 | |
| NM | none | HCA Health Facility Provider Search is down (404) | 0/68 | |
| NY | none | No public administrator-by-facility dataset found | 0/592 | |
| NC | southeast | DHSR Nursing Home Listing xlsx | 404/419 | Hospital-licensed SNF units not on list |
| ND | plains | ND Long Term Care Association member listing (trade association, not state) | 72/72 | Medium confidence; some hospital units list CEO |
| OH | great_lakes_east | ODH EID real-time certification pages | 923/924 | |
| OK | south_central | OSDH Directory of Facilities PDFs | 283/283 | |
| OR | west | ODHS ltclicensing provider pages | 125/128 | |
| PA | mid_atlantic | PA DOH open data "Nursing Homes Current Statewide Health" (Contact Executive) | 654/656 | 49 contacts carry non-administrator titles |
| RI | none | health.ri.gov Cloudflare challenge | 0/72 | Licensee list has Owner/Manager Name; pull from a normal browser |
| SC | southeast | SC DPH Health Facilities ArcGIS layer | 183/187 | |
| SD | plains | DOH Board of NFA licensee roster matched by facility phone | 69/96 | Medium/low; state directory is reCAPTCHA-gated |
| TN | southeast | TN Health Care Facilities search | 303/303 | |
| TX | south_central | HHSC Directory of Nursing Facilities with an Active License (NF.xlsx) | 1,169/1,177 | |
| UT | west | UGRC/DHHS Licensed Health Care Facilities ArcGIS | 97/97 | |
| VT | northeast | DAIL/DLP survey letters addressed "<Name>, Administrator" | 33/33 | Point-in-time letters |
| VA | none | VDH OLC nursing home directory link is dead | 0/289 | |
| WA | west | DSHS ALTSA Nursing Home Locator export | 193/193 | |
| WV | great_lakes_east | OHFLAC Health Care Facility Lookup | 94/123 | 29 show Unknown at source |
| WI | upper_midwest | DHS DQA Nursing Home Provider Directory xlsx | 323/323 | |
| WY | west | WDH HLS Healthcare Facility Directory PDF | 36/36 | |
| PR, GU | none | No licensing roster found | 0/10 | |

States with no state-directory administrator (DE, IL, MA, MT, NH, NM, NY, RI, VA, CO, AK, PR, GU) still
get an administrator where PECOS or the NPI Registry disclose one; see `administrator_source` in the
facilities table. For DE, IL, MA, NH and RI the state source exists and shows the administrator, but the
site blocks automated clients; a person with a normal browser can download it and drop it in here
using the common column layout.

## External review round 1 (2026-10-30)

ChatGPT reviewed the verification sample (407 facilities) and the gap list (2,356 facilities) and returned
3,983 findings (`raw/review/chatgpt_findings_2026-10-30.csv`). Claude then re-fetched every cited public
source for the 1,078 administrator proposals that differed from the database and checked that the proposed
name appears on that page (`raw/review/claude_recheck_of_chatgpt_findings_2026-10-30.csv`):

| Re-check result | Rows | Handling |
|---|---|---|
| Name found on the cited source | 529 | Imported. High confidence when the source is a state agency or CMS, otherwise medium (association or facility pages). |
| Source is a portal Claude cannot open (Illinois IDPH LLCS) | 395 | Imported at medium confidence, labeled "reported by external review; not independently verified". |
| Source unreachable from this environment (NM and MT association directories, Delaware DHSS PDFs, a few facility sites) | 114 | Imported at medium confidence with the same label. |
| Name not found on the cited page | 40 | Not imported. Mostly Rhode Island licensee-list rows and a handful of facility pages. |

Other review outcomes applied to the build:
- Maryland OHCQ "Contact Person" and Nebraska "Assistant Administrator" rows now rank medium, not high.
- Facilities absent from PECOS now take owners from the Care Compare ownership file and the operator from
  the Care Compare legal business name (`owner_data_source` and `operator_source` say which).
- Michigan CCN 235050 (Dana White) removed: the LARA letter belonged to a different license (`exclusions.csv`).
- Proposals that were corporate officers, assistant administrators, deceased individuals, or placeholder
  web-template names were rejected by the reviewer and are not in the database.
- Illinois "Owners" as an operator name was a portal parse error and was not imported.

Still open after round 1: NY (328 facilities), MA (220), VA (129), CO (47), IL (43), MI (65), NH (31),
and the smaller states listed in the summary table above. Rhode Island's licensee list and Illinois' LLCS
listing can both be pulled from a normal browser and dropped in using the common column layout.
