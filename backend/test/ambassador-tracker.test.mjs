/* Diana, Sep 4 2026: "the Ambassadors need to access the tracker."

   The tracker was built in July and points were switched on the same day this
   was written — and an ambassador who signed in still saw nothing at all. The
   dashboard card returned early whenever there was nothing open to sign up for
   and the member had no past shifts: "don't clutter the dashboard". No event
   has ever carried volunteer roles (0 of 267), and the volunteers table is
   empty, so that early return fired for every member, every time. The card had
   never rendered for anyone.

   For an ambassador the tracker IS the dashboard, so it now shows whether or
   not anything is open — their points, their tier, and plainly that no event
   needs volunteers yet. Who counts is the member's own designation, exactly
   the rule the public Ambassadors page uses; the Ambassador Committee roster
   is empty and 22 members carry the designation.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `office-amb-${T}@test.woodlandhillscc.net`;
const AMB_LOGIN = `amb-${T}@example.com`;
const PLAIN_LOGIN = `plain-${T}@example.com`;
const PW = 'tracker-passcode-7';
// Stable seed members; the committed seed is PII-free and carries neither email.
const AMBASSADOR = 'm12569';   // AVANT-GARDE Merchant Solutions — leaderStatus: Ambassador
const PLAIN = 'm16206';        // 32ology Dental Studio — no ambassador designation

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function signIn(email) {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW }),
  });
  assert.equal(r.status, 200, `sign in ${email}: ${await r.text()}`);
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function volunteerAs(ck) {
  const r = await fetch(`${base}/api/me/volunteer`, { headers: { cookie: ck } });
  const body = await r.text();          // read ONCE — a message argument is eager
  assert.equal(r.status, 200, body);
  return JSON.parse(body);
}
async function makeLogin(memberId, email) {
  const made = await adm(`/api/admin/members/${memberId}/create-login`, {
    method: 'POST', body: JSON.stringify({ email, sendInvite: false }),
  });
  assert.equal(made.status, 200, `create-login ${email}: ${await made.text()}`);
  const set = await adm(`/api/admin/users/${encodeURIComponent(email)}/set-password`, {
    method: 'POST', body: JSON.stringify({ password: PW }),
  });
  assert.equal(set.status, 200, `set password ${email}: ${await set.text()}`);
}

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
  await makeLogin(AMBASSADOR, AMB_LOGIN);
  await makeLogin(PLAIN, PLAIN_LOGIN);
});

after(async () => {
  // leave the shared dev store the way we found it
  await adm(`/api/admin/members/${AMBASSADOR}/remove-login`, { method: 'POST', body: JSON.stringify({ email: AMB_LOGIN }) }).catch(() => {});
  await adm(`/api/admin/members/${PLAIN}/remove-login`, { method: 'POST', body: JSON.stringify({ email: PLAIN_LOGIN }) }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('an ambassador is told they are one, so the tracker shows with nothing open', async () => {
  const r = await volunteerAs(await signIn(AMB_LOGIN));
  assert.equal(r.ambassador, true,
    'this flag is the only reason the card renders before any event asks for volunteers');
});

test('an ordinary member is not, so their dashboard stays uncluttered', async () => {
  const r = await volunteerAs(await signIn(PLAIN_LOGIN));
  assert.equal(r.ambassador, false);
});

test('an ambassador with no shifts still gets a real standing to look at', async () => {
  const r = await volunteerAs(await signIn(AMB_LOGIN));
  assert.deepEqual(r.mine, [], 'no shifts recorded yet — that is the state this has to survive');
  assert.equal(r.points, 0);
  assert.equal(typeof r.tier, 'string', 'a tier, even at zero, is what "access to the tracker" means');
  assert.ok(Array.isArray(r.tiers), 'and the tier ladder they are climbing');
});

test('a staff login with no member listing does not crash the tracker', async () => {
  const r = await volunteerAs(cookie);
  assert.equal(r.ambassador, false);
  assert.deepEqual(r.mine, []);
});
