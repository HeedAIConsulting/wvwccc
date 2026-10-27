/* Felicia, Oct 27 2026, on Circus Vargas (Oct 23 - Nov 16): "When I look on
   the events in the chronological listing it is showing up as Oct. 23rd
   (Which has past and should be gone) but no other dates are listed. We want
   it to be on both views please!"

   The month calendar already put a multi-day event on every day it runs. The
   list drew only its first day and sorted it there. Now an event already
   under way is listed under today with its whole run on the row, and a
   one-day event is untouched.

   The helpers are run here for real out of js/chamber.js.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../js/chamber.js', import.meta.url), 'utf8');

function helpers() {
  const pad = SRC.slice(SRC.indexOf('  function _pad(n)'), SRC.indexOf('\n', SRC.indexOf('  function _pad(n)')));
  const a = SRC.indexOf('  function evLastDay(ev)');
  const b = SRC.indexOf('  function _ymd(d)');
  assert.ok(pad && a > 0 && b > a, 'the date helpers moved; update this test');
  const ctx = { Number, String, Date };
  vm.createContext(ctx);
  vm.runInContext(pad + '\n' + SRC.slice(a, b) + '\nthis.asListed = asListed; this.runLabel = runLabel; this.localToday = localToday;', ctx);
  return ctx;
}
const { asListed, runLabel, localToday } = helpers();
const circus = { id: 'ev-c', title: 'Circus Vargas', date: '2026-10-23', endDate: '2026-11-16', month: 'Oct', day: '23' };
const mixer = { id: 'ev-m', title: 'Mixer', date: '2026-11-18', month: 'Nov', day: '18' };

test('a run already under way is listed under today', () => {
  const l = asListed(circus, '2026-10-27');
  assert.equal(l.listDate, '2026-10-27');
  assert.equal(l.month, 'Oct');
  assert.equal(l.day, '27');
  assert.equal(l.date, '2026-10-23', 'the real start date is left alone');
  assert.equal(circus.day, '23', 'the event itself is not changed');
  const nov = asListed(circus, '2026-11-02');
  assert.deepEqual([nov.month, nov.day], ['Nov', '2']);
});

test('before it starts, on its first day and on its last day', () => {
  assert.equal(asListed(circus, '2026-10-20'), circus, 'not started: listed under its own first day');
  assert.equal(asListed(circus, '2026-10-23'), circus, 'first day: already today');
  assert.equal(asListed(circus, '2026-11-16').day, '16', 'last day: still listed, under today');
});

test('a one-day event is never moved', () => {
  assert.equal(asListed(mixer, '2026-11-18'), mixer);
  assert.equal(asListed(mixer, '2026-10-27'), mixer);
  assert.equal(asListed({ ...mixer, endDate: mixer.date }, '2026-10-27').listDate, undefined);
});

test('the row shows the whole run', () => {
  assert.equal(runLabel(circus), 'Oct 23 – Nov 16');
  assert.equal(runLabel(mixer), '');
  assert.equal(runLabel({ ...mixer, endDate: '2026-11-18' }), '');
});

test('"today" is the local date, not UTC', () => {
  // 8 PM on Oct 27 in California is already Oct 28 in UTC.
  class Evening { getFullYear() { return 2026; } getMonth() { return 9; } getDate() { return 27; } toISOString() { return '2026-10-28T03:00:00.000Z'; } }
  const a = SRC.indexOf('  function evLastDay(ev)');
  const ctx = { Number, String, Date: Evening };
  vm.createContext(ctx);
  vm.runInContext(SRC.slice(SRC.indexOf('  function _pad(n)'), SRC.indexOf('\n', SRC.indexOf('  function _pad(n)')))
    + '\n' + SRC.slice(a, SRC.indexOf('  function _ymd(d)')) + '\nthis.localToday = localToday;', ctx);
  assert.equal(ctx.localToday(), '2026-10-27');
  assert.equal(typeof localToday(), 'string');
});

test('the list, the cards, the detail and the homepage all use it', () => {
  const list = SRC.slice(SRC.indexOf('function renderList()'), SRC.indexOf('renderList();', SRC.indexOf('function renderList()')));
  assert.match(list, /filtered\.map\(\(e\) => asListed\(e, today\)\)\s*\.sort\(\(a, b\) => \(a\.listDate \|\| a\.date\)\.localeCompare\(b\.listDate \|\| b\.date\)\)/);
  assert.match(SRC, /const dateUS = ev\.date \? us\(ev\.date\) \+ \(evLastDay\(ev\) !== ev\.date \? ' – ' \+ us\(evLastDay\(ev\)\) : ''\)/, 'quick row shows the run');
  assert.match(SRC, /const when = confirmed \? `\$\{esc\(runLabel\(ev\) \|\| `\$\{ev\.month\} \$\{ev\.day\}`\)\}/, 'card shows the run');
  assert.match(SRC, /const barWhen = [^;]*runLabel\(ev\)/, 'detail shows the run, not the listed day');
  assert.match(SRC, /eventCard\(asListed\(e, todayISO\), 0, \{ thumb: true \}\)/, 'homepage featured list');
  assert.match(SRC, /const todayISO = localToday\(\);/);
});
