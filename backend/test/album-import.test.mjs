/* Michael, Oct 29 2026: "Can we add these as a gallery on the website" —
   Robyn Richardson's Food & Wine Tour 2026 album, 351 photos behind one
   adobe.ly link to Lightroom. Admin → Albums now imports a Lightroom share
   link: the server copies every photo (2048px, with Lightroom's 640px copy as
   the grid thumbnail) and credits the photographer.

   Lightroom is stood in for here; nothing leaves the machine.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';

const real = await import('../album-import.js?real');
const SPACE = 'a'.repeat(32), ALBUM = 'b'.repeat(32), SHARE = SPACE;
const hex = (n) => n.toString(16).padStart(32, '0');
const asset = (n, extra = {}) => ({
  asset: {
    id: hex(n), subtype: 'image',
    payload: { importSource: { fileName: `RRICHARDSON-2026-${String(n).padStart(4, '0')}.jpg` } },
    links: {
      '/rels/rendition_type/2048': { href: `assets/${hex(n)}/revisions/${'c'.repeat(32)}/renditions/${'d'.repeat(32)}` },
      '/rels/rendition_type/640': { href: `assets/${hex(n)}/revisions/${'c'.repeat(32)}/renditions/${'e'.repeat(32)}` },
    },
    ...extra,
  },
});
let PHOTOS = 25;
const lightroom = async (url, opts = {}) => {
  if (url === 'https://adobe.ly/4zlPbgp') return { status: 301, location: `https://lightroom.adobe.com/shares/${SHARE}`, text: '' };
  if (url === `https://lightroom.adobe.com/shares/${SHARE}`) {
    return { status: 200, text: `<html><head><title>Food &amp; Wine Tour 2026 by Robyn Richardson</title></head><body>"spaces/${SPACE}/albums/${ALBUM}/assets?embed=asset"</body></html>` };
  }
  if (url === `https://lightroom.adobe.com/v2/spaces/${SPACE}/albums/${ALBUM}`) {
    return { status: 200, text: 'while (1) {}\n' + JSON.stringify({ payload: { name: 'Food & Wine Tour 2026', cover: { id: hex(3) } } }) };
  }
  if (url.startsWith(`https://lightroom.adobe.com/v2/spaces/${SPACE}/albums/${ALBUM}/assets?`)) {
    const res = Array.from({ length: PHOTOS }, (_, i) => asset(i + 1));
    res.push({ asset: { id: hex(999), subtype: 'video', links: res[0].asset.links } });           // a video: skipped
    res.push(asset(998, { links: { '/rels/rendition_type/2048': { href: '../../evil' } } }));    // a bad path: skipped
    return { status: 200, text: 'while (1) {}\n' + JSON.stringify({ base: `https://photos.adobe.io/v2/spaces/${SPACE}/`, resources: res, links: {} }) };
  }
  return { status: 404, text: '' };
};
// Every image download, counted, so a test can pause the import part-way.
let fetches = 0, holdFrom = Infinity, held = null;
const image = async (url) => {
  fetches++;
  if (fetches > holdFrom) await held;
  return Buffer.from('fake-jpeg-' + url.slice(-40));
};

let server, base, cookie, mod;
const T = Date.now().toString(36);
const ADMIN = `office-ai-${T}@test.woodlandhillscc.net`;
const made = [];

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Test Office`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  mock.module('../album-import.js', {
    namedExports: { ...real, fetchText: lightroom, fetchImage: image },
  });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  mod = await import('../chamber-routes.js');
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', mod.default);
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

after(async () => {
  for (const id of made) await adm(`/api/admin/albums/${id}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

const adm = (p, opts = {}) => fetch(base + p, { ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) } });
const album = async (id) => (await (await fetch(`${base}/api/albums/${id}`)).json()).album;
const finish = async (jobId) => {
  for (let i = 0; i < 200; i++) {
    const j = await (await adm(`/api/admin/albums/import/${jobId}`)).json();
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('import never finished');
};

test('share links: Lightroom and adobe.ly only', () => {
  assert.deepEqual(real.parseShareUrl(`https://lightroom.adobe.com/shares/${SHARE}`), { shareId: SHARE });
  assert.deepEqual(real.parseShareUrl(`https://lightroom.adobe.com/shares/${SHARE.toUpperCase()}/x`), { shareId: SHARE });
  assert.deepEqual(real.parseShareUrl('https://adobe.ly/4zlPbgp'), { shortUrl: 'https://adobe.ly/4zlPbgp' });
  for (const bad of ['javascript:alert(1)', 'https://evil.example/shares/' + SHARE, 'https://lightroom.adobe.com/shares/nothex',
    'https://lightroom.adobe.com.evil.example/shares/' + SHARE, 'https://adobe.ly/../x', 'ftp://adobe.ly/abc', '']) {
    assert.equal(real.parseShareUrl(bad), null, bad);
  }
});

test('only renditions under the album space are ever fetched', () => {
  assert.equal(real.renditionUrl(SPACE, `assets/${hex(1)}/revisions/x/renditions/y`), `https://lightroom.adobe.com/v2/spaces/${SPACE}/assets/${hex(1)}/revisions/x/renditions/y`);
  for (const bad of ['../../evil', `assets/${hex(1)}/../../x`, 'https://evil.example/x.jpg', '//evil.example/x', `albums/${ALBUM}`]) {
    assert.equal(real.renditionUrl(SPACE, bad), '', bad);
  }
});

test('the album reads with its title, photographer, cover and photos in order', async () => {
  const lr = await real.readLightroomAlbum('https://adobe.ly/4zlPbgp', lightroom);
  assert.equal(lr.title, 'Food & Wine Tour 2026');
  assert.equal(lr.author, 'Robyn Richardson');
  assert.equal(lr.coverId, hex(3));
  assert.equal(lr.photos.length, PHOTOS, 'the video and the bad path are left out');
  assert.equal(lr.photos[0].name, 'RRICHARDSON-2026-0001.jpg');
  assert.match(lr.photos[0].full, /^https:\/\/lightroom\.adobe\.com\/v2\/spaces\//);
  await assert.rejects(real.readLightroomAlbum('https://example.com/x', lightroom), /not a Lightroom share link/);
});

test('copying skips what is there, stops at the cap and counts failures', async () => {
  const photos = [1, 2, 3, 4, 5].map((n) => ({ src: 'lr:' + hex(n), name: `p${n}.jpg`, full: 'F' + n, thumb: n === 2 ? 'BADTHUMB' : 'T' + n }));
  const committed = [];
  const r = await real.copyPhotos({
    photos, have: new Set(['lr:' + hex(1)]), room: 3, by: 'Robyn Richardson',
    fetchImage: async (u) => { if (u === 'F4' || u === 'BADTHUMB') throw new Error('nope'); return Buffer.from(u); },
    store: async (b) => '/api/assets/x-' + b.toString(),
    commit: async (batch) => committed.push(...batch),
    batchSize: 2, concurrency: 1,
  });
  assert.deepEqual({ ...r }, { total: 5, skipped: 1, overCap: 1, added: 2, failed: 1, done: 3 });
  assert.deepEqual(committed.map((p) => p.src), ['lr:' + hex(2), 'lr:' + hex(3)]);
  assert.equal(committed[0].thumb, '', 'a missing thumbnail falls back to the full photo');
  assert.equal(committed[1].thumb, '/api/assets/x-T3');
  assert.ok(committed.every((p) => p.by === 'Robyn Richardson'));
});

test('a bad link is explained, not a status code', async () => {
  const r = await adm('/api/admin/albums/import', { method: 'POST', body: JSON.stringify({ url: 'https://example.com/photos' }) });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not a Lightroom share link/);
  const anon = await fetch(`${base}/api/admin/albums/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"url":"https://adobe.ly/4zlPbgp"}' });
  assert.equal(anon.status, 401);
});

test('pasting the link makes the album, credits the photographer and is safe to run again', async () => {
  const r = await adm('/api/admin/albums/import', { method: 'POST', body: JSON.stringify({ url: 'https://adobe.ly/4zlPbgp' }) });
  assert.equal(r.status, 200);
  const start = await r.json();
  made.push(start.albumId);
  assert.equal(start.title, 'Food & Wine Tour 2026');
  assert.equal(start.total, PHOTOS);
  const j = await finish(start.jobId);
  assert.equal(j.state, 'done');
  assert.equal(j.added, PHOTOS);
  const a = await album(start.albumId);
  assert.equal(a.count, PHOTOS);
  assert.equal(a.body, 'Photos by Robyn Richardson.');
  assert.ok(a.photos.every((p) => p.by === 'Robyn Richardson' && /^\/api\/assets\/asset-/.test(p.url) && /^\/api\/assets\/asset-/.test(p.thumb)));
  assert.equal(a.photos[0].src, 'lr:' + hex(1), 'Lightroom order is kept');
  assert.equal(a.cover, a.photos[2].thumb, "Lightroom's own cover photo is the album cover");

  const again = await (await adm('/api/admin/albums/import', { method: 'POST', body: JSON.stringify({ url: `https://lightroom.adobe.com/shares/${SHARE}`, albumId: start.albumId }) })).json();
  const j2 = await finish(again.jobId);
  assert.equal(j2.added, 0);
  assert.equal(j2.skipped, PHOTOS);
  assert.equal((await album(start.albumId)).count, PHOTOS, 'nothing doubled');
});

test('a save from the admin page mid-import does not lose the photos already copied', async () => {
  // Pause the import once 20 photos (two downloads each) are in: the first
  // batch of 20 is saved, the rest wait.
  let open; held = new Promise((r) => { open = r; });
  holdFrom = fetches + 40;
  const start = await (await adm('/api/admin/albums/import', { method: 'POST', body: JSON.stringify({ url: 'https://adobe.ly/4zlPbgp', title: 'Race test' }) })).json();
  made.push(start.albumId);
  for (let i = 0; i < 200 && (await album(start.albumId)).count < 20; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal((await album(start.albumId)).count, 20);
  // The admin page renames by sending the album back whole — here, a stale copy with no photos.
  const save = await adm(`/api/admin/albums/${start.albumId}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed', photos: [] }) });
  assert.equal(save.status, 200);
  open();
  const j = await finish(start.jobId);
  assert.equal(j.state, 'done');
  const a = await album(start.albumId);
  assert.equal(a.title, 'Renamed');
  assert.equal(a.count, PHOTOS, 'the import puts back what the stale save dropped');
});

test('an album holds up to 500 photos', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../chamber-routes.js', import.meta.url), 'utf8');
  assert.match(src, /const ALBUM_PHOTO_CAP = 500;/);
});
