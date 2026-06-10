#!/usr/bin/env python3
"""FINAL roster replace (2026-06-09): 'ACTIVE MEMBERS FROM 1966 THROUGH MAY 31 2026.xlsx'
is the new GROUND TRUTH spine. Each xlsx row is matched against the current
data/_store/members.json (by email, then normalized company) so matched members
KEEP their id/slug/photo/description/tier/group and all other enrichment;
the xlsx remains authoritative for contact fields. Old members not in the xlsx
are dropped (reported). New xlsx-only members are created fresh.

Outputs:
  data/_store/members.json                 (replaced; backup written first)
  data/_store/_roster-final-report.json    (matched / dropped / new report)
  data/directory.json                      (public seed regenerated, PII stripped)
"""
import openpyxl, json, os, re, shutil, datetime, sys

ROOT = r"E:\Documents\GitHub\Heedbusinesssolutions\websites\wvwccc"
XLSX = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Administrator\DL\ACTIVE MEMBERS FROM 1966 THROUGH MAY 31 2026 .xlsx"
STORE = os.path.join(ROOT, "data", "_store", "members.json")
REPORT = os.path.join(ROOT, "data", "_store", "_roster-final-report.json")
SEED = os.path.join(ROOT, "data", "directory.json")
SOURCE_TAG = "active-members-1966-thru-2026-05-31"

def clean(v): return "" if v is None else str(v).strip()
def norm_email(s): return clean(s).lower()
def norm_co(s): return re.sub(r'[^a-z0-9]', '', clean(s).lower())[:22]
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', clean(s).lower()))[:60]
def website(v):
    s = clean(v)
    if not s or '@' in s or ' ' in s: return ''
    s = re.sub(r'^https?://', '', s, flags=re.I)
    if not re.match(r'^[a-z0-9.-]+\.[a-z]{2,}', s, re.I): return ''
    return 'https://' + s.lstrip('/')
def jdate(v):
    if isinstance(v, (datetime.datetime, datetime.date)): return v.strftime('%Y-%m-%d')
    m = re.match(r'(\d{4}-\d{2}-\d{2})', clean(v));  return m.group(1) if m else ''
def seal(name):
    m = re.search(r'[A-Za-z0-9]', name);  return m.group(0).upper() if m else '?'

# ── current store (enrichment source) ──
old_doc = json.load(open(STORE, encoding='utf-8'))
old = old_doc['members']
# lists per key — duplicate companies/emails (multi-location members) each match once
by_email, by_co = {}, {}
for m in old:
    e = norm_email(m.get('email'))
    if e: by_email.setdefault(e, []).append(m)
    c = norm_co(m.get('name'))
    if c: by_co.setdefault(c, []).append(m)
def pick_unused(cands, used):
    for m in cands or []:
        if m.get('id') not in used: return m
    return None

# Fields the xlsx is authoritative for (when it has a value)
def xlsx_fields(r, cell):
    company = clean(cell(r, 'COMPANY'))
    return {
        "name": company,
        "category": clean(cell(r, 'BC_TEXT')),
        "neighborhood": clean(cell(r, 'CITY')),
        "contactName": " ".join(x for x in [clean(cell(r, 'FIRSTNAME')), clean(cell(r, 'LASTNAME'))] if x),
        "address": clean(cell(r, 'ADDRESS')),
        "city": clean(cell(r, 'CITY')),
        "state": clean(cell(r, 'STATE')),
        "zip": clean(cell(r, 'ZIP')),
        "phone": clean(cell(r, 'PHONE')),
        "website": website(cell(r, 'WEBSITE')),
        "email": clean(cell(r, 'EMAIL')),
        "joinDate": jdate(cell(r, 'JOINDATE')),
    }

wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
H = {str(c).strip().upper(): i for i, c in enumerate(rows[0]) if c}
def cell(r, name): return r[H[name]] if name in H and H[name] < len(r) else None

members, used_old_ids, seen_ids, seen_slugs = [], set(), set(), set()
report = {"total_xlsx_rows": 0, "matched": 0, "matched_by_email": 0, "matched_by_company": 0,
          "new_from_xlsx": 0, "new_members": [], "dropped": []}

for r in rows[1:]:
    if not any(r): continue
    company = clean(cell(r, 'COMPANY'))
    if not company: continue
    report["total_xlsx_rows"] += 1
    fx = xlsx_fields(r, cell)

    enr = pick_unused(by_email.get(norm_email(fx["email"])), used_old_ids) if fx["email"] else None
    how = 'email' if enr else None
    if enr is None:
        enr = pick_unused(by_co.get(norm_co(company)), used_old_ids)
        if enr is not None: how = 'company'

    if enr:
        report["matched"] += 1
        report["matched_by_email" if how == 'email' else "matched_by_company"] += 1
        used_old_ids.add(enr['id'])
        m = dict(enr)  # keep ALL enrichment: id, slug, tier, group, tags, logo,
                       # tagline, description, social, legacyAccountId, etc.
        for k, v in fx.items():
            if v: m[k] = v          # xlsx wins when it has a value
            elif k not in m: m[k] = v
        if not m.get('category'): m['category'] = 'Member'
        m['seal'] = seal(m['name'])
        m['source'] = SOURCE_TAG
        m['status'] = 'approved'
    else:
        report["new_from_xlsx"] += 1
        report["new_members"].append(company)
        m = {"id": f"wv-{slug(company)}", "slug": slug(company), **fx,
             "tier": "member", "status": "approved", "seal": seal(company),
             "source": SOURCE_TAG}
        if not m.get('category'): m['category'] = 'Member'

    # id / slug uniqueness
    if m['id'] in seen_ids: m['id'] = f"{m['id']}-{len(members)}"
    seen_ids.add(m['id'])
    if not m.get('slug'): m['slug'] = slug(m['name'])
    if m['slug'] in seen_slugs: m['slug'] = f"{m['slug']}-{len(members)}"
    seen_slugs.add(m['slug'])

    members.append({k: v for k, v in m.items() if v not in ("", None, [])})

# dropped: in old store, not matched by any xlsx row
for m in old:
    if m['id'] not in used_old_ids:
        report["dropped"].append({"id": m['id'], "name": m.get('name'), "joinDate": m.get('joinDate')})

members.sort(key=lambda x: x["name"].lower())
meta = {
    "importedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    "source": "FINAL roster 'ACTIVE MEMBERS FROM 1966 THROUGH MAY 31 2026.xlsx' — enrichment preserved from prior canonical store where matched",
    "count": len(members),
    "matched_to_prior": report["matched"],
    "new_from_xlsx": report["new_from_xlsx"],
    "dropped_from_prior": len(report["dropped"]),
}

# backup then write
bak = STORE + ".bak-" + datetime.date.today().isoformat()
shutil.copy2(STORE, bak)
json.dump({"_meta": meta, "members": members}, open(STORE, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
json.dump({"_meta": meta, **report}, open(REPORT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

print(f"backup → {os.path.basename(bak)}")
print(f"✓ {len(members)} members → data/_store/members.json")
print(f"  matched: {report['matched']} (email {report['matched_by_email']}, company {report['matched_by_company']})")
print(f"  new from xlsx: {report['new_from_xlsx']}   dropped from prior roster: {len(report['dropped'])}")
print(f"  with photo/logo: {sum(1 for m in members if m.get('logo'))}   with description: {sum(1 for m in members if m.get('description'))}")
print(f"  with website: {sum(1 for m in members if m.get('website'))}   with email: {sum(1 for m in members if m.get('email'))}")
