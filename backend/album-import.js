/* ============================================================
   Album import from a Lightroom share link (Oct 29 2026).

   Robyn Richardson shared the Food & Wine Tour 2026 photos as a Lightroom
   album: 351 photos behind one link. The album page could only take photos
   the office first downloaded, one file at a time. Now the office pastes the
   link in Admin → Albums and the server copies every photo across, at the
   size Lightroom serves for the web (2048px) plus Lightroom's own 640px copy
   as the grid thumbnail, credited to the photographer.

   Only lightroom.adobe.com (and its adobe.ly short links) is ever fetched;
   every rendition path is checked before it is requested. A whole album takes
   a few minutes, so the route starts a job and the admin page polls it, like
   the newsletter import.
   ============================================================ */

const LR = 'https://lightroom.adobe.com';
const HEX32 = /^[0-9a-f]{32}$/;
const PHOTO_CAP_BYTES = 15_000_000;
const PAGE_CAP = 20;               // 20 pages of 500 is far past any real album

// A link the office might paste: lightroom.adobe.com/shares/<id>, with or
// without a trailing path, or an adobe.ly short link to one.
export function parseShareUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'lightroom.adobe.com') {
    const id = (/^\/shares\/([0-9a-f]{32})(?:\/|$)/i.exec(u.pathname) || [])[1];
    return id ? { shareId: id.toLowerCase() } : null;
  }
  if (host === 'adobe.ly' && /^\/[A-Za-z0-9]{3,20}$/.test(u.pathname)) return { shortUrl: 'https://adobe.ly' + u.pathname };
  return null;
}

// Lightroom's JSON is served behind an anti-hijacking prefix.
export function lrJson(text) {
  const s = String(text || '');
  return JSON.parse(s.startsWith('while') ? s.slice(s.indexOf('\n') + 1) : s);
}

// "Food &amp; Wine Tour 2026 by Robyn Richardson" → title + photographer.
export function titleAndAuthor(html) {
  const t = (/<title>([^<]*)<\/title>/i.exec(String(html || '')) || [])[1] || '';
  const text = t.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const i = text.lastIndexOf(' by ');
  return i > 0 ? { title: text.slice(0, i).trim(), author: text.slice(i + 4).trim() } : { title: text, author: '' };
}

// A rendition href from Lightroom, made into a URL on lightroom.adobe.com —
// only ever "assets/<hex>/…" under the album's own space.
export function renditionUrl(spaceId, href) {
  const h = String(href || '');
  if (!/^assets\/[0-9a-f]{32}\/[A-Za-z0-9/_.-]+$/.test(h) || h.includes('..')) return '';
  return `${LR}/v2/spaces/${spaceId}/${h}`;
}

export function photosFrom(spaceId, resources) {
  return (resources || []).map((r) => {
    const a = (r && r.asset) || {};
    const l = a.links || {};
    const pick = (...keys) => { for (const k of keys) { const u = renditionUrl(spaceId, l[k] && l[k].href); if (u) return u; } return ''; };
    const full = pick('/rels/rendition_type/2048', '/rels/rendition_type/1280');
    const thumb = pick('/rels/rendition_type/640', '/rels/rendition_type/thumbnail2x');
    if (!HEX32.test(String(a.id || '')) || !full || (a.subtype && a.subtype !== 'image')) return null;
    return { src: 'lr:' + a.id, id: a.id, name: String(((a.payload || {}).importSource || {}).fileName || '').slice(0, 160), full, thumb };
  }).filter(Boolean);
}

/* Everything needed to copy the album, in the order Lightroom shows it.
   fetchText(url, {redirect}) → { status, location, text } so tests can stand
   in for the network. */
export async function readLightroomAlbum(raw, fetchText) {
  const p = parseShareUrl(raw);
  if (!p) throw new Error('That is not a Lightroom share link. It should start with lightroom.adobe.com/shares/ or adobe.ly/.');
  let shareId = p.shareId;
  if (!shareId) {
    const r = await fetchText(p.shortUrl, { redirect: 'manual' });
    const next = parseShareUrl(r.location || '');
    if (!next || !next.shareId) throw new Error('That adobe.ly link does not lead to a Lightroom album.');
    shareId = next.shareId;
  }
  const page = await fetchText(`${LR}/shares/${shareId}`);
  if (page.status !== 200) throw new Error('Lightroom would not open that album. Check that it is shared as a public link.');
  const m = /spaces\/([0-9a-f]{32})\/albums\/([0-9a-f]{32})/.exec(page.text);
  if (!m) throw new Error('Lightroom would not open that album. Check that it is shared as a public link.');
  const [, space, album] = m;
  const { title, author } = titleAndAuthor(page.text);
  let coverId = '';
  try {
    const a = lrJson((await fetchText(`${LR}/v2/spaces/${space}/albums/${album}`)).text);
    coverId = String(((a.payload || {}).cover || {}).id || '');
  } catch { /* no cover is fine — the first photo stands in */ }
  const photos = [];
  let next = `albums/${album}/assets?embed=asset&subtype=image&limit=500`;
  for (let i = 0; next && i < PAGE_CAP; i++) {
    if (!/^albums\/[0-9a-f]{32}\/assets\?[\w=&%;:+.-]+$/.test(next)) break;
    const j = lrJson((await fetchText(`${LR}/v2/spaces/${space}/${next}`)).text);
    photos.push(...photosFrom(space, j.resources));
    next = j.links && j.links.next && j.links.next.href;
  }
  if (!photos.length) throw new Error('That Lightroom album has no photos in it, or they are not shared.');
  return { shareId, space, album, title, author, coverId, photos };
}

/* Copy the photos across. `store(buffer, name, isThumb)` saves one image and
   returns its site URL; `commit(batch)` adds finished photos to the album.
   Photos already in the album (matched by their Lightroom id) are skipped, so
   running the same link again only adds what is missing. */
export async function copyPhotos({ photos, have = new Set(), room = Infinity, by = '', fetchImage, store, commit, onProgress = () => {}, batchSize = 20, concurrency = 4 }) {
  const todo = photos.filter((p) => !have.has(p.src));
  const fits = todo.slice(0, Math.max(0, room));
  const progress = { total: photos.length, skipped: photos.length - todo.length, overCap: todo.length - fits.length, added: 0, failed: 0, done: 0 };
  onProgress({ ...progress });
  let batch = [];
  const flush = async () => { if (batch.length) { const b = batch; batch = []; await commit(b); } };
  let i = 0;
  const worker = async () => {
    while (i < fits.length) {
      const p = fits[i++];
      try {
        const full = await fetchImage(p.full);
        const url = await store(full, p.name, false);
        let thumb = '';
        if (p.thumb) { try { thumb = await store(await fetchImage(p.thumb), p.name, true); } catch { /* grid falls back to the full photo */ } }
        batch.push({ url, thumb, by, src: p.src });
        progress.added++;
      } catch { progress.failed++; }
      progress.done++;
      if (batch.length >= batchSize) await flush();
      onProgress({ ...progress });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, fits.length || 1) }, worker));
  await flush();
  onProgress({ ...progress });
  return progress;
}

// Real network: lightroom.adobe.com / adobe.ly only.
const ALLOWED = new Set(['lightroom.adobe.com', 'adobe.ly']);
export async function fetchText(url, { redirect = 'follow' } = {}) {
  if (!ALLOWED.has(new URL(url).hostname)) throw new Error('blocked host');
  const r = await fetch(url, { redirect, signal: AbortSignal.timeout(30_000) });
  return { status: r.status, location: r.headers.get('location') || '', text: redirect === 'manual' ? '' : await r.text() };
}
export async function fetchImage(url) {
  if (new URL(url).hostname !== 'lightroom.adobe.com') throw new Error('blocked host');
  const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
  const type = r.headers.get('content-type') || '';
  if (r.status !== 200 || !/^image\/jpeg/.test(type)) throw new Error(`rendition ${r.status} ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > PHOTO_CAP_BYTES) throw new Error('rendition size');
  return buf;
}
