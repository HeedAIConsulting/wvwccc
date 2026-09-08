/* Felicia, Sep 8 2026: "Can all members/group leaders see their past events?...
   That way if they have the same type of event for a later date and only need
   to change a date it is easy for them to go in to edit it so it will repost."

   Two problems in one sentence.

   1. A group leader could not see a past event at all — /me/group/:slug
      filtered to date >= today, hiding 47 of them site-wide.
   2. "Edit it so it will repost" would MOVE the event. Change a past event's
      date and the previous occurrence is gone, along with the record of it.
      Copying is what she actually wants, and it did not exist.

   These pin the copy semantics, because the dangerous part of Duplicate is
   what it carries over: a copy must never inherit a homepage slot or a stale
   ticket price, and must never publish itself around the office's review.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, srcId;
const T = Date.now().toString(36);
const ADMIN = `office-dup-${T}@test.woodlandhillscc.net`;
const made = [];
const sentMail = [];
const PAST = '2020-03-05';
const NEW_DATE = '2027-06-11';

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function ev(id) {
  const r = await adm('/api/admin/events');
  const all = (await r.json()).events || [];
  return all.find((e) => e.id === id);
}
async function dup(id, body) {
  const r = await adm(`/api/admin/events/${encodeURIComponent(id)}/duplicate`, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sentMail.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
      notifyTo: () => 'felicia@woodlandhillscc.net',
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

  // Its OWN event — every test file shares data/_store.
  const r = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Duplicate source ${T}`, date: PAST, time: '8:30 AM', endTime: '10:00 AM',
      venue: 'Rose Goldwater', address: '21710 Vanowen St', category: 'Business',
      summary: 'The blurb that should come across.', status: 'approved',
      featured: true, homeOrder: 1, homeBlurb: 'On the homepage',
      ticketed: true, soldOut: true,
      ticketTypes: [{ label: 'Member', price: 25 }],
      links: [{ type: 'info', label: 'Chamber Website', url: 'www.woodlandhillscc.net' }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  assert.equal(r.status, 200, JSON.stringify(body));
  srcId = body.event.id;
  made.push(srcId);
});

after(async () => {
  for (const id of made) await adm(`/api/admin/events/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('a duplicate needs a date — you copy an event TO somewhere', async () => {
  assert.equal((await dup(srcId, {})).status, 400);
  assert.equal((await dup(srcId, { date: 'next tuesday' })).status, 400);
});

test('the original is left completely alone — copied, not moved', async () => {
  const r = await dup(srcId, { date: NEW_DATE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  made.push(r.body.event.id);
  const src = await ev(srcId);
  assert.equal(src.date, PAST, 'this is the whole point: editing would have moved it');
  assert.notEqual(r.body.event.id, srcId, 'a copy is a new event');
});

test('the copy carries the details the office would otherwise retype', async () => {
  const r = await dup(srcId, { date: NEW_DATE });
  made.push(r.body.event.id);
  const c = await ev(r.body.event.id);
  assert.equal(c.title, `Duplicate source ${T}`);
  assert.equal(c.venue, 'Rose Goldwater');
  assert.equal(c.address, '21710 Vanowen St');
  assert.equal(c.time, '8:30 AM');
  assert.equal(c.summary, 'The blurb that should come across.');
  assert.equal(c.date, NEW_DATE);
});

test('a copy never inherits the homepage slot', async () => {
  const r = await dup(srcId, { date: NEW_DATE });
  made.push(r.body.event.id);
  const c = await ev(r.body.event.id);
  assert.equal(c.featured, false, 'a copy silently taking a featured slot is how the wrong event ends up on the homepage');
  assert.equal(c.homeOrder ?? null, null);
  assert.equal(c.homeBlurb || '', '');
});

test('a copy never inherits prices, caps or sold-out', async () => {
  const r = await dup(srcId, { date: NEW_DATE });
  made.push(r.body.event.id);
  const c = await ev(r.body.event.id);
  assert.equal(c.ticketed, false, 'a stale price on a live listing takes money at the wrong number');
  assert.deepEqual(c.ticketTypes || [], []);
  assert.equal(c.soldOut, false);
});

test('the copy records where it came from', async () => {
  const r = await dup(srcId, { date: NEW_DATE });
  made.push(r.body.event.id);
  assert.equal((await ev(r.body.event.id)).duplicatedFrom, srcId);
});

test('a multi-day event keeps its length', async () => {
  const two = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({ title: `Two-dayer ${T}`, date: '2020-03-05', endDate: '2020-03-07', status: 'approved' }),
  });
  const id = (await two.json()).event.id; made.push(id);
  const r = await dup(id, { date: '2027-06-11' });
  made.push(r.body.event.id);
  const c = await ev(r.body.event.id);
  assert.equal(c.date, '2027-06-11');
  assert.equal(c.endDate, '2027-06-13', 'a two-day event copies as a two-day event');
});

/* The list a leader sees is WIDER than the set they can act on. eventsOfGroup
   also matches the group's eventMatch keyword, while canManageEvent honours
   groupSlug alone — deliberately, so a group whose keyword is "Mixer" can
   never edit the Chamber's flagship Mixer. Before this, Edit / Remove /
   Duplicate were rendered on those rows and answered 404 when pressed.

   These act as the group's real leader: /me/group/:slug is leader-only, and a
   staff login leads no group, so the manager email has to be ours for the
   duration. Restored afterwards — the shared store is not ours to leave dirty. */
async function asLeaderOfEducation(fn) {
  const groups = (await (await adm('/api/admin/groups')).json()).groups || [];
  const g = groups.find((x) => x.slug === 'education-committee');
  assert.ok(g, 'need the seeded Education Committee');
  const original = JSON.parse(JSON.stringify(g));
  try {
    await adm('/api/admin/groups', {
      method: 'POST',
      body: JSON.stringify({ ...g, eventMatch: `Dupmatch${T}`, manager: { ...(g.manager || {}), email: ADMIN } }),
    });
    const view = async () => (await (await adm(`/api/me/group/${encodeURIComponent(g.slug)}`)).json());
    await fn(g, view);
  } finally {
    await adm('/api/admin/groups', { method: 'POST', body: JSON.stringify(original) }).catch(() => {});
  }
}

test('a keyword-matched event is listed for the group but marked not theirs', async () => {
  await asLeaderOfEducation(async (g, view) => {
    // Belongs to nobody, but its title matches the group's keyword.
    const r = await adm('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({ title: `Dupmatch${T} office event`, date: '2020-05-05', status: 'approved' }),
    });
    const id = (await r.json()).event.id; made.push(id);
    const owned = await adm('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({ title: `Really theirs ${T}`, date: '2020-05-06', status: 'approved', groupSlug: g.slug }),
    });
    const ownedId = (await owned.json()).event.id; made.push(ownedId);

    const v = await view();
    const rows = [...(v.events || []), ...(v.pastEvents || [])];
    const matched = rows.find((e) => e.id === id);
    const mine = rows.find((e) => e.id === ownedId);
    assert.ok(matched, 'the keyword match still belongs on the group page');
    assert.equal(matched.canManage, false, 'but it is not theirs to edit — this is what returned 404');
    assert.ok(mine, 'their own past event is listed');
    assert.equal(mine.canManage, true);
  });
});

test('past events reach the leader at all — they were filtered out entirely', async () => {
  await asLeaderOfEducation(async (g, view) => {
    const r = await adm('/api/admin/events', {
      method: 'POST',
      body: JSON.stringify({ title: `Long ago ${T}`, date: '2019-02-02', status: 'approved', groupSlug: g.slug }),
    });
    const id = (await r.json()).event.id; made.push(id);
    const v = await view();
    assert.ok((v.pastEvents || []).some((e) => e.id === id),
      'a 2019 meeting must be reachable — 47 of these were invisible');
    assert.ok(!(v.events || []).some((e) => e.id === id),
      'and must not muddle the upcoming list');
  });
});

/* Felicia, Sep 8 2026: "Debra Gordon from Artfully Made added her own event
   last Friday... I am not seeing the past event in her profile."

   She had used the PUBLIC community-event form, which is unauthenticated and
   recorded no owner — so the event (ce-mtnimorl, "Labor Day Weekend Sale")
   belonged to nobody, never appeared in her list, and she could not edit it.
   The form stays public; it now attributes the event when the person
   submitting happens to be signed in. */
test('a community submission from a signed-in member becomes theirs to edit', async () => {
  const MEMBER = 'm16008';
  const em = `comm-${T}@example.com`;
  await adm(`/api/admin/members/${MEMBER}/create-login`, { method: 'POST', body: JSON.stringify({ email: em, sendInvite: false }) });
  await adm(`/api/admin/users/${encodeURIComponent(em)}/set-password`, { method: 'POST', body: JSON.stringify({ password: 'community-pass-4' }) });
  const lg = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: 'community-pass-4' }),
  });
  const ck = (lg.headers.get('set-cookie') || '').split(';')[0];
  try {
    const submitter = `debra-${T}@example.com`;
    sentMail.length = 0;
    const codeReq = await fetch(`${base}/api/public/event/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ck },
      body: JSON.stringify({ email: submitter }),
    });
    assert.equal(codeReq.status, 200, await codeReq.text());
    const code = (String((sentMail[0] || {}).text || '').match(/\b(\d{4,8})\b/) || [])[1];
    assert.ok(code, 'the verification code is emailed');

    const r = await fetch(`${base}/api/public/event`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: ck },
      body: JSON.stringify({
        email: submitter, code, title: `Labor Day style sale ${T}`,
        date: '2027-09-06', organization: 'Artfully Made', venue: 'The shop',
      }),
    });
    assert.equal(r.status, 200, await r.text());

    const list = (await (await fetch(`${base}/api/me/events`, { headers: { cookie: ck } })).json()).events || [];
    const found = list.find((e) => e.title === `Labor Day style sale ${T}`);
    assert.ok(found, 'it must land in the submitting member’s own list — this is exactly what Debra was missing');
    made.push(found.id);
    assert.equal(found.submittedBy, MEMBER);
  } finally {
    await adm(`/api/admin/members/${MEMBER}/remove-login`, { method: 'POST', body: JSON.stringify({ email: em }) }).catch(() => {});
  }
});

test('a signed-out community submission still works and stays ownerless', async () => {
  const submitter = `stranger-${T}@example.com`;
  sentMail.length = 0;
  await fetch(`${base}/api/public/event/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: submitter }),
  });
  const code = (String((sentMail[0] || {}).text || '').match(/\b(\d{4,8})\b/) || [])[1];
  const r = await fetch(`${base}/api/public/event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: submitter, code, title: `Stranger event ${T}`, date: '2027-09-07', organization: 'A neighbour' }),
  });
  assert.equal(r.status, 200, await r.text());
  const all = (await (await adm('/api/admin/events')).json()).events || [];
  const found = all.find((e) => e.title === `Stranger event ${T}`);
  assert.ok(found, 'the form is still open to non-members');
  made.push(found.id);
  assert.ok(!found.submittedBy, 'and a stranger owns nothing');
});
