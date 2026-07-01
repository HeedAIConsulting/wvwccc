/* ============================================================
   Global Support widget — a floating "Support" button on every
   admin & member page. Lets staff/members send a request to Heed
   (via Formspree), optionally with a screenshot of the current
   screen. Screenshots are stored in the Chamber's own asset store
   and linked in the message, so delivery never depends on the
   Formspree file-upload tier. Self-contained: injects its own CSS.
   ============================================================ */
(function () {
  if (window.__wvSupport) return; window.__wvSupport = true;
  var FORMSPREE = 'https://formspree.io/f/xdarknbd';
  var url = (window.ChamberAPI && ChamberAPI.url) ? ChamberAPI.url : function (p) { return p; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };

  var css = ''
    /* Bottom-left utility stack: Support (here, bottom) → ADA (bottom:84) → guide promo (bottom:152).
       Keep the three offsets in sync with accessibility.js + partials.js mountGuidePromo. */
    + '.wv-sup-btn{position:fixed;left:24px;bottom:24px;z-index:99000;background:#1E5631;color:#fff;border:2px solid #C9A227;'
    + 'border-radius:999px;padding:11px 16px;font:600 14px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.25);display:flex;gap:7px;align-items:center;transition:transform .15s,box-shadow .15s}'
    + '.wv-sup-btn:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.3)}'
    + '.wv-sup-ov{position:fixed;inset:0;z-index:99001;background:rgba(14,42,22,.55);display:flex;align-items:flex-start;justify-content:center;padding:5vh 14px;overflow-y:auto}'
    + '.wv-sup-box{background:#fff;max-width:520px;width:100%;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.32);padding:22px 24px;position:relative;font-family:system-ui,sans-serif;color:#16202c}'
    + '.wv-sup-box h2{font-size:1.3rem;margin:0 0 2px;color:#143C20}'
    + '.wv-sup-box .sub{color:#515A66;font-size:.86rem;margin:0 0 14px}'
    + '.wv-sup-x{position:absolute;top:10px;right:12px;border:none;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:#888}'
    + '.wv-sup-box label{display:block;font-size:.8rem;font-weight:600;margin:10px 0 4px}'
    + '.wv-sup-box input,.wv-sup-box select,.wv-sup-box textarea{width:100%;padding:9px 11px;border:1.5px solid #e4dcc8;border-radius:9px;font:inherit;background:#fdfbf6}'
    + '.wv-sup-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
    + '.wv-sup-shot{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px}'
    + '.wv-sup-shot button{background:#F4E9C1;border:1px solid #C9A227;color:#8C6E14;border-radius:8px;padding:7px 12px;font:600 .82rem system-ui;cursor:pointer}'
    + '.wv-sup-prev{margin-top:8px;display:none}'
    + '.wv-sup-prev img{max-width:100%;max-height:160px;border:1px solid #e4dcc8;border-radius:8px}'
    + '.wv-sup-send{margin-top:14px;background:#1E5631;color:#fff;border:none;border-radius:10px;padding:11px 18px;font:600 .95rem system-ui;cursor:pointer;width:100%}'
    + '.wv-sup-send:disabled{opacity:.6}'
    + '.wv-sup-msg{margin-top:10px;font-size:.86rem}'
    + '@media(max-width:520px){.wv-sup-row{grid-template-columns:1fr}.wv-sup-btn span{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var shot = null; // { dataUrl }
  function mountBtn() {
    if (document.querySelector('.wv-sup-btn')) return;
    var b = document.createElement('button');
    b.className = 'wv-sup-btn'; b.type = 'button';
    b.setAttribute('aria-label', 'Get help or report a problem');
    b.innerHTML = '🛟 <span>Support</span>';
    b.addEventListener('click', open);
    document.body.appendChild(b);
  }

  function loadH2C() {
    return new Promise(function (res, rej) {
      if (window.html2canvas) return res(window.html2canvas);
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = function () { res(window.html2canvas); };
      s.onerror = function () { rej(new Error('Could not load the screenshot tool.')); };
      document.head.appendChild(s);
    });
  }

  function open() {
    if (document.querySelector('.wv-sup-ov')) return;
    shot = null;
    var ov = document.createElement('div'); ov.className = 'wv-sup-ov';
    ov.innerHTML = ''
      + '<form class="wv-sup-box" novalidate>'
      + '<button type="button" class="wv-sup-x" data-x aria-label="Close">×</button>'
      + '<h2>Need help?</h2>'
      + '<p class="sub">Send a question or report a problem to the Heed team. You can attach a screenshot of what you’re seeing.</p>'
      + '<div class="wv-sup-row"><div><label>Your name</label><input name="name" maxlength="120"></div>'
      + '<div><label>Your email</label><input name="email" type="email" maxlength="160"></div></div>'
      + '<label>What do you need help with?</label><select name="area">'
      + ['Login / access issue','Feature help or request','Website issue / something looks broken','Members','Events','Groups & Networks','Payments','Newsletter / Podcast','AI Assistant','Other']
          .map(function (o) { return '<option>' + o + '</option>'; }).join('')
      + '</select>'
      + '<label>How can we help? *</label><textarea name="message" rows="4" maxlength="6000" placeholder="Describe what you were doing and what happened…"></textarea>'
      + '<label>Screenshot <span style="font-weight:400;color:#888">(optional)</span></label>'
      + '<div class="wv-sup-shot"><button type="button" data-cap>📷 Capture this screen</button>'
      + '<label style="font-weight:400;margin:0;display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:.82rem">or attach a file '
      + '<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-file style="display:none"><span data-filebtn style="text-decoration:underline;color:#2e6b4f">choose…</span></label></div>'
      + '<div class="wv-sup-prev" data-prev><img alt="screenshot preview"><button type="button" data-clear style="display:block;margin-top:5px;background:none;border:none;color:#b23;cursor:pointer;font-size:.8rem">Remove screenshot</button></div>'
      + '<button type="submit" class="wv-sup-send">Send to Heed support</button>'
      + '<p class="wv-sup-msg" data-msg hidden></p>'
      + '</form>';
    var form = ov.querySelector('form');
    var prev = ov.querySelector('[data-prev]');
    var msg = ov.querySelector('[data-msg]');
    var close = function () { ov.remove(); };
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('[data-x]')) close(); });
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });

    function setShot(dataUrl) { shot = { dataUrl: dataUrl }; prev.style.display = 'block'; prev.querySelector('img').src = dataUrl; }
    ov.querySelector('[data-clear]').addEventListener('click', function () { shot = null; prev.style.display = 'none'; });
    ov.querySelector('[data-cap]').addEventListener('click', async function () {
      var capBtn = this; capBtn.disabled = true; capBtn.textContent = 'Capturing…';
      ov.style.visibility = 'hidden';
      try {
        var h2c = await loadH2C();
        var canvas = await h2c(document.body, { scale: 0.6, useCORS: true, logging: false, backgroundColor: '#ffffff', windowWidth: document.documentElement.clientWidth, windowHeight: document.documentElement.clientHeight, x: window.scrollX, y: window.scrollY, width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
        setShot(canvas.toDataURL('image/jpeg', 0.7));
      } catch (e) { msg.hidden = false; msg.style.color = '#b23'; msg.textContent = 'Could not capture the screen — try attaching a file instead.'; }
      finally { ov.style.visibility = 'visible'; capBtn.disabled = false; capBtn.textContent = '📷 Capture this screen'; }
    });
    var fileInput = ov.querySelector('[data-file]');
    ov.querySelector('[data-filebtn]').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0]; if (!f) return;
      if (f.size > 2400000) { msg.hidden = false; msg.style.color = '#b23'; msg.textContent = 'That image is over ~2.4MB — please attach a smaller one.'; return; }
      var r = new FileReader(); r.onload = function () { setShot(r.result); }; r.readAsDataURL(f);
    });

    // prefill from the signed-in account
    fetch(url('/api/me'), { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return; if (d.user && d.user.email && !form.email.value) form.email.value = d.user.email;
      if (d.member && d.member.name && !form.name.value) form.name.value = d.member.name;
    }).catch(function () {});

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!form.message.value.trim()) { msg.hidden = false; msg.style.color = '#b23'; msg.textContent = 'Please describe how we can help.'; return; }
      var send = form.querySelector('.wv-sup-send'); send.disabled = true; send.textContent = 'Sending…';
      msg.hidden = true;
      var shotUrl = '';
      try {
        if (shot) {
          var up = await fetch(url('/api/me/asset'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'photo', dataUrl: shot.dataUrl }) });
          if (up.ok) { var ud = await up.json(); shotUrl = location.origin + ud.url; }
        }
        var fd = new FormData();
        fd.append('name', form.name.value || '(not given)');
        fd.append('email', form.email.value || 'no-reply@woodlandhillscc.net');
        fd.append('area', form.area.value);
        fd.append('_subject', 'WVWCCC support: ' + form.area.value);
        fd.append('message', form.message.value + '\n\n— Sent from: ' + location.href + (shotUrl ? ('\n— Screenshot: ' + shotUrl) : ''));
        if (shotUrl) fd.append('screenshot', shotUrl);
        var r = await fetch(FORMSPREE, { method: 'POST', headers: { Accept: 'application/json' }, body: fd });
        if (!r.ok) { var ed = await r.json().catch(function () { return {}; }); throw new Error((ed.errors && ed.errors[0] && ed.errors[0].message) || ('error ' + r.status)); }
        form.innerHTML = '<button type="button" class="wv-sup-x" data-x>×</button><h2>Thank you! 🌿</h2><p class="sub">Your message was sent to the Heed team' + (shotUrl ? ' (with your screenshot)' : '') + '. We’ll follow up by email.</p><button type="button" class="wv-sup-send" data-x>Close</button>';
        form.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', close); });
      } catch (err) {
        msg.hidden = false; msg.style.color = '#b23';
        msg.textContent = 'Could not send: ' + (err.message || 'error') + '. You can also email mbowers@heedconsulting.ai.';
        send.disabled = false; send.textContent = 'Send to Heed support';
      }
    });

    document.body.appendChild(ov);
    setTimeout(function () { var t = form.querySelector('textarea'); if (t) t.focus(); }, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBtn);
  else mountBtn();
})();
