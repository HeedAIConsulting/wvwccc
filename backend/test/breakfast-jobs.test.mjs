/* Felicia, Nov 5 2026: (1) Ambassador sign-ups at breakfasts and mixers,
   "2 per category: Greeter, Name Tags, Check In, Floater, Packing Items Up";
   (2) instructions she can forward so members post their own events.
   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const FELICIA = ['Greeter', 'Name Tags', 'Check In', 'Floater', 'Packing Items Up'];

test('the breakfast/mixer jobs are the five Felicia named, two people each', async () => {
  const { BREAKFAST_MIXER_ROLES } = await import('../chamber-routes.js');
  assert.deepEqual(BREAKFAST_MIXER_ROLES.map((r) => r.role), FELICIA);
  assert.ok(BREAKFAST_MIXER_ROLES.every((r) => r.needed === 2 && r.points > 0));
});

test('the admin button adds the same five', () => {
  const js = read('admin/admin.js');
  const block = js.slice(js.indexOf('const BREAKFAST_JOBS = ['), js.indexOf('];', js.indexOf('const BREAKFAST_JOBS = [')));
  assert.deepEqual([...block.matchAll(/role: '([^']+)'/g)].map((m) => m[1]), FELICIA);
  assert.match(js, /for \(const p of BREAKFAST_JOBS\)/);
  assert.match(js, />\+ Add the breakfast\/mixer jobs</);
});

test('the next breakfasts and mixers get the jobs once, only while they have none', async () => {
  const { breakfastMixerJobsFor, BREAKFAST_MIXER_EVENTS } = await import('../chamber-routes.js');
  assert.deepEqual(BREAKFAST_MIXER_EVENTS, ['ev-msz4whul5c4', 'le-11223', 'le-office-20261216-mixer']);
  const roles = breakfastMixerJobsFor({ id: 'le-11223', volunteerRoles: [] });
  assert.deepEqual(roles.map((r) => r.role), FELICIA);
  assert.equal(breakfastMixerJobsFor({ id: 'le-11223' }).length, 5, 'no roles field at all');
  // The office already set its own jobs: left alone.
  assert.equal(breakfastMixerJobsFor({ id: 'le-11223', volunteerRoles: [{ role: 'Raffle', points: 6, needed: 1 }] }), null);
  // Any other event: left alone.
  assert.equal(breakfastMixerJobsFor({ id: 'ce-mt96lvc2', volunteerRoles: [] }), null);
  assert.equal(breakfastMixerJobsFor(null), null);
  // A fresh copy, not the shared list.
  roles[0].needed = 9;
  assert.equal(breakfastMixerJobsFor({ id: 'le-11223' })[0].needed, 2);
  const src = read('backend/chamber-routes.js');
  assert.match(src, /const KEY = 'breakfastMixerJobs-20261105';/);
  assert.match(src, /await applyNov4BlurbLines\(\);\n  await applyBreakfastMixerJobs\(\);/);
});

test('every label the members’ event guide names is on the real pages', () => {
  const guide = read('member/event-guide.html');
  const form = read('member/event.html');
  const dash = read('member/member.js');
  const login = read('auth/login.html');
  const header = read('js/partials.js');
  const on = {
    'Member Login': header, 'Email me a sign-in link': login, 'Email me a link': login,
    'Your events on the calendar': dash, '＋ Add an event': dash, 'Edit': dash, 'Duplicate': dash,
    'awaiting the office': dash, 'Posting as': form, 'Event name': form, 'Date': form, 'Category': form,
    'Start time': form, 'End time': form, 'Location / venue': form, 'Address': form, 'Description': form,
    '🔗 Link': form, 'Repeats?': form, 'Every week': form, 'Monthly (e.g. first Monday)': form, 'One time': form,
    'RSVP button': form, 'Add an RSVP button': form, 'Email RSVPs to': form, 'Flyer': form, 'Add to calendar': form,
  };
  for (const m of guide.matchAll(/<strong>([^<]+)<\/strong>/g)) {
    const label = m[1].replace(/[“”]/g, '').trim();
    if (/woodlandhillscc\.net|Support|\(818\)/.test(label)) continue;
    assert.ok(on[label], `guide names "${label}" but the test does not know which page has it`);
    assert.ok(on[label].includes(label), `"${label}" is not on its page any more`);
  }
});

test('the dashboard and the FAQ point to the guide', () => {
  assert.match(read('member/member.js'), /href="event-guide\.html"/);
  const faq = read('help.html');
  assert.match(faq, /href="member\/event-guide\.html"/);
  assert.equal(/If you lead a Chamber group or circle, or serve on the board, you can add events yourself/.test(faq), false,
    'the FAQ no longer says only leaders can post');
});
