/* Diana, Sep 4 2026: "The group leaders need to be able to add their own
   members."

   They already can — /me/group/:slug has been a full management page since
   August, with the roster, group email, meetings and RSVPs. But only for a
   leader groupsLedBy() recognises, and that comes down to one field: the
   group's Manager email. Nine of the twenty-one groups have a named leader
   and no address, so their leader is locked out — and the admin screen said
   nothing either way, so there was no way for the office to know which, or
   that the email is the switch.

   /api/admin/groups now reports it per group. These pin the three answers the
   office acts on differently: the leader manages it themselves, the address is
   there but has no sign-in yet, and no address at all.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie, gid;
const T = Date.now().toString(36);
const ADMIN = `office-la-${T}@test.woodlandhillscc.net`;
const NOBODY = `no-such-leader-${T}@example.com`;

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
const groups = async () => (await (await adm('/api/admin/groups')).json()).groups || [];
const mine = async () => (await groups()).find((g) => g.id === gid);
const setManager = async (manager) => {
  const g = await mine();
  const r = await adm('/api/admin/groups', { method: 'POST', body: JSON.stringify({ ...g, manager }) });
  assert.equal(r.status, 200, await r.text());
  return (await mine()).leaderAccess;
};

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
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
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  // Its OWN group. Every test file shares data/_store, so editing a real
  // group's manager here would surface as failures in the RSVP routing tests.
  const made = await adm('/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ name: `Leader access test ${T}`, status: 'draft' }),
  });
  const body = await made.json().catch(() => ({}));
  assert.equal(made.status, 200, JSON.stringify(body));
  gid = body.group.id;
});

after(async () => {
  if (gid) await adm('/api/admin/groups/' + encodeURIComponent(gid), { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('no manager email — the leader cannot reach their own group', async () => {
  const a = await setManager({ name: 'Sheryl Tratner', email: '' });
  assert.equal(a.email, '', 'nothing to sign in with');
  assert.equal(a.canManage, false);
  assert.equal(a.name, 'Sheryl Tratner', 'the office still needs to see whose access is missing');
});

test('an email with no sign-in yet is reported as such, not as working', async () => {
  const a = await setManager({ name: 'Sheryl Tratner', email: NOBODY });
  assert.equal(a.email, NOBODY);
  assert.equal(a.canManage, false,
    'an address alone is not access — someone has to give them a login');
});

test('an email that has a sign-in means the leader manages it themselves', async () => {
  const a = await setManager({ name: 'Test Office', email: ADMIN });
  assert.equal(a.canManage, true);
});

test('a roster Leader with an address counts, same as groupsLedBy does', async () => {
  const g = await mine();
  const r = await adm('/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ ...g, manager: { name: 'Sheryl Tratner', email: '' },
      members: [{ id: 'gm-t1', name: 'Test Office', email: ADMIN, role: 'Chair' }] }),
  });
  assert.equal(r.status, 200, await r.text());
  const a = (await mine()).leaderAccess;
  assert.equal(a.email, ADMIN.toLowerCase(),
    'a Leader/Chair/Co-Chair on the roster is a leader too — the report must agree with the rule');
  assert.equal(a.canManage, true);
});

test('leaderAccess is a report, never something a save can write', async () => {
  const g = await mine();
  const r = await adm('/api/admin/groups', {
    method: 'POST',
    body: JSON.stringify({ ...g, manager: { name: 'Sheryl Tratner', email: '' }, members: [],
      leaderAccess: { email: 'spoof@example.com', name: 'Spoof', canManage: true } }),
  });
  assert.equal(r.status, 200, await r.text());
  const a = (await mine()).leaderAccess;
  assert.equal(a.canManage, false, 'the echoed field must not be able to fake access');
  assert.equal(a.email, '');
});
