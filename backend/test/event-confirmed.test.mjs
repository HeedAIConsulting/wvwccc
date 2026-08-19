/* Felicia, Aug 19 2026: she added the November 18 mixer, saved it, saw it in
   Admin - and it never appeared on the public calendar. The cause was in
   buildEvent: `existing.confirmed ?? !!date`. ?? falls through on null and
   undefined but NOT on false, so an event first saved without a date stuck at
   confirmed:false, and adding the date later could never clear it. The public
   list filters on `e.confirmed && e.date`, so the event stayed invisible with
   nothing on screen to explain why.

   These pin the rule: a date means confirmed, unless a caller says otherwise.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvent } from '../chamber-routes.js';

test('a new dated event is confirmed, so it reaches the calendar', () => {
  const ev = buildEvent({ title: 'November 18th Networking Mixer', date: '2026-11-18' });
  assert.equal(ev.confirmed, true);
});

test('adding a date to an event saved without one un-sticks it (the actual bug)', () => {
  const dateless = buildEvent({ title: 'Mixer' });          // no date yet
  assert.equal(dateless.confirmed, false, 'no date means not yet confirmed');
  const dated = buildEvent({ date: '2026-11-18' }, dateless); // office fills the date in
  assert.equal(dated.confirmed, true, 'adding the date must confirm it — this is what regressed');
});

test('an explicit confirmed:false still wins, for a date not yet settled', () => {
  const ev = buildEvent({ title: 'Ribbon cutting', date: '2026-12-01', confirmed: false });
  assert.equal(ev.confirmed, false);
});

test('a dateless event stays unconfirmed', () => {
  const ev = buildEvent({ title: 'Date to be announced' });
  assert.equal(ev.confirmed, false);
});

test('editing a confirmed event does not lose the flag', () => {
  const first = buildEvent({ title: 'Mixer', date: '2026-11-18' });
  const edited = buildEvent({ venue: 'FAIRWINDS - West Hills' }, first);
  assert.equal(edited.confirmed, true);
  assert.equal(edited.date, '2026-11-18');
});
