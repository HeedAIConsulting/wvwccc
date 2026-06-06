#!/usr/bin/env python3
"""From the curated history file list, produce:
  - history_archive_rel.txt  (paths relative to httpdocs, for `rclone --files-from`)
  - data/history-index.json  (gallery index: R2 key, kind, title, year)
"""
import os, re, json

BASE = r"E:\WVWCCOC\var\www\vhosts\woodlandhillscc.net\httpdocs"
FILE_LIST = r"E:\WVWCCOC\history_archive_files.txt"
REL_OUT = r"E:\WVWCCOC\history_archive_rel.txt"
INDEX_OUT = r"E:\Documents\GitHub\Heedbusinesssolutions\websites\wvwccc\data\history-index.json"

IMG = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp')
DOC = ('.pdf', '.doc', '.docx', '.ppt', '.pptx')
profile_re = re.compile(r'(ind_profile2?|profile_photo2?|indpicthumb)_\d+', re.I)

def kind_of(fl):
    if fl.endswith(DOC): return 'document'
    if fl.startswith('event_') or 'event' in fl[:8]: return 'event'
    if re.search(r'(ad[_ ]|qrtpage|banner|flyer|sponsor)', fl): return 'ad'
    return 'photo'

def title_of(fn):
    t = os.path.splitext(fn)[0]
    t = re.sub(r'[-_]\d{3,}$', '', t)          # drop trailing numeric ids
    t = re.sub(r'^(event|ad)[_-]?', '', t, flags=re.I)
    t = re.sub(r'[_\-]+', ' ', t).strip()
    t = re.sub(r'\s+', ' ', t)
    return (t[:80] or 'Chamber archive').strip().title()

def year_of(fn):
    # only trust a year token next to a date-ish separator, and never future
    for m in re.finditer(r'(?<!\d)(19[6-9]\d|20[0-2]\d)(?!\d)', fn):
        y = int(m.group(1))
        if 1960 <= y <= 2026:
            return y
    return None

rel_lines, index = [], []
with open(FILE_LIST, encoding='utf-8') as f:
    for line in f:
        ap = line.strip()
        if not ap: continue
        rel = os.path.relpath(ap, BASE).replace('\\', '/')
        rel_lines.append(rel)
        fn = os.path.basename(ap); fl = fn.lower()
        index.append({'key': rel, 'kind': kind_of(fl), 'title': title_of(fn), 'year': year_of(fn)})

with open(REL_OUT, 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(rel_lines) + '\n')

# sort: newest year first, then by kind
index.sort(key=lambda x: (-(x['year'] or 0), x['kind'], x['title']))
by_kind = {}
for it in index: by_kind[it['kind']] = by_kind.get(it['kind'], 0) + 1
years = sorted({it['year'] for it in index if it['year']})
json.dump({'_meta': {'count': len(index), 'by_kind': by_kind,
           'year_range': [years[0], years[-1]] if years else None,
           'note': 'Chamber history archive index. Image/doc keys resolve under the R2 public base URL set in history.html (R2_BASE).'},
           'items': index}, open(INDEX_OUT, 'w', encoding='utf-8'), indent=0)

print(f'rel list  -> {REL_OUT}  ({len(rel_lines)} files)')
print(f'index     -> data/history-index.json  ({len(index)} items)')
print(f'  by kind: {by_kind}')
print(f'  year range: {years[0] if years else "?"}-{years[-1] if years else "?"}  ({len([i for i in index if i["year"]])} dated)')
