#!/usr/bin/env node
/* Merge website-sourced profile drafts into canonical members that lack a
   description. Drafts are the member's OWN site copy → set as description with
   descriptionDraft=true (admin/member confirms). Skips junk-meta drafts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '_store');
const membersPath = path.join(STORE, 'members.json');
const draftsPath = path.join(STORE, '_profile-drafts.json');

const mem = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
const { drafts } = JSON.parse(fs.readFileSync(draftsPath, 'utf8'));
const byId = new Map(mem.members.map((m) => [m.id, m]));

// junk heuristic: nav/slider boilerplate or many SHOUTING tokens
const isJunk = (s) => /shop now|menu|skip to|enable javascript|add to cart|©|cookie/i.test(s)
  || (s.match(/[A-Z]{4,}/g) || []).length > 3;

let merged = 0, skippedJunk = 0, notInRoster = 0, alreadyHad = 0;
for (const d of drafts) {
  if (d.status !== 'draft' || !d.description) continue;
  const m = byId.get(d.id);
  if (!m) { notInRoster++; continue; }              // not in Diana's 643
  if (m.description) { alreadyHad++; continue; }     // already enriched from NC
  if (isJunk(d.description)) { skippedJunk++; continue; }
  m.description = d.description;
  if (!m.tagline && d.tagline && !isJunk(d.tagline)) m.tagline = d.tagline;
  m.descriptionSource = 'website-draft';
  m.descriptionDraft = true;                          // pending member/admin review
  merged++;
}

mem._meta = { ...mem._meta, profileDraftsMergedAt: new Date().toISOString(), profileDraftsMerged: merged };
fs.writeFileSync(membersPath, JSON.stringify(mem, null, 2));
console.log(`merged ${merged} website drafts into canonical members`);
console.log(`  skipped: ${skippedJunk} junk-meta, ${alreadyHad} already had a description, ${notInRoster} not in the 643 roster`);
console.log(`  members with description now: ${mem.members.filter((m) => m.description).length} of ${mem.members.length}`);
console.log(`  flagged descriptionDraft=true (review queue): ${mem.members.filter((m) => m.descriptionDraft).length}`);
