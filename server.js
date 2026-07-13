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
app.use(express.json({ limit: '8mb' })); // headroom for base64 image/flyer uploads (downscaled client-side)

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
