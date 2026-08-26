/* Felicia, Aug 26 2026 — "the Gaspar logo is pixelated on the September 2nd
   Breakfast." The stored file was a crisp 1800px PNG; the browser's one-step
   squeeze to 252px is what crunched it. /api/assets/:id?w=<px> now serves a
   properly filtered downscale. These tests pin the contract: widths snap to
   a coarse ladder (shared cache rungs), a resize is never an upscale (too
   big a request serves the original bytes), and no-w requests are untouched.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { snapWidth, nativeWidth } from '../images.js';

let server, base, cookie, assetId, uploadedBytes;
const T = Date.now().toString(36);
const ADMIN = `resize-admin-${T}@test.local`;

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Resize Test`;
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
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  uploadedBytes = await QRCode.toBuffer('resize test ' + T, { width: 800 });
  const up = await fetch(`${base}/api/me/asset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ dataUrl: 'data:image/png;base64,' + uploadedBytes.toString('base64'), kind: 'photo', name: 'resize-test' }),
  });
  assert.equal(up.status, 200);
  assetId = (await up.json()).id;
});

after(async () => {
  if (assetId) await fetch(`${base}/api/admin/assets/${assetId}`, { method: 'DELETE', headers: { cookie } }).catch(() => {});
  server && server.close();
  mock.reset();
});

const pngWidth = (buf) => buf.readUInt32BE(16);
const get = async (q) => {
  const r = await fetch(`${base}/api/assets/${assetId}${q}`);
  return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
};

test('requested widths snap to the shared ladder', () => {
  assert.equal(snapWidth(), 0);
  assert.equal(snapWidth('nope'), 0);
  assert.equal(snapWidth(90), 200);
  assert.equal(snapWidth(504), 600);
  assert.equal(snapWidth(5000), 1600);
});

test('nativeWidth reads the real pixel width from the header', () => {
  assert.equal(nativeWidth('image/png', uploadedBytes), 800);
});

test('?w serves a properly downscaled render', async () => {
  const r = await get('?w=300');
  assert.equal(r.status, 200);
  assert.match(r.type, /image\/png/);
  // The contract is pixel size, not byte size — a 1-bit source (this QR)
  // can compress smaller than its RGB render ever will.
  assert.equal(pngWidth(r.buf), 300);
});

test('a tiny request still gets the smallest ladder rung', async () => {
  const r = await get('?w=90');
  assert.equal(pngWidth(r.buf), 200);
});

test('a request at or beyond native size serves the original bytes', async () => {
  const r = await get('?w=5000');
  assert.equal(r.status, 200);
  assert.equal(pngWidth(r.buf), 800);
  assert.equal(r.buf.length, uploadedBytes.length, 'untouched original');
});

test('no ?w keeps the original exactly as before', async () => {
  const r = await get('');
  assert.equal(pngWidth(r.buf), 800);
  assert.equal(r.buf.length, uploadedBytes.length);
});
