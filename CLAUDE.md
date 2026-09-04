# WVWCCC — project context

Website for the **West Valley~Warner Center Chamber of Commerce**
(woodlandhillscc.net). Built and run by Heed AI Solutions (Michael Bowers).
Deployed on Render, auto-deploys from `main`.

**Client contacts:** Diana Williams (CEO, diana@woodlandhillscc.net) and
Felicia Paust (Executive Assistant, felicia@woodlandhillscc.net — day-to-day
contact). Both are `role: staff` in the users table with `member_id = NULL`;
a staff login is deliberately not attached to any member listing.

## Stack

Node 18+ ESM, Express, no build step, `npm start`. Hybrid storage: Render
Postgres via `DATABASE_URL`, JSON files under gitignored `data/_store/`
otherwise. `npm test` runs `backend/test/*.test.mjs`.

## The office must be able to do it themselves

**This is the first thing to check on any client request.** Michael is support,
not a step in the workflow. If a request could be answered either by doing the
thing or by showing the office where to do it, show them — and if the site has
no way for them to do it, that is usually the actual work.

So: never answer with "send it to me and I'll put it up", never make a client
email the mechanism, and never build something only reachable by a developer.
Concrete examples already built to this rule:

- **Newsletters** — Admin → Content → Newsletters. They paste a Google Drive
  link and the server downloads, shrinks and covers it. Built after a 49MB
  Canva export made "email me the PDF" fail.
- **Videos** — Admin → Content → Publish, Type = Video, paste a YouTube/Vimeo
  link (Videos page); the same link in Admin → Homepage popup → Video link
  plays it in the popup. Built Sep 2026 because Diana had the welcome video and
  no way to publish it herself.
- **Group rosters** — Admin → Groups → Manage, search the directory and click.
- **Member team/reps** — the member does it in their own portal under
  "Meet the team".

When writing to the client, give numbered steps naming what they will actually
see on screen, and check the labels in the admin HTML rather than guessing.

## Writing to Diana and Felicia

- Plain, direct, human. Not a status report, and not bullet-point scaffolding
  where prose reads better.
- No apologies, no "that one is on me", no throat-clearing. State what happened
  and what is true now.
- Do not pad the ask list with reassurance ("nothing is broken while these
  sit"). Ask the question.
- Captions and client-approved copy are verbatim — never reword without asking.
- Anything sent to a client is drafted in Gmail for Michael to send, not sent
  directly. **Updating a Gmail draft detaches it from its thread** — delete and
  recreate with `replyToMessageId` instead.
- `search_threads` returns only a preview of a thread's oldest messages. Always
  `get_thread` before concluding what is unanswered; a reply was missed this way
  on 2026-09-02.

## Verify against production, not against a local assumption

Work is not done at a merged PR. Merge, watch the Render deploy, then check the
live site or the production DB. Render's `query_render_postgres` is READ-ONLY —
there is no direct write path to production, so data changes ship as guarded
one-time migrations (see below).

Two traps that have both bitten:

- **The public API strips member emails.** Seeding a local store from
  `/api/groups` gives group records with no leader addresses, which silently
  breaks email-routing tests. Use the seed files or the DB.
- **Bump the `?v=` cache-buster** on `js/chamber.js` / `js/partials.js` when
  either changes, across every HTML file. A returning visitor otherwise runs
  cached JS against new pages.

## One-time migrations

Data corrections run once, keyed by a settings marker
(`legacyEventsMerge-20260711`, `flyerCorrections-20260831`,
`eventGroupHosts-20260904`). Guard each field so it only changes when the live
value is still exactly the stale one — never stomp an edit the office has made.

**`ensureEventsSeeded()` returns early on a fresh store**, skipping every
migration in the chain. A migration that must also apply to a brand-new
deployment has to be called from that path too.

## Data and privacy

- `data/` runtime is gitignored on purpose — it can hold privileged client
  information. Never loosen that.
- `*.xlsx` member roster exports are PII and must never be committed.
- The committed seed deliberately holds no member email addresses.
