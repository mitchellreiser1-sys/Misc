You are doing round 3 of a public-source review of a national nursing home administrator / owner / operator database built by another AI assistant (Claude). Rounds 1 and 2 are merged: your Illinois export was verified against CMS addresses and imported as a state file, and every round 2 proposal was re-checked against its cited source (178 confirmed, 29 not found, 19 unreachable). Your output goes back to Claude, which ingests it mechanically and re-checks every cited source, so follow the format exactly.

## Where the data is

GitHub repository: mitchellreiser1-sys/Misc, branch ccr-f017b7fe-nyiah1, folder nursing_home_db/output/review/.
Read, in order:
1. round3_gap_facilities.csv (1,041 facilities with no administrator or only a low-confidence one; NY 272, MA 197, VA 102, MI 63, CA 48, CO 40, IL 39, NH 30, WV 25, NM 23, then the rest)
2. round3_medium_confidence_to_verify.csv (1,017 facilities at medium confidence; NY 199, MD 170, CO 84, MA 68, IL 63, VA 56, AZ 55, SD 54, then the rest)
3. chatgpt_response_template.csv (the exact output column layout)
4. state_source_notes.md (what was used per state, what is still blocked, and the round 1 and round 2 reconciliation)
If you cannot open the repository, say so immediately and ask me to upload those files.

## What changed since round 2, so you do not repeat it

- Facility-website and news searches for New York, Massachusetts and Virginia filled only 79 of 1,094 gaps in round 2. Do not repeat the same per-facility web search as the primary method for those states. Use the source types in Task A instead, and fall back to facility websites only after those are exhausted.
- Rows you marked UNVERIFIABLE in round 2 with "search-level unresolved result" need a different source type this time, not the same search again.

## Task A: New York, Massachusetts and Virginia through document sources

These states publish no roster, but they do publish documents that name the administrator. Work each of these before anything else:

New York
- NYS DOH Nursing Home Profiles at https://profiles.health.ny.gov/nursing_home/ (open the facility's profile and its "Contact" and "Inspections" tabs; statements of deficiencies and the facility contact block often name the administrator).
- NYS DOH Health Data NY nursing home datasets (https://health.data.ny.gov, search "nursing home") for any dataset with an administrator or contact-name column.
- New York Medicaid cost report (RHCF-4) certification pages, where posted, and NYS DOH enforcement actions and stipulation letters (https://www.health.ny.gov/facilities/nursing/), which are addressed to the administrator by name.
- LeadingAge New York, HANYS and NYSHFA member and award pages, dated 2025 or later.

Massachusetts
- MA DPH Division of Health Care Facility Licensure and Certification: licensure actions, notices of intent and plan-of-correction letters addressed to the administrator by name (https://www.mass.gov/orgs/division-of-health-care-facility-licensure-and-certification).
- CHIA (Center for Health Information and Analysis) nursing facility cost reports (HCF-1), which carry the administrator's name on the certification page (https://www.chiamass.gov/nursing-facility-cost-reports/).
- Massachusetts Senior Care Association member pages and awards, dated 2025 or later.

Virginia
- VDH Office of Licensure and Certification nursing home license applications on vita-vdh.my.site.com (this worked in round 1: 36 high-confidence names). Search each remaining Virginia facility there first.
- VDH OLC inspection reports (statements of deficiencies), which name the administrator in the opening block.
- Virginia Health Care Association member pages, dated 2025 or later.

For each facility, give the document URL, the as-of date printed on the document, and the exact title shown next to the person's name.

## Task B: Two direct downloads

If you can open these, export them in full as CSVs with the file's columns as published:
1. New Hampshire licensed facilities PDF (administrator column): https://www.dhhs.nh.gov/sites/g/files/ehbemt476/files/documents2/licensedfacilities.pdf, or the current link from https://www.dhhs.nh.gov/programs-services/health-care/health-facilities-administration. Return nh_listing.csv.
2. Delaware DHCQ nursing home list with administrator and director of nursing, last published version: https://web.archive.org/web/20251102032107/https://dhss.delaware.gov/wp-content/uploads/sites/6/2025/10/Nursinghomes9.26.25.pdf. Return de_listing.csv.

## Task C: Remaining gaps in other states

Work the rest of round3_gap_facilities.csv: MI (LARA survey letters addressed "<Name>, Administrator", 2025 or later), CA (CDPH Cal Health Find facility detail page, which shows the administrator even when the open-data file is blank), CO (CDPHE licensing letters and the Colorado Health Care Association finder), IL (the IDPH LLCS portal record for the remaining 39, Active status only), NH, WV (OHFLAC facility profile), NM, MN (MDH provider directory record), then the rest.

## Task D: Verify the medium-confidence names

For each row in round3_medium_confidence_to_verify.csv, find a second independent public source naming the same person as administrator (CONFIRMED), a different current administrator (CHANGED, with name and source), or nothing (UNVERIFIABLE). Maryland rows are OHCQ "Contact Person" entries: confirm whether that person is the licensed administrator, for example from the facility's Care Compare inspection report or a licensure letter. North Dakota and South Dakota rows came from association listings; confirm from the state survey reports (ND HHS, SD DOH) or facility pages.

## Rules

- Public sources only. No paid data brokers, no LinkedIn, no guessing from similar names, no inferring the role from a corporate title. An executive director, CEO, owner, DON, counsel or assistant administrator is not the administrator unless the source also calls them the administrator.
- Never invent a name. Leave proposed_value blank with confidence none when nothing is found.
- Every proposed value needs a source_url a reader can open and a source_date (as printed on the source, else the date viewed; month-only is fine). Prefer a direct document URL over a search page.
- Confidence: high = state licensing agency, CMS, or a dated official licensure or survey document naming the administrator; medium = facility or operator website, press release, trade association listing; low = indirect evidence.
- Keep the ccn exactly as given, including suffixes. Note closures, renames and mergers in the note.
- Work in batches by state if needed and say which states are done and which remain.

## Deliverables

1. nh_listing.csv and de_listing.csv if obtained (Task B).
2. findings.csv in exactly the template layout: ccn,facility_name,state,field,current_value,proposed_value,source_name,source_url,source_date,confidence,note. One row per facility for Tasks A, C and D; field = administrator_name; put CONFIRMED / CHANGED / UNVERIFIABLE / GAP_FILLED / GAP_OPEN at the start of note, followed by the exact title shown in the source.
3. A summary table: state, source type used, gaps filled, gaps open, medium rows confirmed, changed, unverifiable, best source with URL.
4. Any systematic problem you notice, each with one example CCN.
