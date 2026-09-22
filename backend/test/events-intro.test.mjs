/* Felicia, Sep 18 2026, relaying Diana: "Diana noticed on our event page at the
   top that the text still says 'Black, White & Bold! On July 25th. RSVP and buy
   tickets right here.' ... I couldn't find where to edit that text. Please
   advise."

   There was nothing to find. The sentence was typed into events/index.html in
   July, so the only way to change it was a developer and a deploy, and it went
   on advertising a July event into late September.

   It is a setting now, edited in Admin → Events. The page still carries the
   standing sentence in its own markup — a visitor should not have to wait for
   a fetch to learn what the page is about, and a search engine should not have
   to run our JavaScript to read it.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

test('the July gala is gone from the events page', () => {
  const html = read('events/index.html');
  assert.ok(!/Black, White/i.test(html), 'the stale July sentence is still on the page');
  assert.ok(!/July 25/i.test(html), 'the page still names a date that has passed');
});

test('the page still says what it is without waiting for a fetch', () => {
  const html = read('events/index.html');
  const m = html.match(/<p class="lead" data-events-intro[^>]*>\s*([^<]+?)\s*<\/p>/);
  assert.ok(m, 'the intro paragraph should be tagged data-events-intro');
  assert.match(m[1], /breakfasts/i, 'and should read as a sentence on its own');
  // Whatever the markup says has to be what an unset site serves, or the line
  // visibly changes under the visitor a moment after the page paints.
  const routes = read('backend/chamber-routes.js');
  const dflt = routes.match(/const EVENTS_INTRO_DEFAULT =\s*'([^']+)'/);
  assert.ok(dflt, 'there should be a named default');
  assert.equal(m[1], dflt[1], 'the markup default and the server default must be the same sentence');
});

test('the office edits it where it edits the rest of the events page', () => {
  const html = read('admin/events.html');
  assert.match(html, /id="evIntro"/, 'a box to type it in');
  assert.match(html, /id="evIntroSave"/, 'and a button to save it');
  assert.match(html, /What this page says at the top/,
    'labelled as what it is, not as "intro" — the office reads the label, not the id');

  const js = read('admin/admin.js');
  assert.match(js, /getElementById\('evIntro'\)/);
  assert.match(js, /'\/api\/admin\/event-settings', \{ method: 'POST', body: JSON\.stringify\(\{ intro: introEl\.value \}\)/,
    'saving the line must not also rewrite the leader-publish switch');
  assert.match(js, /if \(introEl\) introEl\.value = s\.intro/, 'and the box loads what is currently set');
});

test('emptying the box restores the standing sentence rather than blanking the page', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /cleanIntro\(b\.intro\) \|\| EVENTS_INTRO_DEFAULT/);
});

test('the public page can read it without signing in', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /router\.get\('\/events-intro'/, 'a public route');
  const introRoute = routes.slice(routes.indexOf("router.get('/events-intro'"), routes.indexOf("// The Diana switch"));
  assert.ok(!/requireAdmin/.test(introRoute), 'visitors are not signed in');

  const js = read('js/chamber.js');
  assert.match(js, /\[data-events-intro\]/);
  assert.match(js, /\/api\/events-intro/);
  assert.match(js, /if \(t\) introEl\.textContent = t;/,
    'textContent, not innerHTML — this line is office-typed text, not markup');
});

test('the leader-publish switch still works alongside it', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /if \(b\.leaderInstantPublish !== undefined\) await repo\.setSetting\('leaderInstantPublish'/,
    'an intro-only save must leave the switch alone, and the other way round');
});
