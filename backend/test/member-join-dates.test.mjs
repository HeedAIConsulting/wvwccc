/* Felicia, Sep 18 2026: "We would like 2-more entries on the directory if there
   are 2 different join dates for 2 different representatives/accounts...
   Savannah and Vahan are independent representatives for Edward Jones. They
   have different join dates. We would like that reflected. Also, McDonalds has
   2 locations that joined at different times and so does U Frame It. We would
   like those as individual entries on the directory with their respective join
   dates."

   That was her answer to my Sep 11 question about five companies holding two
   join dates, where I had asked which date to keep. Keep both, she said.

   Checked against the live directory API before writing anything: all three
   already come back as two records apiece, each with its own id, address,
   contact and join date — Edward Jones m16115/m16190, McDonald's
   m13449/m13449-154, U-Frame-It m2100/m2100-166. Nothing merges them. What was
   missing was the date itself, which the public API did not carry, so the two
   entries looked like an accidental duplicate rather than two memberships.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const roster = JSON.parse(read('data/directory.json'));
const members = Array.isArray(roster) ? roster : roster.members;

test('the companies Felicia named are two listings each, with their own dates', () => {
  for (const [name, count] of [['Edward Jones', 2], ["McDonald's", 2], ['U-Frame-It Gallery', 2]]) {
    const hits = members.filter((m) => String(m.name).trim() === name);
    assert.equal(hits.length, count, `${name} should hold ${count} listings`);
    const dates = hits.map((m) => m.joinDate);
    assert.equal(new Set(dates).size, dates.length, `${name}: the two listings should not share a join date`);
    for (const m of hits) {
      assert.match(String(m.joinDate), /^\d{4}-\d{2}-\d{2}$/, `${name}: ${m.id} needs a real join date`);
      assert.ok(m.id, 'and its own id, or the directory cannot link to it');
    }
  }
});

test('nothing in the roster collapses two listings of one company', () => {
  // If this ever starts failing, something began de-duplicating by name and
  // one of these memberships has gone quiet.
  const byName = new Map();
  for (const m of members) {
    const k = String(m.name || '').trim().toLowerCase();
    byName.set(k, (byName.get(k) || 0) + 1);
  }
  const shared = [...byName.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.ok(shared.length >= 5, `expected the five known pairs, found ${shared.length}`);
  for (const n of ['edward jones', "mcdonald's", 'u-frame-it gallery']) {
    assert.ok(shared.includes(n), `${n} should still be two listings`);
  }
});

test('the date is on the card and on the profile', () => {
  const js = read('js/chamber.js');
  assert.match(js, /function memberSince\(joinDate\)/);
  assert.match(js, /const since = memberSince\(m\.joinDate\)/, 'the directory card');
  assert.match(js, /tr\('Member since'\)/, 'and it is a translated label, like the rest of the card');
  assert.match(js, /'Member since': 'Miembro desde'/, 'the Spanish directory should not fall back to English');
  assert.match(js, /\['Chamber member since', memberSince\(m\.joinDate\)\]/, 'the profile facts list');
});

test('the date is read as written, not shifted a day by a timezone', () => {
  /* "2024-05-28" through Date() is UTC midnight, which is the evening of the
     27th in California — every listing would show the month before its join
     date for dates falling on the 1st. Parsed as numbers instead. */
  const js = read('js/chamber.js');
  const fn = js.slice(js.indexOf('function memberSince(joinDate)'), js.indexOf('function safeHref(u)'));
  assert.match(fn, /\/\^\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\$\//, 'pulled apart with a pattern');
  assert.ok(!/new Date/.test(fn), 'and never handed to Date()');
});

test('a listing with no usable join date simply shows none', () => {
  const js = read('js/chamber.js');
  const fn = js.slice(js.indexOf('function memberSince(joinDate)'), js.indexOf('function safeHref(u)'));
  assert.match(fn, /if \(!m\) return '';/, 'no date, no line — never "Member since undefined"');
});
