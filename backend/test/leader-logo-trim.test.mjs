/* Diana, Sep 28 2026, through Felicia, after being shown the measurements in
   leader-logo-size: "Regardless of the width being square or rectangular they
   will all be the same height."

   The cells on that banner were always identical. What is not identical is how
   much of each file is the logo: across the 37 live logos the artwork fills
   from 22% of its frame (Kaiser Permanente) to 100% (Mulholland Hills,
   FIREHAWK and three others), which drew them anywhere from 14 to 66 CSS
   pixels tall inside boxes that matched to the pixel.

   So the file is cropped to its own artwork before the page sees it, and the
   stylesheet then sets one height and lets the width follow the shape of the
   mark. A logo that sits on its own coloured square is cropped to that square,
   because the square is part of the picture — that case needs a new file, and
   the Leader Banner page is where the office is told so.

   The pictures here are built rather than shipped as fixtures: the whole point
   is to measure a decoded image, and a mock would measure nothing.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import mupdf from 'mupdf';
import { trimmedLogo, nativeWidth, LOGO_BANNER_H } from '../images.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
// A black rectangle of inkW x inkH at (x0, y0) on a white frameW x frameH page.
function logoPng(frameW, frameH, inkW, inkH, x0, y0) {
  if (x0 === undefined) x0 = Math.floor((frameW - inkW) / 2);
  if (y0 === undefined) y0 = Math.floor((frameH - inkH) / 2);
  const raw = Buffer.alloc(frameH * (1 + frameW * 3), 0xff);
  for (let y = 0; y < frameH; y++) {
    raw[y * (1 + frameW * 3)] = 0;
    for (let x = 0; x < frameW; x++) {
      const ink = inkW > 0 && inkH > 0 && x >= x0 && x < x0 + inkW && y >= y0 && y < y0 + inkH;
      const i = y * (1 + frameW * 3) + 1 + x * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = ink ? 0 : 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(frameW, 0); ihdr.writeUInt32BE(frameH, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Height of a PNG straight from its header, to check what came back out.
const pngHeight = (buf) => buf.readUInt32BE(20);

let seq = 0;
const trim = (buf, mime = 'image/png') => trimmedLogo('t' + (seq++), mime, buf);

test("Kaiser's shape: a sliver of logo in a legacy frame comes back as the sliver", () => {
  // 100x60 holding 60x13 of artwork — 22% of its frame, which is why it drew a
  // quarter the height of its neighbours.
  const out = trim(logoPng(100, 60, 60, 13));
  assert.ok(out, 'a file with this much margin is worth cropping');
  assert.equal(nativeWidth(out.mime, out.buffer), 62, 'the ink plus a pixel either side');
  assert.equal(pngHeight(out.buffer), 15);
});

test('the crop is measured in the file\'s own pixels, not the rasteriser\'s points', () => {
  /* mupdf measures a page in points, so a 100x60 PNG rasterises to 75x45 at
     identity. Cropping from that render would throw away a quarter of the
     detail on files that have none to spare. */
  const out = trim(logoPng(200, 120, 100, 40));
  assert.ok(out);
  assert.equal(nativeWidth(out.mime, out.buffer), 102, 'not 76, which is the same crop taken at 75%');
  assert.equal(pngHeight(out.buffer), 42);
});

test('a logo that already fills its frame is left alone', () => {
  // Cropping this would cost the browser a second download to save nothing.
  assert.equal(trim(logoPng(100, 60, 100, 60)), null);
  assert.equal(trim(logoPng(100, 60, 98, 59)), null, 'a pixel of margin is not worth a file');
});

test('filling one side of the frame is not filling it', () => {
  /* A wordmark runs the full width of its export and sits in a band down the
     middle — Douglas Emmett, Hilton, half the banner. Its width says there is
     nothing to trim and its height is the whole complaint, so "leave it alone"
     has to need BOTH. */
  const out = trim(logoPng(100, 60, 100, 20));
  assert.ok(out, 'full width, a third of the height — this is the case Diana is looking at');
  assert.equal(pngHeight(out.buffer), 22);
});

test('a logo off to one side is found where it is, not where it should be', () => {
  const out = trim(logoPng(200, 100, 40, 20, 5, 70));
  assert.ok(out);
  assert.equal(nativeWidth(out.mime, out.buffer), 42);
  assert.equal(pngHeight(out.buffer), 22);
});

test('a blank file is left alone rather than cropped to nothing', () => {
  assert.equal(trim(logoPng(100, 60, 0, 0)), null, 'one flat colour: there is no logo in it');
});

test('an unreadable file falls back to itself instead of throwing', () => {
  assert.equal(trim(Buffer.from('this is not a picture')), null, 'no header to read');
  assert.equal(trim(Buffer.alloc(0)), null);
  /* A truncated upload is the one that reaches the decoder: the header is good,
     so the size checks pass, and mupdf throws part-way through the pixels.
     Every logo on the banner goes through here on a cold cache, so a throw is
     a 500 on a public page. */
  const good = logoPng(100, 60, 60, 13);
  const broken = Buffer.concat([good.subarray(0, 40), Buffer.alloc(30, 0x41)]);
  assert.equal(nativeWidth('image/png', broken), 100, 'the header still reads, so the guards let it through');
  assert.equal(trim(broken, 'image/png'), null, 'and the decoder failing is caught');
});

test('an animated GIF is never cropped', () => {
  // A crop would freeze it on frame one, which is worse than an uneven logo.
  // Asserted on the rule as well as the call: a GIF cannot be built here
  // without an LZW encoder, and the call alone passes for the wrong reason.
  assert.equal(trimmedLogo('gif', 'image/gif', logoPng(100, 60, 20, 10)), null);
  const js = read('backend/images.js');
  const fn = js.slice(js.indexOf('function buildTrim('), js.indexOf('export function trimmedLogo'));
  assert.match(fn, /if \(mime === 'image\/gif'\) return null;/);
});

test('the public route cannot be pointed at a big file to burn CPU', () => {
  const js = read('backend/images.js');
  const fn = js.slice(js.indexOf('function buildTrim('), js.indexOf('export function trimmedLogo'));
  assert.match(fn, /buffer\.length > TRIM_MAX_BYTES/, 'a size ceiling before anything is decoded');
  assert.match(fn, /nw > TRIM_MAX_WIDTH/, 'and a pixel ceiling, read from the header');
  assert.match(js, /const TRIM_MAX_BYTES = 3 \* 1024 \* 1024;/);
  assert.match(js, /const TRIM_MAX_WIDTH = 2400;/);
  assert.ok(fn.indexOf('buffer.length > TRIM_MAX_BYTES') < fn.indexOf('mupdf.Document.openDocument'),
    'refuse before opening the document, not after');
});

test('the same file is only decoded once', () => {
  const buf = logoPng(100, 60, 60, 13);
  const a = trimmedLogo('same-key', 'image/png', buf);
  const b = trimmedLogo('same-key', 'image/png', logoPng(100, 60, 10, 10));
  assert.equal(b, a, 'the second call returns the cached crop, bytes and all');
  const none = trimmedLogo('flat-key', 'image/png', logoPng(100, 60, 0, 0));
  assert.equal(none, null);
  assert.equal(trimmedLogo('flat-key', 'image/png', logoPng(100, 60, 60, 13)), null,
    '"nothing to crop" is cached too, or an unreadable file is re-decoded on every request');
});

test('a JPEG comes back a JPEG', () => {
  // A photographic logo re-encoded as PNG can be several times the size.
  const doc = mupdf.Document.openDocument(logoPng(200, 120, 100, 40), 'image/png');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const jpg = Buffer.from(pix.asJPEG(90, false));
  pix.destroy(); page.destroy(); doc.destroy();
  const out = trim(jpg, 'image/jpeg');
  assert.ok(out);
  assert.equal(out.mime, 'image/jpeg');
});

test('the route serves the file itself when there is nothing to crop', () => {
  const routes = read('backend/chamber-routes.js');
  const fn = routes.slice(routes.indexOf("router.get('/logo-trim'"), routes.indexOf("router.get('/admin/leader-logo-health'"));
  assert.match(fn, /const out = cut \|\| bytes;/, 'never a gap in the banner');
  assert.match(fn, /const bytes = await logoBytes\(src\);/,
    'the same allowlist the health route uses — /images and stored assets, nothing else');
  // Scoped to the miss itself: the catch below refuses too, so an unscoped
  // match passes with this line handing back an empty 200.
  assert.match(fn, /if \(!bytes\) return res\.status\(404\)\.end\(\);/,
    'a src we do not serve is refused, not answered with nothing');
  assert.match(fn, /Cache-Control/, 'and a crop is not recomputed for every visitor');
});

test('the banner asks for the crop and falls back to the file', () => {
  const js = read('js/chamber.js');
  assert.match(js, /\/api\/logo-trim\?src=' \+ encodeURIComponent\(u\)/);
  assert.match(js, /data-logo-raw="\$\{esc\(fixUrl\(logo\)\)\}"/,
    'the original travels with the img so the fallback has somewhere to go');
  assert.match(js, /img\.addEventListener\('error'[\s\S]{0,220}img\.src = raw;/,
    'a crop that cannot be served shows the file, not a broken picture');
  assert.ok(!/trimUrl\(u\) => .*http/.test(js));
  const fn = js.slice(js.indexOf('const trimUrl ='), js.indexOf('const hrefOf ='));
  assert.match(fn, /\/\^\\\/\/\.test\(u\)/, 'only a path we serve is sent to the route');
});

test('every logo is drawn one height, and the width follows the mark', () => {
  const css = read('css/chamber.css');
  const img = /\.leader-cell__logo img \{([^}]*)\}/.exec(css);
  assert.ok(img, 'the banner still styles its own logos');
  assert.match(img[1], /height:\s*44px/, 'one height — Diana\'s ask');
  assert.match(img[1], /width:\s*auto/, 'and the width is whatever the shape gives');
  assert.ok(!/max-height/.test(img[1]),
    'a max-height would let a wide mark come back shorter than the rest');
  const plate = /\.leader-cell__logo \{([^}]*)\}/.exec(css)[1];
  assert.match(plate, /min-width:\s*132px/, 'a narrow mark still sits on a card the width of its name');
  assert.ok(!/(^|;)\s*width:\s*\d/.test(plate), 'but the plate is no longer a fixed width');
  const cell = /\.leader-cell \{([^}]*)\}/.exec(css)[1];
  assert.match(cell, /max-width:\s*384px/, 'and one very wide mark cannot take a row to itself');
});

test('the stylesheet and the server agree on what that height is', () => {
  /* The server judges every logo against the height the banner draws it at —
     whether it is being enlarged, and by how much, which is what the office is
     told on the Leader Banner page. If the CSS moved and this did not, the
     panel would be reporting against a height that no longer exists. */
  const css = read('css/chamber.css');
  const drawn = Number(/\.leader-cell__logo img \{[^}]*height:\s*(\d+)px/.exec(css)[1]);
  assert.equal(drawn, LOGO_BANNER_H,
    `the banner draws ${drawn}px and images.js judges against ${LOGO_BANNER_H}px`);
});
