/* ============================================================
   Newsletter import-from-link (Felicia/Diana self-serve, Aug 2026).

   The office's newsletter PDFs come out of Canva at print quality —
   the August issue was 49MB, far over the upload cap — so instead of
   asking them to compress files, they paste the public link (Google
   Drive share link, Dropbox, or any direct PDF URL) into Admin →
   Content → Newsletters. The server downloads it, shrinks it to a
   web-friendly size, makes a cover image from page 1, and publishes
   it to the public Valley Biz Connect page. No file juggling.

   Big files take ~15-60s, longer than a proxied request should hang,
   so the POST starts a background job and the admin page polls.
   ============================================================ */
import dns from 'node:dns/promises';
import net from 'node:net';
import express from 'express';
import * as repo from './repo.js';

// Compress only when the source is heavier than the site would want to
// serve; smaller PDFs pass through untouched (keeps their selectable text).
const KEEP_AS_IS_BYTES = 6_500_000;
/* Absolute fetch cap. Raised from 100MB on Sep 4 2026: Diana's September issue
   came off Canva at over 100MB and the import refused it — on the one route
   whose whole point is "any size, we shrink it for you". The service runs on
   Render Standard (2GB); a 200MB source peaks around 700-800MB through the
   buffer, the WASM copy and the rasteriser, which leaves real headroom. */
const DOWNLOAD_CAP = 200_000_000;
const PAGE_CAP = 80;                // a "newsletter" sanity bound
const RASTER_DPI = 125;             // crisp on phones, ~250KB/page
const JPEG_QUALITY = 74;
/* Direct uploads arrive in pieces this size (Oct 13 2026). Felicia's October
   issue was a 194MB Canva export: the old "upload the PDF" button sent the
   whole file as one base64 JSON body, capped at ~20MB, and a single request
   that size would not get through the CDN in front of the site anyway. The
   browser now slices the file, the server reassembles it, and it goes through
   the same shrink-and-publish job as a pasted link. */
const UPLOAD_CHUNK = 8 * 1024 * 1024;

// Canva "view" links (often behind a bit.ly) open a web page, not a PDF —
// October's issue arrived with one. Say so plainly instead of "not a PDF".
const CANVA_MSG = 'That link opens the newsletter in Canva, which is a web page, not the PDF file. '
  + 'Paste the Google Drive link to the PDF instead, or download the PDF and use "upload the PDF file".';
export const isCanvaUrl = (url) => {
  try { return /(^|\.)canva\.com$/i.test(new URL(url).hostname); } catch { return false; }
};

// ── URL handling ────────────────────────────────────────────
// Share links people actually paste, rewritten to direct downloads.
export function normalizeShareUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  // Google Drive: /file/d/<id>/view, open?id=<id>, uc?id=<id>
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const id = (u.pathname.match(/\/file\/d\/([\w-]+)/) || [])[1] || u.searchParams.get('id');
    if (!id) return null;
    return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  // Dropbox: shared links serve an HTML preview unless dl=1
  if (host.endsWith('dropbox.com')) { u.searchParams.set('dl', '1'); return u.toString(); }
  return u.toString();
}

// SSRF guard: the URL's host must resolve to public addresses only.
async function assertPublicHost(url) {
  const host = new URL(url).hostname;
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) throw new Error('That address is not reachable from here.');
  }
}
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 169 && b === 254);
  }
  const low = ip.toLowerCase();
  return low === '::1' || low === '::' || low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd')
    || low.startsWith('::ffff:127.') || low.startsWith('::ffff:10.') || low.startsWith('::ffff:192.168.');
}

async function fetchBinary(url, redirectsLeft = 5) {
  await assertPublicHost(url);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 300_000);   // 200MB needs longer than 2 minutes
  try {
    // Manual redirect handling so every hop gets the SSRF check.
    const r = await fetch(url, { redirect: 'manual', signal: ctl.signal });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      if (!redirectsLeft) throw new Error('Too many redirects.');
      const loc = new URL(r.headers.get('location'), url).toString();
      return fetchBinary(loc, redirectsLeft - 1);
    }
    if (!r.ok) throw new Error(`The link answered ${r.status} — is it shared publicly ("Anyone with the link")?`);
    // Say the real limit and what to do about it, rather than implying they
    // picked the wrong file.
    const tooBig = () => new Error(`That file is over ${Math.round(DOWNLOAD_CAP / 1e6)}MB, which is bigger than the site will pull in. `
      + 'In Canva, export again as "PDF Standard" instead of "PDF Print" and paste the new link.');
    const declared = Number(r.headers.get('content-length')) || 0;
    if (declared > DOWNLOAD_CAP) { ctl.abort(); throw tooBig(); }
    const reader = r.body.getReader();
    // With a declared length, write straight into one buffer: joining a list of
    // chunks would briefly hold the whole file twice.
    const into = declared ? Buffer.allocUnsafe(declared) : null;
    const chunks = []; let total = 0, filled = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > DOWNLOAD_CAP) { ctl.abort(); throw tooBig(); }
      if (into && filled === total && total + value.length <= declared) { into.set(value, total); filled += value.length; }
      else chunks.push(value);
      total += value.length;
    }
    const buffer = !into ? Buffer.concat(chunks)
      : chunks.length ? Buffer.concat([into.subarray(0, filled), ...chunks]) : into.subarray(0, filled);
    return { buffer, contentType: r.headers.get('content-type') || '', finalUrl: url };
  } finally { clearTimeout(timer); }
}

// Google Drive's large-file interstitial ("can't scan for viruses") is an
// HTML form — extract its fields and retry once with them.
function driveConfirmUrl(html) {
  const action = (html.match(/action="([^"]+)"/) || [])[1];
  if (!action || !/drive\.usercontent\.google\.com/.test(action)) return null;
  const inputs = [...html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)];
  const qs = new URLSearchParams(inputs.map(([, n, v]) => [n, v]));
  return `${action}?${qs}`;
}

async function downloadPdf(url) {
  let { buffer, contentType, finalUrl } = await fetchBinary(url);
  if (buffer.subarray(0, 5).toString() !== '%PDF-' && isCanvaUrl(finalUrl)) throw new Error(CANVA_MSG);
  if (buffer.subarray(0, 5).toString() !== '%PDF-' && /html/.test(contentType)) {
    const confirm = driveConfirmUrl(buffer.toString('utf8', 0, 60_000));
    if (confirm) ({ buffer, contentType } = await fetchBinary(confirm));
  }
  if (buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('That link did not return a PDF. In Google Drive use Share → "Anyone with the link", then paste the link here.');
  }
  return buffer;
}

// ── PDF processing (mupdf WASM + pdf-lib — no native binaries) ──
async function renderPageJpeg(mupdf, doc, index, dpi, quality) {
  const page = doc.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    const s = dpi / 72;
    const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
    const jpg = pix.asJPEG(quality, false);
    pix.destroy();
    return { jpg, width: x1 - x0, height: y1 - y0 };
  } finally { page.destroy(); }
}

async function processPdf(buffer, job) {
  const mupdf = await import('mupdf');
  const { PDFDocument } = await import('pdf-lib');
  const src = mupdf.Document.openDocument(buffer, 'application/pdf');
  const pages = src.countPages();
  if (!pages) throw new Error('That PDF has no pages.');
  if (pages > PAGE_CAP) throw new Error(`That PDF has ${pages} pages — newsletters cap at ${PAGE_CAP}.`);

  // Cover: page 1 as a card image for the Valley Biz Connect grid.
  job.step = 'Making the cover image';
  const cover = (await renderPageJpeg(mupdf, src, 0, 100, 80)).jpg;

  let pdfOut = buffer;
  if (buffer.length > KEEP_AS_IS_BYTES) {
    const out = await PDFDocument.create();
    for (let i = 0; i < pages; i++) {
      job.step = `Optimizing page ${i + 1} of ${pages}`;
      const { jpg, width, height } = await renderPageJpeg(mupdf, src, i, RASTER_DPI, JPEG_QUALITY);
      const img = await out.embedJpg(jpg);
      out.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
    }
    pdfOut = Buffer.from(await out.save());
  }
  return { pdfOut, cover, pages, originalBytes: buffer.length };
}

// ── Jobs ────────────────────────────────────────────────────
const jobs = new Map();
const uploads = new Map();   // chunked direct uploads in progress
function gcJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.startedAt < cutoff) jobs.delete(id);
  for (const [id, u] of uploads) if (u.startedAt < cutoff) uploads.delete(id);
}
const newId = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
function startJob(args) {
  const id = newId('nlj-');
  const job = { id, status: 'working', step: 'Starting', startedAt: Date.now() };
  jobs.set(id, job);
  runImport(job, args);
  return id;
}

async function runImport(job, { title, url, buffer: uploaded, userId }) {
  try {
    let buffer = uploaded;
    if (!buffer) {
      job.step = 'Downloading the PDF from the link';
      buffer = await downloadPdf(url);
    }
    job.step = 'Reading the PDF';
    const { pdfOut, cover, pages, originalBytes } = await processPdf(buffer, job);

    job.step = 'Saving to the website';
    const stamp = Date.now().toString(36);
    const pdfId = 'asset-nl-' + stamp;
    const coverId = 'asset-nlc-' + stamp;
    await repo.addAsset({ id: pdfId, memberId: null, kind: 'doc', mime: 'application/pdf', buffer: pdfOut, name: title, tags: 'newsletter' });
    await repo.addAsset({ id: coverId, memberId: null, kind: 'photo', mime: 'image/jpeg', buffer: Buffer.from(cover), name: title + ' — cover', tags: 'newsletter cover' });
    const post = {
      id: 'post-' + stamp,
      type: 'newsletter', authorId: userId, authorName: 'WVWC Chamber', memberId: null,
      title: String(title).slice(0, 200), body: '',
      imageUrl: '/api/assets/' + coverId, linkUrl: '/api/assets/' + pdfId,
      ctaLabel: '', ctaUrl: '', code: '', status: 'approved', featuredHome: false, expiresAt: null,
    };
    await repo.addPost(post);
    job.status = 'done';
    job.step = 'Published';
    job.result = {
      postId: post.id, url: post.linkUrl, pages,
      originalMB: +(originalBytes / 1e6).toFixed(1), finalMB: +(pdfOut.length / 1e6).toFixed(1),
    };
  } catch (e) {
    console.error('newsletter import', e);
    job.status = 'error';
    job.error = e.message || 'Import failed.';
  }
}

export function registerNewsletterImport(router, requireAdmin) {
  router.post('/admin/newsletters/import', requireAdmin, async (req, res) => {
    gcJobs();
    const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
    const url = normalizeShareUrl(req.body && req.body.url);
    if (!title) return res.status(400).json({ error: 'Give the issue a title first (e.g. "September 2026").' });
    if (!url) return res.status(400).json({ error: 'Paste a full link — a Google Drive share link, Dropbox link, or a direct PDF address.' });
    if (isCanvaUrl(url)) return res.status(400).json({ error: CANVA_MSG });
    res.json({ ok: true, jobId: startJob({ title, url, userId: req.user.sub }) });
  });

  // ── Direct upload, in pieces: start → PUT each slice → finish ──
  router.post('/admin/newsletters/upload', requireAdmin, (req, res) => {
    gcJobs();
    const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
    const size = Number(req.body && req.body.size);
    if (!title) return res.status(400).json({ error: 'Give the issue a title first (e.g. "October 2026").' });
    if (!(size > 0)) return res.status(400).json({ error: 'Choose the newsletter PDF to upload.' });
    if (size > DOWNLOAD_CAP) {
      return res.status(400).json({ error: `That file is over ${Math.round(DOWNLOAD_CAP / 1e6)}MB. In Canva, export again as "PDF Standard" instead of "PDF Print" and upload that.` });
    }
    const id = newId('nlu-');
    uploads.set(id, { title, size, received: 0, chunks: [], userId: req.user.sub, startedAt: Date.now() });
    res.json({ ok: true, uploadId: id, chunkSize: UPLOAD_CHUNK });
  });

  router.put('/admin/newsletters/upload/:id', requireAdmin,
    express.raw({ type: 'application/octet-stream', limit: UPLOAD_CHUNK + 1024 }),
    (req, res) => {
      const u = uploads.get(req.params.id);
      if (!u || u.userId !== req.user.sub) return res.status(404).json({ error: 'That upload expired. Choose the file again.' });
      const offset = Number(req.query.offset);
      if (offset !== u.received) return res.status(409).json({ error: 'Out of order.', received: u.received });
      const b = req.body;
      if (!Buffer.isBuffer(b) || !b.length) return res.status(400).json({ error: 'Empty piece.' });
      if (u.received + b.length > u.size) return res.status(400).json({ error: 'The file is bigger than it said it was. Choose it again.' });
      if (offset === 0 && b.subarray(0, 5).toString() !== '%PDF-') {
        uploads.delete(req.params.id);
        return res.status(400).json({ error: 'That file is not a PDF. In Canva, use Share → Download → PDF Standard.' });
      }
      u.chunks.push(b);
      u.received += b.length;
      res.json({ ok: true, received: u.received });
    });

  router.post('/admin/newsletters/upload/:id/finish', requireAdmin, (req, res) => {
    const u = uploads.get(req.params.id);
    if (!u || u.userId !== req.user.sub) return res.status(404).json({ error: 'That upload expired. Choose the file again.' });
    if (u.received !== u.size) return res.status(400).json({ error: 'The upload did not finish. Choose the file again.' });
    const buffer = Buffer.concat(u.chunks, u.size);
    uploads.delete(req.params.id);
    res.json({ ok: true, jobId: startJob({ title: u.title, buffer, userId: u.userId }) });
  });

  router.get('/admin/newsletters/import/:id', requireAdmin, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'unknown job' });
    res.json({ status: job.status, step: job.step, error: job.error || null, result: job.result || null });
  });
}
