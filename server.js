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

/* Canonical host: send www to the apex.
   Both hostnames resolve to this service (the apex is an A record, www is a
   CNAME to wvwccc-web.onrender.com) and both used to answer 200, so every page
   existed at two addresses and Google had to guess which to index. The apex is
   the canonical one — it is what the homepage's own <link rel="canonical"> and
   hreflang tags declare, and now what every page declares.
   Deliberately scoped to the exact www host, so the Render health check and the
   *.onrender.com address are untouched. 301 because this is permanent; keep it
   that way or browsers will have cached a redirect that no longer matches. */
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (host === 'www.woodlandhillscc.net') {
    return res.redirect(301, 'https://woodlandhillscc.net' + req.originalUrl);
  }
  next();
});

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
import chamberRoutes, { sitemapEntries, loadMembersPublic } from './backend/chamber-routes.js';
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

/* --- Pretty, shareable member URLs: /m/<slug> and /members/<slug> ---
   Real files (members/directory.html, profile.html) are served above by static;
   anything else under these paths renders the profile page.

   The page still resolves the member client-side - that is what visitors see,
   and it keeps the profile layout written in exactly one place. But the shell
   that leaves here is no longer blank. All 717 member URLs used to ship the
   same 1,279 bytes: the title "Member Profile", a description reading "A West
   Valley - Warner Center Chamber of Commerce member profile", and the word
   "Loading...". Google was handed 717 pages identical to one another that said
   nothing about the businesses on them, so it had no reason to index any of
   them - which is what a member reported on Aug 21 2026 ("my company does not
   appear in Google search results through your Chamber directory"). Crawlers do
   run JavaScript eventually, but they decide whether a page is worth that
   trouble from the HTML they are handed first.

   So the stamping the album pages do for Facebook previews now runs for members
   too, plus the two things a directory listing specifically needs: a
   LocalBusiness block, which is the form Google reads business name, phone,
   address and website out of, and those details as real HTML inside #profile.
   The client script overwrites that block a moment later with the full
   interactive card, so a visitor sees no difference.

   Fields come from loadMembersPublic() - the same filter the public API uses -
   so a private field cannot reach the page even by mistake. Any failure falls
   back to serving the plain template, which is exactly today's behaviour. */
const profilePage = path.join(__dirname, 'members', 'profile.html');
app.get(['/m/:slug', '/members/:slug'], async (req, res, next) => {
  const slug = req.params.slug || '';
  if (slug.includes('.')) return next();                     // a file -> let 404 handle
  const fallback = () => res.sendFile(profilePage, (err) => { if (err) next(); });
  try {
    const key = decodeURIComponent(slug);
    const { members } = await loadMembersPublic();
    const m = (members || []).find((x) => x.slug === key || x.id === key);
    if (!m) return fallback();                               // client shows "not found"

    const html = await fs.promises.readFile(profilePage, 'utf8');
    const esc = (v) => String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const origin = SITE_ORIGIN;
    const url = `${origin}/members/${encodeURIComponent(m.slug || key)}`;
    const where = [m.city, m.state].filter(Boolean).join(', ');
    const title = `${m.name}${where ? ` - ${where}` : ''} | WVWCCC Member Directory`;
    /* Description: the member's own words first, trimmed to what a result
       snippet actually shows. Only when they have written nothing do we fall
       back to a generated line, and even that names the business and its
       category so no two members share a description. */
    const own = String(m.tagline || m.description || '').replace(/\s+/g, ' ').trim();
    const desc = (own.length > 300 ? own.slice(0, 297).replace(/\s+\S*$/, '') + '\u2026' : own)
      || `${m.name}${m.category ? `, ${m.category}` : ''}${where ? ` in ${where}` : ''}. A member of the West Valley \u00b7 Warner Center Chamber of Commerce.`;
    const img = m.primaryImage || m.pageImage || m.logo || (Array.isArray(m.photos) && m.photos[0]) || '/images/wvwccc-logo.png';
    const ogImage = /^https?:\/\//i.test(img) ? img : origin + (img.startsWith('/') ? img : '/' + img);

    /* LocalBusiness, not Organization: this is a directory entry for a business
       with a street address and a phone number, and LocalBusiness is the type
       Google matches against "movers near me" style searches. Keys are emitted
       only when we hold the value - a schema block with empty fields is worse
       than a short one. */
    const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: m.name, url };
    if (m.website) ld.sameAs = [m.website];
    if (m.description || m.tagline) ld.description = String(m.description || m.tagline).replace(/\s+/g, ' ').trim();
    if (m.phone) ld.telephone = m.phone;
    if (m.address || m.city) {
      ld.address = { '@type': 'PostalAddress', addressCountry: 'US' };
      if (m.address) ld.address.streetAddress = m.address;
      if (m.city) ld.address.addressLocality = m.city;
      if (m.state) ld.address.addressRegion = m.state;
      if (m.zip) ld.address.postalCode = m.zip;
    }
    if (m.hours) ld.openingHours = m.hours;
    if (m.category) ld.additionalType = m.category;
    if (ogImage) ld.image = ogImage;
    // A literal </script> inside JSON would end the block early; escaping < is the standard guard.
    const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');

    const row = (label, value) => (value ? `<li><strong>${esc(label)}:</strong> ${value}</li>` : '');
    const seed = `
      <article>
        <h1>${esc(m.name)}</h1>
        ${m.tagline ? `<p>${esc(m.tagline)}</p>` : ''}
        <ul>
          ${row('Category', esc(m.category))}
          ${row('Address', esc([m.address, m.city, m.state, m.zip].filter(Boolean).join(', ')))}
          ${row('Phone', m.phone ? `<a href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}">${esc(m.phone)}</a>` : '')}
          ${row('Website', m.website ? `<a href="${esc(m.website)}" rel="noopener">${esc(String(m.website).replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</a>` : '')}
        </ul>
        ${m.description ? `<p>${esc(m.description)}</p>` : ''}
        <p><a href="/members/directory.html">West Valley \u00b7 Warner Center Chamber of Commerce member directory</a></p>
      </article>`;

    const out = html
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(desc)}$2`)
      .replace('</head>', `  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="business.business" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${esc(ogImage)}" />
  <meta property="og:url" content="${esc(url)}" />
  <script type="application/ld+json">${ldJson}</script>
</head>`)
      .replace('<p class="member-tile__meta">Loading\u2026</p>', seed);
    res.type('html').send(out);
  } catch (e) {
    console.error('member page', slug, e);
    fallback();                                              // still renders, client-side
  }
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

/* ── SEO: /sitemap.xml ───────────────────────────────────────
   Built per request, so a member approved this morning is listed without a
   deploy. Two halves: a walk of the repo's own .html files (a page added later
   is picked up automatically — nobody has to remember this file), and the
   database-driven URLs from sitemapEntries(). A page is left out when it is
   staff-only (admin/auth/member), when it carries its own `robots: noindex` —
   the sitemap must never contradict the page itself — or when it is a template
   that renders nothing without a slug (the various view.html), since the real
   URLs behind those come from the database half. */
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://woodlandhillscc.net';
const SITEMAP_SKIP_DIRS = new Set([
  'admin', 'auth', 'member',                       // staff-only / signed-in
  'node_modules', '.git', 'backend', 'scripts', 'docs',
  'assets', 'images', 'css', 'js',                 // no public HTML lives here
]);
const SITEMAP_SKIP_FILES = new Set([
  '404.html',
  'members/profile.html',                          // template; real URLs are /members/<slug>
  'newsletters/valley-biz-buzz-2026-06.html',      // saved Adobe viewer page, not chamber content
]);

function staticSitemapPaths() {
  const out = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || SITEMAP_SKIP_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name), relPath);
        continue;
      }
      if (!ent.name.endsWith('.html')) continue;
      if (SITEMAP_SKIP_FILES.has(relPath)) continue;
      if (/(^|\/)view\.html$/.test(relPath)) continue;
      let html = '';
      try { html = fs.readFileSync(path.join(dir, ent.name), 'utf8'); } catch { continue; }
      if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) continue;
      out.push(relPath === 'index.html' ? '/' : '/' + relPath.replace(/\/index\.html$/, '/'));
    }
  };
  walk(__dirname, '');
  return out.sort();
}

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

app.get('/sitemap.xml', async (_req, res) => {
  try {
    let dynamic = [];
    try { dynamic = await sitemapEntries(); }
    catch (e) { console.error('sitemap: dynamic half failed —', e.message); }
    const seen = new Set();
    const urls = [...staticSitemapPaths(), ...dynamic]
      .filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
    res.type('application/xml')
      .set('Cache-Control', 'public, max-age=3600')
      .send('<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + urls.map((p) => `  <url><loc>${xmlEsc(SITE_ORIGIN + p)}</loc></url>`).join('\n')
        + '\n</urlset>\n');
  } catch (e) {
    console.error('sitemap failed', e);
    res.status(500).type('text/plain').send('sitemap unavailable');
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
