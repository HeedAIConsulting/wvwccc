/* Diana, Sep 18 2026, via Felicia: "Leader Level Logos static on bottom of web
   pages. Diana would like logos consistent in size. Example: Heights to all be
   200 or all to be 150."

   She is looking at a real thing, and it is not a stylesheet problem. The cells
   on that banner are already identical — 132x78, object-fit: contain — and so
   are the files: 35 of the 37 logos are legacy 100x60 exports from the old
   website, every one the same shape. What differs is how much of each file is
   the logo. Measured against the live banner, the artwork runs from 10 pixels
   tall (Kaiser Permanente) to the full 45 (FIREHAWK, Maguire & Hart, and three
   others). Two logos in boxes that match to the pixel can therefore draw at
   very different sizes, and no CSS reaches inside a JPEG.

   Evening them out would mean upscaling Kaiser more than four times to match
   its neighbours, fifteen times to hold up on a phone. That is a smear, not a
   fix. The small ones need new artwork from the member, which is the office's
   call, member by member — so the job here is to measure each logo and say
   which ones those are, on the page where the office already replaces them.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import mupdf from 'mupdf';
import { inkBox, logoHealth, LOGO_MIN_INK_H, LOGO_GOOD_INK_H } from '../images.js';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');

/* Build a logo rather than ship a fixture: `inkH` pixels of black centred in a
   white frame, which is precisely the shape of the problem. Written out as a
   real PNG, because the point is to measure a decoded picture and not a mock. */
function logoPng(frameW, frameH, inkW, inkH) {
  const raw = Buffer.alloc(frameH * (1 + frameW * 3), 0xff);
  const x0 = Math.floor((frameW - inkW) / 2), y0 = Math.floor((frameH - inkH) / 2);
  for (let y = 0; y < frameH; y++) {
    raw[y * (1 + frameW * 3)] = 0;                       // filter byte: none
    for (let x = 0; x < frameW; x++) {
      const ink = inkW > 0 && inkH > 0 && x >= x0 && x < x0 + inkW && y >= y0 && y < y0 + inkH;
      const i = y * (1 + frameW * 3) + 1 + x * 3;
      raw[i] = raw[i + 1] = raw[i + 2] = ink ? 0x00 : 0xff;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(frameW, 0); ihdr.writeUInt32BE(frameH, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

test('it finds where the picture stops being background', () => {
  const doc = mupdf.Document.openDocument(logoPng(100, 60, 40, 20), 'image/png');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false);
  const box = inkBox(pix);
  pix.destroy(); page.destroy(); doc.destroy();
  assert.ok(box, 'a black block on white is not nothing');
  /* inkBox works in whatever the rasteriser handed it. mupdf measures a page
     in points, so a 100x60 PNG comes back 75x45 — the box is right, the units
     are not the file's. Check the proportion here; logoHealth is what converts
     it back to real pixels for the office to read. */
  assert.ok(Math.abs(box.h / box.H - 20 / 60) < 0.05, `ink filled ${box.h}/${box.H}, expected about a third`);
  assert.ok(Math.abs(box.w / box.W - 40 / 100) < 0.05, `ink filled ${box.w}/${box.W}, expected about 40%`);
});

test('the size it reports is the one the member would see in an image editor', () => {
  // A 100x60 file rasterises to 75x45, so an unconverted reading of 20px of
  // artwork comes back 15 and every number the office is given is a fifth out.
  const h = logoHealth('image/png', logoPng(100, 60, 40, 20));
  assert.ok(h, 'it should read');
  assert.ok(Math.abs(h.inkH - 20) <= 2, `reported ${h.inkH}px of logo, the file holds 20`);
  assert.ok(Math.abs(h.frameH - 60) <= 2, `reported a ${h.frameH}px frame, the file is 60`);
});

test('a blank file is reported as unreadable, never as a good logo', () => {
  assert.equal(logoHealth('image/png', logoPng(100, 60, 0, 0)), null);
});

test('the small legacy logos are the ones called out', () => {
  // Kaiser's real logo: 10px of artwork in a 60px frame.
  const kaiser = logoHealth('image/png', logoPng(100, 60, 60, 10));
  assert.ok(kaiser, 'it should read');
  assert.equal(kaiser.ok, false, '10px of logo cannot hold the banner');
  assert.ok(kaiser.fills < 25, `fills ${kaiser.fills}%`);

  // An uploaded logo the size Marriott's is: plenty to work with.
  const good = logoHealth('image/png', logoPng(400, 280, 380, 196));
  assert.ok(good, 'it should read');
  assert.equal(good.ok, true, '196px of logo is fine');
  assert.ok(good.inkH >= LOGO_MIN_INK_H);
});

test('the office is told which logos to replace, where it replaces them', () => {
  const js = read('admin/admin.js');
  assert.match(js, /\/api\/admin\/leader-logo-health/);
  assert.match(js, /data-lb-size/, 'a column on the Leader Banner table');
  assert.match(js, /draws small/, 'and it says so in words the office can act on');
  assert.match(js, /Ask this member for the logo at \$\{goodInk\}px tall or more/,
    'naming the next step, since the office is the one who asks the member');
  /* The number in the advice is the one that would actually look right on the
     banner, not the lower bar the flag uses. Quoting the flag threshold back
     would invite a member to send another logo too small to help. */
  assert.ok(LOGO_GOOD_INK_H > LOGO_MIN_INK_H * 2,
    'the size to ask for is well above the size that trips the flag');
  assert.ok(!/\$\{minInk\}px tall or more/.test(js),
    'the advice must not quote the flag threshold as the size to send');
  /* Scope this to paintHealth. `if (!h) return;` also appears in the help
     panel a few thousand lines up, so an unscoped match passes even with this
     guard gone. */
  const paint = js.slice(js.indexOf('function paintHealth()'), js.indexOf('async function loadHealth()'));
  assert.ok(paint, 'paintHealth should exist');
  assert.match(paint, /if \(!h\) return;/,
    'a logo we could not measure shows nothing, not a false all-clear');
  assert.ok(!/fine|ok\b/i.test(paint.split('if (!h)')[1].split('\n')[0]),
    'and it must not fall through to a reassuring word');

  const html = read('admin/leader-banner.html');
  assert.match(html, /Size on the page|Why some logos look smaller/,
    'and the page explains why they differ, so this reads as an answer and not a new problem');
});

test('reading a logo off disk cannot be talked into leaving the images folder', () => {
  const routes = read('backend/chamber-routes.js');
  const fn = routes.slice(routes.indexOf('async function logoBytes'), routes.indexOf("router.get('/admin/leader-logo-health'"));
  assert.match(fn, /path\.resolve\(ROOT, m\[1\]\)/);
  assert.match(fn, /inside\.startsWith\('\.\.'\) \|\| path\.isAbsolute\(inside\)/,
    'resolve first, then check the result is still inside images/ — a prefix test on the raw string is not enough');
  assert.match(fn, /\^\\\/\?\(images\\\/\[\^\?#\]\*\)\$/, 'only paths this site serves under /images');
});

test('measuring the banner is staff-only', () => {
  const routes = read('backend/chamber-routes.js');
  assert.match(routes, /router\.get\('\/admin\/leader-logo-health', requireAdmin/);
});
