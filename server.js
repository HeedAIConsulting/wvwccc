/* ============================================================
   West Valley · Warner Center Chamber of Commerce
   Production server — Express static host + API shell
   Heed Business Solutions
   ============================================================ */
import express from 'express';
import compression from 'compression';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local for local dev (Render injects env vars directly, so this is a
// no-op there). Version-independent — no reliance on the Node --env-file flag.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* no .env.local → use the real environment */ }
const app = express();
const PORT = process.env.PORT || 5500;
const PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1); // Render runs behind a proxy (secure cookies + real client IP)

// Security headers. CSP is disabled here because we load Google Fonts + the
// AGMS Collect.js widget; a tuned CSP is a hardening follow-up.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: PROD,
}));
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '28mb' })); // headroom for base64 uploads: images (downscaled client-side) + newsletter/event PDFs up to ~20MB

// ── Rate limiting ──────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: 'Too many attempts. Try again later.' } });
app.use('/api/auth', authLimiter);
app.use('/api/pay', authLimiter);
app.use('/api', apiLimiter);

// ── Health check (Render) ──────────────────────────────────
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));
// Render health check is configured to hit /api/chamber (legacy path) — keep it.
app.get('/api/chamber', (_req, res) => res.json({ ok: true, live: true, service: 'wvwccc' }));

// ── API routes (payments, concierge) ──────────────────────
import chamberRoutes from './backend/chamber-routes.js';
import * as repo from './backend/repo.js';   // album pages stamp their own og:* tags
app.use('/api', chamberRoutes);
app.get('/api/ping', (_req, res) => res.json({ ok: true, service: 'wvwccc' }));

// ── Never web-serve the import store (emails + password hashes) ──
app.use('/data/_store', (_req, res) => res.status(403).type('text/plain').send('Forbidden'));

// ── Legacy ChamberWare URLs (printed on flyers, indexed by Google) ─────────
// Known pages 301 to their new home; any other stray .php lands on the
// homepage instead of a 404 so no old link ever dead-ends.
const LEGACY_REDIRECTS = {
  '/event_listings.php': '/events/',
  '/event_listing.php': '/events/',
  '/events.php': '/events/',
  '/member_directory.php': '/members/directory.html',
  '/directory.php': '/members/directory.html',
  '/join.php': '/join.html',
  '/contact.php': '/contact.html',
  '/index.php': '/',
};
app.get(Object.keys(LEGACY_REDIRECTS), (req, res) => res.redirect(301, LEGACY_REDIRECTS[req.path.toLowerCase()] || '/'));
app.get(/^\/[^/]+\.php$/i, (_req, res) => res.redirect(302, '/'));

// ── Static site ────────────────────────────────────────────
// Serve clean URLs (/directory -> members/directory.html handled by links;
// extensionless handled at host level on Cloudflare; here we keep .html).
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    // Code/data must always revalidate so deploys take effect immediately
    // (no more stale admin.js / pages in the browser). Media can cache a week.
    if (/\.(html|js|css|json)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));

// ── Pretty, shareable member URLs: /m/<slug> and /members/<slug> ──
// Real files (members/directory.html, profile.html) are served above by static;
// anything else under these paths renders the profile page, which resolves the
// member by slug client-side.
const profilePage = path.join(__dirname, 'members', 'profile.html');
app.get(['/m/:slug', '/members/:slug'], (req, res, next) => {
  if ((req.params.slug || '').includes('.')) return next();   // a file → let 404 handle
  res.sendFile(profilePage, (err) => { if (err) next(); });
});
// Pretty content-page URLs: /p/<slug> → the generic page renderer.
app.get('/p/:slug', (req, res, next) => {
  if ((req.params.slug || '').includes('.')) return next();
  res.sendFile(path.join(__dirname, 'pages', 'view.html'), (err) => { if (err) next(); });
});
// Spanish content-page URLs: /es/p/<slug> → the Spanish page renderer.
app.get('/es/p/:slug', (req, res, next) => {
  if ((req.params.slug || '').includes('.')) return next();
  res.sendFile(path.join(__dirname, 'es', 'pages', 'view.html'), (err) => { if (err) next(); });
});
// Pretty group URLs: /groups/<slug> → group page (real files served by static above).
app.get('/groups/:slug', (req, res, next) => {
  if ((req.params.slug || '').includes('.')) return next();
  res.sendFile(path.join(__dirname, 'groups', 'view.html'), (err) => { if (err) next(); });
});
// Pretty guide URLs: /guides/<slug> → community guide renderer.
app.get('/guides/:slug', (req, res, next) => {
  if ((req.params.slug || '').includes('.')) return next();
  res.sendFile(path.join(__dirname, 'guides', 'view.html'), (err) => { if (err) next(); });
});
// Spanish pretty guide URLs: /es/guides/<slug> → Spanish guide renderer.
app.get('/es/guides/:slug', (req, res, next) => {
  if ((req.params.slug || '').includes('.')) return next();
  res.sendFile(path.join(__dirname, 'es', 'guides', 'view.html'), (err) => { if (err) next(); });
});
/* Short link for the payment portal (Felicia, Jul 30 2026). She reads this one
   down the phone and pastes it into invoices, so /paynow beats /pay-now.html. */
app.get(['/paynow', '/pay-now'], (_req, res) => res.redirect(302, '/pay-now.html'));
/* Pretty album URLs: /albums/<id> → the album renderer, with its og:* tags
   rewritten from the album itself. Diana, Jul 30 2026: "all the images should
   be shareable to social" — Facebook and LinkedIn never run our JavaScript, so
   a client-rendered album would preview as a blank Chamber logo no matter how
   good the page looked. The photos load client-side as usual; only the four
   preview tags are stamped here. */
app.get('/albums/:id', async (req, res, next) => {
  const id = req.params.id || '';
  if (id.includes('.')) return next();                       // a real file → static/404
  const file = path.join(__dirname, 'albums', 'view.html');
  try {
    const html = await fs.promises.readFile(file, 'utf8');
    const album = (await repo.listPosts({ type: 'album', status: 'approved' })).find((p) => p.id === id);
    if (!album) return res.status(404).sendFile(path.join(__dirname, '404.html'), (e) => { if (e) next(); });
    const photos = (album.meta && album.meta.photos) || [];
    const origin = `${req.protocol}://${req.get('host')}`;
    const abs = (u) => (/^https?:\/\//i.test(u) ? u : origin + (u.startsWith('/') ? u : '/' + u));
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const title = `${album.title || 'Photos'} — West Valley · Warner Center Chamber of Commerce`;
    const desc = (album.body || '').trim()
      || `${photos.length} photo${photos.length === 1 ? '' : 's'} from the West Valley · Warner Center Chamber of Commerce.`;
    const cover = abs(album.imageUrl || (photos[0] && photos[0].url) || '/images/wvwccc-logo.png');
    const out = html
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
      .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${esc(cover)}$2`)
      .replace('</head>', `  <meta property="og:url" content="${esc(origin)}/albums/${esc(id)}" />\n</head>`);
    res.type('html').send(out);
  } catch (e) {
    console.error('album page', e);
    res.sendFile(file, (err) => { if (err) next(); });        // still render, generic preview
  }
});

// ── 404 fallback ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'), (err) => {
    if (err) res.status(404).type('text/plain').send('Not found');
  });
});

// Auto-apply the DB schema on boot when Postgres is configured (idempotent —
// schema.sql uses CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS). This
// lets setting DATABASE_URL "just work" with no separate migrate step on Render.
async function initDb() {
  try {
    const db = await import('./backend/db.js');
    if (!db.enabled) { console.log('[db] no DATABASE_URL — using JSON store'); return; }
    const schema = fs.readFileSync(path.join(__dirname, 'backend', 'schema.sql'), 'utf8');
    await db.query(schema);
    console.log('[db] Postgres connected — schema applied ✓');
  } catch (e) { console.error('[db] schema init failed (continuing):', e.message); }
}

initDb().finally(() => {
  app.listen(PORT, () => {
    console.log(`WVWCCC production site running on :${PORT}`);
  });
});
