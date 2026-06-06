#!/usr/bin/env python3
"""Canonical directory build: Diana's 643-member roster (GROUND TRUTH) is the
spine. Enrich each with NC profile content (about/social/tagline) + legacy photo
where matched by accounts_id. The 69 not in the legacy DB come straight from the
xlsx. Copies the matched member photos into images/members/ and wires logo paths.

Outputs:
  data/_store/members.json            (canonical 643)
  data/_store/_roster-report.json     (match / photo / gap report)
  images/members/<id>.<ext>           (301 member photos, ~best res each)
"""
import openpyxl, json, os, re, shutil, datetime

ROOT = r"E:\Documents\GitHub\Heedbusinesssolutions\websites\wvwccc"
XLSX = os.path.join(ROOT, "data", "MEMBERS REPORT BY JOIN DATE.xlsx")
NCJSON = os.path.join(ROOT, "data", "_store", "members.json")  # NC-enriched build
PP = r"E:\WVWCCOC\var\www\vhosts\woodlandhillscc.net\httpdocs\admin\productphotos"
IMG_DIR = os.path.join(ROOT, "images", "members")
OUT = os.path.join(ROOT, "data", "_store", "members.json")
REPORT = os.path.join(ROOT, "data", "_store", "_roster-report.json")

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

# ── NC enrichment index (about/social/tagline/tier by accounts_id and by email/company) ──
nc = json.load(open(NCJSON, encoding='utf-8'))['members']
nc_by_acct = {str(m.get('legacyAccountId')): m for m in nc if m.get('legacyAccountId')}
nc_by_email = {norm_email(m.get('email')): m for m in nc if m.get('email')}
nc_by_co = {}
for m in nc: nc_by_co.setdefault(norm_co(m.get('name')), m)

# ── photo index: accounts_id -> best (priority, size, filename) ──
PRIO = ['profile_photo2_', 'profile_photo_', 'ind_profile2_', 'ind_profile_', 'indpicthumb_']
IMG_EXT = ('.jpg', '.jpeg', '.png', '.gif', '.webp')
photo_re = re.compile(r'(profile_photo2?|ind_profile2?|indpicthumb)_(\d+)', re.I)
best_photo = {}
for f in os.listdir(PP):
    fp = os.path.join(PP, f)
    if not os.path.isfile(fp) or not f.lower().endswith(IMG_EXT): continue
    mo = photo_re.search(f)
    if not mo: continue
    aid = mo.group(2)
    pfx = mo.group(1).lower() + '_'
    prio = next((i for i, p in enumerate(PRIO) if f.lower().startswith(p)), len(PRIO))
    try: size = os.path.getsize(fp)
    except OSError: continue
    cur = best_photo.get(aid)
    # lower prio index = better; then larger size = better
    if not cur or (prio, -size) < (cur[0], -cur[1]):
        best_photo[aid] = (prio, size, f)

# ── Diana roster ──
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
H = {str(c).strip().upper(): i for i, c in enumerate(rows[0]) if c}
def cell(r, name): return r[H[name]] if name in H and H[name] < len(r) else None

os.makedirs(IMG_DIR, exist_ok=True)
members, report = [], {"matched": 0, "new_from_xlsx": 0, "with_photo": 0, "no_photo": 0, "new_members": []}
seen_ids = set()
for r in rows[1:]:
    if not any(r): continue
    company = clean(cell(r, 'COMPANY'))
    if not company: continue
    email = clean(cell(r, 'EMAIL'))
    enr = nc_by_email.get(norm_email(email)) or nc_by_co.get(norm_co(company))
    aid = str(enr['legacyAccountId']) if enr and enr.get('legacyAccountId') else None
    if enr: report["matched"] += 1
    else: report["new_from_xlsx"] += 1; report["new_members"].append(company)

    mid = f"m{aid}" if aid else f"wv-{slug(company)}"
    if mid in seen_ids: mid = f"{mid}-{len(members)}"
    seen_ids.add(mid)

    m = {
        "id": mid,
        "name": company,
        "category": clean(cell(r, 'BC_TEXT')) or (enr.get('category') if enr else '') or 'Member',
        "tier": (enr.get('tier') if enr else '') or 'member',
        "neighborhood": clean(cell(r, 'CITY')),
        "contactName": " ".join(x for x in [clean(cell(r, 'FIRSTNAME')), clean(cell(r, 'LASTNAME'))] if x),
        "address": clean(cell(r, 'ADDRESS')),
        "city": clean(cell(r, 'CITY')),
        "state": clean(cell(r, 'STATE')),
        "zip": clean(cell(r, 'ZIP')),
        "phone": clean(cell(r, 'PHONE')),
        "website": website(cell(r, 'WEBSITE')),
        "email": email,                       # private; API strips
        "joinDate": jdate(cell(r, 'JOINDATE')),
        "status": "approved",
        "seal": seal(company),
        "source": "diana-roster-2026-06",
    }
    # NC enrichment (content only — Diana's contact fields stay authoritative)
    if enr:
        for k in ("tagline", "description", "social", "reviewLinks", "yearEstablished", "employees", "leaderStatus"):
            if enr.get(k): m[k] = enr[k]
        m["legacyAccountId"] = aid
    # photo
    if aid and aid in best_photo:
        _, _, fname = best_photo[aid]
        ext = os.path.splitext(fname)[1].lower()
        dest = f"{mid}{ext}"
        try:
            shutil.copy2(os.path.join(PP, fname), os.path.join(IMG_DIR, dest))
            m["logo"] = f"/images/members/{dest}"
            report["with_photo"] += 1
        except OSError:
            report["no_photo"] += 1
    else:
        report["no_photo"] += 1

    members.append({k: v for k, v in m.items() if v not in ("", None)})

members.sort(key=lambda x: x["name"].lower())
meta = {
    "importedAt": datetime.datetime.now().isoformat(timespec="seconds"),
    "source": "Diana 'MEMBERS REPORT BY JOIN DATE.xlsx' (authoritative current roster) enriched with NC profile/photo where matched",
    "count": len(members),
    "matched_to_legacy": report["matched"],
    "new_from_xlsx": report["new_from_xlsx"],
    "with_photo": report["with_photo"],
    "tier_note": "no tier data in roster — all 'member' until chamber assigns.",
}
json.dump({"_meta": meta, "members": members}, open(OUT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
json.dump({"_meta": meta, **report}, open(REPORT, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

print(f"✓ {len(members)} canonical members → data/_store/members.json")
print(f"  matched to legacy: {report['matched']}   new (xlsx-only): {report['new_from_xlsx']}")
print(f"  photos imported → images/members/: {report['with_photo']}   without photo: {report['no_photo']}")
with_desc = sum(1 for m in members if m.get('description'))
print(f"  with NC description: {with_desc}   with website: {sum(1 for m in members if m.get('website'))}   with joinDate: {sum(1 for m in members if m.get('joinDate'))}")
print(f"  oldest joinDate: {min((m['joinDate'] for m in members if m.get('joinDate')), default='?')}")
