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

/* Felicia, Sep 25 2026: "Can you please make the featured image box (including
   the outer white area) so it is the same size as the 'New To The Area Box'?
   (As the old site was)"

   Nothing bounded that card: it took the width of the hero column and whatever
   height the uploaded picture asked for, so it measured 485 by 525 next to a
   promo box of 340 by 228. Four of the five numbers are written down on both
   sides now and the tests below hold them together; the height is the one that
   has to be measured, because the promo's is its own content's. */
const promoRule = () => {
  const js = read('js/partials.js');
  const from = js.indexOf(".guide-promo{position:fixed");
  const to = js.indexOf("document.head.appendChild(st)", from);
  return js.slice(from, to);
};
const cardRule = () => {
  const css = read('css/chamber.css');
  const from = css.indexOf('.hero .hero__feature { --feature-h');
  return css.slice(from, css.indexOf('}', from));
};

test('the card carries the promo box\'s width, padding and corner', () => {
  const promo = promoRule();
  const card = cardRule();
  const pair = (re, label) => {
    const a = re.exec(promo), b = re.exec(card);
    assert.ok(a, `the guide promo no longer sets ${label} — re-measure the box`);
    assert.ok(b, `the featured card no longer sets ${label}`);
    assert.equal(b[1].trim(), a[1].trim(),
      `${label}: card has ${b[1].trim()}, promo has ${a[1].trim()}`);
  };
  pair(/max-width:\s*([^;]+);/, 'max-width');
  pair(/padding:\s*([^;]+);/, 'padding');
  pair(/border-radius:\s*([^;]+);/, 'border-radius');
});

test('the card is pinned to a height rather than following the picture', () => {
  const card = cardRule();
  assert.match(card, /--feature-h:\s*228px/,
    'the promo box measures 228px tall at 1440 — see the comment above the rule');
  assert.match(card, /height:\s*var\(--feature-h\)/, 'and the card is held to it');
  assert.match(card, /display:\s*flex/);
  assert.match(card, /flex-direction:\s*column/);
});

test('the picture is what absorbs the slack inside that height', () => {
  // Otherwise a tall flyer pushes the date and title out of a fixed-height box.
  const css = read('css/chamber.css');
  const img = /\.hero \.hero__feature \.spotlight-img \{([^}]*)\}/.exec(css);
  assert.ok(img, 'the card still bounds its own picture');
  assert.match(img[1], /flex:\s*1/, 'the frame takes what the label, date and title leave');
  assert.match(img[1], /min-height:\s*0/, 'and may shrink below the picture, or it overflows');
  assert.match(img[1], /max-height:\s*none/, 'the 300px cap outside the card would win otherwise');
  assert.match(css, /\.hero \.hero__feature \.spotlight-when \{[^}]*flex:\s*none/,
    'the date block keeps its size while the picture gives way');
  assert.match(css, /\.hero \.hero__feature > \.mt-4 > a \{[^}]*height:\s*100%/,
    'the link between the card and the picture has to pass the height down');
});

test('a long event name is clamped instead of eating the picture', () => {
  const css = read('css/chamber.css');
  const rule = /\.hero \.hero__feature \.spotlight-when__title \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'a two-line clamp on the title');
  assert.match(rule[1], /-webkit-line-clamp:\s*2/);
  assert.match(rule[1], /overflow:\s*hidden/);
});

test('nothing in the card is white text on the white card', () => {
  /* The card went solid white for readability over the hero photo; three
     colours were left behind from the translucent version. "Spotlights are
     chosen by Chamber staff and rotate weekly." was white on white — invisible,
     and two lines of a 228px box — so it is gone rather than restyled. */
  const html = read('index.html');
  const aside = html.slice(html.indexOf('<aside class="hero__feature'),
    html.indexOf('</aside>', html.indexOf('<aside class="hero__feature')));
  assert.ok(!/color:\s*#fff/i.test(aside), 'no white text left in the featured card');
  assert.ok(!/Spotlights are chosen by Chamber staff/.test(html),
    'the invisible standing line is gone, not merely restyled');

  const js = read('js/chamber.js');
  const branch = js.slice(js.indexOf('} else if (spotlight.member)'),
    js.indexOf('heroAside.hidden = false;', js.indexOf('} else if (spotlight.member)')));
  assert.ok(!/color:\s*#fff/i.test(branch),
    'a featured member used to render its name in white on the white card');
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(branch),
    'and its category line in white at 65%');
});
