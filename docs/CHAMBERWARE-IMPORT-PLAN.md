# ChamberWare → website: import plan & field map

Goal: absorb ChamberWare's data model and obsolete its desktop workflow. The export
is the migration path. This doc maps the export to our schema, lists what's already
handled vs. what's new, and gives a turnkey runbook for when Scott hands over the file.

## What to ask Scott for (export scope)
Get the **full export, not just the directory slice**:
- **Members/accounts** (companies) — all fields, all status codes (not just Active).
- **Representatives** (contacts) per company, if exportable separately.
- **Classifications / categories** (and any NAICS/USCC codes).
- **Financial history / dues** if exportable (even read-only is useful).
- Format: **CSV** is ideal (one row per record). If ChamberWare can only do its
  "Auto Web-Site Generator" HTML, we can still parse it, but CSV is far cleaner.

## Importer status (what's already built)
`scripts/import-chamberware.js` now reads **CSV _or_ MySQL dump** (auto-detected).
It parses the file, learns the columns, fuzzy-maps them to our schema, and writes
`data/_store/members.json` + `users.json` (gitignored; PII never web-served).

Runbook when the export arrives:
```
# 1) See what's in it (no files written)
node scripts/import-chamberware.js <export.csv> --discover

# 2) Import (auto-detects CSV/SQL; pick the table for multi-table SQL dumps)
node scripts/import-chamberware.js <export.csv>            # CSV: single table
node scripts/import-chamberware.js <dump.sql> --table accounts

# 3) Review data/_store/members.json + users.json, then load into Postgres
#    (loader step — see scripts/README-import.md). On Render: run from a Shell
#    with DATABASE_URL set, or load locally and push.
```
The fuzzy aliases already cover the confirmed ChamberWare columns: company, category,
address, address2, city, state, zip, phone, fax, firstname, lastname, email, website,
status, tier, leader, employees, year, tagline, description, join/expire dates, id.

## Field map (ChamberWare export → our schema)
Auto-mapped today (single-rep, directory + login):

| ChamberWare | → our field (members/users) | Notes |
|---|---|---|
| Account ID | `members.id` (`m<id>`) | stable key; also links `users.member_id` |
| Company | `name` | required |
| Classification/Category | `category` (+ `tags`) | primary listing facet |
| Address/Address2, City, State, Zip | `address`, `city`, `state`, `zip` | location address |
| Phone, Fax, Website | `phone`, `fax`, `website` | clickable in directory |
| First+Last (main rep) | `contact_name` | primary rep only (see gap below) |
| Email | `users.email` + private `members.email` | login + private contact |
| Password hash (if present) | `users.password_hash` + algo detect | keep-same-login; unknown → reset on first login |
| Status code | `members.status` (mapped) | see status-code gap below |
| Membership level | `tier` | platinum/gold/silver/bronze/supporter/member |
| Leader/Board/Ambassador | `leader_status` | drives Leaders/Board/Ambassadors pages |
| Employees, Year established | `employees`, `year_established` | shown on profile |
| Join / Expire (paid-through) | `join_date`, `expire_date` | drives renewals dashboard |

## Gaps — ChamberWare features not yet modeled (decisions needed)
1. **Multiple representatives per company.** ChamberWare allows many reps each with
   their own address + contact prefs. We store one `contact_name` today.
   - *Proposal:* import the **main rep now**; add a `reps` array (jsonb on the member
     record / `member_profiles`) in Phase 2 for the rest. **Decision: import primary
     rep only for launch?** (recommended) or build multi-rep now.
2. **Three address types (location / mailing / billing).** We use one (location, for
   the directory). Mailing/billing matter for **dues invoicing**.
   - *Proposal:* keep mailing/billing in a jsonb `billing` bag on import so they're
     ready when the dues module lands; directory keeps showing the location address.
3. **Status codes (Active / Courtesy / Dropped / Prospective / Trade-Out).** We map to
   approved/pending/suspended/inactive — which **loses the original code** that drives
   billing + lapsed-member re-engagement (Wendy's targeting).
   - *Proposal:* preserve the raw code (e.g. `cwStatus`) alongside the mapped status so
     "Dropped"/"Prospective" can drive re-engagement campaigns. **Low effort, high value.**
4. **Custom fields (20+/member, 16+/rep) + NAICS/USCC codes.**
   - *Proposal:* dump unmapped columns into a jsonb `custom` bag on import (lossless),
     surface the useful ones later. Nothing is thrown away.
5. **Financial history / automatic dues invoicing.** NOT built. `orders` only logs
   AGMS payments. This is the big one and it's **gated on the still-open decision:**
   online join/renew payments vs. office-only (see DIANA-NOTES-STATUS.md). The renewals
   dashboard (30/60/90 + expire dates) already exists and will light up from import.
6. **Comm preference per rep, notes/comments, tickler/prospecting CRM.** Later phase.

## Recommended sequence
1. **Now (done):** CSV import support + this map.
2. **On export day:** `--discover` → confirm columns → import → review `_store` → load
   to Postgres. Directory, logins, tiers, leader designations, and the renewals
   dashboard all populate from this.
3. **Fast follow (low effort):** preserve raw status codes (#3) + custom-field bag (#4)
   so nothing is lost and re-engagement targeting works.
4. **Phase 2 (needs decisions/keys):** dues/financial module (#5, after the payments
   decision + AGMS keys), multi-rep (#1), billing addresses (#2).

## Decisions needed from Michael/Diana
- **Reps:** import primary rep only for launch (recommended), or build multi-rep now?
- **Status codes:** confirm the mapping — which ChamberWare codes show in the directory
  (Active, Courtesy?) vs. hidden (Dropped, Prospective, Trade-Out)?
- **Dues/financial:** in scope for this phase, or after the online-payments decision?
- **Passwords:** does the export include member password hashes (keep-same-login), or
  will all members set a password via the new reset/set-password flow?
