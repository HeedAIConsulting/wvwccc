/* ============================================================
   WVWCCC — Member portal logic (signed-in members)
   ============================================================ */
window.MemberPortal = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = (window.ChamberAPI ? ChamberAPI.url('') : '');

  async function api(pathname, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(base + pathname, { credentials: 'same-origin', ...opts, headers });
    if (res.status === 401 || res.status === 403) { location.href = '../auth/member-login.html'; throw new Error('auth'); }
    if (!res.ok) throw new Error(`${pathname} → ${res.status}`);
    return res.json();
  }

  async function logout() { try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {} location.href = '../index.html'; }

  const TIER_LABEL = (t) => (t || 'member').charAt(0).toUpperCase() + (t || 'member').slice(1);

  // ── Dashboard ──
  async function initDashboard() {
    let data;
    try { data = await api('/api/me'); } catch (e) { return; }
    const { user, member } = data;
    const bindLogout = () => document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); logout(); }));

    document.getElementById('welcome').textContent = member ? member.name : user.email;
    const wrap = document.getElementById('memberBody');

    if (!member) {
      wrap.innerHTML = `<div class="notice">Your login isn't linked to a directory listing yet. Contact the Chamber office at (818) 347-4737 and we'll connect it.</div>`;
      bindLogout(); return;
    }
    const status = member.status || 'approved';
    const logoPrompt = !member.logo ? `
      <div class="notice" style="display:flex;justify-content:space-between;align-items:center;gap:var(--s-4);flex-wrap:wrap;border-left:4px solid var(--gold,#c8a24a)">
        <span><strong>Add your logo.</strong> Listings with a logo stand out in the directory — it takes 10 seconds.</span>
        <a class="btn btn--forest btn--sm" href="profile.html#logo">Upload logo</a>
      </div>` : '';
    wrap.innerHTML = `
      ${logoPrompt}
      <div class="grid" style="grid-template-columns:1.4fr .9fr;gap:var(--s-6);align-items:start">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:var(--s-4);flex-wrap:wrap">
            <div>
              <span class="kicker">Your listing</span>
              <h2 style="margin:4px 0">${esc(member.name)}</h2>
              <div class="member-tile__meta">${esc(member.category || '')}${member.neighborhood ? ' · ' + esc(member.neighborhood) : ''}</div>
            </div>
            <span class="badge badge--${(member.tier || 'member')}">${esc(TIER_LABEL(member.tier) === 'Member' ? 'Member' : TIER_LABEL(member.tier) + ' Member')}</span>
          </div>
          <p class="mt-4">${esc(member.tagline || 'Add a tagline so neighbors know what you do.')}</p>
          ${member.description ? `<p class="member-tile__meta">${esc(member.description)}</p>` : ''}
          <div class="btn-row mt-5">
            <a class="btn btn--forest" href="profile.html">Edit my profile</a>
            <a class="btn btn--ghost" href="../members/profile.html?id=${encodeURIComponent(member.id)}" target="_blank">View public page ↗</a>
          </div>
        </div>
        <aside class="card bg-forest" style="color:#fff">
          <span class="hero__feature-label">Membership</span>
          <h3 style="color:#fff;margin-top:8px">${esc(TIER_LABEL(member.tier))}</h3>
          <p style="color:rgba(255,255,255,.85)">Status: <strong style="text-transform:capitalize">${esc(status)}</strong></p>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;margin-top:var(--s-3)">
            <li><a style="color:var(--gold-bright)" href="profile.html">› Update profile</a></li>
            <li><a style="color:var(--gold-bright)" href="post.html">› Post an offer / community</a></li>
            <li><a style="color:var(--gold-bright)" href="account.html">› Change password</a></li>
            <li><a style="color:var(--gold-bright)" href="../events/index.html">› Upcoming events</a></li>
            <li><a style="color:var(--gold-bright)" href="../donate.html">› Sponsor / donate</a></li>
          </ul>
        </aside>
      </div>`;
    bindLogout();
  }

  // ── Image upload helper (file → data URL → /api/me/asset → url) ──
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
    });
  }
  async function uploadImage(file, kind) {
    const dataUrl = await fileToDataUrl(file);
    const res = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind, dataUrl }) });
    return res.url; // e.g. /api/assets/asset-xxxx
  }

  // ── Edit profile (rich) ──
  async function initProfile() {
    let data; try { data = await api('/api/me'); } catch (e) { return; }
    const m = data.member;
    const form = document.getElementById('profileForm');
    if (!m) { form.innerHTML = '<div class="notice">No listing linked to your account yet — contact the Chamber.</div>'; return; }
    const msg = document.getElementById('profileMsg');

    // scalar fields
    form.querySelectorAll('[data-field]').forEach((el) => { el.value = m[el.dataset.field] || ''; });
    // categories (choose up to 3) — primary is the first
    let catList = [];
    try { catList = (await api('/api/categories')).categories || []; } catch (e) {}
    const picker = document.getElementById('categoryPicker');
    const selected = (Array.isArray(m.categories) && m.categories.length) ? m.categories.slice(0, 3) : (m.category ? [m.category] : []);
    function renderCats() {
      if (!picker) return;
      const optsFor = (sel) => '<option value="">— none —</option>'
        + catList.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')
        + ((sel && !catList.includes(sel)) ? `<option selected>${esc(sel)}</option>` : '');
      picker.innerHTML = [0, 1, 2].map((i) =>
        `<select data-cat="${i}" style="width:100%;margin-bottom:6px;padding:8px;border:1px solid var(--line,#d7d2c6);border-radius:8px">${optsFor(selected[i] || '')}</select>`).join('')
        + '<div class="member-tile__meta">Your first category is your primary listing.</div>';
      picker.querySelectorAll('[data-cat]').forEach((sel) => sel.addEventListener('change', () => { selected[+sel.dataset.cat] = sel.value; }));
    }
    renderCats();
    // social + review links
    form.querySelectorAll('[data-social]').forEach((el) => { el.value = (m.social || {})[el.dataset.social] || ''; });
    form.querySelectorAll('[data-review]').forEach((el) => { el.value = (m.reviewLinks || {})[el.dataset.review] || ''; });
    // CTAs (up to 3)
    const ctas = m.ctaLinks || [];
    form.querySelectorAll('[data-cta-label]').forEach((el, i) => { el.value = ctas[i] ? ctas[i].label : ''; });
    form.querySelectorAll('[data-cta-url]').forEach((el, i) => { el.value = ctas[i] ? ctas[i].url : ''; });
    // logo
    let logoUrl = m.logo || '';
    const logoPrev = document.getElementById('logoPreview');
    const renderLogo = () => { if (logoPrev) logoPrev.innerHTML = logoUrl ? `<img src="${esc(logoUrl)}" alt="logo" style="width:90px;height:90px;border-radius:12px;object-fit:cover">` : '<span class="member-tile__meta">No logo yet</span>'; };
    renderLogo();
    const logoInput = document.getElementById('logoFile');
    if (logoInput) logoInput.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      msg.hidden = false; msg.style.borderColor = 'var(--line)'; msg.textContent = 'Uploading logo…';
      try { logoUrl = await uploadImage(f, 'logo'); renderLogo(); msg.textContent = 'Logo uploaded — remember to Save.'; }
      catch (err) { msg.textContent = 'Logo upload failed (PNG/JPG, max ~2.5MB).'; }
    });
    // photos (up to 3 slots)
    let photos = Array.isArray(m.photos) ? m.photos.slice(0, 3) : [];
    const photoPrev = document.getElementById('photoPreview');
    const renderPhotos = () => { if (photoPrev) photoPrev.innerHTML = photos.map((p) => `<img src="${esc(p)}" alt="" style="width:80px;height:60px;border-radius:8px;object-fit:cover">`).join('') || '<span class="member-tile__meta">No photos yet</span>'; };
    renderPhotos();
    const photoInput = document.getElementById('photoFile');
    if (photoInput) photoInput.addEventListener('change', async (e) => {
      const files = [...e.target.files].slice(0, 3 - photos.length);
      for (const f of files) { try { photos.push(await uploadImage(f, 'photo')); } catch (err) {} }
      renderPhotos();
      msg.hidden = false; msg.style.borderColor = 'var(--line)'; msg.textContent = 'Photos uploaded — remember to Save.';
    });

    // video live preview (YouTube/Vimeo) — value already populated by the field loader above
    const videoInput = form.querySelector('[data-field="video"]');
    const videoPrev = document.getElementById('videoPreview');
    const renderVideo = () => {
      if (!videoPrev) return;
      const u = ((videoInput && videoInput.value) || '').trim();
      const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/i);
      const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
      const src = yt ? 'https://www.youtube.com/embed/' + yt[1] : (vm ? 'https://player.vimeo.com/video/' + vm[1] : '');
      videoPrev.innerHTML = src
        ? `<div style="position:relative;width:100%;max-width:440px;aspect-ratio:16/9;border-radius:12px;overflow:hidden;box-shadow:var(--sh-sm)"><iframe src="${src}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowfullscreen loading="lazy"></iframe></div>`
        : (u ? '<span class="member-tile__meta">Paste a YouTube or Vimeo link to preview it here.</span>' : '');
    };
    if (videoInput) { videoInput.addEventListener('input', renderVideo); renderVideo(); }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = {};
      form.querySelectorAll('[data-field]').forEach((el) => { patch[el.dataset.field] = el.value; });
      patch.categories = [...new Set([0, 1, 2].map((i) => (picker && picker.querySelector(`[data-cat="${i}"]`) ? picker.querySelector(`[data-cat="${i}"]`).value : '').trim()).filter(Boolean))];
      patch.social = {}; form.querySelectorAll('[data-social]').forEach((el) => { if (el.value) patch.social[el.dataset.social] = el.value; });
      patch.reviewLinks = {}; form.querySelectorAll('[data-review]').forEach((el) => { if (el.value) patch.reviewLinks[el.dataset.review] = el.value; });
      patch.ctaLinks = [];
      const labels = [...form.querySelectorAll('[data-cta-label]')]; const urls = [...form.querySelectorAll('[data-cta-url]')];
      labels.forEach((el, i) => { if (el.value && urls[i] && urls[i].value) patch.ctaLinks.push({ label: el.value, url: urls[i].value }); });
      patch.logo = logoUrl; patch.photos = photos;
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api('/api/me/profile', { method: 'PATCH', body: JSON.stringify(patch) });
        msg.hidden = false; msg.style.borderColor = 'var(--green)'; msg.textContent = 'Saved — your listing is updated.';
      } catch (err) { msg.hidden = false; msg.style.borderColor = 'var(--red)'; msg.textContent = 'Could not save. Please try again.'; }
      finally { btn.disabled = false; btn.textContent = 'Save changes'; }
    });
  }

  // ── Account (password) ──
  async function initAccount() {
    try { await api('/api/me'); } catch (e) { return; }
    const form = document.getElementById('pwForm'); const msg = document.getElementById('pwMsg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = form.querySelector('[name="password"]').value;
      const pw2 = form.querySelector('[name="confirm"]').value;
      msg.hidden = false;
      if (pw !== pw2) { msg.style.borderColor = 'var(--red)'; msg.textContent = 'Passwords do not match.'; return; }
      try {
        await api('/api/auth/set-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
        msg.style.borderColor = 'var(--green)'; msg.textContent = 'Password updated.'; form.reset();
      } catch (err) { msg.style.borderColor = 'var(--red)'; msg.textContent = 'Could not update (min 8 characters).'; }
    });
  }

  // ── Submit an offer or community post ──
  async function initPost() {
    try { await api('/api/me'); } catch (e) { return; }
    const form = document.getElementById('postForm');
    const msg = document.getElementById('postMsg');
    let imageUrl = '';
    const imgInput = document.getElementById('postImage');
    if (imgInput) imgInput.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      msg.hidden = false; msg.style.borderColor = 'var(--line)'; msg.textContent = 'Uploading image…';
      try { const r = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl: await fileToDataUrl(f) }) }); imageUrl = r.url; msg.textContent = 'Image attached.'; }
      catch (err) { msg.textContent = 'Image upload failed.'; }
    });
    // Show/hide the per-type field groups as the member switches type.
    const TYPE_LABEL = { discount: 'Offer', member_post: 'Community post', job: 'Job opening', listing: 'Property listing' };
    const TITLE_LABEL = { discount: 'Title', member_post: 'Title', job: 'Position title', listing: 'Listing headline' };
    const syncTypeFields = () => {
      const t = (form.querySelector('input[name="type"]:checked') || {}).value || 'discount';
      form.querySelectorAll('[data-type-fields]').forEach((d) => { d.hidden = d.getAttribute('data-type-fields') !== t; });
      const tl = form.querySelector('[data-label-title]');
      if (tl) tl.textContent = TITLE_LABEL[t] || 'Title';
    };
    form.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', syncTypeFields));
    syncTypeFields();

    // load my posts with statuses
    try {
      const mine = (await api('/api/me/posts')).posts || [];
      const list = document.getElementById('myPosts');
      if (list) list.innerHTML = mine.length ? mine.map((p) => `
        <div class="card" style="padding:var(--s-4)">
          <div style="display:flex;justify-content:space-between;gap:var(--s-3)">
            <strong>${esc(p.title)}</strong>
            <span class="badge ${p.status === 'approved' ? 'badge--gold' : p.status === 'rejected' ? 'badge--bronze' : ''}">${esc(p.status)}</span>
          </div>
          <div class="member-tile__meta">${esc(TYPE_LABEL[p.type] || p.type)}</div>
        </div>`).join('') : '<p class="member-tile__meta">You haven\'t posted anything yet.</p>';
    } catch (e) {}

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { type: fd.get('type'), title: fd.get('title'), body: fd.get('body'), imageUrl };
      body.ctaLabel = fd.get('ctaLabel'); body.ctaUrl = fd.get('ctaUrl');
      if (body.type === 'discount') body.code = fd.get('code');
      if (body.type === 'member_post') body.linkUrl = fd.get('ctaUrl');
      if (body.type === 'job') body.meta = {
        jobType: fd.get('jobType'), location: fd.get('jobLocation'),
        payRange: fd.get('payRange'), applyEmail: fd.get('applyEmail'),
      };
      if (body.type === 'listing') body.meta = {
        listingType: fd.get('listingType'), dealType: fd.get('dealType'), price: fd.get('price'),
        address: fd.get('listingAddress'), beds: fd.get('beds'), baths: fd.get('baths'), sqft: fd.get('sqft'),
      };
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        await api('/api/me/post', { method: 'POST', body: JSON.stringify(body) });
        msg.hidden = false; msg.style.borderColor = 'var(--green)'; msg.textContent = 'Submitted! The Chamber will review it before it goes live.';
        form.reset(); imageUrl = '';
      } catch (err) { msg.hidden = false; msg.style.borderColor = 'var(--red)'; msg.textContent = 'Could not submit (title and details are required).'; }
      finally { btn.disabled = false; btn.textContent = 'Submit for review'; }
    });
  }

  return { initDashboard, initProfile, initAccount, initPost, logout, esc };
})();
