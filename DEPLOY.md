# WVWCCC — Production Deployment Runbook

Single Render **web service** (Express serves the static site + the `/api`) backed by a
Render **Postgres**. Auth is custom (bcrypt + JWT cookies) so migrated ChamberWare members
keep their existing logins.

Legend: 🔧 = code/config (done, in repo) · 👤 = **you** must do (account / credential / DNS).

---

## 1. Provision (👤)
1. **Render account** with access to the `Heedbusinesssolutions` repo.
2. New → **Blueprint** → point at `websites/wvwccc/render.yaml`. It creates:
   - `wvwccc-db` (Postgres 16)
   - `wvwccc-production` (Node web service, Standard plan)
3. Set the **secret** env vars (marked `sync:false`) in the Render dashboard:
   - `GEMINI_API_KEY` (Heed key) · `ANTHROPIC_API_KEY` (optional)
   - `AGMS_SECURITY_KEY` (gateway → Settings → Security Keys — start with the **sandbox** key)
   - `AGMS_API_BASE` = `https://sandbox.nmi.com` (switch to `https://agms.transactiongateway.com` for live)
   - `DATABASE_URL` and `JWT_SECRET` are wired automatically by the blueprint.

## 2. Migrate + first deploy (🔧 automatic)
- `preDeployCommand: npm run migrate` applies `backend/schema.sql` before traffic flips.
- Health check: `/healthz`.

## 3. Create the staff/admin logins (👤, one-time)
From a Render Shell on the service (or locally with `DATABASE_URL` set):
```
node scripts/create-staff.js diana@woodlandhillscc.net '<strong password>' 'Diana Williams'
node scripts/create-staff.js felicia@woodlandhillscc.net '<strong password>' 'Felicia Paust'
```
Then sign in at `/auth/staff-login.html` → `/admin/`.

## 4. Import the existing members + logins (👤 supplies file)
When Rob sends `woodlandhills_db.sql`:
```
node scripts/import-chamberware.js scripts/woodlandhills_db.sql --discover   # confirm mapping
node scripts/import-chamberware.js scripts/woodlandhills_db.sql              # → data/_store/*.json
# then load the store into Postgres (loader step — see scripts/README-import.md)
```
Members + usernames + profiles migrate; most members keep their password (legacy hash is
verified, then upgraded to bcrypt on first login). Unknown-hash accounts get a reset.

## 5. Payments go-live (👤 keys, then 🔧)
1. Test in **sandbox** first: set `AGMS_SECURITY_KEY` (sandbox) + the Collect.js **tokenization
   key** in `checkout.html` → `WVWCCC_PAY.tokenizationKey`. Run a $1 test ticket/donation.
2. Flip to **production**: production `AGMS_SECURITY_KEY` + `AGMS_API_BASE` = the live gateway,
   and the production tokenization key. Confirm a real charge + refund.
3. Receipts to payer + `felicia@woodlandhillscc.net` and the 15% remittance log wire in with
   M365 (Phase 3).

## 6. DNS cutover (👤 — do last, after sign-off)
- Point apex `woodlandhillscc.net` + `www` at the Render service (CNAME/ALIAS per Render's
  custom-domain instructions). SSL auto-issues.
- **Keep MX / email DNS unchanged** — only the website host moves. Verify mail still flows.
- The current ChamberWare/The-Web-Corner site stays up until cutover is confirmed.

## 7. Monitoring & hardening (🔧 scaffolding / 👤 IDs)
- Add GA4 + Microsoft Clarity snippets (IDs from you), Sentry (`SENTRY_DSN`), UptimeRobot on `/healthz`.
- Postgres daily backups (Render setting), 30-day retention.
- Tune a Content-Security-Policy (currently disabled in `server.js`).
- Rotate any credential shared in chat.

---

## Launch checklist
- [ ] Blueprint deployed; `/healthz` green; migrations applied
- [ ] Staff logins created; `/admin/` reachable only when signed in
- [ ] `woodlandhills_db.sql` imported; member count ≈ matches admin (~864); spot-checked
- [ ] AGMS sandbox tested → production keys in; real charge + refund verified
- [ ] Receipts + 15% remittance logging on
- [ ] Real social handles, Gala venue/ticket tiers, dues table confirmed
- [ ] Spanish `/es/` reviewed by a native speaker
- [ ] GA4 / Clarity / Sentry / UptimeRobot wired
- [ ] Postgres backups on
- [ ] DNS cutover (MX preserved); SSL issued
- [ ] Privacy + Terms legal-reviewed
