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

/* ── How much of a logo file is actually the logo ───────────────────────────

   Diana, Sep 18 2026, via Felicia: "Leader Level Logos static on bottom of web
   pages. Diana would like logos consistent in size. Example: Heights to all be
   200 or all to be 150."

   The cells on that banner were already identical, and so were the files: 35 of
   the 37 logos are legacy 100x60 exports from the old website, every one of them
   the same shape. What differs is how much of each file is the logo and how much
   is empty margin, and that is inside the JPEG where no stylesheet reaches.

   Measured across the live banner, the artwork runs from 10 pixels tall
   (Kaiser Permanente) to 45 (FIREHAWK, Maguire & Hart, and three others that
   fill their frame edge to edge). Drawing them all at one height therefore is
   not a matter of cropping: Kaiser would have to be blown up more than four
   times to match, and fifteen times to look right on a phone screen. It would
   come out a smear. The two logos the office has uploaded since — Marriott at
   196 pixels and UCLA at 318 — are the only ones on the banner with the detail
   to be resized at all.

   So the banner cannot be evened out from these files; the small ones need new
   artwork from the member. This measures each one so the office can see at a
   glance which those are, on the Leader Banner page where they replace them.
   Exported on its own so a test can measure a picture it built itself. */

// How far a pixel must sit from the background before it counts as the logo.
// Sum of the three channel distances, so 40 is a gentle edge: it survives JPEG
// ringing around the artwork without eating a pale logo on a white field.
const INK_THRESHOLD = 40;

/* Where to draw the line. 60 is the height of the legacy frame every one of
   these files came in, so a logo under it does not even fill the thumbnail it
   was exported into — that is the objective, explainable test, and it is the
   one this flags.

   It is not the size to ask a member for. The banner draws a logo 78 CSS px
   tall, which is 156 real pixels on the phones most people read the site on,
   so anything under about 300px tall has nothing in hand for a retina screen.
   Almost none of the legacy files clear that, which is why the flag uses the
   lower bar and the advice quotes the higher one. */
export const LOGO_MIN_INK_H = 60;
export const LOGO_GOOD_INK_H = 300;

export function inkBox(pix) {
  const W = pix.getWidth(), H = pix.getHeight(), N = pix.getNumberOfComponents();
  const px = pix.getPixels();
  if (!W || !H) return null;
  const at = (x, y) => (y * W + x) * N;
  // Average the four corners: one stray dark corner pixel should not decide
  // that the whole background is dark.
  const corners = [at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)];
  const bg = [0, 1, 2].map((c) => Math.round(corners.reduce((sum, i) => sum + px[i + c], 0) / corners.length));
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (d > INK_THRESHOLD) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;                       // one flat colour, no logo in it
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, W, H };
}

/* { inkH, inkW, frameH, fills, ok } for a logo file, or null if it cannot be
   read — an unreadable file is never reported as a bad logo, only as unknown.
   `fills` is the share of the frame the artwork takes up, which is what makes
   two same-sized files look different sizes on the page. */
export function logoHealth(mime, buffer) {
  if (mime === 'image/gif') return null;
  let doc, page, pix;
  try {
    doc = mupdf.Document.openDocument(buffer, mime);
    page = doc.loadPage(0);
    pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
    const box = inkBox(pix);
    if (!box) return null;
    /* mupdf hands back a page measured in points, so a 100x60 image rasterises
       to 75x45 at identity scale. Put the measurement back into the file's own
       pixels: the office reads these numbers against what the member sees in
       an image editor, and "10px" when the file really holds 13 is a number
       nobody can check. Unmeasurable header → report what we rendered. */
    const nw = nativeWidth(mime, buffer);
    const toNative = nw && box.W ? nw / box.W : 1;
    const inkH = Math.round(box.h * toNative);
    return {
      inkH,
      inkW: Math.round(box.w * toNative),
      frameH: Math.round(box.H * toNative),
      fills: Math.round((box.h / box.H) * 100),
      ok: inkH >= LOGO_MIN_INK_H,
    };
  } catch (e) {
    return null;
  } finally {
    try { pix && pix.destroy(); } catch (e) { /* native handle already gone */ }
    try { page && page.destroy(); } catch (e) { /* ditto */ }
    try { doc && doc.destroy(); } catch (e) { /* ditto */ }
  }
}
