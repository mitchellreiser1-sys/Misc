"""Export compact JSON for the web lookup page (web/index.html).

Reads output/facilities_master.csv, people_index.csv, organization_index.csv and writes
output/web/facilities.json, people.json, orgs.json with short keys to keep the files small.
Usage: python3 -I scripts/build_web_data.py
"""
import json, os, pandas as pd
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "output")
web = os.path.join(out, "web"); os.makedirs(web, exist_ok=True)
rd = lambda f: pd.read_csv(os.path.join(out, f), dtype=str, keep_default_na=False)

fm = rd("facilities_master.csv")
cols = {"ccn": "ccn", "provider_name": "name", "address": "addr", "city": "city", "state": "st", "zip": "zip", "county": "county",
        "phone": "phone", "certified_beds": "beds", "ownership_type": "own", "overall_rating": "rating",
        "administrator_name": "adm", "administrator_title": "admt", "administrator_source": "adms", "administrator_confidence": "admc",
        "administrator_source_date": "admd", "administrator_phone": "admp", "administrator_email": "adme",
        "operator_entity_name": "op", "operator_dba": "dba", "operator_entity_type": "optype", "proprietary_or_nonprofit": "pnp",
        "management_company": "mgmt", "chain_name": "chain", "affiliated_entity_name": "aff",
        "direct_owners_org": "dO", "direct_owners_individual": "dI", "indirect_owners_org": "iO", "indirect_owners_individual": "iI",
        "operational_control_org": "cO", "operational_control_individual": "cI", "officers_directors": "off", "managing_employees": "me",
        "reit_or_landlord_orgs": "reit", "private_equity_orgs": "pe", "holding_or_parent_orgs": "hold", "lenders_mortgage_security": "lend",
        "additional_disclosable_parties_org": "adpO", "additional_disclosable_parties_individual": "adpI",
        "changed_ownership_last_12_months": "chow", "special_focus_status": "sfs", "state_license_number_nppes": "lic",
        "legal_business_name": "legal", "date_first_approved": "since"}
f = fm[list(cols)].rename(columns=cols)
recs = [{k: v for k, v in r.items() if v != ""} for r in f.to_dict("records")]
LIST_KEYS = {"ccn", "name", "city", "st", "zip", "beds", "own", "rating", "adm", "admc", "op", "chain"}
json.dump([{k: v for k, v in r.items() if k in LIST_KEYS} for r in recs],
          open(os.path.join(web, "facilities.json"), "w"), separators=(",", ":"))
# full detail split in two files (each stays well under the 16MB page-file limit)
half = len(recs) // 2
for i, chunk in enumerate((recs[:half], recs[half:])):
    json.dump({r["ccn"]: r for r in chunk}, open(os.path.join(web, f"details{i}.json"), "w"), separators=(",", ":"))

def idx(file, key):
    d = rd(file)
    rows = []
    for r in d.to_dict("records"):
        rows.append({"n": r["name"], "c": int(r["facility_count"]), "s": r["states"], "r": r["roles"], "t": r["titles"],
                     "f": [x.strip() for x in r["ccns"].split(",") if x.strip()]})
    return rows
json.dump(idx("people_index.csv", "person_key"), open(os.path.join(web, "people.json"), "w"), separators=(",", ":"))
json.dump(idx("organization_index.csv", "org_key"), open(os.path.join(web, "orgs.json"), "w"), separators=(",", ":"))
summary = json.load(open(os.path.join(out, "build_summary.json")))
json.dump({"facilities": summary["facilities"], "with_admin": summary["facilities_with_admin_name"], "people": summary["unique_people"],
           "orgs": summary["unique_orgs"], "built": "2026-10-30"}, open(os.path.join(web, "meta.json"), "w"))
for fn in os.listdir(web): print(fn, os.path.getsize(os.path.join(web, fn)))
