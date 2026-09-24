/* Felicia, Sep 22 2026: "Our new member is trying to add his LinkedIn url to
   his profile but it is not sticking after he hits save. I tried it to."
   The member was Dagan Klipfel, the address was
   linkedin.com/in/dagan-klipfel-94a238167, and the box was <input type="url">.
   The browser refuses to submit a form holding an invalid constrained field,
   and it refuses BEFORE any submit listener runs — so the page made no
   request, showed no error, and saved nothing. It was never only LinkedIn:
   every link box on that form was type="url".

   Two halves, and this file covers both. The form no longer lets the browser
   block it, and what a member types is turned into a usable address instead of
   being demanded in a particular shape. The same function is the gate on what
   is allowed into an href, so javascript: goes out with it.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeUrl } from '../profile-helpers.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

test('the address Dagan actually typed is taken', () => {
  assert.equal(normalizeUrl('linkedin.com/in/dagan-klipfel-94a238167'),
    'https://linkedin.com/in/dagan-klipfel-94a238167');
});

test('a bare host is given the scheme it is missing', () => {
  assert.equal(normalizeUrl('www.sdiins.com'), 'https://www.sdiins.com');
  assert.equal(normalizeUrl('foo.co.uk/path?a=b#c'), 'https://foo.co.uk/path?a=b#c');
  assert.equal(normalizeUrl('  instagram.com/x  '), 'https://instagram.com/x');
});

test('an address that is already complete is left exactly alone', () => {
  assert.equal(normalizeUrl('https://x.com/a'), 'https://x.com/a');
  assert.equal(normalizeUrl('HTTP://Foo.com'), 'HTTP://Foo.com');
  assert.equal(normalizeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  assert.equal(normalizeUrl('tel:8183474737'), 'tel:8183474737');
});

test('our own uploads keep working', () => {
  assert.equal(normalizeUrl('/api/assets/abc123'), '/api/assets/abc123');
  assert.equal(normalizeUrl('//cdn.example.com/x.png'), 'https://cdn.example.com/x.png');
});

test('a script scheme never becomes a link on a member page', () => {
  // Members write their own hrefs on a public page, so this is the gate.
  // These all carry a dot, which matters: a payload with no dot is turned away
  // by the "does this even look like a host" test at the end and proves
  // nothing about the scheme check above it.
  assert.equal(normalizeUrl('javascript:alert(document.domain)'), '');
  assert.equal(normalizeUrl('JaVaScRiPt:alert(document.cookie)'), '');
  assert.equal(normalizeUrl('vbscript:msgbox(1.0)'), '');
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl('data:text/html,<script>x</script>'), '');
});

test('something that is not an address at all is dropped, not stored', () => {
  assert.equal(normalizeUrl('@myhandle'), '');
  assert.equal(normalizeUrl('call me'), '');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
});

test('the profile form can no longer be blocked by the browser in silence', () => {
  const html = read('member/profile.html');
  assert.ok(!/type="url"/.test(html),
    'type="url" is what swallowed the save: the browser rejects the field and never fires submit');
  assert.ok(/inputmode="url"/.test(html),
    'the link boxes should still bring up a URL keyboard on a phone');
});

test('every link field on the profile is normalised, not just LinkedIn', () => {
  const js = read('member/member.js');
  assert.match(js, /form\.querySelectorAll\('\[inputmode="url"\]'\)\.forEach\(\(el\) => \{ el\.value = tidyUrl\(el\.value\); \}\)/,
    'the submit handler tidies every link box, not the social ones only');
  assert.match(js, /addEventListener\('invalid'[\s\S]{0,400}?\}, true\)/,
    'invalid does not bubble, so the listener has to capture — otherwise a blocked save is silent again');

  const routes = read('backend/chamber-routes.js');
  for (const field of ['website', 'video', 'logo', 'pageImage']) {
    assert.ok(routes.includes(`'${field}'`), `${field} should still be a profile field`);
  }
  assert.match(routes, /MEMBER_URL_FIELDS.*=.*\[.*'website'.*'video'.*'logo'.*'pageImage'.*\]/,
    'the server normalises too, so a save from anywhere lands clean');
  assert.match(routes, /for \(const k of SOCIAL_KEYS\).*normalizeUrl/, 'socials');
  assert.match(routes, /for \(const k of \['google', 'yelp'\]\).*normalizeUrl/, 'review links');
  assert.match(routes, /url: normalizeUrl\(c\.url\)/, 'call-to-action buttons');
});

test('links saved before today still render, and a bad one renders as no link', () => {
  // Existing records can hold a bare host, so the renderer repairs on read as
  // well. Without this, an old value would resolve against woodlandhillscc.net.
  const js = read('js/chamber.js');
  assert.match(js, /function safeHref\(u\)/);
  // Assert on the href itself. Checking that safeHref appears somewhere passes
  // even when the attribute is still built from the raw value, which is the
  // only line that actually matters.
  for (const bit of ['m.social[k]', 'm.reviewLinks[k]', 'safeHref(c.url)', 'safeHref(m.website)']) {
    const inner = bit.startsWith('safeHref') ? bit : `safeHref(${bit})`;
    assert.ok(js.includes(`href="\${esc(${inner})}"`),
      `the href for ${bit} must be built from safeHref, not from the stored value`);
  }
});
