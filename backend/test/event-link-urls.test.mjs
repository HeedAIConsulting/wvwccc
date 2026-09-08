/* Michael, Sep 8 2026, looking at the Small Business Resource Event: "I just
   noticed the URL on this page pointing to the chamber website is redundant.
   Why, was it user error?"

   Half user error — somebody added a "Chamber Website" link to an event that
   lives ON the Chamber website. But the link was also BROKEN, and that half
   was ours: it was stored as "www.woodlandhillscc.net" with no scheme, so the
   browser read it as a relative path and it resolved to
   /events/www.woodlandhillscc.net — a 404. Three live links were like this.

   clampUrl only trimmed and truncated, so it also let any scheme through —
   and event links arrive from the PUBLIC community submit form, which needs
   no login. "javascript:…" was storable and would render as a live href once
   an admin approved the event. That is the part these tests exist for.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent } from '../chamber-routes.js';

const linksOf = (links) => buildEvent({ title: 'x', date: '2027-01-01', links }, {}).links;
const one = (url) => (linksOf([{ label: 'L', url, type: 'info' }])[0] || {}).url;

test('a bare host gets a scheme instead of becoming a relative path', () => {
  assert.equal(one('www.woodlandhillscc.net'), 'https://www.woodlandhillscc.net',
    'this exact value 404d on a live event page');
  assert.equal(one('summitiop.org'), 'https://summitiop.org');
  assert.equal(one('example.org/tickets?a=1'), 'https://example.org/tickets?a=1');
});

test('an email address in the link box becomes a mailto, not a broken path', () => {
  assert.equal(one('info@summitiop.org'), 'mailto:info@summitiop.org',
    'a live RSVP link was an email address');
});

test('links that were already fine are left exactly alone', () => {
  for (const u of ['https://example.org/x', 'http://example.org', 'mailto:a@b.co', 'tel:+18183474737', '/events/index.html', '#tickets']) {
    assert.equal(one(u), u, u);
  }
});

test('javascript: and friends are dropped, not stored', () => {
  // The community submit form is unauthenticated, so this is reachable by
  // anyone; an admin approving a plausible event would not inspect the href.
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:msgbox', 'file:///etc/passwd']) {
    assert.equal(one(u), undefined, `${u} must not survive into an event`);
  }
});

test('free text is dropped rather than published as a dead link', () => {
  assert.equal(one('ask at the front desk'), undefined);
  assert.equal(one('   '), undefined);
});

test('the good links in a mixed list survive and the bad ones do not', () => {
  const out = linksOf([
    { label: 'Site', url: 'www.example.org', type: 'info' },
    { label: 'Bad', url: 'javascript:alert(1)', type: 'info' },
    { label: 'Mail', url: 'hello@example.org', type: 'info' },
  ]);
  assert.deepEqual(out.map((l) => l.url), ['https://www.example.org', 'mailto:hello@example.org']);
});
