/* Felicia, Sep 14 2026: "when I copy/paste the text formatting doesn't stick
   and I need to format it in the text box."

   The July paste cleanup (her complaint then: Word text "wouldn't reformat")
   dropped SPAN outright and every style with it. Word and Outlook express most
   formatting as span styles — bold, colour, size — and centre a line with
   text-align on the paragraph, so all of it was being thrown away and she was
   re-applying it by hand on a long exhibitor list.

   The cleaner now keeps exactly what the toolbar itself can produce and still
   drops Word's typeface, its classes and its mso-* junk, which is what made
   pasted text refuse to reformat in the first place.

   Two things are pinned here: what the cleaner emits, and that what it emits
   survives the server's sanitiser. Emitting a property the server strips would
   look right in the editor and vanish on save — the worst kind of pass.

   Run: npm test */
import { test, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';

// Load the real shipped editor. Its top level is pure — the DOM only gets
// touched inside mount() — so it evaluates fine with a bare window object.
const win = {};
new Function('window', readFileSync(new URL('../../js/rich-editor.js', import.meta.url), 'utf8'))(win);
const { cleanPasted, pastedFontSize, pastedColor } = win.RichEditor;

const txt = (s) => ({ nodeType: 3, textContent: s });
const el = (tagName, style = {}, kids = [], attrs = {}) => ({
  nodeType: 1, tagName, style, childNodes: kids,
  getAttribute: (n) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
});
const body = (...kids) => el('BODY', {}, kids);

// What Word actually puts on the clipboard for one bold sponsor name.
const WORD_SPAN = { fontSize: '11.0pt', fontFamily: '"Calibri",sans-serif' };

test('a bold sponsor name pasted from Word is still bold', () => {
  const html = cleanPasted(body(el('P', {}, [
    el('SPAN', { ...WORD_SPAN, fontWeight: '700' }, [txt('Gaspar Insurance Services')]),
  ])));
  assert.match(html, /font-weight:bold/, 'this is the whole complaint — bold has to survive');
  assert.match(html, /Gaspar Insurance Services/);
});

test('a centred line stays centred', () => {
  const html = cleanPasted(body(el('P', { textAlign: 'center' }, [txt('Thank you to our sponsors')])));
  assert.match(html, /<p style="[^"]*text-align:center"/);
});

test('alignment is kept on blocks, not smuggled onto a span', () => {
  const html = cleanPasted(body(el('SPAN', { textAlign: 'center' }, [txt('inline')])));
  assert.equal(html, 'inline', 'text-align on an inline span does nothing — do not emit a span for it');
});

test("Word's typeface is left behind", () => {
  const html = cleanPasted(body(el('P', {}, [el('SPAN', { ...WORD_SPAN }, [txt('plain body text')])])));
  assert.ok(!/font-family/i.test(html), 'the site has its own font — that was half of the July complaint');
  assert.equal(html, '<p>plain body text</p>', 'a span carrying nothing we keep is unwrapped, not published empty');
});

test('ordinary body sizes are ignored, a real size change is kept', () => {
  assert.equal(pastedFontSize('11.0pt'), '', "Word's body text is not a size choice");
  assert.equal(pastedFontSize('12pt'), '');
  assert.equal(pastedFontSize('16px'), '');
  assert.equal(pastedFontSize('18pt'), '1.5rem', 'a heading pasted at 18pt is a deliberate choice');
  assert.equal(pastedFontSize('24px'), '1.5rem');
  assert.equal(pastedFontSize(''), '');
  assert.equal(pastedFontSize('inherit'), '');
});

test('a real colour is kept; automatic black and near-white are not', () => {
  assert.equal(pastedColor('#c00000'), '#c00000', 'the red she uses on a headline');
  assert.equal(pastedColor('rgb(192, 0, 0)'), '#c00000');
  assert.equal(pastedColor('#004080'), '#004080', 'a dark navy is darker than mid-grey and still a real choice');
  assert.equal(pastedColor('#000000'), '', "Word's automatic black would override the site's ink");
  assert.equal(pastedColor('rgb(0,0,0)'), '');
  assert.equal(pastedColor('#1a1a1a'), '', 'as good as black');
  assert.equal(pastedColor('#ffffff'), '', 'white on a white page is invisible');
  assert.equal(pastedColor('nonsense'), '');
});

test('structure and links still come through', () => {
  const html = cleanPasted(body(
    el('UL', {}, [el('LI', {}, [txt('Doors at 5:30')]), el('LI', {}, [txt('Valet parking')])]),
    el('P', {}, [el('A', {}, [txt('Sign up')], { href: 'https://woodlandhillscc.net/events/' })]),
  ));
  assert.match(html, /<ul><li>Doors at 5:30<\/li><li>Valet parking<\/li><\/ul>/);
  assert.match(html, /<a href="https:\/\/woodlandhillscc\.net\/events\/">Sign up<\/a>/);
});

test('a script-scheme link is reduced to its text, never published as a link', () => {
  const html = cleanPasted(body(el('P', {}, [
    el('A', {}, [txt('Click here')], { href: 'javascript:alert(1)' }),
  ])));
  assert.equal(html, '<p>Click here</p>');
});

test('text is escaped, so pasted angle brackets cannot become markup', () => {
  const html = cleanPasted(body(el('P', {}, [txt('Fish & Chips <Woodland Hills>')])));
  assert.match(html, /Fish &amp; Chips &lt;Woodland Hills&gt;/);
  assert.ok(!/<Woodland/.test(html));
});

/* ── and the half that only the server can answer ── */

let server, base, cookie, evId;
const T = Date.now().toString(36);
const ADMIN = `paste-admin-${T}@test.woodlandhillscc.net`;
const adm = (p, opts = {}) => fetch(base + p, {
  ...opts, headers: { 'Content-Type': 'application/json', cookie, ...(opts.headers || {}) },
});

before(async () => {
  process.env.ADMIN_BOOTSTRAP = `${ADMIN}|${bcrypt.hashSync('test-passcode-1', 10)}||admin|Paste Test`;
  mock.module('../email.js', {
    namedExports: {
      send: async () => ({ ok: true, id: 'test', provider: 'stub' }),
      notifyTo: () => 'felicia@woodlandhillscc.net',
      enabled: () => true, provider: () => 'stub', diagnose: async () => ({}),
    },
  });
  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const routes = (await import('../chamber-routes.js')).default;
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN, password: 'test-passcode-1' }),
  });
  assert.equal(login.status, 200);
  cookie = (login.headers.get('set-cookie') || '').split(';')[0];
});

after(async () => {
  if (evId) await adm(`/api/admin/events/${encodeURIComponent(evId)}`, { method: 'DELETE' }).catch(() => {});
  server && server.close();
  mock.reset();
});

test('everything the cleaner emits survives the save', async () => {
  // One paste, the shape of her exhibitor list: a centred heading, a coloured
  // line, bold names, a size, a link.
  const pasted = cleanPasted(body(
    el('P', { textAlign: 'center' }, [
      el('SPAN', { ...WORD_SPAN, fontSize: '18.0pt', fontWeight: 'bold', color: '#c00000' },
        [txt('Thank you to our exhibitors')]),
    ]),
    el('P', {}, [
      el('SPAN', { ...WORD_SPAN, fontWeight: 'bold' }, [txt('Gaspar Insurance')]),
      txt(' · '),
      el('SPAN', { ...WORD_SPAN, fontStyle: 'italic' }, [txt('Jaguar Land Rover Woodland Hills')]),
    ]),
    el('P', {}, [el('A', {}, [txt('Exhibitor list')], { href: 'https://woodlandhillscc.net/events/' })]),
  ));

  const made = await adm('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Paste round-trip ${T}`, date: '2027-05-06', time: '5:30 PM',
      venue: 'Test venue', category: 'Community', status: 'approved',
      descriptionHtml: pasted,
    }),
  });
  const out = await made.json().catch(() => ({}));
  assert.equal(made.status, 200, JSON.stringify(out));
  evId = out.event.id;

  const saved = await (await fetch(`${base}/api/events/${encodeURIComponent(evId)}`)).json();
  const h = saved.descriptionHtml || '';
  for (const decl of ['text-align:center', 'font-weight:bold', 'font-style:italic', 'color:#c00000', 'font-size:1.5rem']) {
    assert.ok(h.includes(decl), `${decl} was stripped on the way in — it would look right in the editor and vanish on save`);
  }
  assert.match(h, /<a href="https:\/\/woodlandhillscc\.net\/events\/"/);
  assert.ok(!/font-family/i.test(h));
});
