#!/usr/bin/env node
/* One-time: load the 2026 Gala purchase menu (tickets, sponsorships, program
   ads, add-ons, bundles) onto event le-11209 in the store/Postgres, and set the
   early-bird ticket price ($150 through Jul 5, then $200).

   Run from the machine with the store, DATABASE_URL pointed at prod:
     DATABASE_URL="<render external url>" node scripts/set-gala-options.mjs
   Add --dry-run to print the event without writing.

   Idempotent: replaces ticketTypes on le-11209; leaves everything else intact.
   Source: events/2026 gala ads and sponsorship.pdf (Diana, 2026). */
import * as db from '../backend/db.js';
import * as repo from '../backend/repo.js';

const GALA_ID = 'le-11209';
const TICKET_TYPES = [
  // group, name, price, earlyPrice?, earlyUntil?, qty (null = up to 10; number = max available)
  { group: 'Tickets', name: 'Gala Ticket', price: 200, earlyPrice: 150, earlyUntil: '2026-07-05T23:59:00-07:00', qty: null },

  { group: 'Sponsorships', name: 'Luxe Title Sponsor (1 available)', price: 5000, qty: 1 },
  { group: 'Sponsorships', name: 'Onyx Entertainment Sponsor', price: 4000, qty: null },
  { group: 'Sponsorships', name: 'Casino Reception Sponsor', price: 3000, qty: null },
  { group: 'Sponsorships', name: 'Garnet Media Sponsor', price: 2500, qty: null },
  { group: 'Sponsorships', name: 'Philanthropist Sponsor', price: 800, qty: null },
  { group: 'Sponsorships', name: 'Black Jack Sponsor (3 available)', price: 750, qty: 3 },
  { group: 'Sponsorships', name: 'VIP Glam Cam Sponsor', price: 750, qty: null },

  { group: 'Program Ads', name: 'Friend Listing (logo only)', price: 100, qty: null },
  { group: 'Program Ads', name: 'Business Card Ad', price: 250, qty: null },
  { group: 'Program Ads', name: 'Half Page Ad', price: 350, qty: null },
  { group: 'Program Ads', name: 'Full Page Ad', price: 700, qty: null },

  { group: 'Ad Add-Ons', name: 'Website Recognition', price: 100, qty: null },
  { group: 'Ad Add-Ons', name: 'Social Media Spotlight', price: 150, qty: null },
  { group: 'Ad Add-Ons', name: 'Event Screen Slideshow Inclusion', price: 250, qty: null },

  { group: 'Bundles', name: 'Supporter Package — 2 tickets + Business Card Ad', price: 500, qty: null },
  { group: 'Bundles', name: 'Patron Package — 2 tickets + Half Page Ad', price: 600, qty: null },
].map((t) => ({ available: true, ...t }));

const dryRun = process.argv.includes('--dry-run');

const events = await repo.listEventsStore();
let ev = events.find((e) => e.id === GALA_ID);
if (!ev) {
  console.error(`Event ${GALA_ID} not found in the store/DB. Is it seeded? Aborting.`);
  await db.end?.();
  process.exit(1);
}

ev = { ...ev, price: 150, ticketTypes: TICKET_TYPES, ticketed: true, updated: new Date().toISOString() };

console.log(`Event: ${ev.id} — ${ev.title}`);
console.log(`Ticket/item options (${TICKET_TYPES.length}):`);
for (const t of TICKET_TYPES) {
  const eb = t.earlyPrice ? ` (early $${t.earlyPrice} until ${t.earlyUntil})` : '';
  const cap = t.qty != null ? ` [max ${t.qty}]` : '';
  console.log(`  [${t.group}] ${t.name} — $${t.price}${eb}${cap}`);
}

if (dryRun) { console.log('\n--dry-run: nothing written.'); await db.end?.(); process.exit(0); }
if (!db.enabled) {
  console.error('\nDATABASE_URL not set — refusing to write to the JSON store only. Set DATABASE_URL to prod and re-run.');
  process.exit(1);
}

await repo.upsertEvent(ev);
console.log('\n✓ Gala options written to Postgres. Buyers now see the dropdown at checkout.html?type=ticket&event=' + GALA_ID);
await db.end?.();
