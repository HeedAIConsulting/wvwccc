/* Felicia, Sep 28 2026: "Can we have tools to change the font size, bold,
   italicize, link the text in the home page blurb box? (As the old site was)"

   The blurb was a 400-character textarea, escaped on the way out. It is now the
   same editor as Full details with a cut-down toolbar, stored as
   homeBlurbHtml and put on the page as HTML — so sanitizeBlurbHtml is the only
   thing standing between the admin panel and the front page, and it is what
   most of this file is about.

   Two shapes it has to hold:
     · the card cannot grow, so a size is clamped and a block tag becomes a
       space rather than a second paragraph;
     · an event saved before the toolbar existed has only the plain line, and
       must keep rendering exactly as it did.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeBlurbHtml, blurbText, buildEvent, BLURB_MAX_CHARS } from '../chamber-routes.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

test('the four marks Felicia named survive', () => {
  const out = sanitizeBlurbHtml(
    '<b>Bold</b> <i>italic</i> <u>under</u> <span style="font-size:1.1rem">big</span>'
    + ' <a href="https://woodlandhillscc.net/join">Click here to sign up</a>');
  assert.match(out, /<b>Bold<\/b>/);
  assert.match(out, /<i>italic<\/i>/);
  assert.match(out, /<u>under<\/u>/);
  assert.match(out, /font-size:1\.1rem/);
  assert.match(out, /<a href="https:\/\/woodlandhillscc\.net\/join"/);
  assert.match(out, /Click here to sign up/, 'the words are the link, not the address');
});

test('a size is clamped to what the card can take', () => {
  // The blurb sits in one of four cards across the home page. A 2.5rem line
  // would push the other three out of line, and the office cannot see that
  // from the admin panel.
  assert.match(sanitizeBlurbHtml('<span style="font-size:2.5rem">x</span>'), /font-size:1\.4rem/);
  assert.match(sanitizeBlurbHtml('<span style="font-size:0.2rem">x</span>'), /font-size:0\.7rem/);
  // Pasted text arrives in the units Word uses. 16px and 12pt are ordinary body
  // text and have to land inside the band, not on its ceiling — a clamp that
  // never converted would put every pasted line at the maximum.
  assert.match(sanitizeBlurbHtml('<span style="font-size:16px">x</span>'), /font-size:1rem/);
  assert.match(sanitizeBlurbHtml('<span style="font-size:12pt">x</span>'), /font-size:1rem/);
  assert.match(sanitizeBlurbHtml('<span style="font-size:48px">x</span>'), /font-size:1\.4rem/,
    'and a genuinely huge one is still brought down');
  assert.match(sanitizeBlurbHtml('<span style="font-size:36pt">x</span>'), /font-size:1\.4rem/);
});

test('nothing that owns a block of its own gets in', () => {
  // There is no room in the card for a heading, a list or a picture, and a
  // second paragraph would push the row out of line.
  assert.equal(sanitizeBlurbHtml('<p>One</p><p>Two</p>'), 'One Two');
  assert.equal(sanitizeBlurbHtml('<ul><li>One</li><li>Two</li></ul>'), 'One Two');
  assert.equal(sanitizeBlurbHtml('<h3>Heading</h3>'), 'Heading');
  assert.equal(sanitizeBlurbHtml('<img src="/x.png">Coffee'), 'Coffee');
  assert.ok(!/<br>/.test(sanitizeBlurbHtml('<p>One</p><p>Two</p>')),
    'a paragraph break is a space, not a line break the card has no room for');
});

test('script, style and a javascript: link never reach the page', () => {
  assert.ok(!/script/i.test(sanitizeBlurbHtml('<script>alert(1)</script>Hi')));
  assert.ok(!/onerror/i.test(sanitizeBlurbHtml('<b onerror="alert(1)">Hi</b>')));
  const bad = sanitizeBlurbHtml('<a href="javascript:alert(document.domain)">press me</a>');
  assert.ok(!/javascript/i.test(bad), 'the address is refused');
  assert.ok(!/<a/i.test(bad), 'and the empty tag is unwrapped rather than published');
  assert.match(bad, /press me/, 'the words stay');
  const data = sanitizeBlurbHtml('<a href="data:text/html;base64,PHN2Zz4=">x</a>');
  assert.ok(!/data:/i.test(data));
});

test('a long blurb is cut at a character, not through a tag', () => {
  const out = sanitizeBlurbHtml('<b>' + 'a'.repeat(500) + '</b>');
  assert.equal(blurbText(out).length, BLURB_MAX_CHARS);
  assert.match(out, /^<b>a+<\/b>$/, 'the bold tag is closed again after the cut');
  const mixed = sanitizeBlurbHtml('<i>' + 'b'.repeat(398) + '</i>' + 'c'.repeat(50));
  assert.equal(blurbText(mixed).length, BLURB_MAX_CHARS);
  assert.ok(!/<\/i>[\s\S]*<\/i>/.test(mixed), 'and not closed twice');
});

test('an entity counts as the one character a reader sees', () => {
  const out = sanitizeBlurbHtml('&amp;'.repeat(BLURB_MAX_CHARS + 20));
  assert.equal(blurbText(out).length, BLURB_MAX_CHARS);
  assert.ok(!/&am(p)?$/.test(out), 'and is never cut down the middle');
});

test('the plain field is derived from the formatted one', () => {
  // Two copies that can disagree is how the home page ends up saying something
  // the office cannot see in the admin panel.
  const ev = buildEvent({ title: 'T', date: '2026-10-01',
    homeBlurbHtml: '<p>Join us for <b>coffee</b> and <i>connections</i>.</p>' }, {});
  assert.equal(ev.homeBlurbHtml, 'Join us for <b>coffee</b> and <i>connections</i>.');
  assert.equal(ev.homeBlurb, 'Join us for coffee and connections.');
});

test('an event saved before the toolbar keeps its plain line', () => {
  const ev = buildEvent({ title: 'T' }, { homeBlurb: 'Networking at 7am.' });
  assert.equal(ev.homeBlurb, 'Networking at 7am.');
  assert.equal(ev.homeBlurbHtml, '', 'nothing is invented for it');
  const card = read('js/chamber.js');
  assert.match(card, /ev\.homeBlurbHtml\) \? ev\.homeBlurbHtml : esc\(blurb\)/,
    'and the card still escapes the plain one');
});

test('the browser never decides what HTML the home page runs', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /homeBlurbHtml: blurbHtml/, 'the stored field is the sanitized value');
  assert.match(routes, /sanitizeBlurbHtml\(b\.homeBlurbHtml\)/);
  assert.match(routes, /function sanitizeBlurbHtml\(html\) \{\s*let s = sanitizeRichHtml\(html\);/,
    'and it narrows what sanitizeRichHtml allows rather than replacing it');
});

test('the toolbar offers the marks and nothing the card cannot hold', () => {
  const html = read('admin/events.html');
  const bar = html.slice(html.indexOf('id="evBlurbBar"'), html.indexOf('id="evBlurb"'));
  assert.match(bar, /data-rt="bold"/);
  assert.match(bar, /data-rt="italic"/);
  assert.match(bar, /data-rt-size/);
  assert.match(bar, /data-rt-link/);
  assert.ok(!/data-rt-img|data-rt-libimg/.test(bar), 'no picture: the card has one already');
  assert.ok(!/data-rt="justify/.test(bar), 'and nothing that needs a block of its own');
  const sizes = /<select data-rt-size[\s\S]*?<\/select>/.exec(bar)[0];
  for (const m of sizes.matchAll(/value="([\d.]+)rem"/g)) {
    const v = Number(m[1]);
    assert.ok(v >= 0.7 && v <= 1.4, `the ${v}rem option would be clamped by the server`);
  }
});

test('the office is told the limits before it hits them', () => {
  const html = read('admin/events.html');
  assert.match(html, /id="evBlurbCount"/, 'a live character count, since a contenteditable has no maxlength');
  const admin = read('admin/admin.js');
  assert.match(admin, /blurbPlain\(\)\.length > BLURB_MAX/, 'and a save that would be cut short is refused');
  assert.match(admin, /Not saved — the home-page blurb is/);
  assert.match(admin, /if \(e\.key === 'Enter'\) e\.preventDefault\(\)/,
    'Enter is off: a second paragraph has nowhere to go');
});

test('editing an event loads what is stored and saves what is typed', () => {
  const admin = read('admin/admin.js');
  assert.match(admin, /if \(ev && ev\.homeBlurbHtml\) blurb\.innerHTML = ev\.homeBlurbHtml;/);
  assert.match(admin, /else blurb\.textContent = v\('homeBlurb'\);/,
    'a legacy plain blurb opens as text, never as markup');
  assert.match(admin, /homeBlurbHtml: blurb \? blurb\.innerHTML : ''/);
  assert.ok(!/homeBlurb: form\.homeBlurb/.test(admin),
    'the textarea is gone, so reading it would throw on every save');
  assert.ok(!/<textarea name="homeBlurb"/.test(read('admin/events.html')));
});
