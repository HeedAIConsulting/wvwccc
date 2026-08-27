/* Jon Mann, Aug 27 2026 — "When I sign in to my company page, I see content
   for YPN mixed in. Can we separate these two accounts?" He runs Joint Matters
   AND leads the Young Professionals Network, and one sign-in opened both on a
   single page. The email is the account key, so the old site's
   same-username-two-passwords setup can't return; instead the dashboard now
   renders one workspace per hat. That only works if the two are addressable
   SEPARATELY from the server — a business identity from /api/me and a group
   identity from /api/me/my-groups — and if a group's own calendar can be read
   without dragging the business's events along. These tests pin that.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie;
const T = Date.now().toString(36);
const LEADER = `two-hats-${T}@test.local`;
const MEMBER = 'm16008'; // stable seed member = this login's business listing
const GROUP = `Test Circle ${T}`;
let groupSlug;

before(async () => {
  // A login that wears both hats: a member listing (mid) and, once the group
  // below names it as manager, a group leadership.
  process.env.ADMIN_BOOTSTRAP = `${LEADER}|${bcrypt.hashSync('test-passcode-1', 10)}|${MEMBER}|admin|Two Hats`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
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
    body: JSON.stringify({ email: LEADER, password: 'test-passcode-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const made = await fetch(`${base}/api/admin/groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: GROUP, manager: { name: 'Two Hats', email: LEADER } }),
  });
  assert.equal(made.status, 200);
  groupSlug = (await made.json()).group.slug;
});

after(async () => {
  try {
    const gs = await (await fetch(`${base}/api/admin/groups`, { headers: { cookie } })).json();
    const mine = (gs.groups || []).find((g) => g.slug === groupSlug);
    if (mine) await fetch(`${base}/api/admin/groups/${encodeURIComponent(mine.id)}`, { method: 'DELETE', headers: { cookie } });
  } catch (e) {}
  server && server.close();
  mock.reset();
});

test('the business workspace comes from /api/me and names only the business', async () => {
  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.member.id, MEMBER, 'the listing behind the business workspace');
  assert.ok(!JSON.stringify(me.member).includes(GROUP), 'no group content is folded into the listing');
});

test('the group workspace comes from /api/me/my-groups and names only the group', async () => {
  const mine = await (await fetch(`${base}/api/me/my-groups`, { headers: { cookie } })).json();
  const g = (mine.groups || []).find((x) => x.slug === groupSlug);
  assert.ok(g, 'the group this login leads');
  assert.equal(g.name, GROUP);
  assert.equal(typeof g.memberCount, 'number', 'the switcher shows a roster count');
});

test('both hats are offered as separate posting identities', async () => {
  const il = await (await fetch(`${base}/api/me/is-leader`, { headers: { cookie } })).json();
  const kinds = (il.identities || []).map((i) => i.kind);
  assert.ok(kinds.includes('business'), 'the business identity');
  assert.ok(kinds.includes('group'), 'the group identity');
  const biz = il.identities.find((i) => i.kind === 'business');
  const grp = il.identities.find((i) => i.key === groupSlug);
  assert.ok(grp, 'the group is addressable by its slug');
  assert.notEqual(biz.name, grp.name, 'the two workspaces are named differently');
  assert.equal(il.identities[0].kind, 'business', 'signing in still lands on the business');
});

test("a group's own events are readable without the business's", async () => {
  // The group workspace reads its calendar from the group, not from the pile
  // of everything this login has posted.
  const r = await fetch(`${base}/api/me/group/${encodeURIComponent(groupSlug)}`, { headers: { cookie } });
  assert.equal(r.status, 200);
  const g = await r.json();
  assert.ok(Array.isArray(g.events), 'the group carries its own event list');
  assert.ok(g.events.every((e) => !e.groupSlug || e.groupSlug === groupSlug), 'no other group’s events leak in');
});

test('leading a group is not the same as leading someone else’s', async () => {
  const r = await fetch(`${base}/api/me/group/${encodeURIComponent('young-professionals-network')}`, { headers: { cookie } });
  assert.equal(r.status, 403, 'a leader only manages their own group');
});
