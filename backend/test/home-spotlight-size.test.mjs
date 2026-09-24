/* Felicia, Sep 18 2026: "Featured Image on homepage top right. Can you have it
   so that image is much smaller like our thumbnails for the 4 featured events?
   ... Diana also likes that if we feature an event, the date will be displayed."

   Diana, Sep 22, with the numbers: "The size you had it the first time around
   was proportionate to the page. Landscape 600 by 300px Portrait 300 by 600px."

   The picture in that slot was rendered at width:100% and nothing else, so the
   card stretched whatever the office uploaded to the full width of the hero
   column. The one on the site is 280x522, which is already about Diana's
   portrait size — the file was never the problem, the slot was. Bounding the
   height instead lets a 600x300 sit across the card and brings a 300x600 down
   to 150x300, close to the 170px the four featured events use.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

test('the picture is bounded, not stretched to the column', () => {
  const js = read('js/chamber.js');
  const css = read('css/chamber.css');
  assert.match(js, /<img class="spotlight-img"/, 'the image carries the class that bounds it');
  assert.ok(!/<img src="\$\{esc\(spotlight\.image\)\}" alt="[^"]*" style="width:100%/.test(js),
    'the old inline width:100% is what made a portrait flyer run down the page');

  const rule = css.slice(css.indexOf('.spotlight-img {'), css.indexOf('.spotlight-when {'));
  assert.match(rule, /max-height:\s*300px/, "Diana's landscape height is the cap");
  assert.match(rule, /max-width:\s*100%/, 'and it never overflows the card');
  assert.match(rule, /width:\s*auto/, 'width follows the picture, so nothing is squashed');
  assert.match(rule, /object-fit:\s*contain/, 'a flyer is never cropped');
});

test('a portrait comes down to about the size of an event thumbnail', () => {
  // Diana's portrait is 300x600. Capped at 300 tall it renders 150 wide, which
  // is the "much smaller, like our thumbnails" Felicia asked for — those are
  // 124px wide with a 170px cap.
  const css = read('css/chamber.css');
  const cap = Number(/\.spotlight-img \{[^}]*max-height:\s*(\d+)px/.exec(css)[1]);
  const thumbCap = Number(/\.event-thumb \{[^}]*max-height:\s*(\d+)px/.exec(css)[1]);
  const portraitWidth = Math.round(300 * (cap / 600));
  assert.ok(cap <= thumbCap * 2, `spotlight caps at ${cap}px against a ${thumbCap}px event thumbnail`);
  assert.ok(portraitWidth >= 100 && portraitWidth <= 200,
    `a 300x600 portrait would render ${portraitWidth}px wide`);
});

test('the date shows when the spotlight points at an event', () => {
  const js = read('js/chamber.js');
  assert.match(js, /async function spotlightEventDate\(href, slot\)/);
  assert.match(js, /spotlightEventDate\(spotlight\.href, hero\.querySelector\('\[data-spotlight-when\]'\)\)/);
  const fn = js.slice(js.indexOf('async function spotlightEventDate'), js.indexOf('// ── Groups & networks'));
  assert.match(fn, /event-date__mo/, 'the same date block the event rows use');
  assert.match(fn, /events\\\/view\\\.html/, 'and only for a link that names an event');
});

test('a spotlight that is not an event is left alone', () => {
  // It may point at a member page or an outside site; neither should be
  // decorated with a date, and neither should throw.
  const js = read('js/chamber.js');
  const fn = js.slice(js.indexOf('async function spotlightEventDate'), js.indexOf('// ── Groups & networks'));
  assert.match(fn, /if \(!m \|\| !\/events/, 'no event id in the link, nothing to do');
  assert.match(fn, /catch \(e\) \{ return; \}/, 'and a failed lookup leaves the picture as it is');
  assert.match(fn, /!ev\.month \|\| !ev\.day/, 'an undated event shows no date rather than a blank block');
});

test('the picture still renders before the date lookup finishes', () => {
  /* The image is written into the card and only then is the event fetched, so a
     slow or failed lookup costs nothing — the picture is the point. */
  const js = read('js/chamber.js');
  const branch = js.slice(js.indexOf("if (spotlight.type === 'image'"), js.indexOf('} else if (spotlight.member)'));
  assert.ok(branch.indexOf('hero.innerHTML') < branch.indexOf('spotlightEventDate'),
    'the card is filled first, then decorated');
  assert.ok(!/await spotlightEventDate/.test(branch), 'and the page never waits on it');
});
