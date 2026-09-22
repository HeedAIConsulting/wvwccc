/* Felicia, Sep 18 2026: "Yes, we still want a new member page. We would like
   the duration of the new members staying on it for 30 days."

   The window is what makes this worth building on the site rather than as a
   page somebody edits: a member drops off on their own thirty-first day and
   nobody has to remember to take anyone down. The thirty is a setting, so the
   office can change its mind in Admin → Members without asking.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickNewMembers } from '../chamber-routes.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

const TODAY = new Date('2026-09-22T12:00:00Z');
const day = (n) => new Date(TODAY.getTime() - n * 86400000).toISOString().slice(0, 10);

test('a member is on the page for the window, and then is not', () => {
  const roster = [
    { name: 'Joined today', joinDate: day(0) },
    { name: 'Joined 29 days ago', joinDate: day(29) },
    { name: 'Joined 30 days ago', joinDate: day(30) },
    { name: 'Joined 31 days ago', joinDate: day(31) },
    { name: 'Joined a year ago', joinDate: day(365) },
  ];
  const names = pickNewMembers(roster, 30, TODAY).map((m) => m.name);
  assert.deepEqual(names, ['Joined today', 'Joined 29 days ago', 'Joined 30 days ago']);
});

test('newest first, so the page reads as an announcement', () => {
  const roster = [
    { name: 'B', joinDate: day(10) },
    { name: 'A', joinDate: day(2) },
    { name: 'C', joinDate: day(20) },
  ];
  assert.deepEqual(pickNewMembers(roster, 30, TODAY).map((m) => m.name), ['A', 'B', 'C']);
});

test('two on the same day are settled by name, not by roster order', () => {
  const roster = [
    { name: 'Zed Plumbing', joinDate: day(3) },
    { name: 'Acme Bakery', joinDate: day(3) },
  ];
  assert.deepEqual(pickNewMembers(roster, 30, TODAY).map((m) => m.name), ['Acme Bakery', 'Zed Plumbing']);
});

test('a member with no join date is not new', () => {
  // 607 members carried over from the old system. If a missing date counted as
  // new, the page would open with the entire 1966 intake on it.
  const roster = [
    { name: 'No date at all' },
    { name: 'Empty string', joinDate: '' },
    { name: 'Nonsense', joinDate: 'sometime in 2019' },
    /* This one is the reason the shape is checked and not just the range.
       Dates are compared as strings, and "2026-09-15 (approx)" sorts happily
       between the cutoff and today, so a range test alone lets it through. */
    { name: 'Looks close enough to sort', joinDate: day(7) + ' (approx)' },
    { name: 'Real', joinDate: day(1) },
  ];
  assert.deepEqual(pickNewMembers(roster, 30, TODAY).map((m) => m.name), ['Real']);
});

test('a join date in the future does not sit at the top of the page', () => {
  // A typo in the admin form should not park a member above everyone else
  // until the date comes round.
  const future = new Date(TODAY.getTime() + 5 * 86400000).toISOString().slice(0, 10);
  const roster = [{ name: 'Typo', joinDate: future }, { name: 'Real', joinDate: day(1) }];
  assert.deepEqual(pickNewMembers(roster, 30, TODAY).map((m) => m.name), ['Real']);
});

test('the window is a setting the office owns, inside sane bounds', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /const NEW_MEMBER_DAYS_DEFAULT = 30;/, 'Felicia asked for 30');
  assert.match(routes, /raw >= 1 && raw <= 365/, 'a stored value out of range falls back rather than emptying the page');
  assert.match(routes, /router\.post\('\/admin\/new-member-window', requireAdmin/);
  assert.match(routes, /d < 1 \|\| d > 365/, 'and the same bounds on the way in');

  const html = read('admin/members.html');
  assert.match(html, /id="nmDays"/);
  assert.match(html, /then comes off on their own/,
    'the office should read what the setting does, not just a number');
  assert.match(read('admin/admin.js'), /\/api\/admin\/new-member-window/);
});

test('the page shows only listings the directory would show', () => {
  // Built from loadMembersPublic, so the approved-only filter and the public
  // field list are the directory's, not a second copy that can drift.
  const routes = read('backend/chamber-routes.js');
  const route = routes.slice(routes.indexOf("router.get('/members/new'"), routes.indexOf("router.get('/admin/new-member-window'"));
  assert.match(route, /loadMembersPublic\(\)/);
  assert.ok(!/loadMembersFull\(\)/.test(route), 'the full record carries fields the public list strips');
});

test('joinDate is published, because two of these asks need it', () => {
  const routes = read('backend/chamber-routes.js');
  const fields = routes.slice(routes.indexOf('const PUBLIC_FIELDS'), routes.indexOf('let _kw'));
  assert.match(fields, /'joinDate'/);
});

test('an empty page says which window is empty', () => {
  const js = read('js/chamber.js');
  assert.match(js, /No new members in the last \$\{days\} days/,
    '"no new members" alone reads like the page is broken');
  assert.match(js, /businesses have joined in the last \$\{days\} days/);
  assert.match(js, /One business has joined/, 'and it should not say "1 businesses"');
});

test('the page is reachable without knowing the address', () => {
  const partials = read('js/partials.js');
  assert.ok((partials.match(/members\/new\.html/g) || []).length >= 2, 'main nav and footer');
  assert.match(read('members/directory.html'), /new\.html/, 'and from the directory');
  assert.match(read('members/new.html'), /Chamber\.initNewMembers\(\)/);
});
