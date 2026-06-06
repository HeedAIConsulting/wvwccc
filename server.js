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
app.use(express.json({ limit: '4mb' })); // headroom for base64 image uploads (capped to ~2.5MB server-side)

// ── Rate limiting ──────────────────────────────────────────
const apiLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: 'Too many attempts. Try again later.' } });
app.use('/api/auth', authLimiter);
app.use('/api/pay', authLimiter);
app.use('/api', apiLimiter);

// ── Health check (Render) ──────────────────────────────────
app.get('/healthz', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── API routes (payments, concierge) ──────────────────────
import chamberRoutes from './backend/chamber-routes.js';
app.use('/api', chamberRoutes);
app.get('/api/ping', (_req, res) => res.json({ ok: true, service: 'wvwccc' }));

// ── Never web-serve the import store (emails + password hashes) ──
app.use('/data/_store', (_req, res) => res.status(403).type('text/plain').send('Forbidden'));

// ── Static site ────────────────────────────────────────────
// Serve clean URLs (/directory -> members/directory.html handled by links;
// extensionless handled at host level on Cloudflare; here we keep .html).
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
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

// ── 404 fallback ───────────────────────────────────────────
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '404.html'), (err) => {
    if (err) res.status(404).type('text/plain').send('Not found');
  });
});

app.listen(PORT, () => {
  console.log(`WVWCCC production site running on :${PORT}`);
});
