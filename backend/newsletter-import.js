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
import * as repo from './repo.js';

// Compress only when the source is heavier than the site would want to
// serve; smaller PDFs pass through untouched (keeps their selectable text).
const KEEP_AS_IS_BYTES = 6_500_000;
const DOWNLOAD_CAP = 100_000_000;   // absolute fetch cap
const PAGE_CAP = 80;                // a "newsletter" sanity bound
const RASTER_DPI = 125;             // crisp on phones, ~250KB/page
const JPEG_QUALITY = 74;

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
  const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    // Manual redirect handling so every hop gets the SSRF check.
    const r = await fetch(url, { redirect: 'manual', signal: ctl.signal });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      if (!redirectsLeft) throw new Error('Too many redirects.');
      const loc = new URL(r.headers.get('location'), url).toString();
      return fetchBinary(loc, redirectsLeft - 1);
    }
    if (!r.ok) throw new Error(`The link answered ${r.status} — is it shared publicly ("Anyone with the link")?`);
    const reader = r.body.getReader();
    const chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > DOWNLOAD_CAP) { ctl.abort(); throw new Error('That file is over 100MB — please check it is the right one.'); }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks), contentType: r.headers.get('content-type') || '' };
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
  let { buffer, contentType } = await fetchBinary(url);
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
function gcJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if (j.startedAt < cutoff) jobs.delete(id);
}

async function runImport(job, { title, url, userId }) {
  try {
    job.step = 'Downloading the PDF from the link';
    const buffer = await downloadPdf(url);
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
    const id = 'nlj-' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    const job = { id, status: 'working', step: 'Starting', startedAt: Date.now() };
    jobs.set(id, job);
    runImport(job, { title, url, userId: req.user.sub });
    res.json({ ok: true, jobId: id });
  });

  router.get('/admin/newsletters/import/:id', requireAdmin, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'unknown job' });
    res.json({ status: job.status, step: job.step, error: job.error || null, result: job.result || null });
  });
}
