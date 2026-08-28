/* Two Aug 27 2026 asks that both live in server.js.

   Diana: "Take this page down. Chamber Leaders" — leaders.html is gone. The
   URL was in the sitemap and is linked from old email, so it has to redirect
   rather than 404, and it must not come back in the sitemap.

   Nicole Cohen (Hawaiian Movers), via Felicia: submit her listing for indexing
   in Search Console, and confirm the sitemap carries her page and every other
   member profile. Verification needs a token-bearing file at the site root;
   the sitemap half is pinned here so the answer we give her stays true.

   These boot the real server.js so the routes, the redirect and the sitemap
   walk are all exercised together. Run: npm test */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

let proc, base;
const PORT = 5610 + (process.pid % 50);

async function up(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.status) return true; } catch {}
    await sleep(250);
  }
  return false;
}

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), GSC_VERIFICATION: 'abc123testtoken', ADMIN_BOOTSTRAP: '' },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${PORT}`;
  assert.ok(await up(`${base}/healthz`), 'server started');
});

after(() => { proc && proc.kill(); });

test('the retired Chamber Leaders page redirects instead of dead-ending', async () => {
  const r = await fetch(`${base}/leaders.html`, { redirect: 'manual' });
  assert.equal(r.status, 301, 'permanent — the page is not coming back');
  assert.equal(r.headers.get('location'), '/members/directory.html');
});

test('the retired page is gone from the sitemap', async () => {
  const xml = await (await fetch(`${base}/sitemap.xml`)).text();
  assert.ok(!xml.includes('/leaders.html'), 'sitemap must never advertise a URL we redirect away');
});

test('the sitemap carries every member profile page', async () => {
  const [xml, api] = await Promise.all([
    (await fetch(`${base}/sitemap.xml`)).text(),
    (await fetch(`${base}/api/members`)).json(),
  ]);
  const members = api.members || [];
  assert.ok(members.length > 100, 'the directory is loaded');
  const listed = (xml.match(/<loc>[^<]*\/members\/[^<]*<\/loc>/g) || [])
    .filter((u) => !u.includes('directory.html')).length;
  assert.equal(listed, members.filter((m) => m.slug).length,
    'every member with a slug is in the sitemap — this is what we told Nicole');
});

test('Search Console verification is served from the token, not a file in the repo', async () => {
  const r = await fetch(`${base}/googleabc123testtoken.html`);
  assert.equal(r.status, 200);
  assert.equal((await r.text()).trim(), 'google-site-verification: googleabc123testtoken.html');
});

test('a wrong verification token is not honoured', async () => {
  const r = await fetch(`${base}/googlewrongtoken.html`);
  assert.equal(r.status, 404, 'only the configured token verifies the property');
});
