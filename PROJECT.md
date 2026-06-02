# WVWCCC — Production Build (status)

## 🟢 LIVE: https://wvwccc-web.onrender.com
Render Web Service `wvwccc-web` (srv-d8f8pci8qa3s738nsib0) + Postgres `wvwccc-db`, Oregon, from repo **HeedAIConsulting/wvwccc** branch `main` (standalone repo; subtree of `websites/wvwccc`). Migration applied, auth live, verified (/healthz, members API, admin 401, _store 403, HSTS). The old `srv-d8f88m42m8qs73dvgekg` was a Static Site — unused.
**Durability:** ✅ DONE — auth users, leads, orders, member admin-overrides, AND member self-edits all persist to **Postgres** (via `backend/repo.js`; JSON store only in dev). Verified live.
**Member portal:** ✅ DONE — `/member/` (dashboard, edit listing, change password). Members edit their own directory profile (`/api/me`, `/api/me/profile`); edits merge into the public directory (base < member edits < admin overrides). Create member logins with `scripts/create-member.js`.


**West Valley · Warner Center Chamber of Commerce** — production platform.
Owner: Michael Bowers / Heed Business Solutions · Client: Diana Williams (CEO).
Fresh codebase. The POC stays intact at `websites/WVchamber/` (do not touch).

## The deal (signed 2026-05-26)
- **$4,000 build + $95/mo** all-in (hosting + support + AI Concierge) → restructured **3 × $1,423** (launch / Jul 1 / Aug 1), with $870 in-kind (annual membership + breakfast package).
- Processor: **AGMS (Avant Garde Marketing Solutions) on the NMI gateway** — Eduardo Yumet, updated 2026-06-01 (supersedes the earlier Square recommendation; Sheryl's platform dropped). Gateway login `heedaisolutions` @ agms.transactiongateway.com; sandbox @ sandbox.nmi.com. **ADA included, no fee.** **IP owned by the Chamber.**
- **Timeline:** build complete **Jun 15** · launch **Jun 22** · **Gala ticketing live Jun 25** · fiscal-year launch **Jul 1, 2026**.

## Scope decisions (locked with Michael, 2026-06-01)
- **v1 = signed parity only.** Directory · member profiles · events + ticketing · jobs board · donations · full admin · AI Concierge · AGMS/NMI payments. Guides/blog/community/sponsorship-marketplace + the strategy-master "Local Feed" → **Phase 2**.
- **Homepage:** distinctive parity hero (built) — not the Local Feed yet.
- **Languages at launch:** **English + Spanish.** Spanish needs a native-reviewer pass before going public. Other languages (KO/FA/HY/RU/UK/ZH) phased post-launch.

## Stack (per chamber-of-commerce-site skill — do not deviate)
Pure HTML/CSS/vanilla JS frontend · Node 18 + Express (`server.js`) · Render **Standard** (not free) · **AGMS/NMI** payments (`backend/payments-agms.js`, Collect.js tokenization, SAQ-A) · Gemini Flash → Anthropic fallback for Concierge · Postgres + real auth before public launch (JSON files for now). Member roster migrates from **`woodlandhills_db.sql`** (Rob / The Web Corner).

## Design system — "Civic Editorial" (heritage green)
Real WVWCCC brand sampled from the chamber's circular "Since 1930" seal: **forest green** `--green-deep #1E5631` / `--green #3A8A3F` + **antique gold** accent `#C9A227`, warm cream paper. Real logo at `images/wvwccc-logo.png` (header/footer brand seal).
Fonts: **Fraunces** (display) × **Hanken Grotesk** (body) × Spline Sans Mono (labels). Gold hairlines, subtle paper grain, heritage century-arc in hero.

## Build status
| Area | State |
|---|---|
| Scaffold (package.json, server.js, render.yaml, .gitignore) | ✅ done |
| `css/chamber.css` design system | ✅ done |
| `js/partials.js` (header/footer, EN/ES switch, real contact) | ✅ done |
| `js/chamber.js`, `js/api-base.js` | ✅ done |
| `index.html` homepage (hero, featured members/events, CTAs) | ✅ done + **verified rendering** |
| `data/directory.json` | ⚠️ verified-real anchors only — **needs ChamberWare export** |
| `data/events.json` | ⚠️ placeholder — **needs confirmed dates 60d fwd + Gala details** |
| Directory page (search, facets, geo sort, tiers) | ✅ done + verified |
| Member profile page | ✅ done + verified |
| Events page (chronological list + month grid) | ✅ done + verified |
| AGMS/NMI checkout (Collect.js + `/api/pay`) | ✅ scaffolded — needs sandbox keys to transact |
| Donate page (4 real projects → checkout) | ✅ done + verified |
| Join page (application → membership checkout) | ✅ done + verified |
| Jobs board (UI + honest import notice) | ✅ done + verified |
| Contact page + `/api/contact` notifications | ✅ done + verified (endpoint returns ok) |
| About / 404 / Accessibility / Privacy pages | ✅ done |
| **ChamberWare import pipeline** (users + profiles) | ✅ built + verified on fixture — `scripts/import-chamberware.js` |
| `/api/members` (serves import store→seed, PII-safe) + `_store` 403 block | ✅ done + verified |
| Postgres schema (`backend/schema.sql`) | ✅ drafted |
| Run real import from `woodlandhills_db.sql` (~864 members) | ⬜ on Rob's export |
| Admin console — dashboard, members (status radios + featured), approvals, pay log, inquiries, events | ✅ done + verified |
| **Real auth** — bcrypt + JWT cookies, staff + member login, legacy-hash keep-same-login | ✅ done + verified |
| Admin console protected (page redirect + API 401/403) | ✅ done + verified |
| Security — helmet headers, rate limiting, cookie-parser, trust proxy | ✅ done |
| **Postgres layer** (`backend/db.js`, `schema.sql`, `npm run migrate`) + user repo | ✅ done — activates on `DATABASE_URL` (dev falls back to JSON store) |
| Deploy blueprint (`render.yaml` w/ Postgres) + runbook (`DEPLOY.md`) | ✅ done |
| Provision Render + Postgres, set secrets, DNS cutover | ⬜ 👤 you — see DEPLOY.md |
| Load `_store` → Postgres after import; M365 receipts/notifications | ⬜ Phase 3 |
| Monitoring (GA4 / Clarity / Sentry / UptimeRobot) | ⬜ needs IDs |
| Tuned CSP (currently disabled) | ⬜ hardening |
| Spanish `/es/` + hreflang | ⬜ next |
| **AGMS** webhooks + emailed receipts (15% remit) | ⬜ Phase 3 |
| Auth + login (keep-same-login: verify legacy hash → rehash) + Postgres load | ⬜ hardening |

## ⚠️ Data integrity (critical)
The POC `members.json` mixed **real businesses with fabricated `(818) 555-01xx` entries** (Ethos Fitness, Serenity Valley Spa, Valley Master Plumbing, Tarzana Family Dental, KinderGym, Warner Center CPA, The Computer Doctor, Lee's Hoagie House). **Those were removed.** Production seed = verifiable-real anchors only. NEVER carry fabricated member/contact/social data forward. Social links omitted until handles are verified by visiting each account.

## Diana's "Important website features" (contractual — May 20)
Payments: auto receipts to payee + felicia@; per-event payment/RSVP lookup; master pay log; employee-count dues OR manual amount; ticket caps.
Members: member-built profiles (events/discounts/photos); featured-member → homepage; admin status radios (Leader/Board/New); ChamberWare sync.
Home: admin-managed featured listings/events.
Other: approve members + community events pre-post; contact/inquiry notifications; time-bound RSVPs auto-drop off calendar; **two public calendar views (chronological + month)**.

## Run locally
```
cd websites/wvwccc
npm install
npm start   # http://localhost:5500
```

## Outstanding inputs
- **`woodlandhills_db.sql`** — full member DB export from Rob / The Web Corner (roster, emails, tiers, renewal dates; password hashes if possible). *Link pending.*
- Gala (07/25) venue + ticket/sponsor tiers (for the June 25 ticketing go-live)
- Membership dues pricing table (by employee count)
- **AGMS sandbox Security Key** + Collect.js tokenization key (from the gateway → Settings → Security Keys)
- Verified social handles · Board/Leaders roster + photos · Spanish native reviewer
- (Heads-up to Web Corner: the ChamberWare admin prints a login credential in plaintext.)
