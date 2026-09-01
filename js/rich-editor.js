/* Shared rich-text editor for event descriptions.

   Lifted out of admin/admin.js so the office panel and a member's own event
   form run the SAME editor. Every fix in here was reported against the admin
   one (Felicia, Jul 14/16/29; Diana, Jul 2026) — a second copy would have
   drifted the moment either side was touched.

   Felicia, Sep 1 2026: "our members have lost the ability to customize their
   events ... a link has a full address instead of being able to link text that
   will simply say 'Click Here To Sign Up'. They are also unable to change font
   size and color." Members never had this editor; only the office did.

     RichEditor.mount(editorEl, toolbarEl, {
       esc,                             // HTML-escape helper
       uploadImage: async (dataUrl) => url,
       pickImages,                      // optional library picker (office only)
     })

   Markup contract: a [data-rt] toolbar plus a contenteditable .rt-typo box —
   see the block in admin/events.html and member/event.html. What this produces
   goes to the server as descriptionHtml and is run through sanitizeRichHtml
   there; browser-side HTML is never trusted.
*/
window.RichEditor = (function () {
  function mount(rich, richBar, opts) {
    if (!rich || !richBar) return;
    const { esc, uploadImage, pickImages } = opts || {};
      // Enter makes a real <p> instead of Chrome's default bare <div>. Divs
      // carry no margin, so paragraphs typed in the editor published as one
      // dense block — Felicia's "there's not a lot of spacing in between"
      // (Jul 29). Paragraphs now get the same 16px gap here and on the site.
      try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}
      // Remember where the caret is in the editor. Clicking a toolbar file
      // input (insert image) blurs the editor and loses the caret, which is why
      // inserted images jumped to the top (Felicia, Jul 16). We save the range
      // while the editor has focus and restore it right before inserting.
      let savedRange = null;
      const rememberRange = () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && rich.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
      };
      rich.addEventListener('keyup', rememberRange);
      rich.addEventListener('mouseup', rememberRange);
      rich.addEventListener('blur', rememberRange);
      const restoreRange = () => {
        rich.focus();
        if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
      };
      const focusExec = (fn) => { rich.focus(); fn(); };
      richBar.querySelectorAll('[data-rt]').forEach((b) => b.addEventListener('click', () =>
        focusExec(() => document.execCommand(b.dataset.rt, false, null))));
      const styleSelection = (prop, val) => focusExec(() => {
        // styleWithCSS makes execCommand emit span styles (sanitizer-friendly).
        document.execCommand('styleWithCSS', false, true);
        if (prop === 'color') { document.execCommand('foreColor', false, val); return; }
        // font-size / font-family across ANY selection — including several
        // paragraphs of pasted text (per Felicia, Jul 14: sizing pasted text
        // did nothing). Let the browser tag the whole selection with <font>
        // markers, then restyle those markers as clean spans.
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed || !rich.contains(sel.anchorNode)) { alert('First select the text you want to change, then pick the ' + (prop === 'font-size' ? 'size' : 'font') + '.'); return; }
        document.execCommand('styleWithCSS', false, false);
        if (prop === 'font-size') document.execCommand('fontSize', false, '7');
        else document.execCommand('fontName', false, '__rt-marker__');
        document.execCommand('styleWithCSS', false, true);
        rich.querySelectorAll(prop === 'font-size' ? 'font[size="7"]' : 'font[face="__rt-marker__"]').forEach((f) => {
          const span = document.createElement('span');
          span.style[prop === 'font-size' ? 'fontSize' : 'fontFamily'] = val;
          while (f.firstChild) span.appendChild(f.firstChild);
          f.replaceWith(span);
        });
      });
      richBar.querySelector('[data-rt-font]')?.addEventListener('change', (e) => { if (e.target.value) styleSelection('font-family', e.target.value); e.target.value = ''; });
      richBar.querySelector('[data-rt-size]')?.addEventListener('change', (e) => { if (e.target.value) styleSelection('font-size', e.target.value); e.target.value = ''; });
      richBar.querySelector('[data-rt-color]')?.addEventListener('input', (e) => styleSelection('color', e.target.value));
      richBar.querySelector('[data-rt-link]')?.addEventListener('click', () => {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed || !rich.contains(sel.anchorNode)) { alert('First select the text you want to link (e.g. “Click here to sign up”), then press 🔗 Link.'); return; }
        let url = prompt('Link this text to which web address?', 'https://');
        if (!url || url === 'https://') return;
        if (!/^(https?:|mailto:|tel:|\/)/i.test(url)) url = 'https://' + url;
        focusExec(() => document.execCommand('createLink', false, url));
      });
      // 📋 Paste cleanup (per Felicia, Jul 14 — sponsor text pasted from Word
      // carried Word's own fonts/styles and wouldn't reformat). Keep the
      // structure (paragraphs, bullets, bold/italic/underline, links), drop
      // the styling, so the toolbar works on whatever was pasted.
      rich.addEventListener('paste', (e) => {
        const html = e.clipboardData && e.clipboardData.getData('text/html');
        const text = e.clipboardData && e.clipboardData.getData('text/plain');
        if (!html && !text) return; // images etc. — let the browser handle it
        e.preventDefault();
        let out = '';
        if (html) {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          doc.querySelectorAll('style,script,meta,link,head,title').forEach((n) => n.remove());
          const KEEP = { P: 'p', DIV: 'p', H1: 'h3', H2: 'h3', H3: 'h4', H4: 'h4', H5: 'h4', UL: 'ul', OL: 'ol', LI: 'li', B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', A: 'a', BR: 'br' };
          const walk = (node) => [...node.childNodes].map((n) => {
            if (n.nodeType === 3) return esc(n.textContent);
            if (n.nodeType !== 1) return '';
            const tag = KEEP[n.tagName];
            const inner = walk(n);
            if (tag === 'br') return '<br>';
            if (!tag) return inner;
            if (!inner.trim()) return '';
            if (tag === 'a') {
              const href = n.getAttribute('href') || '';
              return /^(https?:|mailto:|tel:)/i.test(href) ? `<a href="${esc(href)}">${inner}</a>` : inner;
            }
            return `<${tag}>${inner}</${tag}>`;
          }).join('');
          out = walk(doc.body)
            .replace(/(?:<br>\s*){3,}/g, '<br><br>'); // Word's stacked spacer breaks
        } else {
          out = esc(text).replace(/\r?\n/g, '<br>');
        }
        if (out) document.execCommand('insertHTML', false, out);
      });
      // 🖼 Click any image in the editor to resize it (per Diana, Jul 2026 —
      // there was no way to resize logos/images placed in an event).
      rich.addEventListener('click', (e) => {
        const img = e.target.closest('img');
        document.querySelector('.rt-imgbar')?.remove();
        if (!img) return;
        const bar = document.createElement('div');
        bar.className = 'rt-imgbar';
        bar.style.cssText = 'position:absolute;z-index:500;background:#fff;border:1px solid var(--gold,#C9A227);border-radius:8px;box-shadow:0 8px 22px rgba(0,0,0,.18);padding:4px 6px;display:flex;gap:4px;font-size:.8rem;align-items:center';
        const r = img.getBoundingClientRect();
        bar.style.left = Math.max(8, r.left + scrollX) + 'px';
        bar.style.top = Math.max(8, r.top + scrollY - 40) + 'px';
        const mk = (label, w, title) => {
          const b = document.createElement('button');
          b.type = 'button'; b.textContent = label; b.title = title || '';
          b.style.cssText = 'border:1px solid #ddd;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit';
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (w === 'remove') {
              // A linked image lives inside an <a> — take the empty wrapper too.
              const p = img.parentElement;
              img.remove();
              if (p && p.tagName === 'A' && !p.textContent.trim() && !p.querySelector('img')) p.remove();
            } else { img.style.width = w; img.style.maxWidth = '100%'; }
            bar.remove();
          });
          return b;
        };
        // Live size slider (per Diana, Jul 2026 — the old S/M/L jumped in big
        // steps and a small % could make the image seem to vanish). Drag to
        // resize in real time; the px box mirrors it for an exact number. Width
        // is always in pixels with a 40px floor so it can never disappear.
        bar.append('Size ');
        const natural = img.naturalWidth || 0;
        const editorW = (rich && rich.clientWidth) || 800;
        const maxW = Math.max(120, Math.min(natural || 1600, editorW, 1600));
        const curPx = () => {
          const m2 = /^(\d+(?:\.\d+)?)px$/.exec(img.style.width || '');
          if (m2) return Math.round(Number(m2[1]));
          const bw = Math.round(img.getBoundingClientRect().width);
          return Math.min(bw || (natural || 300), maxW);
        };
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = '40'; slider.max = String(maxW);
        slider.value = String(Math.min(Math.max(40, curPx()), maxW));
        slider.title = 'Drag to resize';
        slider.style.cssText = 'width:120px;vertical-align:middle;cursor:pointer;accent-color:var(--gold,#C9A227)';
        const pxBox = document.createElement('input');
        pxBox.type = 'number'; pxBox.min = '40'; pxBox.max = String(maxW);
        pxBox.value = slider.value;
        pxBox.title = 'Exact width in pixels';
        pxBox.style.cssText = 'width:60px;border:1px solid #ddd;border-radius:6px;padding:2px 6px;font:inherit';
        const applyW = (v) => {
          const n = Math.min(maxW, Math.max(40, Math.round(Number(v) || 0)));
          img.style.width = n + 'px'; img.style.height = 'auto'; img.style.maxWidth = '100%';
          slider.value = String(n); pxBox.value = String(n);
        };
        slider.addEventListener('mousedown', (ev) => ev.stopPropagation());
        slider.addEventListener('input', (ev) => { ev.stopPropagation(); applyW(slider.value); });
        pxBox.addEventListener('mousedown', (ev) => ev.stopPropagation());
        pxBox.addEventListener('input', (ev) => ev.stopPropagation());
        pxBox.addEventListener('change', (ev) => { ev.stopPropagation(); applyW(pxBox.value); });
        pxBox.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); applyW(pxBox.value); } });
        bar.appendChild(slider);
        bar.appendChild(pxBox);
        bar.append('px ');
        // Full = span the text column; clearing the width lets it size naturally.
        bar.appendChild(mk('Full', '100%', 'Fill the width of the text column'));
        // Position: wrap the text left/right, center on its own line, or inline.
        bar.append(' Position: ');
        const place = (mode) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = mode === 'left' ? '⬅ Wrap' : mode === 'right' ? 'Wrap ➡' : mode === 'center' ? '▣ Center' : '↩ Inline';
          b.title = mode === 'center' ? 'Center the image on its own line'
            : mode === 'inline' ? 'Back to sitting in the text line'
            : `Text wraps around the ${mode} side`;
          b.style.cssText = 'border:1px solid #ddd;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit';
          b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            img.style.float = ''; img.style.display = ''; img.style.margin = '';
            if (mode === 'left') { img.style.float = 'left'; img.style.margin = '4px 14px 8px 0'; }
            if (mode === 'right') { img.style.float = 'right'; img.style.margin = '4px 0 8px 14px'; }
            if (mode === 'center') { img.style.display = 'block'; img.style.margin = '8px auto'; }
            bar.remove();
          });
          return b;
        };
        ['left', 'center', 'right', 'inline'].forEach((m) => bar.appendChild(place(m)));
        // 🔗 Make the image clickable (Felicia, Jul 29 — sponsor logos in the
        // description need to reach the sponsor's site). Always opens in a new
        // tab so the visitor keeps the chamber page behind them.
        const linkBtn = document.createElement('button');
        const linkedA = () => (img.parentElement && img.parentElement.tagName === 'A' ? img.parentElement : null);
        linkBtn.type = 'button';
        linkBtn.style.cssText = 'border:1px solid #ddd;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit';
        const paintLink = () => {
          const a = linkedA();
          linkBtn.textContent = a ? '🔗 Linked' : '🔗 Link';
          linkBtn.title = a ? `Opens ${a.getAttribute('href')} — click to change or remove` : 'Make this image clickable (opens in a new tab)';
          linkBtn.style.borderColor = a ? 'var(--gold,#C9A227)' : '#ddd';
        };
        paintLink();
        linkBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const a = linkedA();
          const next = prompt('Where should this image link to?\n\nPaste the web address (leave blank to remove the link).', a ? a.getAttribute('href') || '' : 'https://');
          if (next === null) return;
          const url = next.trim();
          if (!url || url === 'https://') {                    // unwrap
            if (a) { a.replaceWith(img); }
            paintLink(); bar.remove(); return;
          }
          const href = /^(https?:|mailto:|tel:|\/)/i.test(url) ? url : 'https://' + url;
          if (a) { a.setAttribute('href', href); }
          else {
            const wrap = document.createElement('a');
            wrap.setAttribute('href', href);
            img.replaceWith(wrap); wrap.appendChild(img);
          }
          const holder = linkedA();
          if (holder) { holder.setAttribute('target', '_blank'); holder.setAttribute('rel', 'noopener'); }
          paintLink(); bar.remove();
        });
        bar.appendChild(linkBtn);
        bar.appendChild(mk('✕', 'remove', 'Delete this image from the text'));
        document.body.appendChild(bar);
        const away = (ev) => { if (!bar.contains(ev.target) && ev.target !== img) { bar.remove(); document.removeEventListener('mousedown', away, true); } };
        document.addEventListener('mousedown', away, true);
      });
      // 🖼 Insert an image inline where the cursor is — breaks up long text.
      // Save the caret the instant the button is pressed (before the file
      // dialog steals focus), then restore it so the image lands exactly there
      // — and you can add as many as you like (Felicia, Jul 16).
      richBar.querySelector('[data-rt-img]')?.addEventListener('mousedown', rememberRange);
      richBar.querySelector('[data-rt-img]')?.addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = async () => {
          try {
            const url = await uploadImage(r.result);
            restoreRange();
            document.execCommand('insertHTML', false, `<img src="${esc(url)}" alt="" style="max-width:100%"><br>`);
            rememberRange();
          } catch (err) { alert('Image upload failed (PNG/JPG, ≤2.5 MB).'); }
          e.target.value = '';
        };
        r.readAsDataURL(f);
      });
      // Same insert, but from the library — sponsor logos and headshots get
      // reused across events, so re-uploading them was pure busywork.
      // Only the office has an image library; a member's toolbar hides the
      // button rather than offering one that cannot work.
      const libImg = richBar.querySelector('[data-rt-libimg]');
      if (libImg && !pickImages) libImg.hidden = true;
      libImg?.addEventListener('mousedown', rememberRange);
      libImg?.addEventListener('click', async () => {
        if (!pickImages) return;
        const urls = await pickImages({ multiple: true, title: 'Insert images into the description', max: 8 });
        if (!urls || !urls.length) return;
        restoreRange();
        document.execCommand('insertHTML', false, urls.map((u) => `<img src="${esc(u)}" alt="" style="max-width:100%">`).join('') + '<br>');
        rememberRange();
      });
  }
  return { mount };
})();
