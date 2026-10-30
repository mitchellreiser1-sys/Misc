"""Build the national nursing home owner / operator / administrator database.

Inputs (raw/):
  NH_ProviderInfo.csv, NH_Ownership.csv      Care Compare (CMS provider-data catalog)
  SNF_Enrollments.csv, SNF_All_Owners.csv    PECOS enrollment + ownership disclosures (data.cms.gov)
  nppes_raw.jsonl                            NPI Registry records (scripts/nppes_pull.py)
  state_administrators/*.csv                 State licensing-directory administrator pulls (optional)

Outputs (output/):
  nursing_homes.sqlite        all tables below
  facilities_master.csv       one row per facility (CCN) with administrator, operator, owners, chain
  administrators.csv          best administrator per facility + all candidates
  owners_operators.csv        one row per facility: operator entity, management co, owners, lenders
  people_roles.csv            long table: every person / org disclosed for every facility
  people_index.csv            one row per unique person name: where they show up
  organization_index.csv      one row per unique organization name: where it shows up
  nursing_homes.xlsx          Excel workbook with the key tables

Usage:  python3 -I scripts/build_db.py [--raw-dir raw] [--out-dir output]
"""
import argparse, csv, glob, json, os, re, sqlite3, sys
import pandas as pd

ADMIN_RE = re.compile(r"\b(ADMINISTRATOR|ADMIN|ADMINISTRATION|N\.?H\.?A\.?|L\.?N\.?H\.?A\.?|LICENSED NURSING HOME ADMIN)\b")
NOT_ADMIN_RE = re.compile(r"\b(ASSISTANT|ASST|ASSOC|REGIONAL|CORPORATE|VICE|DIRECTOR OF|BUSINESS OFFICE|ADMINISTRATIVE|OFFICE|SYSTEM|CHIEF ADMINISTRATIVE)\b")
OWNERSHIP_ROLES = {
    "5% OR GREATER DIRECT OWNERSHIP INTEREST", "DIRECT OWNERSHIP INTEREST",
    "5% OR GREATER INDIRECT OWNERSHIP INTEREST", "INDIRECT OWNERSHIP INTEREST",
    "GENERAL PARTNERSHIP INTEREST", "LIMITED PARTNERSHIP INTEREST",
}
DIRECT_ROLES = {"5% OR GREATER DIRECT OWNERSHIP INTEREST", "DIRECT OWNERSHIP INTEREST",
                "GENERAL PARTNERSHIP INTEREST", "LIMITED PARTNERSHIP INTEREST"}
INDIRECT_ROLES = {"5% OR GREATER INDIRECT OWNERSHIP INTEREST", "INDIRECT OWNERSHIP INTEREST"}
LENDER_ROLES = {"5% OR GREATER MORTGAGE INTEREST", "5% OR GREATER SECURITY INTEREST"}
MGMT_ROLES = {"W-2 MANAGING EMPLOYEE", "CONTRACTED MANAGING EMPLOYEE"}


def clean(s):
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    return re.sub(r"\s+", " ", str(s)).strip()


def person_key(name):
    """Normalise a person name to 'FIRST LAST' for matching across sources."""
    n = clean(name).upper()
    n = re.sub(r"\b(JR|SR|II|III|IV|MD|DO|RN|LNHA|NHA|CPA|ESQ|PHD|MBA|LPN|DDS)\b\.?", " ", n)
    n = re.sub(r"[^A-Z,' -]", " ", n)
    if "," in n:
        last, first = n.split(",", 1)
        n = first.strip() + " " + last.strip()
    toks = [t for t in re.split(r"[\s]+", n.replace("'", "")) if t]
    if len(toks) >= 2:
        return toks[0] + " " + toks[-1]
    return " ".join(toks)


def org_key(name):
    n = clean(name).upper()
    n = re.sub(r"[.,'\"]", "", n)
    n = re.sub(r"\b(THE|INC|LLC|L L C|LP|L P|LLP|CORP|CORPORATION|CO|COMPANY|LTD|PC|PLLC)\b", " ", n)
    return re.sub(r"\s+", " ", n).strip()


def first_last_to_display(first, middle, last):
    parts = [clean(first), clean(middle), clean(last)]
    return " ".join(p for p in parts if p)


def lastfirst_to_display(name):
    n = clean(name)
    if "," in n:
        last, first = n.split(",", 1)
        return (first.strip() + " " + last.strip()).strip()
    return n


def is_admin_title(title):
    t = clean(title).upper()
    if not t:
        return False
    return bool(ADMIN_RE.search(t)) and not NOT_ADMIN_RE.search(t)


def read_csv(path):
    return pd.read_csv(path, dtype=str, encoding="latin1", keep_default_na=False)


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--raw-dir", default=os.path.join(here, "..", "raw"))
    ap.add_argument("--out-dir", default=os.path.join(here, "..", "output"))
    args = ap.parse_args()
    raw, out = os.path.abspath(args.raw_dir), os.path.abspath(args.out_dir)
    os.makedirs(out, exist_ok=True)

    # ------------------------------------------------------------------ load
    print("loading CMS files", flush=True)
    prov = read_csv(os.path.join(raw, "NH_ProviderInfo.csv"))
    cc_own = read_csv(os.path.join(raw, "NH_Ownership.csv"))
    enr = read_csv(os.path.join(raw, "SNF_Enrollments.csv"))
    pecos = read_csv(os.path.join(raw, "SNF_All_Owners.csv"))
    manifest = {}
    mp = os.path.join(raw, "manifest.json")
    if os.path.exists(mp):
        manifest = json.load(open(mp))

    prov = prov.rename(columns={"CMS Certification Number (CCN)": "ccn"})
    prov["ccn"] = prov["ccn"].str.strip().str.zfill(6)
    cc_own = cc_own.rename(columns={"CMS Certification Number (CCN)": "ccn"})
    cc_own["ccn"] = cc_own["ccn"].str.strip().str.zfill(6)
    enr["ccn"] = enr["CCN"].str.strip().str.zfill(6)
    enr = enr[enr["ccn"] != "000000"]
    # one enrollment per CCN (keep first; multiples are rare re-enrollments)
    enr1 = enr.drop_duplicates("ccn")
    pecos = pecos.merge(enr[["ENROLLMENT ID", "ccn"]], on="ENROLLMENT ID", how="inner")

    # ------------------------------------------------------------ facilities
    print("building facilities", flush=True)
    fac = pd.DataFrame({
        "ccn": prov["ccn"],
        "provider_name": prov["Provider Name"],
        "legal_business_name": prov["Legal Business Name"],
        "address": prov["Provider Address"],
        "city": prov["City/Town"],
        "state": prov["State"],
        "zip": prov["ZIP Code"],
        "phone": prov["Telephone Number"],
        "county": prov["County/Parish"],
        "ownership_type": prov["Ownership Type"],
        "provider_type": prov["Provider Type"],
        "certified_beds": prov["Number of Certified Beds"],
        "avg_residents_per_day": prov["Average Number of Residents per Day"],
        "in_hospital": prov["Provider Resides in Hospital"],
        "ccrc": prov["Continuing Care Retirement Community"],
        "date_first_approved": prov["Date First Approved to Provide Medicare and Medicaid Services"],
        "chain_name": prov["Chain Name"],
        "chain_id": prov["Chain ID"],
        "chain_facility_count": prov["Number of Facilities in Chain"],
        "overall_rating": prov["Overall Rating"],
        "health_inspection_rating": prov["Health Inspection Rating"],
        "staffing_rating": prov["Staffing Rating"],
        "qm_rating": prov["QM Rating"],
        "special_focus_status": prov["Special Focus Status"],
        "abuse_icon": prov["Abuse Icon"],
        "changed_ownership_last_12_months": prov["Provider Changed Ownership in Last 12 Months"],
        "administrators_departed": prov.get("Number of administrators who have left the nursing home", ""),
        "in_care_compare": "Y",
    })
    e = enr1.set_index("ccn")
    for col, src in (("npi", "NPI"), ("enrollment_id", "ENROLLMENT ID"), ("pecos_enrollment_state", "ENROLLMENT STATE"),
                     ("operator_entity_name", "ORGANIZATION NAME"), ("operator_dba", "DOING BUSINESS AS NAME"),
                     ("operator_entity_type", "ORGANIZATION TYPE STRUCTURE"), ("operator_incorporation_state", "INCORPORATION STATE"),
                     ("operator_incorporation_date", "INCORPORATION DATE"), ("proprietary_or_nonprofit", "PROPRIETARY_NONPROFIT"),
                     ("affiliated_entity_name", "AFFILIATION ENTITY NAME"), ("affiliated_entity_id", "AFFILIATION ENTITY ID")):
        fac[col] = fac["ccn"].map(e[src]).fillna("")
    fac["in_pecos"] = fac["ccn"].isin(e.index).map({True: "Y", False: "N"})
    # enrollment-only facilities (not on Care Compare this month)
    extra = enr1[~enr1["ccn"].isin(fac["ccn"])]
    if len(extra):
        add = pd.DataFrame({
            "ccn": extra["ccn"], "provider_name": extra["NURSING HOME PROVIDER NAME"],
            "legal_business_name": extra["ORGANIZATION NAME"], "address": extra["ADDRESS LINE 1"],
            "city": extra["CITY"], "state": extra["STATE"], "zip": extra["ZIP CODE"].str[:5],
            "npi": extra["NPI"], "enrollment_id": extra["ENROLLMENT ID"], "pecos_enrollment_state": extra["ENROLLMENT STATE"],
            "operator_entity_name": extra["ORGANIZATION NAME"], "operator_dba": extra["DOING BUSINESS AS NAME"],
            "operator_entity_type": extra["ORGANIZATION TYPE STRUCTURE"], "operator_incorporation_state": extra["INCORPORATION STATE"],
            "operator_incorporation_date": extra["INCORPORATION DATE"], "proprietary_or_nonprofit": extra["PROPRIETARY_NONPROFIT"],
            "affiliated_entity_name": extra["AFFILIATION ENTITY NAME"], "affiliated_entity_id": extra["AFFILIATION ENTITY ID"],
            "in_care_compare": "N", "in_pecos": "Y",
        })
        fac = pd.concat([fac, add], ignore_index=True).fillna("")
    fac = fac.sort_values(["state", "city", "provider_name"]).reset_index(drop=True)
    fac_idx = fac.set_index("ccn")

    # ----------------------------------------------------------- people_roles
    print("building people_roles", flush=True)
    rows = []
    # 1. PECOS all owners
    for r in pecos.itertuples(index=False):
        d = r._asdict()
        g = lambda k: clean(d.get(k.replace(" ", "_").replace("-", "_"), ""))
        # pandas itertuples renames columns with spaces; use positional dict instead
        break
    pc = {c: i for i, c in enumerate(pecos.columns)}
    for rec in pecos.itertuples(index=False, name=None):
        g = lambda k: clean(rec[pc[k]])
        ptype = "Person" if g("TYPE - OWNER") == "I" else "Organization"
        if ptype == "Person":
            name = first_last_to_display(g("FIRST NAME - OWNER"), g("MIDDLE NAME - OWNER"), g("LAST NAME - OWNER"))
        else:
            name = g("ORGANIZATION NAME - OWNER")
        flags = [lab for col, lab in (("MANAGEMENT SERVICES COMPANY - OWNER", "MANAGEMENT CO"), ("REIT - OWNER", "REIT"),
                                      ("PRIVATE EQUITY COMPANY - OWNER", "PRIVATE EQUITY"), ("HOLDING COMPANY - OWNER", "HOLDING CO"),
                                      ("INVESTMENT FIRM - OWNER", "INVESTMENT FIRM"), ("FINANCIAL INSTITUTION - OWNER", "FINANCIAL INSTITUTION"),
                                      ("CHAIN HOME OFFICE - OWNER", "CHAIN HOME OFFICE"), ("CONSULTING FIRM - OWNER", "CONSULTING FIRM"),
                                      ("MEDICAL STAFFING COMPANY - OWNER", "STAFFING CO"), ("TRUST OR TRUSTEE - OWNER", "TRUST"),
                                      ("PARENT COMPANY - OWNER", "PARENT CO"), ("NON PROFIT - OWNER", "NON PROFIT"),
                                      ("FOR PROFIT - OWNER", "FOR PROFIT")) if g(col) == "Y"]
        rows.append({
            "ccn": rec[pc["ccn"]], "source": "PECOS", "party_type": ptype, "name": name,
            "first_name": g("FIRST NAME - OWNER") if ptype == "Person" else "", "last_name": g("LAST NAME - OWNER") if ptype == "Person" else "",
            "title": g("TITLE - OWNER"), "role": g("ROLE TEXT - OWNER"), "ownership_pct": g("PERCENTAGE OWNERSHIP"),
            "association_date": g("ASSOCIATION DATE - OWNER"), "org_flags": "; ".join(flags),
            "other_type_text": g("OTHER TYPE TEXT - OWNER"), "dba": g("DOING BUSINESS AS NAME - OWNER"),
            "party_address": ", ".join(x for x in (g("ADDRESS LINE 1 - OWNER"), g("ADDRESS LINE 2 - OWNER")) if x),
            "party_city": g("CITY - OWNER"), "party_state": g("STATE - OWNER"), "party_zip": g("ZIP CODE - OWNER")[:5],
            "phone": "", "email": "", "source_url": "https://data.cms.gov/provider-characteristics/hospitals-and-other-facilities/skilled-nursing-facility-all-owners",
            "source_date": manifest.get("SNF_All_Owners.csv", {}).get("version", ""), "match_method": "ccn_direct", "match_confidence": "high",
            "owner_associate_id": g("ASSOCIATE ID - OWNER"),
        })
    # 2. Care Compare ownership
    cc = {c: i for i, c in enumerate(cc_own.columns)}
    for rec in cc_own.itertuples(index=False, name=None):
        g = lambda k: clean(rec[cc[k]])
        if g("Role played by Owner or Manager in Facility") == "Ownership Data Not Available":
            continue
        ptype = "Person" if g("Owner Type") == "Individual" else "Organization"
        name = lastfirst_to_display(g("Owner Name")) if ptype == "Person" else g("Owner Name")
        pct = g("Ownership Percentage")
        pct = "" if pct in ("NOT APPLICABLE", "NO PERCENTAGE PROVIDED") else pct.replace("%", "")
        rows.append({
            "ccn": rec[cc["ccn"]], "source": "CARE_COMPARE", "party_type": ptype, "name": name,
            "first_name": "", "last_name": "", "title": "", "role": g("Role played by Owner or Manager in Facility"),
            "ownership_pct": pct, "association_date": g("Association Date").replace("since ", ""), "org_flags": "",
            "other_type_text": "", "dba": "", "party_address": "", "party_city": "", "party_state": "", "party_zip": "",
            "phone": "", "email": "", "source_url": "https://data.cms.gov/provider-data/dataset/y2hd-n93e",
            "source_date": manifest.get("NH_Ownership.csv", {}).get("modified", ""), "match_method": "ccn_direct",
            "match_confidence": "high", "owner_associate_id": "",
        })
    # 3. NPPES authorized officials
    npi_to_ccn = {}
    for rec in enr.itertuples(index=False, name=None):
        npi = clean(rec[list(enr.columns).index("NPI")])
        if npi:
            npi_to_ccn.setdefault(npi, rec[list(enr.columns).index("ccn")])
    nppes_path = os.path.join(raw, "nppes_raw.jsonl")
    nppes_lic = {}
    if os.path.exists(nppes_path):
        with open(nppes_path) as f:
            for line in f:
                try:
                    d = json.loads(line)
                except json.JSONDecodeError:
                    continue
                resp = d.get("resp") or {}
                res = resp.get("results") or []
                if not res:
                    continue
                b = res[0].get("basic", {})
                ccn = npi_to_ccn.get(d["npi"])
                if not ccn:
                    continue
                for tx in res[0].get("taxonomies", []):
                    if tx.get("license"):
                        nppes_lic.setdefault(ccn, tx["license"])
                        break
                name = first_last_to_display(b.get("authorized_official_first_name"), b.get("authorized_official_middle_name"),
                                             b.get("authorized_official_last_name"))
                if not name:
                    continue
                rows.append({
                    "ccn": ccn, "source": "NPPES", "party_type": "Person", "name": name,
                    "first_name": clean(b.get("authorized_official_first_name")), "last_name": clean(b.get("authorized_official_last_name")),
                    "title": clean(b.get("authorized_official_title_or_position")), "role": "NPI AUTHORIZED OFFICIAL",
                    "ownership_pct": "", "association_date": clean(b.get("last_updated")), "org_flags": "", "other_type_text": "",
                    "dba": "", "party_address": "", "party_city": "", "party_state": "", "party_zip": "",
                    "phone": clean(b.get("authorized_official_telephone_number")), "email": "",
                    "source_url": f"https://npiregistry.cms.hhs.gov/provider-view/{d['npi']}", "source_date": clean(b.get("last_updated")),
                    "match_method": "ccn_direct", "match_confidence": "high", "owner_associate_id": "",
                })
    # 4. State administrator directories
    state_files = sorted(glob.glob(os.path.join(raw, "state_administrators", "*.csv")))
    state_sources = []
    for sf in state_files:
        try:
            sdf = read_csv(sf)
        except Exception as ex:
            print(f"  skipping {sf}: {ex}")
            continue
        need = {"ccn", "state", "administrator_name"}
        if not need.issubset(sdf.columns):
            print(f"  skipping {sf}: missing columns {need - set(sdf.columns)}")
            continue
        n = 0
        for rec in sdf.to_dict("records"):
            name = clean(rec.get("administrator_name"))
            ccn = clean(rec.get("ccn")).zfill(6) if clean(rec.get("ccn")) else ""
            if not name or not ccn or ccn not in fac_idx.index:
                continue
            n += 1
            rows.append({
                "ccn": ccn, "source": "STATE_" + clean(rec.get("state")).upper(), "party_type": "Person", "name": name,
                "first_name": "", "last_name": "", "title": clean(rec.get("administrator_title")) or "Administrator",
                "role": "ADMINISTRATOR (STATE LICENSING DIRECTORY)", "ownership_pct": "", "association_date": "",
                "org_flags": "", "other_type_text": "", "dba": "", "party_address": "", "party_city": "", "party_state": "", "party_zip": "",
                "phone": clean(rec.get("administrator_phone")), "email": clean(rec.get("administrator_email")),
                "source_url": clean(rec.get("source_url")), "source_date": clean(rec.get("source_date")),
                "match_method": clean(rec.get("match_method")) or "manual", "match_confidence": clean(rec.get("match_confidence")) or "medium",
                "owner_associate_id": "",
            })
        state_sources.append({"file": os.path.basename(sf), "rows_loaded": n, "rows_in_file": len(sdf)})
        print(f"  state file {os.path.basename(sf)}: {n} administrator rows matched to CCN")

    people = pd.DataFrame(rows)
    people["name_key"] = people.apply(lambda r: person_key(r["name"]) if r["party_type"] == "Person" else org_key(r["name"]), axis=1)
    for col in ("provider_name", "state", "city"):
        people["facility_" + col] = people["ccn"].map(fac_idx[col]).fillna("")
    people = people[people["name"] != ""]
    people = people.sort_values(["ccn", "party_type", "name_key", "source"]).reset_index(drop=True)
    people.insert(0, "role_id", range(1, len(people) + 1))

    # --------------------------------------------------------- administrators
    print("building administrators", flush=True)
    cand = []
    persons = people[people["party_type"] == "Person"]
    for r in persons.itertuples(index=False):
        src, role, title = r.source, r.role, r.title
        if src.startswith("STATE_") and (not title or is_admin_title(title) or title.upper().startswith("CONTACT PERSON")):
            tier, basis = 1, f"State licensing directory lists this person as '{title or 'Administrator'}'"
        elif src == "PECOS" and is_admin_title(title):
            tier, basis = 2, f"PECOS disclosure title '{title}' ({role})"
        elif src.startswith("STATE_"):
            tier, basis = 3, f"State licensing directory contact with non-administrator title '{title}'"
        elif src == "NPPES" and is_admin_title(title):
            tier, basis = 4, f"NPI Registry authorized official, title '{title}'"
        elif src in ("PECOS", "CARE_COMPARE") and role in MGMT_ROLES and not title:
            tier, basis = 5, f"{role} with no title disclosed (often the administrator, unverified)"
        elif src == "PECOS" and role in MGMT_ROLES and title:
            continue  # managing employee with a non-admin title (DON, CFO, etc.)
        else:
            continue
        cand.append({"ccn": r.ccn, "administrator_name": r.name, "name_key": r.name_key, "title": title, "source": src,
                     "tier": tier, "basis": basis, "association_date": r.association_date, "source_url": r.source_url,
                     "source_date": r.source_date, "match_confidence": r.match_confidence, "phone": r.phone, "email": r.email})
    cand = pd.DataFrame(cand)
    cand["_date"] = pd.to_datetime(cand["association_date"], errors="coerce")
    cand = cand.sort_values(["ccn", "tier", "_date"], ascending=[True, True, False])
    # collapse duplicates of the same person for the same facility, keep best tier
    cand = cand.drop_duplicates(["ccn", "name_key"], keep="first")
    best = cand.drop_duplicates("ccn", keep="first").copy()
    best["confidence"] = best["tier"].map({1: "high", 2: "high", 3: "medium", 4: "medium", 5: "low"})
    best["other_candidates"] = best["ccn"].map(
        cand.groupby("ccn").apply(lambda g: "; ".join(f"{a} [{s}]" for a, s in zip(g["administrator_name"].iloc[1:], g["source"].iloc[1:])))
    ).fillna("")
    admins = fac[["ccn", "provider_name", "city", "state"]].merge(best.drop(columns=["_date", "name_key"]), on="ccn", how="left").fillna("")
    admins["confidence"] = admins["confidence"].replace("", "none")

    # ------------------------------------------------------ owners_operators
    print("building owners_operators", flush=True)
    pp = people[people["source"] == "PECOS"]

    def joined(df, fmt):
        return df.groupby("ccn").apply(lambda g: "; ".join(dict.fromkeys(fmt(r) for r in g.itertuples(index=False)))).rename("v")

    def fmt_pct(r):
        return f"{r.name} ({r.ownership_pct}%)" if r.ownership_pct else r.name

    def fmt_title(r):
        return f"{r.name} ({r.title})" if r.title else r.name

    oo = fac[["ccn", "provider_name", "city", "state", "legal_business_name", "ownership_type", "operator_entity_name", "operator_dba",
              "operator_entity_type", "proprietary_or_nonprofit", "operator_incorporation_state", "chain_name", "chain_id",
              "chain_facility_count", "affiliated_entity_name", "changed_ownership_last_12_months"]].copy()
    parts = {
        "management_company": pp[pp["org_flags"].str.contains("MANAGEMENT CO") & (pp["party_type"] == "Organization")],
        "direct_owners_org": pp[pp["role"].isin(DIRECT_ROLES) & (pp["party_type"] == "Organization")],
        "direct_owners_individual": pp[pp["role"].isin(DIRECT_ROLES) & (pp["party_type"] == "Person")],
        "indirect_owners_org": pp[pp["role"].isin(INDIRECT_ROLES) & (pp["party_type"] == "Organization")],
        "indirect_owners_individual": pp[pp["role"].isin(INDIRECT_ROLES) & (pp["party_type"] == "Person")],
        "operational_control_org": pp[(pp["role"] == "OPERATIONAL/MANAGERIAL CONTROL") & (pp["party_type"] == "Organization")],
        "operational_control_individual": pp[(pp["role"] == "OPERATIONAL/MANAGERIAL CONTROL") & (pp["party_type"] == "Person")],
        "officers_directors": pp[pp["role"].isin({"CORPORATE OFFICER", "CORPORATE DIRECTOR", "MANAGING CONTROL - GOVERNING BODY"}) & (pp["party_type"] == "Person")],
        "managing_employees": pp[pp["role"].isin(MGMT_ROLES) & (pp["party_type"] == "Person")],
        "reit_or_landlord_orgs": pp[pp["org_flags"].str.contains("REIT")],
        "private_equity_orgs": pp[pp["org_flags"].str.contains("PRIVATE EQUITY")],
        "holding_or_parent_orgs": pp[pp["org_flags"].str.contains("HOLDING CO|PARENT CO") & ~pp["org_flags"].str.contains("MANAGEMENT CO")],
        "lenders_mortgage_security": pp[pp["role"].isin(LENDER_ROLES)],
        "additional_disclosable_parties_org": pp[(pp["role"] == "ADP OF THE SNF") & (pp["party_type"] == "Organization")],
        "additional_disclosable_parties_individual": pp[(pp["role"] == "ADP OF THE SNF") & (pp["party_type"] == "Person")],
    }
    for col, df in parts.items():
        if col in ("officers_directors", "managing_employees", "operational_control_individual"):
            f = fmt_title
        elif "owners" in col or col == "lenders_mortgage_security":
            f = fmt_pct
        else:
            f = lambda r: r.name
        oo[col] = oo["ccn"].map(joined(df, f)).fillna("") if len(df) else ""
    oo["individual_owner_count"] = oo["ccn"].map(pp[pp["role"].isin(OWNERSHIP_ROLES) & (pp["party_type"] == "Person")].groupby("ccn")["name_key"].nunique()).fillna(0).astype(int)
    oo["disclosed_party_count"] = oo["ccn"].map(pp.groupby("ccn")["name_key"].nunique()).fillna(0).astype(int)

    # ----------------------------------------------------------- facilities master
    fm = fac.merge(admins[["ccn", "administrator_name", "title", "source", "confidence", "source_date", "phone", "email"]]
                   .rename(columns={"title": "administrator_title", "source": "administrator_source", "confidence": "administrator_confidence",
                                    "source_date": "administrator_source_date", "phone": "administrator_phone", "email": "administrator_email"}),
                   on="ccn", how="left")
    fm = fm.merge(oo.drop(columns=["provider_name", "city", "state", "legal_business_name", "ownership_type", "operator_entity_name", "operator_dba",
                                   "operator_entity_type", "proprietary_or_nonprofit", "operator_incorporation_state", "chain_name", "chain_id",
                                   "chain_facility_count", "affiliated_entity_name", "changed_ownership_last_12_months"]), on="ccn", how="left")
    fm["state_license_number_nppes"] = fm["ccn"].map(nppes_lic).fillna("")
    fm = fm.fillna("")
    lead = ["ccn", "provider_name", "address", "city", "state", "zip", "county", "phone", "certified_beds", "ownership_type", "overall_rating",
            "administrator_name", "administrator_title", "administrator_source", "administrator_confidence",
            "operator_entity_name", "operator_dba", "management_company", "chain_name", "affiliated_entity_name",
            "direct_owners_org", "direct_owners_individual", "indirect_owners_org", "indirect_owners_individual", "operational_control_org",
            "reit_or_landlord_orgs", "private_equity_orgs", "lenders_mortgage_security"]
    fm = fm[lead + [c for c in fm.columns if c not in lead]]

    # -------------------------------------------------------------- indexes
    print("building people / organization indexes", flush=True)

    def build_index(df, key_label):
        g = df.groupby("name_key")
        idx = pd.DataFrame({
            "name": g["name"].agg(lambda s: s.value_counts().index[0]),
            "facility_count": g["ccn"].nunique(),
            "states": g["facility_state"].agg(lambda s: ", ".join(sorted(set(x for x in s if x)))),
            "roles": g["role"].agg(lambda s: "; ".join(sorted(set(x for x in s if x)))),
            "titles": g["title"].agg(lambda s: "; ".join(sorted(set(x for x in s if x)))),
            "sources": g["source"].agg(lambda s: ", ".join(sorted(set(s)))),
            "facilities": g.apply(lambda x: "; ".join(dict.fromkeys(f"{n} ({c}, {st}) [{ccn}]" for n, c, st, ccn in
                                                                 zip(x["facility_provider_name"], x["facility_city"], x["facility_state"], x["ccn"])))),
            "ccns": g["ccn"].agg(lambda s: ", ".join(sorted(set(s)))),
        }).reset_index().rename(columns={"name_key": key_label})
        return idx.sort_values(["facility_count", "name"], ascending=[False, True])

    people_index = build_index(people[people["party_type"] == "Person"], "person_key")
    org_index = build_index(people[people["party_type"] == "Organization"], "org_key")
    for df in (people_index, org_index):
        df["facilities"] = df["facilities"].str.slice(0, 30000)

    # --------------------------------------------------------------- write
    print("writing outputs", flush=True)
    fm.to_csv(os.path.join(out, "facilities_master.csv"), index=False)
    admins.to_csv(os.path.join(out, "administrators.csv"), index=False)
    cand.drop(columns=["_date"]).to_csv(os.path.join(out, "administrator_candidates.csv"), index=False)
    oo.to_csv(os.path.join(out, "owners_operators.csv"), index=False)
    people.to_csv(os.path.join(out, "people_roles.csv.gz"), index=False, compression="gzip")
    people_index.to_csv(os.path.join(out, "people_index.csv"), index=False)
    org_index.to_csv(os.path.join(out, "organization_index.csv"), index=False)

    dbp = os.path.join(out, "nursing_homes.sqlite")
    if os.path.exists(dbp):
        os.remove(dbp)
    con = sqlite3.connect(dbp)
    fm.to_sql("facilities", con, index=False)
    admins.to_sql("administrators", con, index=False)
    cand.drop(columns=["_date"]).to_sql("administrator_candidates", con, index=False)
    oo.to_sql("owners_operators", con, index=False)
    people.to_sql("people_roles", con, index=False)
    people_index.to_sql("people_index", con, index=False)
    org_index.to_sql("organization_index", con, index=False)
    pd.DataFrame(state_sources).to_sql("state_sources", con, index=False) if state_sources else None
    pd.DataFrame([{"key": k, "value": json.dumps(v)} for k, v in manifest.items()]).to_sql("source_manifest", con, index=False)
    con.executescript("""
        CREATE INDEX ix_people_name ON people_roles(name_key);
        CREATE INDEX ix_people_ccn ON people_roles(ccn);
        CREATE INDEX ix_fac_state ON facilities(state);
        CREATE INDEX ix_fac_name ON facilities(provider_name);
    """)
    con.commit(); con.close()
    import gzip, shutil
    with open(dbp, "rb") as fi, gzip.open(dbp + ".gz", "wb") as fo:
        shutil.copyfileobj(fi, fo)

    with pd.ExcelWriter(os.path.join(out, "nursing_homes.xlsx"), engine="openpyxl") as xw:
        fm.to_excel(xw, sheet_name="Facilities", index=False)
        admins.to_excel(xw, sheet_name="Administrators", index=False)
        oo.to_excel(xw, sheet_name="Owners_Operators", index=False)
        people_index.to_excel(xw, sheet_name="People_Index", index=False)
        org_index.to_excel(xw, sheet_name="Organization_Index", index=False)
        pd.DataFrame({"note": [
            "People_Roles (every disclosed person/org per facility, ~500k rows) is in people_roles.csv.gz and nursing_homes.sqlite (gunzip nursing_homes.sqlite.gz).",
            "Use People_Index to search a name: it lists every facility where that person is disclosed in any role.",
            "administrator_confidence: high = state directory or PECOS title says Administrator; medium = state directory contact with another title, or NPI authorized official titled administrator; low = managing employee with no title; none = no candidate.",
        ]}).to_excel(xw, sheet_name="README", index=False)

    # summary
    s = {
        "facilities": len(fm), "facilities_with_admin_name": int((fm["administrator_name"] != "").sum()),
        "admin_by_confidence": fm["administrator_confidence"].value_counts().to_dict(),
        "people_roles": len(people), "unique_people": len(people_index), "unique_orgs": len(org_index),
        "facilities_with_any_individual_owner": int((oo["individual_owner_count"] > 0).sum()),
        "facilities_with_management_company": int((oo["management_company"] != "").sum()),
        "state_sources": state_sources,
    }
    json.dump(s, open(os.path.join(out, "build_summary.json"), "w"), indent=2)
    print(json.dumps(s, indent=2))


if __name__ == "__main__":
    main()
