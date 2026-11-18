/* Michael, Nov 17 2026 — Groups:
   1. add people to groups by name, not just company
   2. the group email has to look like an email, not three pop-up steps
   3. repeating meetings ("the first Wednesday of the month") with visible
      options and a pop-up calendar
   4. future meetings shown, and past ones behind an expand button rather than
      "13 past meetings not shown."
   5. many photos at once into a meeting's gallery
   6. Add to calendar on the event and in the emails
   7. a group page older members can follow: one job at a time

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

// js/group-tools.js is a browser script; run it with a bare window.
function tools() {
  const ctx = { window: {}, document: {} };
  vm.runInNewContext(read('js/group-tools.js'), ctx);
  return ctx.window;
}

test('repeat: the first Wednesday of every month lands on the right dates', () => {
  const { WVRecur } = tools();
  assert.deepEqual(
    [...WVRecur.datesFor({ start: '2026-12-01', how: 'monthly', weekday: 3, nth: 1, months: 6 })],
    ['2026-12-02', '2027-01-06', '2027-02-03', '2027-03-03', '2027-04-07', '2027-05-05']);
  // The last Thursday, including a month with five.
  assert.deepEqual(
    [...WVRecur.datesFor({ start: '2026-11-01', how: 'monthly', weekday: 4, nth: 5, months: 3 })],
    ['2026-11-26', '2026-12-31', '2027-01-28']);
  // The start date itself only counts when it fits.
  assert.equal(WVRecur.datesFor({ start: '2026-12-03', how: 'monthly', weekday: 3, nth: 1, months: 1 })[0], '2027-01-06');
});

test('repeat: weekly and every other week, capped at one save', () => {
  const { WVRecur } = tools();
  assert.deepEqual([...WVRecur.datesFor({ start: '2026-12-01', how: 'weekly', weekday: 2, months: 1 })],
    ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22', '2026-12-29']);
  assert.deepEqual([...WVRecur.datesFor({ start: '2026-12-01', how: 'biweekly', weekday: 5, months: 1 })],
    ['2026-12-04', '2026-12-18']);
  assert.equal(WVRecur.datesFor({ start: '2026-12-01', how: 'weekly', weekday: 2, months: 12 }).length, WVRecur.MAX_DATES);
  assert.deepEqual([...WVRecur.datesFor({ start: '2026-12-09', how: 'once' })], ['2026-12-09']);
});

test('repeat: a picked date suggests its own pattern, and says it plainly', () => {
  const { WVRecur } = tools();
  assert.deepEqual({ ...WVRecur.patternOf('2026-12-02') }, { weekday: 3, nth: 1 });   // 1st Wednesday
  assert.deepEqual({ ...WVRecur.patternOf('2026-11-26') }, { weekday: 4, nth: 5 });   // 4th and last Thursday → "Last"
  assert.deepEqual({ ...WVRecur.patternOf('2026-12-17') }, { weekday: 4, nth: 3 });   // 3rd Thursday
  assert.equal(WVRecur.describe({ how: 'monthly', weekday: 3, nth: 1 }), 'the first Wednesday of every month');
  assert.equal(WVRecur.describe({ how: 'biweekly', weekday: 1 }), 'every other Monday');
});

test('people: a group member is found and added by their own name', () => {
  const { WVPeople } = tools();
  const dir = [
    { id: 'm1', name: 'Agency, The', category: 'Real Estate', contactName: 'Michael Okafor', team: [{ name: 'Jane Roe', title: 'Broker' }, { name: 'michael okafor' }] },
    { id: 'm2', name: 'Heed Consulting Group', category: 'Business Consultant', contactName: 'Pat Lee' },
  ];
  const jane = WVPeople.searchPeople(dir, 'jane')[0];
  assert.equal(jane.person, 'Jane Roe');
  assert.equal(jane.business, 'Agency, The');
  assert.deepEqual({ ...WVPeople.rowFor(jane) }, { memberId: 'm1', name: 'Jane Roe', business: 'Agency, The' });
  // A first name finds the person first; the team list does not repeat the contact.
  const mich = WVPeople.searchPeople(dir, 'mich');
  assert.equal(mich[0].person, 'Michael Okafor');
  assert.equal(mich.filter((p) => /michael/i.test(p.person)).length, 1);
  // The business can still be picked as itself.
  const biz = WVPeople.searchPeople(dir, 'heed')[0];
  assert.equal(biz.person, '');
  assert.deepEqual({ ...WVPeople.rowFor(biz) }, { memberId: 'm2', name: 'Heed Consulting Group', business: 'Business Consultant' });
  // Two people from one listing are two roster rows; the same person is one.
  const roster = [{ memberId: 'm1', name: 'Michael Okafor' }];
  assert.equal(WVPeople.onRoster(roster, mich[0]), true);
  assert.equal(WVPeople.onRoster(roster, jane), false);
  assert.match(WVPeople.suggestionHtml(jane), /<b>Jane Roe<\/b><span>Broker · Agency, The<\/span>/);
});

test('add to calendar: Google, Outlook and Apple links in Chamber time', async () => {
  const { calendarLinks, eventEmailBlock, laOffset } = await import('../calendar-links.js');
  assert.equal(laOffset('2026-12-18', 17, 30), '-08:00');
  assert.equal(laOffset('2026-07-15', 9, 0), '-07:00');
  const ev = { id: 'ev-1', title: 'Holiday Social & Mixer', date: '2026-12-18', time: '5:30 PM', endTime: '7:00 PM', venue: 'Safir', address: '1 Main St, Woodland Hills', summary: 'Join us.' };
  const l = calendarLinks(ev, 'https://woodlandhillscc.net');
  assert.match(l.google, /&dates=20261218T173000\/20261218T190000&ctz=America%2FLos_Angeles/);
  assert.match(l.outlook, /&startdt=2026-12-18T17%3A30%3A00-08%3A00&enddt=2026-12-18T19%3A00%3A00-08%3A00/);
  assert.equal(l.ics, 'https://woodlandhillscc.net/api/events/ev-1.ics');
  assert.equal(l.page, 'https://woodlandhillscc.net/events/view.html?id=ev-1');
  // No time on file → an all-day entry; an end before the start → two hours.
  assert.match(calendarLinks({ ...ev, time: '' }, '').google, /&dates=20261218\/20261219&/);
  assert.match(calendarLinks({ ...ev, endTime: '5:00 PM' }, '').google, /T173000\/20261218T193000/);
  assert.equal(calendarLinks({ ...ev, date: '' }, ''), null);
  const block = eventEmailBlock(ev, 'https://woodlandhillscc.net', { heading: 'Coming up' });
  assert.match(block.html, /Holiday Social &amp; Mixer/);
  assert.match(block.html, /📅 Add to your calendar/);
  for (const b of ['>Google</a>', '>Outlook</a>', '>Apple / iPhone</a>']) assert.ok(block.html.includes(b), b);
  assert.match(block.text, /Add to your calendar:\nGoogle: https:\/\/calendar\.google\.com/);
  assert.match(block.text, /Apple \/ iPhone: https:\/\/woodlandhillscc\.net\/api\/events\/ev-1\.ics/);
});

test('group emails carry the attached meeting, and only one of that group\'s', () => {
  const src = read('backend/chamber-routes.js');
  assert.match(src, /async function sendGroupAnnouncement\(g, subject, message, req, eventId = ''\)/);
  assert.match(src, /eventsOfGroup\(g, await loadEvents\(\)\)\n\s+\.find\(\(e\) => e\.id === String\(eventId\) && \(e\.status \|\| 'approved'\) === 'approved'\)/);
  assert.equal((src.match(/sendGroupAnnouncement\(g, subject, message, req, req\.body && req\.body\.eventId\)/g) || []).length, 2);
  // The RSVP confirmation gets the calendar buttons too.
  assert.match(src, /const cal = eventEmailBlock\(rsvpEvent, siteBase\(req\)\);/);
  // A leader's meeting album is tied to the meeting only when it is theirs.
  assert.match(src, /const ev = eventsOfGroup\(g, await loadEvents\(\)\)\.find\(\(e\) => e\.id === String\(req\.body\.eventId\)\);/);
});

test('Admin → Groups: one job at a time, an email that looks like one, no pop-up steps', () => {
  const html = read('admin/groups.html');
  for (const t of ['meetings', 'members', 'email', 'photos', 'leader', 'page']) {
    assert.match(html, new RegExp(`data-tab="${t}"`), `tab ${t}`);
    assert.match(html, new RegExp(`data-tabpane="${t}"`), `pane ${t}`);
  }
  assert.ok(html.indexOf('js/group-tools.js') < html.indexOf('admin.js?v='), 'group-tools loads first');
  assert.match(html, /<div id="gmRecur"><\/div>/);
  assert.match(html, /placeholder="Type a person's name, e\.g\. Maria…"/);
  const js = read('admin/admin.js');
  const groups = js.slice(js.indexOf('async function initGroups()'), js.indexOf('async function', js.indexOf('async function initGroups()') + 30));
  assert.equal(/prompt\(/.test(groups.slice(0, groups.indexOf('function leaderCell'))), false, 'no prompt() steps in group management');
  assert.match(js, /JSON\.stringify\(\{ subject, message, eventId: compose\.eventId \|\| '' \}\)/);
  assert.match(js, /<label for="gcSubject">Subject<\/label>/);
  assert.match(js, /Show \$\{past\.length\} past meeting/);
  assert.equal(js.includes('past meeting${past === 1 ? \'\' : \'s\'} not shown'), false);
  assert.match(js, /WVPeople\.searchPeople\(await directory\(\), searchEl\.value, 10\)/);
  assert.match(js, /data-evphotos=/);
  assert.match(js, /data-repeat title=/, 'Admin → Events has ⟳ Repeat');
  assert.ok(read('admin/events.html').indexOf('js/group-tools.js') < read('admin/events.html').indexOf('admin.js?v='));
});

test('the leader\'s Manage group page: five big buttons, people by name, email like an email', () => {
  const js = read('member/member.js');
  for (const [id, label] of [['meetings', 'Meetings'], ['members', 'Members'], ['email', 'Email the group'], ['photos', 'Photos'], ['page', 'Group page']]) {
    assert.match(js, new RegExp(`T\\('${id}', '[^']+', '${label}'`), label);
  }
  assert.match(js, /WVPeople\.searchPeople\(dir, searchEl\.value, 10\)/);
  assert.match(js, /JSON\.stringify\(\{ subject, message, eventId: draft\.eventId \|\| '' \}\)/);
  assert.match(js, /data-showpast/);
  assert.match(js, /WVRecur\.mount\(recurHost, \{ dateInput, how: params\.get\('recur'\) === 'monthly' \? 'monthly' : 'once' \}\)/);
  for (const page of ['member/group.html', 'member/event.html']) {
    const h = read(page);
    assert.ok(h.indexOf('js/group-tools.js') > 0 && h.indexOf('js/group-tools.js') < h.indexOf('member.js?v='), page);
  }
  assert.match(read('member/event.html'), /<div id="recurPicker"><\/div>/);
  // The tour points at the buttons that exist now.
  const tour = read('js/tour.js');
  for (const t of ['meetings', 'members', 'email', 'photos', 'page']) assert.match(tour, new RegExp(`\\[data-tab="${t}"\\]`));
  assert.equal(tour.includes('#gmAnnounce'), false);
});

test('the event page shows Add to my calendar under the date, not at the foot', () => {
  const js = read('js/chamber.js');
  assert.match(js, /\$\{ctaRow\}\n\s+\$\{ev\.confirmed \? calendarMenu\(ev, true\) : ''\}/);
  assert.match(js, /📅 Add to my calendar/);
  assert.match(js, />Apple \/ iPhone<\/a>/);
});
