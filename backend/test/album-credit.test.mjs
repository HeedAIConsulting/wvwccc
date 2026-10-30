/* Robyn Richardson, Oct 30 2026, on the Food & Wine Tour album: "For the photo
   credit line above the gallery, can you add "RichardsonPortraits.com" after
   my name?"

   An album's description could only be set when the album was made, so the
   office had no way to do it. Admin → Photo Albums now has a description box
   on every album card, a web address in it becomes a link on the album page,
   and this album's line is set once.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { ALBUM_CREDIT_FIX, albumCreditFix } from '../chamber-routes.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const JS = read('js/chamber.js');

function linkify() {
  const escLine = JS.slice(JS.indexOf('  const esc = (s) =>'), JS.indexOf('}[c]));', JS.indexOf('  const esc = (s) =>')) + '}[c]));'.length);
  const a = JS.indexOf('  function linkifyText(s)');
  const b = JS.indexOf('  // One photo, with its own share row.');
  assert.ok(escLine && a > 0 && b > a, 'the helper moved; update this test');
  const ctx = { String };
  vm.createContext(ctx);
  vm.runInContext(escLine.replace('const esc', 'var esc') + '\n' + JS.slice(a, b) + '\nthis.linkifyText = linkifyText;', ctx);
  return ctx.linkifyText;
}
const linkifyText = linkify();

test('her website becomes a link after her name', () => {
  assert.equal(linkifyText('Photos by Robyn Richardson, RichardsonPortraits.com'),
    'Photos by Robyn Richardson, <a href="https://RichardsonPortraits.com" target="_blank" rel="noopener">RichardsonPortraits.com</a>');
  assert.equal(linkifyText('See https://richardsonportraits.com/gallery.'),
    'See <a href="https://richardsonportraits.com/gallery" target="_blank" rel="noopener">https://richardsonportraits.com/gallery</a>.',
    'a full address, without the full stop after it');
  assert.match(linkifyText('www.example.org'), /href="https:\/\/www\.example\.org"/);
});

test('nothing else turns into markup', () => {
  assert.equal(linkifyText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!/<a/.test(linkifyText('javascript:alert(1)')));
  assert.ok(!/<a/.test(linkifyText('Write to robyn@richardsonportraits.com')), 'an email address is left as text');
  assert.ok(!/<a/.test(linkifyText('Mr. Smith paid $1.50')));
  assert.ok(!/"[^"]*"[^>]*onmouseover/.test(linkifyText('x.com/"onmouseover="alert(1)')), 'a quote cannot break out of the link');
});

test('the album page links it; the gallery card, itself a link, does not', () => {
  assert.match(JS, /<p class="lead" style="max-width:62ch">\$\{linkifyText\(album\.body\)\}<\/p>/);
  assert.match(JS, /\$\{a\.body \? `<p>\$\{esc\(a\.body\)\}<\/p>` : ''\}/);
});

test('the office can change an album description in Admin', () => {
  const admin = read('admin/admin.js');
  assert.match(admin, /<input data-abf="body" value="\$\{esc\(a\.body \|\| ''\)\}"/);
  assert.match(admin, /row\.querySelector\('\[data-abf="body"\]'\)\.addEventListener\('change', async \(e\) => \{\s*try \{ await save\(id, \{ body: e\.target\.value\.trim\(\) \}\);/);
});

test("the Food & Wine Tour credit line is set once, and only if untouched", () => {
  const album = { id: 'alb-mvu3wnlq', body: 'Photos by Robyn Richardson.' };
  assert.equal(albumCreditFix(album), 'Photos by Robyn Richardson, RichardsonPortraits.com');
  assert.equal(albumCreditFix({ ...album, body: 'Something the office wrote' }), null, 'an edit is never stomped');
  assert.equal(albumCreditFix({ ...album, id: 'alb-other' }), null);
  assert.equal(albumCreditFix(null), null);
  assert.equal(ALBUM_CREDIT_FIX.to, 'Photos by Robyn Richardson, RichardsonPortraits.com');
  const src = read('backend/chamber-routes.js');
  assert.match(src, /const KEY = 'albumCredit-20261030';/);
  assert.match(src, /async function loadAlbums\(\) \{\n  await applyAlbumCreditFix\(\);/, 'runs when albums are first loaded');
});
