/* Felicia, Oct 12 2026: "We tried to upload the news letter … we got an
   'Upload Failed' message." The October issue was a 194MB Canva export.
   The "upload the PDF directly" button sent the whole file as one base64
   JSON body (capped near 20MB, and too big for the CDN in one request), and
   the other link she had was a bit.ly to a Canva view page, not a PDF.

   Now a direct upload goes up in 8MB pieces and through the same
   shrink-and-publish job as a pasted link, and a Canva link gets a plain
   explanation instead of a generic failure.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { isCanvaUrl } from '../newsletter-import.js';

const ADMIN = 'nl-upload-test@wvwccc.test';
let server, base, cookie;
const cleanup = { posts: [], assets: [] };

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Newsletter Test`;
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
});

after(async () => {
  for (const id of cleanup.posts) await fetch(`${base}/api/admin/posts/${id}`, { method: 'DELETE', headers: { cookie } }).catch(() => {});
  for (const id of cleanup.assets) await fetch(`${base}/api/admin/assets/${id}`, { method: 'DELETE', headers: { cookie } }).catch(() => {});
  server && server.close();
  mock.reset();
});

const json = (path, body, method = 'POST') => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const put = (path, buf) => fetch(base + path, {
  method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', cookie }, body: buf,
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function samplePdf(pages = 3) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([400, 560]).drawText(`Valley Biz Connect test page ${i + 1}`, { x: 40, y: 500, size: 16, font });
  return Buffer.from(await doc.save());
}

async function waitForJob(jobId) {
  for (let i = 0; i < 120; i++) {
    const r = await fetch(`${base}/api/admin/newsletters/import/${jobId}`, { headers: { cookie } }).then((x) => x.json());
    if (r.status !== 'working') return r;
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error('job never finished');
}

test('Canva links are recognised, bit.ly and Drive links are not', () => {
  assert.ok(isCanvaUrl('https://www.canva.com/design/DAHXH68pPME/abc/view'));
  assert.ok(isCanvaUrl('https://canva.com/design/x'));
  assert.ok(!isCanvaUrl('https://drive.google.com/file/d/1oVg/view'));
  assert.ok(!isCanvaUrl('https://bit.ly/ValleyBizConnect_OCTOBER2026'));
  assert.ok(!isCanvaUrl('https://notcanva.com.evil.example/x'));
});

test('pasting a Canva link is refused with an explanation, not a job', async () => {
  const r = await json('/api/admin/newsletters/import', { title: 'October 2026', url: 'https://www.canva.com/design/DAHXH68pPME/x/view' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Canva/);
  assert.match(r.body.error, /Google Drive link/);
});

test('a PDF uploaded in pieces is published with a cover', async () => {
  const pdf = await samplePdf(3);
  const start = await json('/api/admin/newsletters/upload', { title: 'Upload test issue', size: pdf.length });
  assert.equal(start.status, 200);
  const { uploadId } = start.body;
  // Smaller pieces than production so the test exercises reassembly.
  const piece = Math.ceil(pdf.length / 3);
  for (let off = 0; off < pdf.length; off += piece) {
    const r = await put(`/api/admin/newsletters/upload/${uploadId}?offset=${off}`, pdf.subarray(off, off + piece));
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const fin = await json(`/api/admin/newsletters/upload/${uploadId}/finish`, {});
  assert.equal(fin.status, 200);
  const job = await waitForJob(fin.body.jobId);
  assert.equal(job.status, 'done', job.error);
  assert.equal(job.result.pages, 3);
  cleanup.posts.push(job.result.postId);
  const pdfId = job.result.url.split('/').pop();
  cleanup.assets.push(pdfId, pdfId.replace('asset-nl-', 'asset-nlc-'));

  const served = await fetch(base + job.result.url);
  assert.equal(served.status, 200);
  assert.equal(Buffer.from(await served.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('pieces out of order are refused and the server says where it is', async () => {
  const pdf = await samplePdf(1);
  const { body } = await json('/api/admin/newsletters/upload', { title: 'Order test', size: pdf.length });
  const r = await put(`/api/admin/newsletters/upload/${body.uploadId}?offset=10`, pdf.subarray(10));
  assert.equal(r.status, 409);
  assert.equal(r.body.received, 0);
});

test('a file that is not a PDF is refused on its first piece', async () => {
  const fake = Buffer.from('<html>this is a Canva page</html>');
  const { body } = await json('/api/admin/newsletters/upload', { title: 'Not a PDF', size: fake.length });
  const r = await put(`/api/admin/newsletters/upload/${body.uploadId}?offset=0`, fake);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not a PDF/);
  const fin = await json(`/api/admin/newsletters/upload/${body.uploadId}/finish`, {});
  assert.equal(fin.status, 404, 'a refused upload is gone');
});

test('an upload over the cap is refused before any bytes move', async () => {
  const r = await json('/api/admin/newsletters/upload', { title: 'Huge', size: 250_000_000 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /PDF Standard/);
});

test('finishing before every piece arrived is refused', async () => {
  const pdf = await samplePdf(1);
  const { body } = await json('/api/admin/newsletters/upload', { title: 'Short', size: pdf.length });
  await put(`/api/admin/newsletters/upload/${body.uploadId}?offset=0`, pdf.subarray(0, 100));
  const fin = await json(`/api/admin/newsletters/upload/${body.uploadId}/finish`, {});
  assert.equal(fin.status, 400);
});

test('the upload routes are for staff only', async () => {
  const r = await fetch(`${base}/api/admin/newsletters/upload`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'x', size: 10 }),
  });
  assert.ok([401, 403].includes(r.status), String(r.status));
});
