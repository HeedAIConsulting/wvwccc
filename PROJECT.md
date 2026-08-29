# WVWCCC — Production Build (status)

## 🟢 LIVE: https://wvwccc-web.onrender.com
Render Web Service `wvwccc-web` (srv-d8f8pci8qa3s738nsib0) + Postgres `wvwccc-db`, Oregon, from repo **HeedAIConsulting/wvwccc** branch `main` (standalone repo; subtree of `websites/wvwccc`). Migration applied, auth live, verified (/healthz, members API, admin 401, _store 403, HSTS). The old `srv-d8f88m42m8qs73dvgekg` was a Static Site — unused.
**Durability:** ✅ DONE — auth users, leads, orders, member admin-overrides, AND member self-edits all persist to **Postgres** (via `backend/repo.js`; JSON store only in dev). Verified live.
**Member portal:** ✅ DONE — `/member/` (dashboard, edit listing, change password). Members edit their own directory profile (`/api/me`, `/api/me/profile`); edits merge into the public directory (base < member edits < admin overrides). Create member logins with `scripts/create-member.js`.
**Rich profiles + content + AI (2026-06-02):** ✅ DONE & live —
- Detailed profiles: logo + photos (Postgres `assets` store, served `/api/assets/:id`), social links, CTA buttons, Google/Yelp review links, occupation/type/year/employees/hours.
- Member **offers/discounts** + **member-to-member community posts** (`posts` table) with **admin approval gate**. Public **Deals** page + **Community** board; offers also render on member profiles.
- Admin **Content console** (`admin/content.html`): create news/announcements/messaging + approve/reject/feature/delete; `pendingPosts` on dashboard.
- **ElevenLabs ConvAI** agent `agent_8201kqnjhzyrfpdvtqwgf9e0034y` on all public pages (pulled from POC).
- Nav adds Deals + Community.

**Felicia + Diana, 2026-08-27/28:** ✅ built
- *Chamber Leaders page retired* (Diana: "take this page down") — off the
  menu and the admin sidebar, `/leaders.html` 301s to `/about.html` so the
  indexed URL doesn't dead-end. Tier still doubles as the Leader level for
  the office's own records.
- *Full category set imported* (Felicia's "ALL CATEGORIES and Join Date"
  export): 558 of 607 members matched, 71 now carry 2–3 categories in
  `categories[]`, which the directory filter and Wendy already search — so a
  caterer that is also a banquet hall is findable as both.
  `scripts/import-directory-categories.py`. Join dates are **fill-only**:
  549/555 already agreed, and the 6 that differ are the duplicate-company
  rows the export itself flags, so the site's dates stand.
- *Fewer categories to browse:* the category picker is now two-tier — the ~20
  broad types lead, the ~250 specific ones sit underneath (both still filter).
- *Taxonomy de-duplicated + a real bug fixed:* the group keywords moved to
  `data/category-groups.json`, shared by the importer and
  `scripts/categorize-members.js`. `keywords` now match at a word start and a
  new `exact` list matches whole words only. Plain substring matching had put
  **14 listings** in the wrong section: four newspapers AND four "Office Space
  Leasing" suites under Beauty & Personal Care (`spa`), "Retirement Plans"
  under Automotive (`tire`), three "Transportation" under Fitness (`sport`),
  "Environmental Consultant" (`mental`) and a plant "Nursery" (`nurs`) under
  Health. The fallback that kept a member's stored group when nothing matched
  was also dropped — it was preserving exactly these stale wrong values, which
  made the fix a no-op for the four newspapers.
- *New `Media & Press` group:* the 23 newspaper/magazine/TV/radio members had
  nowhere to sit and were nearly all in "Other". With that plus keyword gaps
  filled (credit, party, heating/HVAC, nursery), **"Other" fell 109 → 81**.
- *Education Committee:* leader Damon Buford, 4th Thursday 9 AM. The add-only
  group seed now also backfills a leader name and replaces the "contact the
  office" placeholder schedule — but never a time the office set in admin.

**Mixer feedback batch (2026-08-27):** ✅ built — Felicia's "Update Requests
from Members and Us" (member feedback from the Aug 26 mixer):
- *Member-to-member messaging:* there wasn't one (directory strips emails on
  purpose). `POST /api/members/:id/message` relays it server-side — signed-in
  senders only, recipient's address never exposed, Reply-To back to the
  sender, 5/hr rate limit, logged to Admin → Inquiries. "✉️ Message this
  member" on every profile. Tests: `backend/test/member-message.test.mjs`.
- *Nav restructure:* Community dropdown keeps only Our Community + the three
  recovered pages; everything else (Groups, Community Board, Gallery, Biz
  Buzz, Podcast, Magazine, CBF, Grateful Hearts, History) moved under The
  Chamber. "Groups & Networks" renamed **Groups & Connection Circles**
  everywhere (nav, footer, page, support topics).
- *Groups roster:* audited against the office's "Networks and Committees
  2026" flyer; added the 9 missing (Table for Six, Food & Wine, Installation,
  Golf, UCC Government Affairs, Ambassador, Membership, Education,
  Beautification committees) — seed is add-only into the live store, so they
  appear on deploy without touching admin edits. Flags for the office: three
  circle names differ site-vs-flyer; Event Planning & Hospitality is on the
  site but not the flyer. **Resolved 2026-08-27** — Felicia confirmed the
  Education Committee's duplicate flyer entries: Damon Buford, 4th Thursday
  9 AM is the current one.
- *Old-site pages recovered from the Wayback Machine:* Important Phone
  Numbers (full A–Z + hotlines + officials, searchable), Candy Cane Lane,
  Demographics → `community/phone-numbers.html`, `candy-cane-lane.html`,
  `demographics.html`. Officials/numbers are as last published on the old
  site — page invites corrections to the office.
Cache-busts: partials.js + chamber.js → 20260827a.

**Felicia's Aug 26 pair (2026-08-26):** ✅ built —
- *Action buttons at the top:* the event page's RSVP / Get tickets buttons
  (plus the members-free hint) moved from the foot to directly under the
  date/venue, above the flyer and description (`ev-card__cta--top`).
- *"Gaspar logo pixelated":* the stored upload was a crisp 1800×900 PNG —
  the crunch was the browser squeezing it to 252px in one step (aliases fine
  halftone detail). `/api/assets/:id?w=<px>` now serves properly filtered
  downscaled renders via mupdf (`backend/images.js`, ladder-snapped +
  LRU-cached, GIFs and would-be upscales pass through untouched); event
  pages request ~2× the CSS size for description images, flyers, covers, and
  sponsor logos. Tests: `backend/test/asset-resize.test.mjs`. Verified
  headless-Chromium side-by-side (one-step 1800→252 vs pre-scaled render).

**Two representatives per account (2026-08-26):** ✅ built — Felicia's Aug 25
"Member Profile Question" ("some accounts have 2 admins working on their
profiles"). A member listing can carry several logins: one per rep, each with
their own email + password, all opening the same profile. Admin → Members →
**🔑 Logins** manages them (add a second rep, per-rep view-as / sign-in /
reset links / set password, remove one who left). Force-reset and
email-change are per-login now — resetting one rep no longer locks out the
other, and changing the listing email no longer trips the unique-email
constraint when two logins exist. Staff emails can't be attached as member
sign-ins (used to silently wipe the staff password). Tests:
`backend/test/two-rep-logins.test.mjs`.


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
| **AGMS** webhooks + emailed receipts | ⬜ Phase 3 |
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
