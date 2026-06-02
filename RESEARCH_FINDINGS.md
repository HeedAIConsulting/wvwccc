# WVWCCC — Live Admin Research Findings

Source: read-only walkthrough of the current site + ChamberWare admin at `woodlandhillscc.net/admin/` (2026-06-01, with Michael's authorization). **No changes made.** No credentials or bulk member PII recorded here — the full roster + payment history come via The Web Corner's database export (secure migration path).

## Platform
- Current site = **ChamberWare** (PHP), built/hosted by **The Web Corner** (Rob Adams). Pages are `*.php`.
- Admin gated by login **+ IP allow-list** ("must have your IP in our firewall").
- ⚠️ **Security:** the admin dashboard prints a login credential in plaintext at the top of every page. Recommend The Web Corner remove it.

## Member directory — the real numbers
- **864 member listings** in the public directory (`new_directory.php?do=profiles`), 15/page, pagination is POST-based (not a URL param → don't scrape by `?page=`).
- Admin **Accounts** (`accounts.php`) is the system of record. Filters: **Approved / Pending / Not Active / Suspended / Featured / New Members / Ambassadors / Board of Directors**. Sortable by company / phone / email / status. Each row → `account_details.php?accounts_id=NNNNN`.
- **ChamberWare CSV column map** (from `directory_csv.php` import tool) — this is the migration schema:
  | col | field | col | field |
  |--|--|--|--|
  | 0 | category | 11 | fax |
  | 2 | company | 13 | firstname |
  | 5 | address | 14 | lastname |
  | 6 | address2 | 20 | **email** |
  | 7 | city | 21 | website |
  | 8 | state | | |
  | 9 | zip | | |
  | 10 | phone | | |
- **Migration plan:** get the full member export (incl. emails, passwords-or-hashes, join/expiration dates, tier) as a **CSV/DB dump from Rob** — he already offered to "tar the directory or rsync the database file" (May 21 thread). Do NOT browser-scrape 864 PII rows into the repo.

## Membership model
- Dues are **employee-count based** (join form asks "No. of Employees") — confirms Diana's "populate amount by employee count" requirement.
- Members self-register with **email + password** (so the "keep the same login" question hinges on whether Rob can hand over password hashes; otherwise a reset-on-first-login flow).
- Join form also captures: occupation/title, type of business, year established, up to **3 extra contacts w/ emails**, and **Committee Interest** (Special Events, Winetasting, Government, Education, Ambassadors, Marketing/PR, Programs).
- Exact dues **pricing table not exposed publicly** — get from admin/Rob. (Diana's in-kind referenced $450 annual membership.)
- Member status / leadership tiers in admin: **Ambassadors**, **Board of Directors**, Featured, New Member → maps to Diana's "status radio buttons (Leader/Board/New)".

## Real events (confirmed, through Dec 2026) — `event_listings.php`
Recurring:
- **"Start Your Month" Breakfast** — 1st-of-month, **ticketed** (Buy Tickets). Rotates venues: Corbin Bowl, **Woodland Hills Country Club**, Fogo de Chão. (Jun 3 had 31 paid.)
- **Connection Circles** — Martin's (Computer Doctor), Lee's Luncheon — monthly.
- **Networking groups** (RSVP): Dynamic Business Networking (DBN), VSRN, Home Improvement Professionals Network, Health & Wellness Resource Network, Sustainable Professionals Network.
- **Board of Directors Monthly Meeting** — monthly.
- **Ribbon cuttings** — frequent (Heaven's Hands 6/4, Green Rodent 6/8, etc.).

Signature / dated:
| Date | Event |
|--|--|
| 06/25/26 | UCC Mega Mixer @ Anheuser Busch, 5 PM |
| **07/25/26** | **GALA — "Black, White & Bold!" — 6 PM** (Ticket/Sponsor). **Ticketing opens Jun 25.** Venue/ticket tiers TBD — get from admin. |
| 09/16/26 | 20th Annual Food & Wine Event (public welcome) |
| 10/17/26 | Light the Night Walk |
| 11/14/26 | Grateful Hearts LAPD & LAFD Fundraiser / Fall Family Fair |
| 12/05/26 | Jingle in the Jungle / Menorah Lighting (w/ Tarzana Improvement Assoc.) |

Events support **RSVP** and **paid tickets** with per-event downloads ("download Tickets" / "download RSVP") — covers Diana's per-event payment/RSVP lookup.

## Payments
- **Pay Log** = `NC_payment_orders.php` (master order log, very large history). Per-event ticket/RSVP exports on the dashboard.
- Current processor relationship via "Sheryl" → **switching to AGMS (Avant Garde Marketing Solutions) on the NMI gateway** (updated 2026-06-01; supersedes Square). See `backend/payments-agms.js` + `.env.example`.

## Donations — `choose_donation_project.php`
4 projects, preset amounts **$25 / $60 / $125 / $200 / $300 / $600** + custom:
1. **Community Benefit Foundation** (cleanup supplies & equipment)
2. **Grateful Hearts** (LAPD/LAFD)
3. **Valley Asian Cultural Festival**
4. **Education** (youth + adult programs)
Admin: `donation_settings.php`.

## Jobs board
- Admin shows **Active Jobs (150)**, Pending Jobs (0), **Job Resumes (38)** → real, active jobs board to port. (`active_jobs.php`)

## Other admin surfaces (for parity / admin build)
Content Manager/Posts (news = "Valley Biz Buzz"), Calendar, **Leaders** (`listleaders.php`), Manage **Featured Listings** (`listfeaturedhome.php`), Home Page Slider, Choice Awards, School Apps (35) + School Donation (368 — a scholarship/fundraiser program), Downloads, Links, Admins.

## Public site structure (current nav)
Home · The Chamber (`payment_option.php?do=payonline`) · Our Community · Grateful Hearts · Events · Chamber Profiles (directory) · Join Now · Valley Biz Buzz (news/blog) · Dining Guide (`dine_sfv.html`) · Donate. Categories via `new_directory_categories.php`.

## Admin deep-dive — parity model (from account_details + featured listings)

**Member account record** (`account_details.php`) — the full model to recreate:
- **Account Status:** Approved Access · Pending Access · No Site Login Access
- **Donation Status (= membership tier):** none · platinum · gold · silver · bronze · supporter · friends
- **Chamber Status:** member · staff · suspended
- **Designation flags (independent Yes/No, NOT one radio):** Ambassador · Board Member · Featured Account · New Member · Post Tools (can submit posts) · Wellness Resource Network · Holiday Guide · Dine SFV
- **Profile fields:** Join Date, First/Last Name, Company, Occupation/Title, Type of Business, Year Established, Phone, Fax, Website, No. of Employees, Notes, Company Address, Billing Address, Email, Password, **Extra Contacts 1–3 + emails**.
- → Schema refinement: our `members` need a **set of boolean flags** + tier, not the single `leaderStatus` radio the v1 admin shipped. (`schema.sql` should add the flag columns; admin Members page should show toggles per flag.)

**Content model = unified "posts"** (`listfeaturedhome.php`, `addnews.php`):
- Post **types: event · page · news**. Each can be **Featured on Home Page**.
- Posts are **attributed to a member account** (members with Post Tools submit their own; chamber posts are "WVWC Chamber").
- Events track **RSVP count** and **ticket count** separately, each with a **downloadable attendee/buyer list** ("Download (N)").
- Long history (2018→present) of ribbon cuttings, monthly breakfasts, mixers, galas, expos, fundraisers — this is the content engine that keeps the home page fresh.
- → Build implication: model a single `posts` table (type, member_id, title, body, date, featured_home, rsvp_enabled, ticket_enabled, ticket_cap, rsvp_cutoff) feeding both the events calendar and home featured module.

## Still to obtain (from admin/Rob — gating items)
- [ ] Full member CSV/DB export (roster + emails + tiers + expiration dates + password hashes if possible)
- [ ] Membership dues pricing table (by employee count)
- [ ] Gala venue + ticket/sponsor tiers (for Jun 25 ticketing)
- [ ] Sponsorship tiers + pricing
- [ ] Square merchant credentials
- [ ] Leaders/Board roster + photos (about page)
- [ ] Confirm whether School Apps/Donation + Grateful Hearts + Dining Guide are in v1 parity or Phase 2
