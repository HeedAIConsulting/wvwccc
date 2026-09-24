/* Diana, Sep 24 2026, via Felicia: "If there are 2 co-leaders, Diana would
   like them to both be able to sign in with their own email address. Can that
   be arranged?" And a few minutes later: "Can you add an additional user for
   groups like we have for members?"

   They always could. groupsLedBy() takes the group's manager email OR any
   roster member whose role is Leader/Chair/Co-Chair and who matches by email
   or by member id, so the number of co-leaders was never capped at one.
   normalizeGroupMembers has stored an `email` on every roster entry the whole
   time, and /admin/groups already counts a roster leader's address when it
   reports who can manage.

   The one thing missing was a box. The roster row in the admin form rendered
   a name, a role dropdown and Remove, and nothing else — so a leader typed in
   by hand had no address anywhere and was locked out with no way to fix it.
   Valley Senior Resource Network is the live case: Marcia Israel and Sandy
   Rosenholz both sit on it as Leaders with memberId null and no email.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

test('the sign-in rule really does take more than one leader', () => {
  // If this ever narrows to a single manager email, co-leaders break silently.
  const routes = read('backend/chamber-routes.js');
  const fn = routes.slice(routes.indexOf('async function groupsLedBy'), routes.indexOf('// The identities a member can post'));
  assert.match(fn, /g\.manager && String\(g\.manager\.email \|\| ''\)\.toLowerCase\(\) === e/, 'the manager route');
  assert.match(fn, /\(g\.members \|\| \[\]\)\.some\(/, 'and the roster route, which has no limit of one');
  assert.match(fn, /\^\(leader\|chair\|co-chair\)\$/i);
  assert.match(fn, /String\(m\.email \|\| ''\)\.toLowerCase\(\) === e/, 'matched on a roster email');
  assert.match(fn, /m\.memberId === mid/, 'or on their own listing');
});

test('a roster entry keeps the email it is given', () => {
  const routes = read('backend/chamber-routes.js');
  const fn = routes.slice(routes.indexOf('function normalizeGroupMembers'), routes.indexOf('// The person who runs a group'));
  assert.match(fn, /email: String\(m\.email \|\| ''\)\.slice\(0, 160\)/,
    'the sanitiser must not drop it on the way in');
  assert.match(fn, /'Co-Chair'/, 'and Co-Chair has to survive as a role');
});

test('the roster row asks for an address once somebody is a leader', () => {
  const js = read('admin/admin.js');
  const roster = js.slice(js.indexOf('const LEADS = (role)'), js.indexOf('function addMember(entry)'));
  assert.match(roster, /\^\(leader\|chair\|co-chair\)\$/i, 'only the leader roles get a box');
  assert.match(roster, /data-email/, 'the box exists');
  assert.match(roster, /Sign-in email/, 'and is labelled in words the office reads');
  assert.match(roster, /\[data-email\]'\)\?\.addEventListener\('input'/, 'and typing in it is kept');
  assert.match(roster, /m\.role = e\.target\.value; renderRoster\(\);/,
    'changing the role re-renders, or the box never appears until a reload');
});

test('a leader who came from the directory is not asked for one', () => {
  // They sign in with their own member login; an empty box beside their name
  // reads as something missing when nothing is.
  const js = read('admin/admin.js');
  const roster = js.slice(js.indexOf('const LEADS = (role)'), js.indexOf('function addMember(entry)'));
  assert.match(roster, /m\.memberId\s*\n?\s*\?\s*`<div class="sub"[^`]*Signs in with their own member login/);
});

test('a leader with no address is called out, not left blank', () => {
  const js = read('admin/admin.js');
  const roster = js.slice(js.indexOf('const LEADS = (role)'), js.indexOf('function addMember(entry)'));
  assert.match(roster, /they cannot open their Manage group page/i);
});

test('every leader is reported, not just the first one found', () => {
  const routes = read('backend/chamber-routes.js');
  const route = routes.slice(routes.indexOf("router.get('/admin/groups'"), routes.indexOf("router.post('/admin/groups'"));
  assert.match(route, /const leaders = \[\];/);
  assert.match(route, /leaders,/, 'and they ride along on leaderAccess');
  /* Assert the set is actually filled, not merely declared: dropping the one
     line that populates it leaves every other mention of the name in place,
     and a directory leader then reports as unable to sign in. */
  assert.match(route, /accountsByMember = new Set\(list\.map\(\(u\) => u\.memberId\)\.filter\(Boolean\)\)/,
    'a directory leader signs in by member id, not by an address on the group');
  assert.match(route, /accountsByMember \? accountsByMember\.has\(memberId\) : null/,
    'and that is what decides whether they can manage');
  assert.match(route, /if \(!key \|\| seen\.has\(key\)\) return;/, 'the same person twice is one leader');

  const js = read('admin/admin.js');
  assert.match(js, /leaders\.length > 1/, 'the panel lists them when there is more than one');
  assert.match(js, /people can manage this group/);
});

test('the panel does not put a list inside a paragraph', () => {
  // A <ul> inside a <p> is closed by the parser and the list escapes the box.
  const html = read('admin/groups.html');
  assert.ok(!/<p[^>]*id="grpLeaderAccess"/.test(html), 'grpLeaderAccess must not be a <p>');
  assert.match(html, /<div class="sub" id="grpLeaderAccess"/);
});

test('the page says co-leaders are possible, since nothing else would', () => {
  const html = read('admin/groups.html');
  assert.match(html, /Sign-in email/);
  assert.match(html, /As many co-leaders as you like/);
});
