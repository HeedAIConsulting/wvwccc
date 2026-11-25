/* Felicia, Nov 17 and 18 2026.

   "New Request": "Diana would like the Ambassadors to only have to RSVP once
   so when they sign up for a task it will populate the overall event RSVP as
   well. When someone signs up for an event the RSVP's get sent to me so I
   would still like to get that generated receipt."

   "New Fix": Sheryl sent the Ambassador invite to the committee and Felicia and
   Diana never got it. Their roster rows were picked from listings with no
   email on file, so the group email skipped them without saying who.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

let server, base, cookie, memberCookie, eventId, groupId;
const T = Date.now().toString(36);
const ADMIN = `office-rsvp1-${T}@test.woodlandhillscc.net`;
const AMB_LOGIN = `amb-rsvp1-${T}@example.com`;
const PW = 'rsvp-once-passcode-4';
const AMBASSADOR = 'm12569';   // seeded member; the committed seed is PII-free
const OFFICE = 'felicia@woodlandhillscc.net';
const sent = [];
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const me = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie: memberCookie, ...(opts.headers || {}) },
});
async function signUp(role) {
  const r = await me('/api/me/volunteer', { method: 'POST', body: JSON.stringify({ eventId, role }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function myShifts() {
  const d = await (await me('/api/me/volunteer')).json();
  return (d.mine || []).filter((v) => v.eventId === eventId);
}
async function rsvpLeads() {
  const d = await (await adm('/api/admin/leads')).json();
  return (d.leads || []).filter((l) => l.kind === 'rsvp' && String(l.event || '').includes(`[${eventId}]`));
}
const settle = () => new Promise((r) => setTimeout(r, 50));   // sends are fire-and-forget

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => OFFICE,
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  await adm(`/api/admin/members/${AMBASSADOR}/create-login`, {
    method: 'POST', body: JSON.stringify({ email: AMB_LOGIN, sendInvite: false }),
  });
  await adm(`/api/admin/users/${encodeURIComponent(AMB_LOGIN)}/set-password`, {
    method: 'POST', body: JSON.stringify({ password: PW }),
  });
  const ml = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: AMB_LOGIN, password: PW }),
  });
  assert.equal(ml.status, 200);
  memberCookie = (ml.headers.get('set-cookie') || '').split(';')[0];

  const date = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  const ev = await (await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Holiday Open House ${T}`, date, time: '5:30 PM', endTime: '7:30 PM', venue: 'Chamber office',
      status: 'approved',
      volunteerRoles: [{ role: 'Greeter', needed: 2, points: 5 }, { role: 'Check In', needed: 2, points: 5 }],
    }),
  })).json();
  eventId = ev.event.id;
});

after(async () => {
  for (const v of await myShifts().catch(() => [])) {
    await me(`/api/me/volunteer/${encodeURIComponent(v.id)}`, { method: 'DELETE' }).catch(() => {});
  }
  if (eventId) await adm(`/api/admin/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }).catch(() => {});
  if (groupId) await adm(`/api/admin/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' }).catch(() => {});
  await adm(`/api/admin/members/${AMBASSADOR}/remove-login`,
    { method: 'POST', body: JSON.stringify({ email: AMB_LOGIN }) }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('an Ambassador who signs up for a job is RSVP\'d, and the office gets the receipt', async () => {
  sent.length = 0;
  const r = await signUp('Greeter');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rsvp, true);
  await settle();

  const leads = await rsvpLeads();
  assert.equal(leads.length, 1, 'one RSVP on the event, filed like any other');
  assert.equal(leads[0].email, AMB_LOGIN);
  assert.match(leads[0].message, /^Ambassador sign-up: Greeter\nAttending: 1$/);

  const receipt = sent.find((m) => m.to === OFFICE);
  assert.ok(receipt, 'Felicia still gets the generated receipt');
  assert.match(receipt.subject, /^New RSVP — Holiday Open House/);
  assert.match(receipt.html, /THANK YOU/);
  assert.match(receipt.html, /Ambassador — Greeter/);
  assert.match(receipt.text, /Registration: Ambassador — Greeter\nRSVP Qty: 1/);
  assert.equal(receipt.replyTo, AMB_LOGIN);

  const mine = sent.find((m) => m.to === AMB_LOGIN);
  assert.ok(mine, 'the Ambassador gets a confirmation');
  assert.match(mine.subject, /^Your RSVP is confirmed — /);
  assert.match(mine.html, /Add to your calendar/);
  assert.equal(mine.html.includes('Admin &rarr; Inquiries'), false, 'no admin footer on their copy');
});

test('a second job at the same event does not RSVP them twice', async () => {
  sent.length = 0;
  const r = await signUp('Check In');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rsvp, false);
  await settle();
  assert.equal((await rsvpLeads()).length, 1);
  assert.equal(sent.length, 0, 'no second receipt for the same person');
});

test('cancelling one job keeps the RSVP; cancelling the last one takes it off the count', async () => {
  const shifts = await myShifts();
  assert.equal(shifts.length, 2);
  await me(`/api/me/volunteer/${encodeURIComponent(shifts[0].id)}`, { method: 'DELETE' });
  assert.equal((await rsvpLeads()).filter((l) => l.status !== 'trash').length, 1, 'still has a job, still coming');
  await me(`/api/me/volunteer/${encodeURIComponent(shifts[1].id)}`, { method: 'DELETE' });
  const after = await rsvpLeads();
  assert.equal(after.length, 1, 'nothing is deleted');
  assert.equal(after[0].status, 'trash', 'moved to Trash, so it no longer counts');
  // Signing up again files a fresh RSVP rather than finding the trashed one.
  sent.length = 0;
  const again = await signUp('Greeter');
  assert.equal(again.body.rsvp, true);
  assert.equal((await rsvpLeads()).filter((l) => l.status !== 'trash').length, 1);
});

test('an RSVP the person made themselves is never trashed by a cancelled job', () => {
  const src = read('backend/chamber-routes.js');
  const drop = src.slice(src.indexOf('async function dropAmbassadorRsvp('), src.indexOf('/* ── Welcome-to-the-group email'));
  assert.match(drop, /startsWith\(AMBASSADOR_RSVP_MARK\)/);
});

test('trashed RSVPs drop out of the counts the office and leaders see', () => {
  const src = read('backend/chamber-routes.js');
  assert.match(src, /const countsAsRsvp = \(l\) => l && l\.kind === 'rsvp' && l\.status !== 'spam' && l\.status !== 'trash';/);
  assert.match(src, /rsvpLeads = \(await repo\.listLeads\(\)\)\.filter\(countsAsRsvp\)/);
  const admin = read('admin/admin.js');
  assert.match(admin, /if \(l\.status === 'spam' \|\| l\.status === 'trash'\) return false;/);
});

test('the sign-up message says it RSVPs them, and cancel says the RSVP goes too', () => {
  const js = read('member/member.js');
  assert.match(js, /d\.rsvp \? ' That also RSVPs you for the event/);
  assert.match(js, /your RSVP is cancelled with it/);
});

test('a group email names the people it could not reach', async () => {
  const g = await (await adm('/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: `Test Committee ${T}`, slug: `test-committee-${T}`,
      members: [
        // Picked from a listing with no email on file — how Felicia and Diana were added.
        { name: 'Felicia Paust', memberId: `m-no-email-${T}`, role: 'Member' },
        { name: 'Reachable Person', email: `reach-${T}@example.com`, role: 'Member' },
      ],
    }),
  })).json();
  groupId = g.group.id;
  sent.length = 0;
  const r = await (await adm(`/api/admin/groups/${encodeURIComponent(groupId)}/announce`, {
    method: 'POST', body: JSON.stringify({ subject: 'Ambassador invite', message: 'Join us.' }),
  })).json();
  assert.equal(r.sent, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.skippedNames, ['Felicia Paust']);

  // Typing an address on the row fixes it.
  const rows = g.group.members.map((m) => (m.name === 'Felicia Paust' ? { ...m, email: OFFICE } : m));
  const saved = await (await adm(`/api/admin/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST', body: JSON.stringify({ members: rows }),
  })).json();
  assert.ok(saved.ok, JSON.stringify(saved));
  const r2 = await (await adm(`/api/admin/groups/${encodeURIComponent(groupId)}/announce`, {
    method: 'POST', body: JSON.stringify({ subject: 'Ambassador invite', message: 'Join us.' }),
  })).json();
  assert.equal(r2.sent, 2);
  assert.deepEqual(r2.skippedNames, []);
});

test('both Members pages flag a row no group email reaches, with a box to fix it', () => {
  const src = read('backend/chamber-routes.js');
  assert.match(src, /members: await withNoEmailFlags\(g\.members \|\| \[\]\)/);
  const member = read('member/member.js');
  assert.match(member, /No email on file — group emails skip them\./);
  assert.match(member, /data-saveemail/);
  assert.match(member, /Not sent to \$\{\(r\.skippedNames \|\| \[\]\)\.join\(', '\)/);
  const admin = read('admin/admin.js');
  assert.match(admin, /No email on file — group emails skip them\./);
  assert.match(admin, /Not sent to \$\{\(r\.skippedNames \|\| \[\]\)\.join\(', '\)/);
});

test('Sheryl\'s sign-up list has its own button, not the foot of Meetings', () => {
  const js = read('member/member.js');
  assert.match(js, /\$\{g\.hasVolunteerSheet \? T\('signups', '🙋', 'Ambassador sign-ups'\) : ''\}/);
  assert.match(js, /\.\.\.\(g\.hasVolunteerSheet \? \['signups'\] : \[\]\)/);
  const meetings = js.slice(js.indexOf('        meetings: `'), js.indexOf('        signups: `'));
  assert.equal(meetings.includes('gmVolSheet'), false, 'no longer buried under the meetings');
  assert.match(js, /signups: `\n\s+<div id="gmVolSheet">/);
});

test('Felicia can see taken and open places and get straight to changing a job', () => {
  const js = read('admin/admin.js');
  assert.match(js, /<th style="width:90px">Taken<\/th><th style="width:90px">Open<\/th>/);
  assert.match(js, /\$\{j\.people\.length\} of \$\{j\.needed\}/);
  assert.match(js, /href="events\.html\?focus=\$\{encodeURIComponent\(ev\.id\)\}&amp;jobs=1">✏️ Change jobs or how many<\/a>/);
  assert.match(js, /get\('jobs'\)\) \{/);
  assert.match(js, /<span style="width:95px">People needed<\/span>/);
  assert.match(read('admin/events.html'), /<label>Ambassador jobs <span class="sub">\(each job and how many people it needs/);
});

/* Diana, via Felicia, Nov 24 2026: nobody had signed up for the Dec 2
   breakfast, because nothing tells an Ambassador that jobs are posted. */
test('the ask email lists every job, covered ones too, and sends them to their dashboard', async () => {
  const { ambassadorAskEmail } = await import('../chamber-routes.js');
  const ev = { id: 'e1', title: 'Start Your Month Breakfast', date: '2026-12-02', time: '7:30 AM', venue: 'Fogo de Chão' };
  const jobs = [{ role: 'Greeter', needed: 2, open: 2 }, { role: 'Check In', needed: 2, open: 0 }, { role: 'Floater', needed: 2, open: 1 }];
  const m = ambassadorAskEmail(ev, jobs, 'https://woodlandhillscc.net', 'Martin');
  assert.equal(m.subject, 'Ambassadors needed: Start Your Month Breakfast (Dec 2)');
  assert.match(m.text, /^Hi Martin,\n\nWe're asking every Ambassador to help at Start Your Month Breakfast on Wednesday, December 2 at 7:30 AM at Fogo de Chão\. Please pick a job, even if it already shows as covered\./);
  // Sheryl, Nov 24: every Ambassador, however many have already said yes.
  assert.match(m.text, /- Greeter: 2 of 2 still needed\n- Check In: covered, more welcome\n- Floater: 1 of 2 still needed\n/);
  assert.match(m.html, /<a href="https:\/\/woodlandhillscc\.net\/member\/"[^>]*>Pick a job<\/a>/);
  assert.match(m.text, /under "Volunteer at an event" on your dashboard/);
  assert.match(ambassadorAskEmail(ev, jobs, '', '').text, /^Hi there,/);
});

test('📣 asks every Ambassador not already doing a job, and records it', async () => {
  const ask = async () => {
    const r = await adm(`/api/admin/events/${encodeURIComponent(eventId)}/ask-ambassadors`, { method: 'POST', body: '{}' });
    return { status: r.status, body: await r.json() };
  };
  // Our Ambassador already has a job here, so is left out.
  sent.length = 0;
  let r = await ask();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.alreadySignedUp >= 1);
  assert.equal(sent.some((m) => m.to === AMB_LOGIN), false, 'already signed up — not asked');
  // Once they have no job there, they are asked — at their sign-in address.
  for (const v of await myShifts()) await me(`/api/me/volunteer/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
  sent.length = 0;
  r = await ask();
  assert.equal(r.status, 200);
  const mine = sent.find((m) => m.to === AMB_LOGIN);
  assert.ok(mine, 'the Ambassador gets the ask');
  assert.match(mine.subject, /^Ambassadors needed: Holiday Open House/);
  assert.match(mine.text, /- Greeter: 2 of 2 still needed/);
  assert.equal(mine.replyTo, OFFICE, 'replies go to the office');
  assert.ok(r.body.sent >= 1);
  assert.ok(Array.isArray(r.body.noEmail));
  // The sign-up list shows it went.
  const sheet = await (await adm('/api/admin/volunteer-sheet')).json();
  const ev = sheet.events.find((e) => e.id === eventId);
  assert.ok(ev.lastAsked && ev.lastAsked.sent === r.body.sent && ev.lastAsked.by === ADMIN);
});

test('📣 is refused for anyone but the office or the committee, never for being covered', async () => {
  const r = await adm('/api/admin/events/no-such-event/ask-ambassadors', { method: 'POST', body: '{}' });
  assert.equal(r.status, 404);
  const asMember = await me(`/api/admin/events/${encodeURIComponent(eventId)}/ask-ambassadors`, { method: 'POST', body: '{}' });
  assert.ok([401, 403].includes(asMember.status));
  const notLeader = await me(`/api/me/group/ambassador-committee/ask-ambassadors/${encodeURIComponent(eventId)}`, { method: 'POST', body: '{}' });
  assert.ok([403, 404].includes(notLeader.status), String(notLeader.status));
  const src = read('backend/chamber-routes.js');
  assert.equal(src.includes("Every job at that event is already covered"), false);
  assert.match(src, /if \(g\.id !== AMBASSADOR_GROUP_ID\) return res\.status\(404\)\.json\(\{ error: 'Only the Ambassador Committee can do this\.' \}\);/);
});

test('both sign-up lists carry the 📣 button', () => {
  for (const f of ['admin/admin.js', 'member/member.js']) {
    const js = read(f);
    assert.match(js, /data-askamb="\$\{esc\(ev\.id\)\}"/, f);
    assert.match(js, /📣 Ask Ambassadors to sign up/, f);
    assert.match(js, /ev\.lastAsked \?/, f);
  }
});

/* Sheryl, Nov 24 2026: "I want the ambassadors to be able to volunteer no
   matter how many have already said so." People needed is a target. */
test('an Ambassador can take a job that is already covered', async () => {
  for (const v of await myShifts()) await me(`/api/me/volunteer/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
  for (const name of ['Covered One', 'Covered Two']) {
    const r = await adm('/api/admin/volunteers', { method: 'POST', body: JSON.stringify({ name, eventId, role: 'Check In' }) });
    assert.equal(r.status, 200, await r.text());
  }
  const sheetBefore = (await (await adm('/api/admin/volunteer-sheet')).json()).events.find((e) => e.id === eventId);
  assert.equal(sheetBefore.jobs.find((j) => j.role === 'Check In').open, 0);
  const r = await signUp('Check In');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const job = (await (await adm('/api/admin/volunteer-sheet')).json()).events.find((e) => e.id === eventId).jobs.find((j) => j.role === 'Check In');
  assert.equal(job.people.length, 3);
  assert.equal(job.extra, 1);
  const js = read('member/member.js');
  assert.match(js, / · covered, join in/);
  assert.equal(/\$\{isMine \|\| full \? 'disabled' : ''\}/.test(js), false, 'a covered job is not greyed out');
  assert.match(read('admin/admin.js'), /✓ covered\$\{j\.extra \? ` \(\+\$\{j\.extra\}\)` : ''\}/);
});

/* Sheryl, Nov 24 2026: "Not sent to 2 members: no email on file" when all 23
   people had it. Two of her 25 rows were the same person twice. */
test('a group email says who shares an address instead of calling them missing', async () => {
  const shared = `twice-${T}@example.com`;
  const g = await (await adm('/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: `Twice Committee ${T}`, slug: `twice-committee-${T}`,
      members: [
        { name: 'Mercy Alpert', email: shared, role: 'Member' },
        { name: 'Have Mercy', email: shared.toUpperCase(), role: 'Member' },
        { name: 'Someone Else', email: `else-${T}@example.com`, role: 'Member' },
        { name: 'No Address', memberId: `m-none-${T}`, role: 'Member' },
      ],
    }),
  })).json();
  const r = await (await adm(`/api/admin/groups/${encodeURIComponent(g.group.id)}/announce`, {
    method: 'POST', body: JSON.stringify({ subject: 'RSVP PLEASE', message: 'Hi.' }),
  })).json();
  await adm(`/api/admin/groups/${encodeURIComponent(g.group.id)}`, { method: 'DELETE' });
  assert.equal(r.sent, 2);
  assert.equal(r.skipped, 1, 'only the row with no address is missing');
  assert.deepEqual(r.skippedNames, ['No Address']);
  assert.deepEqual(r.sharedNames, [['Mercy Alpert', 'Have Mercy']]);
  for (const f of ['admin/admin.js', 'member/member.js']) {
    assert.match(read(f), /share one email address, so each got one copy\./, f);
  }
});
