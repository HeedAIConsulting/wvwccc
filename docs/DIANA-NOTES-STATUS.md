# Diana's "New Website Notes" — status & backlog

Cross-referenced against the live `websites/wvwccc/` build. Grouped by Diana's note
sections. Legend: ✅ done · 🟡 already built (data not yet populated) · 🔵 pending
(spec below) · ⛔ blocked (needs a decision/keys).

---

## Directory
- 🟡 **Smart/clickable (address → map, phone → dials)** — already built in both the
  directory cards (`memberTile`) and member profile pages (`tel:` + Google-Maps link).
- 🟡 **Show member photos/gallery, social links, video** — the profile page already
  renders logo, photo grid, social chips, review links, CTA buttons, and a
  YouTube/Vimeo embed when present. The imported roster just has **no media uploaded
  yet** (0 of 595 members have photos/video; 176 have social). Fills in as members
  complete their profiles.
- ✅ **Smaller boxes / quadrant layout** — directory grid tightened to ~220px min
  columns with denser tiles (`.dir-grid` in `css/chamber.css`).
- 🔵 **Ask Wendy: "French Restaurant" / "Persian Restaurant" not showing members** —
  DIAGNOSED. The **text concierge** (`/api/concierge`) works correctly: it returns
  *Deux Bistro* for "French restaurant" and *Safir Mediterranean Cuisine* for
  "Persian restaurant". The likely culprit is the **floating ElevenLabs voice widget**
  ("Ask Wendy"), which is a separate system with **no knowledge of the member
  directory** — so it can't list members. Fix is ElevenLabs-side: either give that
  agent a directory tool / knowledge base, or route the "Ask Wendy" UI to the working
  text concierge. No app code change needed.

## Home Page
- ✅ **Less green / beige around the green** — the CEO-quote band (was solid green) is
  now a warm beige editorial panel with gold accents; the hero and closing CTA stay
  green for rhythm. (Earlier: the why-join "explore the guide" panel was also moved to
  tan.) More sections can be softened on request.
- 🟡 **Leader-level logos/banner static on every page** — the tiered Leaders Wall
  already renders in the footer of every public page (`initLeaderBanner`).
- 🔵 **Choose which events populate the home page + set their order** — TODAY: each
  event has a "Feature on homepage" checkbox and featured events float to the top
  (max 4). MISSING: an explicit **order** control. Spec: add a `homeOrder` number to
  events (like the new hero-slider `meta.sortOrder`), an admin reorder UI on the
  events list, and have `initHome` sort featured events by `homeOrder`. ~Half a day.

## The Chamber dropdown
- ✅ **Individual pages for Leaders, Board of Directors, Ambassadors** — `initBoard`
  now reads `?group=` and renders a sub-nav; each group is its own deep-linkable view
  (`leadership.html?group=Board%20Member`, `?group=Ambassador`, `?group=Leader`), and
  the three are linked in the "About & Membership" nav dropdown.
- ✅ **Click through to view profile** — each leader card already links to the member's
  full profile ("View profile →").

## Members (member-side)
- 🔵 **Members create their own events (email RSVP, no on-site selling)** — NOT built.
  Spec: member-portal event form (title/date/venue/flyer/summary), approval-gated,
  RSVPs delivered to the member's email; an external ticket link (their Eventbrite) is
  pasted in, no payment on our site. Reuses the admin event model + the existing
  approval gate. ~1–2 days.
- 🔵 **Profile quadrants: Accomplishments / Services / Associations** (à la Sheryl
  Tratner) — TODAY profiles have a single "description". Spec: add structured
  multi-paragraph fields (`headline`, `about`, `services`, `accomplishments`,
  `associations`) to the member edit form + profile render. ~Half a day.

## Administration — Adding events
- 🔵 **Ticket table (Name / Price / Quantity / Available / Delete-row) + RSVP /
  Buy-Tickets / sponsorship radials** — NOT built (depends on the payments decision
  below). The admin event form has a single "ticketed" flag + cap today.
- 🔵 **Cutoff date auto-removes the event after it passes** — partial: events carry an
  `rsvpCutoff` date; add logic to drop past/expired events from the calendar + home.
- 🔵 **Two image uploads: Main Flyer + Thumbnail** — TODAY: up to 3 generic images.
  Spec: distinct `flyer` (detail/portrait) + `thumbnail` (square card) fields.
- 🔵 **Per-event text quadrant for custom home-page copy** — new `homeBlurb` field.
- 🔵 **Calendar-view yes/no toggle** per event — new `showOnCalendar` flag.
- 🔵 **Upload 3 PDFs at the bottom** (donation form, sponsorship levels…) — new
  `documents[]` (PDF upload → links on the event detail/modal).
- 🔵 **See per-event RSVP / payment counts** — depends on RSVP + checkout existing.
- ✅ **Home-page radial (feature) option** — exists ("Feature on homepage" toggle);
  and the events PAGE now visibly badges + floats featured events (this session's bug
  fix — see below).

## Payments
- 🟡 **Payment Log on the admin side** — already built (Admin → Pay Log / `initOrders`).
- 🔵 **Receipt to customer + felicia@woodlandhillscc.net on payment** — pending
  checkout (transactional email pipeline still being finalized — M365 admin access
  needed; see `wvwccc-email-setup`).
- 🔵 **Capture Name / Company / Phone / Email / full billing address at checkout** —
  pending the checkout build.
- 🔵 **Buy more than one ticket at point of sale** — pending checkout (multi-item cart
  via AGMS).

## ⛔ The three ways to pay — BLOCKED ON A DECISION
Diana's notes ask for **"Join Online"** and **"Renew Online"** (custom dollar amount)
buttons. This **contradicts the Jun 17 locked decision**: *"memberships are office-only
— route all join CTAs to the application form"* (shipped in commit `2ac9171`). These
can't both be true. **Need Diana's call:**
- Does she now want online membership join/renew payments after all? or
- Are "Join/Renew Online" only for the renew-with-custom-amount flow for existing
  members, with new joins still office-only?

Until that's resolved I won't build the online-join/renew payment paths (they'd undo a
signed decision). The **event-ticket** checkout and **donation** custom-amount paths
are not blocked by this — they're blocked only on AGMS/NMI keys + the checkout build.

- 🔵 **"Chamber Connect" widget** (contact / join email list / join chamber, like the
  current site's home page) — new combined opt-in widget. Doable independently.

---

## Shipped this session (committed to branch `claude/rebuild-chamber-website-LXSM5`)
1. **Events "featured" placement bug FIX** — featured events were invisible on the
   events page (sorted purely chronologically, no badge). Now: featured events float
   to the top and show a "★ Featured" badge (`eventCard` + `eventPreviewCard`); home
   already did featured-first. NOTE: there were **0 events marked featured** in the
   data, so nothing was showing — staff need to toggle "Feature on homepage" on the
   events they want surfaced.
2. Leaders / Board / Ambassadors deep-linkable pages + dropdown links.
3. Home CEO-quote band recolored beige (less green).
4. Denser "quadrant" directory grid.
5. Wendy cuisine search diagnosed (text concierge works; ElevenLabs widget is the gap).

Plus the earlier Jun-17 batch (#1–6): homepage "6 communities", admin logout, PDF
flyer + square-image notes, lighter why-join panel, Wendy orb recolor + close button,
admin hero-slider manager.

## Recommended next order of work
1. **Resolve the Join/Renew-Online payment conflict** (unblocks the biggest chunk).
2. Event home-page selection **ordering** + the admin event-form additions (flyer vs
   thumbnail, home blurb, calendar toggle, 3 PDFs, cutoff auto-removal).
3. Member-side event creation (email RSVP) + profile quadrants.
4. Event-ticket checkout (ticket table, multi-ticket, billing capture, receipts) once
   AGMS keys are in hand.
