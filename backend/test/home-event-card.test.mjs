/* Felicia, Sep 14 2026: "We would also like to keep the feature we used to have
   of being able to add a thumbnail of the featured event or logo on the left
   side of that event when they are on the home page."

   Events already carried a thumbnail — the admin form has uploaded one since
   July — and the home page never rendered it. The card put the date block on
   the left and any artwork as small thumbs underneath the text.

   The same visit turned up its twin: "Home-page blurb" was saved on the event,
   stored by the server, and read by nothing. Diana had been filling it in and
   watching the home page not change, which is the other half of what she meant
   by "the homepage blurb ... will not save".

   Both are home-page-only. The all-events list stays the compact rows it is,
   which is why the card takes the choice as an option rather than reading the
   field wherever it happens to be set.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const js = read('js/chamber.js');
const card = js.slice(js.indexOf('function eventCard(ev'), js.indexOf('function eventQuickRow'));

test('the home page asks for the picture; the all-events list does not', () => {
  assert.match(js, /eventCard\(e, 0, \{ thumb: true \}\)/, 'home page');
  assert.match(js, /eventCard\(e, 1, \{ newTab: true \}\)/,
    'the all-events list keeps its compact rows — Felicia asked for this on the home page');
});

test('the thumbnail falls back to artwork the event already has', () => {
  assert.match(card, /opts\.thumb \?/, 'opt-in, so only the home page changes');
  assert.match(card, /ev\.thumbnail \|\| ev\.flyer \|\| evImgOf\(ev\.images && ev\.images\[0\]\)/,
    'an event with a flyer should show one without anyone re-uploading it as a thumbnail');
});

test('an event with no artwork renders exactly as before', () => {
  // The lead cell is the date block itself unless there is something to show —
  // an empty wrapper would change the grid on every event on the calendar.
  assert.match(card, /const lead = thumbSrc\s*\n?\s*\?/);
  assert.match(card, /:\s*dateBlock;/);
  assert.match(card, /event-row\$\{thumbSrc \? ' event-row--thumb' : ''\}/,
    'and the wider lead column is only applied when there is a picture in it');
});

test('one picture per row, not two', () => {
  assert.match(card, /\$\{thumbSrc \? '' : imgs\}/,
    'the strip of small thumbnails under the text is what the left-hand picture replaces');
});

test('the picture is asked for at a sensible size', () => {
  assert.match(card, /evImgSrc\(thumbSrc, base, \d+\)/,
    'uploads are full-size; the server can render a small one (see asset-resize)');
});

test('the home-page blurb is finally read', () => {
  assert.match(card, /opts\.thumb && ev\.homeBlurb\) \? ev\.homeBlurb : \(ev\.summary \|\| ''\)/,
    'the field exists, is saved, and until now nothing displayed it');
  assert.match(card, /esc\(blurb\)/, 'and it is escaped like everything else');
});

test('the server still stores both fields', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /thumbnail: b\.thumbnail !== undefined/);
  assert.match(routes, /homeBlurb: String\(b\.homeBlurb/);
});

test('the layout has somewhere to put the picture', () => {
  const css = read('css/chamber.css');
  assert.match(css, /\.event-row--thumb \{[^}]*grid-template-columns/,
    'the 84px date column is too narrow for artwork');
  assert.match(css, /\.event-row__lead \{/, 'date and picture share the one grid cell');
  assert.match(css, /\.event-thumb \{[^}]*object-fit: contain/,
    'contain, not cover — a portrait flyer must not be cropped and a wide logo must not stretch');
  assert.match(css, /@media \(max-width: 640px\)[\s\S]{0,400}\.event-row--thumb/,
    'phones need the narrower version too');
});

test('the office is told what the two fields actually do', () => {
  const html = read('admin/events.html');
  assert.match(html, /Thumbnail <span class="sub">\(the picture beside the date on the home page/,
    '"square; shown on cards" told nobody where it lands');
  assert.match(html, /Home-page blurb <span class="sub">\(optional — replaces the Summary/);
});
