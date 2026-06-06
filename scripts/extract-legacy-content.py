#!/usr/bin/env python3
"""Stream the big mysqldump and extract only NC_news and NC_coupons
(CREATE TABLE + INSERT lines) into small .sql files for downstream parsing.
Memory-safe: processes line by line (handles very long extended-INSERT lines)."""
import sys, io

BIG = r"E:/WVWCCOC/var/www/vhosts/woodlandhillscc.net/httpdocs/woodlandhills_db.sql"
OUT_DIR = r"E:/WVWCCOC"
TABLES = ["NC_news", "NC_coupons"]

outs = {t: open(f"{OUT_DIR}/{t}.sql", "w", encoding="utf-8", newline="\n") for t in TABLES}
create_state = None  # which table's CREATE block we're inside
counts = {t: {"create": 0, "insert": 0} for t in TABLES}

with io.open(BIG, "r", encoding="utf-8", errors="replace", newline="\n") as f:
    for line in f:
        # CREATE TABLE blocks (multi-line, end at line starting with ')')
        if create_state:
            outs[create_state].write(line)
            counts[create_state]["create"] += 1
            if line.lstrip().startswith(")"):
                create_state = None
            continue
        stripped = line.lstrip()
        matched = False
        for t in TABLES:
            if stripped.startswith(f"CREATE TABLE `{t}`"):
                create_state = t
                outs[t].write(line)
                counts[t]["create"] += 1
                matched = True
                break
            if stripped.startswith(f"INSERT INTO `{t}`"):
                outs[t].write(line)
                counts[t]["insert"] += 1
                matched = True
                break
        if matched:
            continue

for t in TABLES:
    outs[t].close()
    print(f"{t}: create_lines={counts[t]['create']} insert_lines={counts[t]['insert']} -> {OUT_DIR}/{t}.sql")
