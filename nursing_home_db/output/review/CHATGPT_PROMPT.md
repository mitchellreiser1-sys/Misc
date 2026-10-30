You are fact-checking and extending a national nursing home owner / operator / administrator database that another AI assistant (Claude) built for me. Your output goes back to Claude, which will ingest it mechanically, so follow the response format exactly.

## Where the data is

GitHub repository: mitchellreiser1-sys/Misc, branch ccr-f017b7fe-nyiah1, folder nursing_home_db/.
Read these first, in order:
1. nursing_home_db/README.md (what the database is, sources, how the administrator is chosen)
2. nursing_home_db/output/review/state_source_notes.md (per-state administrator source, coverage, and which states have gaps)
3. nursing_home_db/output/review/verification_sample.csv (407 facilities with a named administrator, up to 8 per state, with the source Claude used)
4. nursing_home_db/output/review/gap_facilities.csv (2,356 facilities with no administrator or only low/medium confidence)
5. nursing_home_db/output/review/chatgpt_response_template.csv (the exact column layout for your findings)
If you cannot open the repository, say so immediately and ask me to upload those files instead of guessing what they contain.

Background: the database covers every CMS-certified nursing home (14,881 CCNs). Facility, operator, owner, officer, management company, REIT, private equity and lender fields come from CMS Care Compare (Provider Information and Ownership datasets), CMS PECOS (Skilled Nursing Facility Enrollments and All Owners), and the NPI Registry. Administrator names come from state licensing directories for 38 states plus DC, otherwise from PECOS titles or the NPI Registry authorized official. Thirteen jurisdictions have no state source: NY, IL, MA, VA, CO, NM, NH, MT, RI, DE, AK, PR, GU. Michigan and South Dakota are partial.

## Task 1: Fact-check the verification sample

For every row in verification_sample.csv, independently verify the administrator name using a public source (state licensing directory, state health department facility profile, CMS Care Compare, the facility's own website, or a dated news item). For each row report one of: CONFIRMED (same person), CHANGED (different current administrator, give the name and source), UNVERIFIABLE (no public source found), or SOURCE_ERROR (the source Claude cites does not say what the row says). Also spot-check 40 of those rows' operator_entity_name and chain_name against CMS Care Compare and note any disagreement.

## Task 2: Fill the gaps

Work gap_facilities.csv state by state, largest gap first: NY (479), IL (441), MA (268), VA (205), CO (129), MI (95), AZ (79), NM (62), NH (61), CA (57), MT (49), PA (47), RI (46), DE (41), then the rest. For each facility, find the current administrator from a public source. Known starting points that blocked automated access but work in a normal browser:
- IL: IDPH licensing portal "Listing of Illinois Nursing Homes" at https://llcs.dph.illinois.gov/ (shows administrator).
- NH: NH DHHS licensed facilities PDF on dhhs.nh.gov (has an administrator column).
- RI: RIDOH licensee lists on health.ri.gov (Owner/Manager Name column).
- MA: mass.gov DPH long-term care facility list (check whether a column names the administrator).
- DE: DHSS DHCQ licensed nursing homes list (prior PDF named administrators).
- MT: mt-reports.com facility search, license type Long Term Care.
- NY and VA: no state-published administrator list was found; look for NYS DOH Health Profiles, NY cost report certifications, Virginia VDH OLC inspection reports, facility websites, LNHA license lookups that show employer, and dated news or press releases. Say explicitly if a state truly has no public source.
Also check the organization-level gaps: facilities in gap_facilities.csv with an empty operator_entity_name or empty direct_owners_org, and propose values from CMS PECOS, state corporation records, or the state licensing record.

## Rules

- Use only public sources. No paid data brokers, no LinkedIn scraping, no inference from similar names.
- Never invent a name. If you cannot find it, leave proposed_value blank and set confidence to none.
- Every proposed value must carry a source_url that a reader can open and a source_date (the as-of date shown on the source, otherwise the date you viewed it).
- Confidence: high = state licensing agency or CMS record naming the person as administrator; medium = facility website, press release, or trade association listing; low = indirect evidence (e.g., a license lookup showing the employer).
- Match on the CCN; never change the ccn column. If a facility appears to have closed or changed its name, say so in the note.
- Do not stop after the first few states. If the job is too large for one response, do it in batches by state and tell me which states are done and which remain so I can ask you to continue.

## Deliverables

1. findings.csv in exactly the template layout: ccn,facility_name,state,field,current_value,proposed_value,source_name,source_url,source_date,confidence,note. One row per fact checked or filled. field is one of: administrator_name, operator_entity_name, chain_name, direct_owners_org, management_company. For Task 1 rows put the verdict (CONFIRMED, CHANGED, UNVERIFIABLE, SOURCE_ERROR) at the start of note.
2. A short summary table: state, rows checked, confirmed, changed, unverifiable, gaps filled, gaps still open, and the best public source you found for that state with its URL.
3. A list of any systematic problems you noticed in the database (for example a state source that looks stale, a matching error pattern, or a field that is mislabeled), each with one concrete example CCN.
