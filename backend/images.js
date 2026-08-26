/* Downscaled renders of stored assets (Felicia, Aug 26 2026 — "the Gaspar
   logo is pixelated on the September 2nd Breakfast").

   The stored file was fine: a crisp 1800×900 PNG. The event page showed it
   at 252 CSS px, and a browser squeezing 1800→252 in ONE step aliases fine
   detail — that logo's halftone dots turned to crunch. Same disease the
   chamber seal had on Aug 25, but these are office uploads, so pre-baked
   files can't cover them: /api/assets/:id?w=504 now serves a properly
   filtered smaller render, and the pages ask for ~2× the CSS size so the
   result stays sharp on retina screens too.

   mupdf is already a dependency (PDF pipeline) and its rasterizer does the
   filtering — no new packages. Renders are cached in memory; asset bytes
   never change for an id (a new upload gets a new id), so long HTTP caching
   is safe. */
import mupdf from 'mupdf';

const STEP = 100, MIN_W = 200, MAX_W = 1600;

// Snap a requested width to a coarse ladder so the whole site shares a
// handful of cached renders per asset instead of one per pixel value.
export function snapWidth(w) {
  w = Number(w);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.max(MIN_W, Math.min(MAX_W, Math.ceil(w / STEP) * STEP));
}

// Native pixel width straight from the file header — mupdf page bounds are
// in points (DPI-dependent), which is the wrong number for "would this be
// an upscale?".
export function nativeWidth(mime, buf) {
  try {
    if (mime === 'image/png' && buf.length > 24) return buf.readUInt32BE(16);
    if (mime === 'image/gif' && buf.length > 8) return buf.readUInt16LE(6);
    if (/^image\/jpe?g$/.test(mime)) {
      let i = 2;
      while (i + 9 < buf.length && buf[i] === 0xff) {
        const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return buf.readUInt16BE(i + 7);
        }
        i += 2 + len;
      }
    }
  } catch (e) { /* unknown header → treat as unmeasurable */ }
  return 0;
}

// Tiny LRU — renders are cheap to rebuild, so cap memory, not hit rate.
const cache = new Map(); // "id@w" → { mime, buffer }
const CACHE_MAX = 120;

// Resize to `width` px (keeping aspect). Returns { mime, buffer } or null
// when resizing doesn't apply (would upscale, unmeasurable, or animated
// GIF — a resize would freeze it on frame one). Throws on decode failure;
// the route falls back to the original bytes.
export function resizedRender(id, mime, buffer, width) {
  const key = id + '@' + width;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }

  if (mime === 'image/gif') return null;
  const nw = nativeWidth(mime, buffer);
  if (!nw || width >= nw) return null;

  let doc, page, pix;
  try {
    doc = mupdf.Document.openDocument(buffer, mime);
    page = doc.loadPage(0);
    const [x0, , x1] = page.getBounds();
    const scale = width / (x1 - x0);
    pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, true);
    // JPEG stays JPEG (no alpha, much smaller for photos); everything else PNG.
    const out = /^image\/jpe?g$/.test(mime)
      ? { mime: 'image/jpeg', buffer: Buffer.from(pix.asJPEG(85, false)) }
      : { mime: 'image/png', buffer: Buffer.from(pix.asPNG()) };
    if (cache.has(key)) cache.delete(key);
    cache.set(key, out);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return out;
  } finally {
    try { pix && pix.destroy(); } catch (e) { /* native handle already gone */ }
    try { page && page.destroy(); } catch (e) { /* ditto */ }
    try { doc && doc.destroy(); } catch (e) { /* ditto */ }
  }
}
