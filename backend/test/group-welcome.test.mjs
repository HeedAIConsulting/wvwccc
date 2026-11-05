/* The group welcome email (Nov 5 2026). Sheryl Tratner forwarded the
   Ambassador Committee welcome Martin Carman got: "Hi Computer," (the roster
   row is named after his business), links to wvwccc-web.onrender.com, a From
   line that did not say replies go to her, and a schedule line that was no
   longer true. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siteBase, greetingName } from '../site-base.js';
import { fromWith } from '../email.js';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const req = (host) => ({ protocol: 'https', get: (h) => (h === 'host' ? host : undefined) });

test('emailed links use the Chamber domain, whatever host the sender was on', () => {
  const saved = { SITE_URL: process.env.SITE_URL, SITE_ORIGIN: process.env.SITE_ORIGIN };
  delete process.env.SITE_URL; delete process.env.SITE_ORIGIN;
  try {
    assert.equal(siteBase(req('wvwccc-web.onrender.com')), 'https://woodlandhillscc.net');
    assert.equal(siteBase(req('woodlandhillscc.net')), 'https://woodlandhillscc.net');
    assert.equal(siteBase(req('localhost:3000')), 'https://localhost:3000');
    process.env.SITE_ORIGIN = 'https://example.org/';
    assert.equal(siteBase(req('wvwccc-web.onrender.com')), 'https://example.org');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('no emailed link is built from the request host any more', () => {
  const src = read('backend/chamber-routes.js');
  assert.equal(src.includes("process.env.SITE_URL || `${req.protocol}://${req.get('host')}`"), false);
  assert.match(src, /function notifyNewGroupMembers[\s\S]*?const base = siteBase\(req\)/);
});

test('a row picked from the directory is greeted by the contact name, not the business', () => {
  const dir = { id: 'm10053', name: 'Computer Doctor, The', contactName: 'Martin Carman' };
  const row = { memberId: 'm10053', name: 'Computer Doctor, The', business: 'Computer Services' };
  assert.equal(greetingName(row, dir), 'Martin');
  // Business name with stray spacing/punctuation still counts as the business.
  assert.equal(greetingName({ memberId: 'x', name: 'Lady Fortunes Inc. ' },
    { name: 'Lady Fortunes Inc.', contactName: 'Gary Huettinger' }), 'Gary');
  // No contact on file: "there", never the first word of the business.
  assert.equal(greetingName(row, { ...dir, contactName: '' }), 'there');
  assert.equal(greetingName(row, null), 'Computer');
});

test('a name somebody typed is kept, honorifics are skipped', () => {
  assert.equal(greetingName({ name: 'Sandy Rosenholz', business: 'Senior Resources, Inc' }, null), 'Sandy');
  // A second rep of a member business, typed in by hand.
  assert.equal(greetingName({ memberId: 'm10053', name: 'Jane Smith' },
    { name: 'Computer Doctor, The', contactName: 'Martin Carman' }), 'Jane');
  assert.equal(greetingName({ name: 'Dr. Jane Smith' }, null), 'Jane');
  assert.equal(greetingName({ name: 'Acme', business: 'Acme' }, null), 'there');
  assert.equal(greetingName({ name: '' }, null), 'there');
});

test('the welcome email greets with greetingName and sends From the leader', () => {
  const src = read('backend/chamber-routes.js');
  const fn = src.slice(src.indexOf('async function notifyNewGroupMembers'), src.indexOf('async function ledGroupOr403'));
  assert.match(fn, /greetingName\(m, m\.memberId \? dirById\.get\(m\.memberId\) : null\)/);
  assert.match(fn, /email\.send\(\{ to: addr, replyTo, fromName,/);
  assert.equal(fn.includes("String(m.name || '').trim().split"), false);
});

test('From carries the leader name on the Chamber address, and nothing can be injected', () => {
  const FROM = 'West Valley · Warner Center Chamber <wendy@woodlandhillscc.net>';
  assert.equal(fromWith('Sheryl Tratner', FROM), '"Sheryl Tratner via West Valley · Warner Center Chamber" <wendy@woodlandhillscc.net>');
  assert.equal(fromWith('', FROM), FROM);
  assert.equal(fromWith('Sheryl', 'wendy@woodlandhillscc.net'), 'wendy@woodlandhillscc.net');
  const evil = fromWith('Eve"\r\nBcc: x@y.z <a@b.c>', FROM);
  assert.equal(/[\r\n]/.test(evil), false);
  assert.match(evil, /^"[^"<>]+" <wendy@woodlandhillscc\.net>$/);
});

test('Ambassador schedule: only the stale line is replaced, on the live store and in the seed', async () => {
  const { AMBASSADOR_SCHEDULE, ambassadorScheduleFix } = await import('../chamber-routes.js');
  assert.equal(ambassadorScheduleFix({ meetingSchedule: '30 minutes before each mixer starts' }), AMBASSADOR_SCHEDULE.to);
  assert.equal(ambassadorScheduleFix({ meetingSchedule: '3rd Wednesday · 9 AM' }), null);
  assert.equal(ambassadorScheduleFix(null), null);
  assert.match(AMBASSADOR_SCHEDULE.to, /calendar/);
  const seed = JSON.parse(read('data/groups.json'));
  const groups = Array.isArray(seed) ? seed : seed.groups;
  const amb = groups.find((g) => g.id === AMBASSADOR_SCHEDULE.id);
  assert.equal(amb.meetingSchedule, AMBASSADOR_SCHEDULE.to);
  const src = read('backend/chamber-routes.js');
  assert.match(src, /await applyAmbassadorSchedule\(\);\n  return repo\.listGroupsStore\(\);/);
});

test('a leader can change the schedule line from Manage group', () => {
  const js = read('member/member.js');
  assert.match(js, /id="gmSchedule"/);
  assert.match(js, /JSON\.stringify\(\{ meetingSchedule \}\)/);
  assert.match(read('member/leader-guide.html'), /Save schedule/);
});
