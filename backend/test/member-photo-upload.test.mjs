/* Marcia Israel, Oct 1 2026: "tried to upload pics but needed to erase and I
   don't see how to delete what was uploaded", with her new headshot attached
   as IMG_3774.heic because the portal would not take it.

   Three things were true of the member portal (member/member.js):
   - It sent the file exactly as chosen. /api/me/asset refuses anything over
     2.5MB and anything that is not PNG/JPG/GIF/WebP, so a photo off a phone
     (3-12MB) or an iPhone photo saved to a computer (HEIC) failed with
     "Upload failed (PNG/JPG, max ~2.5MB)". The admin console has shrunk
     pictures in the browser since July; the portal never did.
   - The Directory Image and the Page Image had no Remove. Only the three
     photos did.
   - The photo loop swallowed every error and said "Photos uploaded".

   The helper is run here for real, in a sandbox with a fake canvas.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('../../', import.meta.url);
const SRC = readFileSync(new URL('member/member.js', ROOT), 'utf8');

function helperSource() {
  const a = SRC.indexOf('  function fileToDataUrl(file)');
  const b = SRC.indexOf('  async function uploadImage(file, kind)');
  assert.ok(a > 0 && b > a, 'the upload helpers moved; update this test');
  return SRC.slice(a, b);
}

/* A browser just big enough for the helper. `decodes` says whether this
   browser can open the file (Safari opens HEIC, Chrome does not); `pngBytes`
   is how big the canvas says its PNG comes out. */
function sandbox({ decodes = true, pngBytes = 1000 } = {}) {
  const log = { canvases: [], ops: [] };
  class FileReader {
    readAsDataURL(f) {
      setImmediate(() => {
        this.result = `data:${f.type || 'application/octet-stream'};base64,ORIGINAL`;
        this.onload();
      });
    }
  }
  class Image {
    set src(_) {
      setImmediate(() => {
        if (!this._file.decodes) return this.onerror(new Error('no'));
        this.naturalWidth = this._file.w; this.naturalHeight = this._file.h;
        this.onload();
      });
    }
  }
  let current = null;
  const ctx = {
    fillStyle: '',
    fillRect() { log.ops.push(['fill', this.fillStyle]); },
    clearRect() { log.ops.push(['clear']); },
    drawImage(_, x, y, w, h) { log.ops.push(['draw', w, h]); },
  };
  const document = {
    createElement() {
      const c = {
        width: 0, height: 0,
        getContext: () => ctx,
        toDataURL(type) {
          log.ops.push(['encode', type]);
          const n = type === 'image/png' ? pngBytes : 1000;
          return `data:${type};base64,` + 'A'.repeat(Math.ceil(n * 4 / 3));
        },
      };
      log.canvases.push(c);
      return c;
    },
  };
  const URL = { createObjectURL: (f) => { current = f; return 'blob:x'; }, revokeObjectURL() {} };
  const ctxObj = { FileReader, document, URL, setImmediate, Math, Error, Promise,
    Image: class extends Image { constructor() { super(); this._file = { ...current, decodes }; } } };
  vm.createContext(ctxObj);
  vm.runInContext(helperSource() + '\nthis.imageDataUrl = imageDataUrl; this.UploadError = UploadError;', ctxObj);
  return { imageDataUrl: ctxObj.imageDataUrl, UploadError: ctxObj.UploadError, log };
}
const file = (name, type, size, w = 4032, h = 3024) => ({ name, type, size, w, h });

test('a phone photo over 2.5MB is redrawn as a JPEG no larger than 1800px', async () => {
  const { imageDataUrl, log } = sandbox();
  const out = await imageDataUrl(file('IMG_1234.jpg', 'image/jpeg', 4_800_000));
  assert.match(out, /^data:image\/jpeg;base64,/);
  assert.equal(log.canvases.length, 1);
  assert.deepEqual([log.canvases[0].width, log.canvases[0].height], [1800, 1350]);
});

test('a small PNG/JPG goes up exactly as chosen, so a logo keeps its transparency', async () => {
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    const { imageDataUrl, log } = sandbox();
    const out = await imageDataUrl(file('logo', type, 180_000));
    assert.equal(out, `data:${type};base64,ORIGINAL`, type);
    assert.equal(log.canvases.length, 0, type + ' should not be redrawn');
  }
});

test('Marcia\'s HEIC goes up as a JPEG in a browser that can open it', async () => {
  const { imageDataUrl } = sandbox({ decodes: true });
  const out = await imageDataUrl(file('IMG_3774.heic', 'image/heic', 400_000));
  assert.match(out, /^data:image\/jpeg;base64,/);
  // Some browsers hand a .heic over with no type at all.
  const out2 = await imageDataUrl(file('IMG_3774.HEIC', '', 400_000));
  assert.match(out2, /^data:image\/jpeg;base64,/);
});

test('a HEIC the browser cannot open says what to do instead of "Upload failed"', async () => {
  const { imageDataUrl, UploadError } = sandbox({ decodes: false });
  await assert.rejects(imageDataUrl(file('IMG_3774.heic', 'image/heic', 400_000)), (e) => {
    assert.ok(e instanceof UploadError);
    assert.match(e.message, /iPhone photo \(HEIC\)/);
    assert.match(e.message, /save a copy as JPG/);
    return true;
  });
});

test('a JPEG is drawn on white, because a clear canvas encodes as black', async () => {
  const { imageDataUrl, log } = sandbox();
  await imageDataUrl(file('big.jpg', 'image/jpeg', 3_000_000));
  const fill = log.ops.findIndex((o) => o[0] === 'fill' && o[1] === '#fff');
  const draw = log.ops.findIndex((o) => o[0] === 'draw');
  assert.ok(fill >= 0 && fill < draw, 'white fill must come before the picture');
});

test('a big transparent PNG stays a PNG when the smaller one fits', async () => {
  const { imageDataUrl, log } = sandbox({ pngBytes: 900_000 });
  const out = await imageDataUrl(file('logo.png', 'image/png', 3_500_000, 3000, 1000));
  assert.match(out, /^data:image\/png;base64,/);
  assert.ok(!log.ops.some((o) => o[0] === 'fill'), 'no white fill on a PNG that fits');
});

test('a PNG that is still too big falls back to a JPEG on white', async () => {
  const { imageDataUrl, log } = sandbox({ pngBytes: 3_000_000 });
  const out = await imageDataUrl(file('scan.png', 'image/png', 6_000_000));
  assert.match(out, /^data:image\/jpeg;base64,/);
  const clear = log.ops.findIndex((o) => o[0] === 'clear');
  const fill = log.ops.findIndex((o) => o[0] === 'fill' && o[1] === '#fff');
  assert.ok(clear >= 0 && clear < fill, 'the PNG attempt is wiped before the white fill');
});

test('a PDF or an audio file is passed straight through, not drawn', async () => {
  for (const f of [file('flyer.pdf', 'application/pdf', 5_000_000), file('song.mp3', 'audio/mpeg', 4_000_000)]) {
    const { imageDataUrl, log } = sandbox();
    assert.equal(await imageDataUrl(f), `data:${f.type};base64,ORIGINAL`);
    assert.equal(log.canvases.length, 0);
  }
});

test('every portal upload goes through the helper', () => {
  // The helper itself is the only place a raw file is read.
  const outside = SRC.replace(helperSource(), '');
  assert.ok(!/fileToDataUrl\(/.test(outside.replace('function fileToDataUrl(file)', '')),
    'a portal upload is reading the raw file again');
  assert.ok(!/max ~2\.5MB\)\.'/.test(outside.replace(/uploadFailed = [^\n]+/, '')),
    'an upload is printing the old fixed message instead of uploadFailed()');
});

test('the Directory Image and the Page Image can be removed', () => {
  assert.match(SRC, /data-rmlogo[\s\S]{0,400}logoUrl = '';/);
  assert.match(SRC, /data-rmpageimage[\s\S]{0,400}pageImageUrl = '';/);
  // and what Save sends is the emptied value, which clears it on the listing
  assert.match(SRC, /patch\.logo = logoUrl; patch\.pageImage = pageImageUrl;/);
});

test('a photo that fails to upload is reported, not counted as uploaded', () => {
  const a = SRC.indexOf("const photoInput = document.getElementById('photoFile');");
  const loop = SRC.slice(a, SRC.indexOf('// video live preview', a));
  assert.ok(!/catch \(err\) \{\s*\}/.test(loop), 'the photo loop is swallowing errors again');
  assert.match(loop, /failed\.push\(/);
  assert.match(loop, /limit is 3 photos/);
});
