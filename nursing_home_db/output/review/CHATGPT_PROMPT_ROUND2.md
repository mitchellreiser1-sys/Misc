You are doing round 2 of a public-source review of a national nursing home administrator / owner / operator database built by another AI assistant (Claude). Round 1 is done and merged. Your output goes back to Claude, which ingests it mechanically and re-checks every cited source, so follow the format exactly.

## Where the data is

GitHub repository: mitchellreiser1-sys/Misc, branch ccr-f017b7fe-nyiah1, folder nursing_home_db/output/review/.
Read, in order:
1. round2_gap_facilities.csv (1,123 facilities that still have no administrator, or only a low-confidence one)
2. round2_medium_confidence_to_verify.csv (1,428 facilities whose administrator is medium confidence: reported from a portal Claude could not open, carried from a trade-association listing, or published under a non-administrator title such as "Contact Person")
3. chatgpt_response_template.csv (the exact output column layout)
4. state_source_notes.md (what was used per state and what is still blocked)
If you cannot open the repository, say so immediately and ask me to upload those files.

## Task A: Export two state listings in full

These two state sites block Claude's environment but you were able to open them in round 1. Pull each one completely and return it as its own CSV, one row per facility, exactly as published, no interpretation:

1. Illinois: IDPH Licensing portal, Facility Lookup, https://llcs.dph.illinois.gov/s/facility-lookup?language=en_US. Return il_listing.csv with columns: facility_id, facility_name, license_type, address, city, zip, county, administrator_name, ccn_or_medicare_number (if shown), license_number, as_of_date. Cover every long-term care / nursing facility type the portal offers, not only skilled nursing.
2. Rhode Island: RIDOH licensee download, https://datahealth.ri.gov/lists/licensees/index.php, "Profession or Facility" = Nursing Facility, button "Download Licensee List". Return ri_listing.csv with the file's columns as published (it includes an Owner/Manager Name column).

If a site cannot be exported in full, return as many rows as you can and state exactly how many facilities the site shows versus how many you returned.

## Task B: Fill the remaining gaps

Work round2_gap_facilities.csv state by state, largest first: NY (291), MA (213), VA (106), MI (66), CA (48), CO (45), IL (41), NH (31), RI (29), WV (25), NM (23), MN (22), then the rest. For New York, Massachusetts and Virginia there is no state roster, so use: the facility's own website leadership page, the operator's website, NYS DOH Health Profiles, Virginia VDH nursing home license applications (vita-vdh.my.site.com), Massachusetts DPH licensure actions, press releases, and dated local news. For Michigan, LARA license letters addressed "<Name>, Administrator" count as high confidence if dated 2025 or later.

## Task C: Verify the medium-confidence names

For each row in round2_medium_confidence_to_verify.csv, find a second independent public source that names the same person as the facility administrator (CONFIRMED), names a different current administrator (CHANGED, give the name and source), or nothing (UNVERIFIABLE). Illinois rows can be confirmed directly from the Task A export. Maryland rows are "Contact Person" entries from the OHCQ licensee list; confirm whether that person is the licensed administrator.

## Rules

- Public sources only. No paid data brokers, no LinkedIn, no guessing from similar names, no inferring a role from a corporate title (a VP, owner, counsel, DON or assistant administrator is not the administrator).
- Never invent a name. Leave proposed_value blank with confidence none when nothing is found.
- Every proposed value needs a source_url a reader can open and a source_date (as shown on the source, else the date viewed; month-only is fine).
- Confidence: high = state licensing agency, CMS or a dated official license document naming the administrator; medium = facility or operator website, press release, trade association listing; low = indirect evidence.
- Keep the ccn exactly as given. Note closures, renames and mergers in the note.
- Work in batches by state if needed and say which states are done and which remain.

## Deliverables

1. il_listing.csv and ri_listing.csv (Task A).
2. findings.csv in exactly the template layout: ccn,facility_name,state,field,current_value,proposed_value,source_name,source_url,source_date,confidence,note. One row per facility for Tasks B and C; field = administrator_name; put CONFIRMED / CHANGED / UNVERIFIABLE / GAP_FILLED / GAP_OPEN at the start of note.
3. A summary table: state, gaps filled, gaps open, medium rows confirmed, changed, unverifiable, best source with URL.
4. Any systematic problem you notice, each with one example CCN.
