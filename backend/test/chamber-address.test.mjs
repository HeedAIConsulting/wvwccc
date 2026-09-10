/* The Chamber moved, and the old address sat in the Regional Resource Guide
   until Diana found it (Sep 10 2026). It survived because the address was
   written out once, by hand, in a page nobody had reason to re-read.

   It is now in three places on purpose — the footer partial renders it on
   every page, and index.html and contact.html carry it as JSON-LD, which has
   to be static markup because a search engine should not have to run our
   JavaScript to learn where the Chamber is.

   Three copies is two chances to drift. These tests fail if they ever stop
   agreeing, so the next move is one edit per place and nothing missed.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

const STREET = '6351 Owensmouth Avenue, Suite 101A';
const CITY = 'Woodland Hills';
const STATE = 'CA';
const ZIP = '91367';
const PHONE_DIGITS = '8183474737';

const jsonLd = (f) => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read(f));
  assert.ok(m, `${f} has no JSON-LD block — search engines get no address from it`);
  return JSON.parse(m[1]);
};
const LD_PAGES = ['index.html', 'contact.html'];

test('the footer partial carries the current address', () => {
  const s = read('js/partials.js');
  assert.match(s, new RegExp(`street:\\s*'${STREET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(s, new RegExp(`city:\\s*'${CITY}'`));
  assert.match(s, new RegExp(`zip:\\s*'${ZIP}'`));
  // …and actually renders it, rather than only defining it.
  assert.match(s, /CHAMBER\.street/, 'the footer must render the address, not just hold it');
});

test('the Contact page states the street address', () => {
  const s = read('contact.html');
  assert.ok(s.includes(STREET), 'Contact is where someone looks for the office address');
  assert.ok(s.includes(`${CITY}, ${STATE} ${ZIP}`));
});

for (const f of LD_PAGES) {
  test(`${f} publishes a valid address for search engines`, () => {
    const d = jsonLd(f);
    const a = d.address;
    assert.equal(a['@type'], 'PostalAddress');
    assert.equal(a.streetAddress, STREET);
    assert.equal(a.addressLocality, CITY);
    assert.equal(a.addressRegion, STATE);
    assert.equal(a.postalCode, ZIP);
    assert.equal(String(d.telephone).replace(/\D/g, '').replace(/^1/, ''), PHONE_DIGITS);
    assert.ok(String(d.url).startsWith('https://woodlandhillscc.net'));
  });
}

test('the two JSON-LD blocks describe the same organisation', () => {
  const [a, b] = LD_PAGES.map(jsonLd);
  assert.deepEqual(a.address, b.address, 'index and contact must not disagree about where the Chamber is');
  assert.equal(a.name, b.name);
  assert.equal(a.telephone, b.telephone);
});

test('no page still carries a superseded Chamber address', () => {
  // 6100 Topanga was the old office; PO Box 1 is a mailing address that may
  // legitimately remain on the 2025 Grateful Hearts event, so it is not
  // checked here — only the office address, and only in page markup.
  for (const f of ['index.html', 'contact.html', 'about.html', 'regional-resource-guide.html', 'join.html']) {
    assert.doesNotMatch(read(f), /6100 Topanga/, `${f} still shows the old office address`);
  }
});

test('the address is never published without a way to call', () => {
  // A local listing with no phone is the one that gets ignored.
  for (const f of LD_PAGES) assert.ok(jsonLd(f).telephone, `${f} gives an address but no telephone`);
  assert.match(read('js/partials.js'), /CHAMBER\.phone/);
  assert.match(read('contact.html'), /347-4737/);
});
