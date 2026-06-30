# ChamberWare → Production import

Migrates the existing member **database, usernames, and profiles** from the current
ChamberWare site into the new platform.

## What you need
`woodlandhills_db.sql` — the MySQL dump from Rob / The Web Corner (he offered to
"tar the directory or rsync the database file"). Save it anywhere, e.g.
`scripts/woodlandhills_db.sql` (it's gitignored as `*.sql` is not — see note below).

> ⚠️ The dump contains member PII (emails) and password hashes. Keep it out of git.
> The importer's **output** goes to `data/_store/` which **is** gitignored.

## Run it
```bash
# 1) See what's in the dump (tables + columns) — no files written:
node scripts/import-chamberware.js scripts/woodlandhills_db.sql --discover

# 2) Import (auto-picks the members/accounts table, or force it):
node scripts/import-chamberware.js scripts/woodlandhills_db.sql
node scripts/import-chamberware.js scripts/woodlandhills_db.sql --table accounts
```

Outputs (gitignored, never web-served):
- `data/_store/members.json` — directory + profile data → served publicly via `/api/members` (display fields only)
- `data/_store/users.json` — auth: email/username + **legacy password hash** + detected algo → **server-only**

The site switches from the seed roster to the imported roster automatically once
`data/_store/members.json` exists (the "Preview roster" badge disappears).

## How fields are mapped
The dump's exact table/column names aren't assumed. The importer reads each
`CREATE TABLE` to learn columns, then maps them to our schema by **fuzzy name match**
(see `FIELD_ALIASES`), aligned with the ChamberWare CSV column map confirmed in the
admin (category, company, address, city, state, zip, phone, fax, firstname, lastname,
email, website). Run `--discover` and eyeball the printed column map; adjust
`FIELD_ALIASES` if a column isn't picked up.

## Usernames & "keep the same login" (Diana's question)
For each account with an email/username we record `passwordHash` + `passwordAlgo`
(bcrypt / md5 / sha1 / sha256 / unknown). The login flow (built in hardening) will:

1. **Verify against the legacy hash** using the detected algorithm.
2. On first successful login, **re-hash to bcrypt** and clear the legacy hash
   (transparent upgrade — the member keeps their existing email + password).
3. If `needsReset` is true (no hash, or `passwordAlgo: "unknown"`), the member gets a
   one-time **set-a-password** email instead. Their username/email and profile still
   migrate; only the password is reset.

This means **most members keep their existing login**; only accounts with an
unrecognized hash format need a reset.

## After import (production hardening)
- **Load the member logins into Postgres** — REQUIRED before go-live. `npm run migrate`
  only creates the schema; it does not seed users. Because `data/_store/` is gitignored,
  run the loader from the machine that has the store, with `DATABASE_URL` pointed at the
  Render Postgres:
  ```bash
  node scripts/load-users-to-pg.js --dry-run                 # preview counts (writes nothing)
  DATABASE_URL="<render external url>" node scripts/load-users-to-pg.js
  ```
  Until this runs the prod `users` table is empty — no member can sign in and
  "Forgot password" has nobody to email.
- Verify counts against the admin (≈864 members).
- Spot-check a few profiles against the live site.
- Confirm reset email actually sends: as an admin, hit `GET /api/admin/email-test?to=you@…`
  — it reports which provider is live (Resend / Graph / SMTP) or `none`. If `none`, set
  `RESEND_API_KEY` (or MS Graph / SMTP creds) on Render or reset links never leave the box.
