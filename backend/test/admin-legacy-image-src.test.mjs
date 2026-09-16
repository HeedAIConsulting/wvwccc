/* Found in Felicia's own session log, Sep 15 2026: while she had the Oct 21
   Food & Wine event open in Admin → Events, the browser asked for

       GET /admin/assets/events/11262.jpg → 404

   and drew a broken image box where the event's picture should be. Artwork
   imported from the old website is stored as a path relative to the site root —
   "assets/events/11262.jpg". The public pages resolve that correctly because
   each one knows its own depth (evImgSrc prepends the base). The admin pages
   live under /admin/, so the very same string resolves one folder too deep.

   On the live site 23 event images and 2 flyers are stored this way, so this is
   not one stray record — it is every legacy event, and the office has been
   editing them half-blind.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const admin = read('admin/admin.js');

// The real shipped helper — admin.js's top level is pure, so it evaluates with
// nothing but a window object.
const win = {};
new Function('window', admin)(win);
const { adminSrc } = win.Admin;

test('a legacy site-relative path is rooted', () => {
  assert.equal(adminSrc('assets/events/11262.jpg'), '/assets/events/11262.jpg');
  assert.equal(adminSrc('./assets/events/11262.jpg'), '/assets/events/11262.jpg');
  assert.equal(adminSrc('images/logo.png'), '/images/logo.png');
});

test('anything already resolvable is left exactly as it is', () => {
  for (const u of [
    '/api/assets/asset-msqdn9nm53',
    'https://woodlandhillscc.net/images/a.png',
    'http://example.test/a.png',
    'data:image/png;base64,AAAA',
    'blob:http://localhost/9f1',
  ]) assert.equal(adminSrc(u), u);
});

test('nothing in, nothing out — never a bare "/"', () => {
  for (const v of ['', null, undefined, '   ']) assert.equal(adminSrc(v), '');
});

test('every stored-image preview on the event form goes through it', () => {
  const form = admin.slice(admin.indexOf('async function initEvents'), admin.indexOf('async function initBoardManager'));
  for (const [what, src] of [
    ['event images', 'adminSrc(imgSrcOf(it))'],
    ['extra flyers', 'adminSrc(u)'],
    ['sponsor logos', 'adminSrc(s.src)'],
    ['flyer and thumbnail', 'adminSrc(get())'],
  ]) assert.ok(form.includes(src), `${what} still render the stored value raw`);
});

test('the public side already handled it — do not "fix" it there', () => {
  // evImgSrc prepends the page's own base; that is why the same records look
  // right on the website and wrong in the admin form.
  const chamber = read('js/chamber.js');
  assert.match(chamber, /function evImgSrc\(u, base, w\)/);
  assert.match(chamber, /\/\^\(https\?:\|\\\/\|data:\)\/i\.test\(u\) \? u : \(base \|\| ''\) \+ u/);
});
