#!/usr/bin/env python3
"""Reconcile Diana's authoritative 643-member roster against our NC members.json
(to get accounts_id), then scope the legacy photo import to JUST those members.
Outputs the exact Tier-1 photo footprint + a roster match report."""
import openpyxl, json, os, re, collections

ROOT = r"E:\Documents\GitHub\Heedbusinesssolutions\websites\wvwccc"
XLSX = os.path.join(ROOT, "data", "MEMBERS REPORT BY JOIN DATE.xlsx")
MEMBERS = os.path.join(ROOT, "data", "_store", "members.json")
PP = r"E:\WVWCCOC\var\www\vhosts\woodlandhillscc.net\httpdocs\admin\productphotos"

def norm_email(s): return (s or "").strip().lower()
def norm_co(s):
    s = re.sub(r'[^a-z0-9]', '', (s or '').lower())
    return s[:22]

# ── Diana's roster ──
wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
hdr = [str(c).strip().upper() if c else '' for c in rows[0]]
col = {h: i for i, h in enumerate(hdr)}
diana = []
for r in rows[1:]:
    if not any(r): continue
    diana.append({
        'company': r[col['COMPANY']], 'email': r[col['EMAIL']],
        'website': r[col.get('WEBSITE', -1)] if 'WEBSITE' in col else '',
        'category': r[col.get('BC_TEXT', -1)] if 'BC_TEXT' in col else '',
        'joindate': r[col['JOINDATE']],
    })
print(f"Diana roster: {len(diana)} members")

# ── our NC members.json ──
mem = json.load(open(MEMBERS, encoding='utf-8'))['members']
by_email = {norm_email(m.get('email')): m for m in mem if m.get('email')}
by_co = {}
for m in mem: by_co.setdefault(norm_co(m.get('name')), m)

matched, by_id, unmatched = 0, {}, []
for d in diana:
    m = by_email.get(norm_email(d['email'])) or by_co.get(norm_co(d['company']))
    if m and m.get('legacyAccountId'):
        matched += 1; by_id[str(m['legacyAccountId'])] = d['company']
    else:
        unmatched.append(d['company'])
print(f"matched to NC accounts_id: {matched}/{len(diana)}   unmatched: {len(unmatched)}")
print("  sample unmatched:", [u for u in unmatched[:8]])

# ── photo index: accounts_id -> [(file,size)] for profile-type images ──
idx = collections.defaultdict(list)
profile_re = re.compile(r'(ind_profile2?|profile_photo2?|indpicthumb)_(\d+)', re.I)
for f in os.listdir(PP):
    fp = os.path.join(PP, f)
    if not os.path.isfile(fp): continue
    mo = profile_re.search(f)
    if mo:
        try: idx[mo.group(2)].append((f, os.path.getsize(fp)))
        except OSError: pass

# ── scope to Diana's matched members ──
cur_ids = set(by_id)
have_photo = [i for i in cur_ids if idx.get(i)]
total_files = sum(len(idx[i]) for i in have_photo)
total_size = sum(s for i in have_photo for _, s in idx[i])
def human(n):
    for u in ['B','KB','MB','GB']:
        if n < 1024: return f"{n:.1f}{u}"
        n /= 1024
print(f"\n— TIER-1 photo import (Diana's current members only) —")
print(f"  current members matched: {len(cur_ids)}")
print(f"  of those WITH a legacy profile photo: {len(have_photo)}")
print(f"  total photo files: {total_files}   total size: {human(total_size)}")
print(f"  members with NO legacy photo (need new headshot/logo): {len(cur_ids) - len(have_photo)}")
