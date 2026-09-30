/* Felicia, Sep 8 2026: "We would like to add a couple things to the welcome
   letter that gets sent out to the new members. How can we do that?"

   She could not. The copy was hardcoded in three places in chamber-routes.js —
   the preview, the plain-text send and the HTML send — so only Michael could
   change a word, and the three could drift apart from one another.

   It is now one plain-text template in settings with the HTML derived from it.
   These pin the things that would quietly break the letter:

   - {{link}} is the set-your-password link. A letter saved without it looks
     fine and is useless, so the save refuses.
   - The preview must be the same template the send uses, or the office
     approves one letter and the member receives another.
   - A stored letter that is somehow unusable must fall back to the original
     rather than send an empty email.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

let server, base, cookie;
const T = Date.now().toString(36);
const ADMIN = `office-wl-${T}@test.woodlandhillscc.net`;
const MEMBER = 'm16008';   // stable seed member; the committed seed is PII-free
const sent = [];

const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});
async function get() {
  const r = await adm('/api/admin/welcome-letter');
  const t = await r.text();
  assert.equal(r.status, 200, t);
  return JSON.parse(t);
}
async function save(body) {
  const r = await adm('/api/admin/welcome-letter', { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function preview() {
  const r = await adm(`/api/admin/members/${MEMBER}/send-welcome`, { method: 'POST', body: JSON.stringify({ preview: true }) });
  const t = await r.text();
  assert.equal(r.status, 200, t);
  return JSON.parse(t);
}

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async (m) => { sent.push(m); return { ok: true, id: 'test', provider: 'stub' }; },
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
});

const ADDED = [];   // members this file adds by hand, removed again in after()

after(async () => {
  // leave the shared dev store the way we found it
  await save({ reset: true }).catch(() => {});
  if (ADDED.length) {
    const store = await import('../store.js');
    const drop = new Set(ADDED);
    store.write('added-members.json', store.read('added-members.json', []).filter((m) => !drop.has(m.id)));
    const ov = store.read('member-admin.json', {});
    for (const id of ADDED) delete ov[id];
    store.write('member-admin.json', ov);
    const mu = store.read('users.json', { users: [] });
    const arr = Array.isArray(mu) ? mu : (mu.users || []);
    const next = arr.filter((u) => !drop.has(u.memberId));
    store.write('users.json', Array.isArray(mu) ? next : { ...mu, users: next });
  }
  server && server.close();
  mock.reset();
});

test('out of the box it is the original letter, untouched', async () => {
  await save({ reset: true });
  const d = await get();
  assert.equal(d.isDefault, true);
  assert.match(d.subject, /Welcome to the West Valley/);
  assert.ok(d.body.includes('{{link}}'), 'the sign-in link is in the shipped copy');
  assert.ok(d.body.includes('it is only $50'), 'the office’s own wording is preserved verbatim');
});

test('a letter without {{link}} is refused — it would send a dead welcome', async () => {
  const r = await save({ subject: 'Welcome!', body: 'Glad to have you. Come to a mixer.' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /\{\{link\}\}/);
  assert.equal((await get()).isDefault, true, 'and nothing was stored');
});

test('a made-up merge field is refused rather than sent out raw', async () => {
  const r = await save({ subject: 'Welcome!', body: 'Hi {{firstname}} — {{link}}' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /firstname/);
});

test('an empty subject or body is refused', async () => {
  assert.equal((await save({ subject: '', body: 'x {{link}}' })).status, 400);
  assert.equal((await save({ subject: 'Hi', body: '   ' })).status, 400);
});

test('the office can add a couple of things — which is the whole request', async () => {
  const body = 'Welcome, {{name}}!\n\nWe are glad {{business}} has joined.\n\nSet your password: {{link}}\n\nOur next breakfast is the first Wednesday.';
  const r = await save({ subject: 'Welcome aboard!', body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = await get();
  assert.equal(d.isDefault, false);
  assert.equal(d.body, body);
  assert.equal(d.subject, 'Welcome aboard!');
});

test('the preview shows the edited letter with the fields filled in', async () => {
  const p = await preview();
  assert.equal(p.subject, 'Welcome aboard!', 'the preview follows the edit, not the old hardcoded copy');
  assert.match(p.text, /Our next breakfast is the first Wednesday/);
  assert.ok(!p.text.includes('{{'), `no merge field should survive into the letter: ${p.text}`);
  assert.match(p.text, /sign-in link goes here/, 'the real link is only minted on a real send');
});

test('what is sent is what was previewed, and carries a working link', async () => {
  sent.length = 0;
  const r = await adm(`/api/admin/members/${MEMBER}/send-welcome`, { method: 'POST', body: JSON.stringify({ email: `wl-${T}@example.com` }) });
  assert.equal(r.status, 200, await r.text());
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.subject, 'Welcome aboard!');
  assert.match(mail.text, /Our next breakfast is the first Wednesday/);
  assert.ok(!mail.text.includes('{{'), 'no unfilled merge field goes to a member');
  const link = (mail.text.match(/https?:\/\/\S+reset\.html\?token=\S+/) || [])[0];
  assert.ok(link, `the set-your-password link must survive into the mail: ${mail.text}`);
  assert.ok(mail.html.includes(`href="${link}"`), 'and be a real anchor in the HTML half');
  assert.ok(mail.html.includes('<p>'), 'the HTML is generated from the same text, not hand-kept');
});

test('a stored letter that lost its link falls back to the original', async () => {
  // Belt and braces: the save guard should make this unreachable, but a bad
  // row must never mean a member gets an email with no way in.
  const repo = await import('../repo.js');
  await repo.setSetting('welcomeLetter', JSON.stringify({ subject: 'Broken', body: 'no link here' }));
  const d = await get();
  assert.equal(d.isDefault, true, 'unusable stored copy is ignored');
  assert.ok(d.body.includes('{{link}}'));
});

/* Felicia, Sep 30 2026, sending new wording for "our welcome email that goes
   out to everyone". It did not go out to everyone: adding a member by hand
   under Members sent its own hardcoded note, so a member added that way got
   the old wording whatever the office saved under Content. */
test('a member added by hand gets the office\'s letter, not a separate note', async () => {
  const body = 'Welcome, {{name}}!\n\n{{business}} is on the to-do list.\n\nYour sign-in link: {{link}}';
  assert.equal((await save({ subject: 'Welcome to the Chamber! Your New Member To-Do List', body })).status, 200);
  sent.length = 0;
  const addr = `added-${T}@example.com`;
  const r = await adm('/api/admin/members', { method: 'POST', body: JSON.stringify({
    name: `Hand Added Co ${T}`, contactName: 'Pat Example', email: addr,
  }) });
  const out = await r.json();
  assert.equal(r.status, 200, JSON.stringify(out));
  ADDED.push(out.member.id);

  assert.equal(sent.length, 1, 'one email, not the letter and a note');
  const mail = sent[0];
  assert.equal(mail.to, addr);
  assert.equal(mail.subject, 'Welcome to the Chamber! Your New Member To-Do List', 'the subject the office saved');
  assert.match(mail.text, /^Welcome, Pat Example!/, '{{name}} is the contact');
  assert.match(mail.text, new RegExp(`Hand Added Co ${T} is on the to-do list`), '{{business}} is the listing');
  assert.ok(!mail.text.includes('{{'), 'no merge field left raw');
  assert.ok(!/set up your account/i.test(mail.subject + mail.text), 'the old hardcoded note is gone');
  const link = (mail.text.match(/https?:\/\/\S+reset\.html\?token=\S+/) || [])[0];
  assert.ok(link, 'it still carries the set-your-password link');
  assert.ok(mail.html.includes(`href="${link}"`), 'as a real anchor');
  assert.match(out.login, /welcome letter sent/);
});

test('the row reads "Welcome sent", so nobody sends a second copy', async () => {
  const id = ADDED[ADDED.length - 1];
  assert.ok(id, 'the previous test added a member');
  const members = (await (await adm('/api/admin/members')).json()).members || [];
  const m = members.find((x) => x.id === id);
  assert.ok(m, 'the added member is on the roster');
  assert.ok(m.welcomeSent, 'stamped the same way the Welcome button stamps it');
});

test('a member added with no email is added, and nothing is sent', async () => {
  sent.length = 0;
  const r = await adm('/api/admin/members', { method: 'POST', body: JSON.stringify({ name: `No Email Co ${T}` }) });
  const out = await r.json();
  assert.equal(r.status, 200);
  ADDED.push(out.member.id);
  assert.equal(sent.length, 0);
  assert.equal(out.login, null);
});

test('both paths go through the one helper', async () => {
  const { readFileSync } = await import('node:fs');
  const routes = readFileSync(new URL('../chamber-routes.js', import.meta.url), 'utf8');
  const button = routes.slice(routes.indexOf("router.post('/admin/members/:id/send-welcome'"), routes.indexOf('// Force a member to reset their password'));
  const add = routes.slice(routes.indexOf("router.post('/admin/members', requireAdmin"));
  assert.match(button, /await sendWelcomeLetter\(m, addr, link\)/, 'the Welcome button');
  const addFn = add.slice(0, add.indexOf('\n});') + 4);
  assert.match(addFn, /await sendWelcomeLetter\(m, m\.email, link\)/, 'adding a member by hand');
  assert.ok(!/email\.send\(/.test(addFn), 'and no second, hand-written email in that route');
});
