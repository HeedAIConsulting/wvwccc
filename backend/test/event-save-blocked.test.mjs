/* "Save Event needs to be fixed." — Diana, Sep 15 2026, after six days of
   pressing it.

   Nothing on that event would save: not the hidden ticket row, not the
   homepage blurb, not a spelling correction. Other events saved fine in the
   same period, which is what made it look like user error rather than a bug.

   The server logs settled it. Between Sep 9 and Sep 15 there was not ONE
   PATCH to le-11262 from her address, while le-11221 and three others all
   came back 200. The request was never being sent.

   The cause was in the markup, not the code. That event carries homeOrder 5,
   and the Home order box was capped at max="4". A control outside its range
   makes the browser abandon the submit event outright — our handler never
   runs, nothing is sent, and the only signal is a validation bubble on a box
   well above where she was working.

   The cap was simply wrong. homeOrder is a running order, not a slot: the
   homepage sorts by it and takes the top four (js/chamber.js), so 5 means
   "queued fifth", which is exactly what she meant. Seven featured events were
   already spread across orders 1 to 5.

   Verified in a browser both ways: with max="4" and a stored 5, zero PATCHes
   leave the page and neither the blurb nor the ticket row survives. Without
   it, one PATCH, everything saves, and the order stays 5.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

test('Home order is not capped below what the site actually uses', () => {
  const html = read('admin/events.html');
  const input = /<input name="homeOrder"[^>]*>/.exec(html);
  assert.ok(input, 'the Home order box should still exist');
  assert.ok(!/\bmax=/.test(input[0]),
    'a max here silently blocks every save on any event ranked past it — homeOrder is a running order, not a slot');
  assert.match(input[0], /min="1"/, 'a rank still starts at 1');
});

test('the homepage treats homeOrder as a rank and takes the top four', () => {
  // If this ever becomes a fixed set of slots, the cap above could come back —
  // so pin the assumption the cap was removed on.
  const js = read('js/chamber.js');
  assert.match(js, /homeOrd\s*=\s*\(e\)/, 'homeOrder is read as a sort key');
  assert.match(js, /\.slice\(0,\s*4\)/, 'and the homepage takes the top four of whatever is ranked');
});

test('a save the browser refuses names the box and why', () => {
  const js = read('admin/admin.js');
  assert.match(js, /addEventListener\('invalid'/,
    'the submit event never fires when a control is invalid — catch `invalid` instead');
  assert.match(js, /Not saved —/, 'and say so, rather than failing in silence');
  assert.match(js, /FIELD_LABELS/, 'naming the box in words the office uses, not the field name');
  const at = js.indexOf("addEventListener('invalid'");
  assert.match(js.slice(at, at + 1400), /scrollIntoView/,
    'the offending box is usually well above where they are working');
});
