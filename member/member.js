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
    // canPost = any member with a listing may add events (leaders publish
    // immediately; others go to the office queue) — restores member self-serve.
    let isLeader = false;
    try { const il = await api('/api/me/is-leader'); isLeader = !!(il.canSubmit || il.leader); } catch (e) {}
    const bindLogout = () => document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); logout(); }));

    document.getElementById('welcome').textContent = member ? member.name : user.email;
    const wrap = document.getElementById('memberBody');

    if (!member) {
      wrap.innerHTML = `<div class="notice">Your login isn't linked to a directory listing yet. Contact the Chamber office at (818) 347-4737 and we'll connect it.</div>`;
      bindLogout(); return;
    }
    const status = member.status || 'approved';
    // Welcome + getting-started guide — a checklist that reflects what's actually
    // filled in, so new members know exactly how to complete their listing.
    const steps = [
      { done: !!member.logo, label: 'Add your business logo', href: 'profile.html#logo' },
      { done: !!member.tagline, label: 'Write a one-line tagline', href: 'profile.html' },
      { done: !!(member.services || member.description), label: 'Describe your services', href: 'profile.html' },
      { done: !!(member.accomplishments || member.associations), label: 'Add accomplishments & associations', href: 'profile.html' },
      { done: !!(member.social && Object.keys(member.social).length), label: 'Add your social media links', href: 'profile.html' },
      { done: !!(member.photos && member.photos.length), label: 'Upload photos to your gallery', href: 'profile.html' },
    ];
    const doneCount = steps.filter((s) => s.done).length;
    const allDone = doneCount === steps.length;
    const firstName = (member.contactName || member.name || '').split(' ')[0] || member.name;
    const gettingStarted = `
      <div class="card" style="border-left:4px solid var(--gold,#c8a24a);margin-bottom:var(--s-6)">
        <span class="kicker">Welcome to the Chamber</span>
        <h2 style="margin:4px 0 2px">Welcome, ${esc(firstName)}! 🌿</h2>
        <p class="member-tile__meta">${allDone
          ? "Your listing is complete — you're all set. You can update it anytime below."
          : `Let's get your business listing looking its best. You've completed <strong>${doneCount} of ${steps.length}</strong> steps.`}</p>
        ${allDone ? '' : `
        <div style="height:8px;background:var(--cream-deep,#f0e9d6);border-radius:99px;overflow:hidden;margin:12px 0 16px" role="progressbar" aria-valuenow="${doneCount}" aria-valuemax="${steps.length}">
          <div style="height:100%;width:${Math.round((doneCount / steps.length) * 100)}%;background:var(--green,#1E5631)"></div>
        </div>
        <ul style="list-style:none;display:grid;gap:9px;margin:0;padding:0">
          ${steps.map((s) => `<li style="display:flex;align-items:center;gap:10px">
            <span aria-hidden="true" style="flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:.78rem;${s.done ? 'background:var(--green,#1E5631);color:#fff' : 'background:var(--cream-deep,#f0e9d6);color:var(--slate-mid,#6b7a72)'}">${s.done ? '✓' : '○'}</span>
            ${s.done
              ? `<span style="color:var(--slate-mid,#6b7a72);text-decoration:line-through">${esc(s.label)}</span>`
              : `<a href="${s.href}" style="color:var(--green-ink,#12241a);font-weight:600;text-decoration:none">${esc(s.label)} →</a>`}
          </li>`).join('')}
        </ul>`}
        <div class="btn-row mt-4">
          <a class="btn btn--forest btn--sm" href="profile.html">${allDone ? 'Edit my profile' : 'Complete my profile'}</a>
          ${isLeader ? '<a class="btn btn--gold btn--sm" href="event.html">＋ Add an event to the calendar</a>' : ''}
          <button type="button" class="btn btn--ghost btn--sm" onclick="if(window.WVTour)WVTour.start('member')">Take a quick tour</button>
          <span class="member-tile__meta" style="align-self:center">Need help? Use the <strong>🛟 Support</strong> button (bottom-left).</span>
        </div>
      </div>`;
    wrap.innerHTML = `
      ${gettingStarted}
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
            ${isLeader ? '<a class="btn btn--gold" href="event.html">＋ Add an event</a>' : ''}
          </div>
        </div>
        <aside class="card bg-forest" style="color:#fff">
          <span class="hero__feature-label">Membership</span>
          <h3 style="color:#fff;margin-top:8px">${esc(TIER_LABEL(member.tier))}</h3>
          <p style="color:rgba(255,255,255,.85)">Status: <strong style="text-transform:capitalize">${esc(status)}</strong></p>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;margin-top:var(--s-3)">
            <li><a style="color:var(--gold-bright)" href="profile.html">› Update profile</a></li>
            <li><a style="color:var(--gold-bright)" href="post.html">› Post an offer / community</a></li>
            ${isLeader ? '<li><a style="color:var(--gold-bright)" href="event.html">› Add an event to the calendar</a></li>' : ''}
            <li><a style="color:var(--gold-bright)" href="account.html">› Change password</a></li>
            <li><a style="color:var(--gold-bright)" href="../events/index.html">› Upcoming events</a></li>
            <li><a style="color:var(--gold-bright)" href="../donate.html">› Sponsor / donate</a></li>
          </ul>
        </aside>
      </div>
      <div id="volunteerBlock" class="mt-6"></div>`;
    bindLogout();
    mountVolunteer();
  }

  /* ── Volunteer sign-up (ambassador tracker, Felicia Jul 29 2026) ──
     "There's a way for me to sign in and say I'm volunteering for this event."
     Shows the open jobs on upcoming events, what each is worth, and the
     member's own running total and tier. */
  async function mountVolunteer() {
    const host = document.getElementById('volunteerBlock');
    if (!host) return;
    let openings = { events: [] };
    let me = { mine: [], points: 0, tier: '' };
    try {
      [openings, me] = await Promise.all([
        api('/api/me/volunteer/openings').catch(() => ({ events: [] })),
        api('/api/me/volunteer').catch(() => ({ mine: [], points: 0, tier: '' })),
      ]);
    } catch (e) { return; }
    const evs = openings.events || [];
    const mine = me.mine || [];
    // Nothing to volunteer for and no history → don't clutter the dashboard.
    if (!evs.length && !mine.length) return;

    const claimed = new Set(mine.map((m) => `${m.eventId}|${m.role}`));
    const upcomingMine = mine.filter((m) => !m.eventDate || m.eventDate >= new Date().toISOString().slice(0, 10));

    host.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:var(--s-4);flex-wrap:wrap">
          <div>
            <span class="kicker">Ambassadors</span>
            <h2 style="margin:4px 0">Volunteer at an event</h2>
            <p class="member-tile__meta">Pick a job and we'll put you down for it. The Chamber office sees exactly who's covering what.</p>
          </div>
          <div style="text-align:right">
            <div style="font-size:2rem;font-weight:700;color:var(--green-ink,#12241a);line-height:1">${esc(me.points || 0)}</div>
            <div class="member-tile__meta">points${me.tier ? ` · <strong>${esc(me.tier)}</strong>` : ''}</div>
          </div>
        </div>

        ${upcomingMine.length ? `<div class="notice mt-4" style="border-color:var(--green)">
          <strong>You're signed up for:</strong>
          <ul style="margin:6px 0 0;padding-left:18px">
            ${upcomingMine.map((m) => `<li>${esc(m.role)} — ${esc(m.eventTitle)}${m.eventDate ? ` (${esc(m.eventDate)})` : ''}
              <button type="button" data-vcancel="${esc(m.id)}" class="btn btn--ghost btn--sm" style="margin-left:6px;color:var(--red)">Cancel</button></li>`).join('')}
          </ul></div>` : ''}

        ${evs.length ? `<div class="mt-5" style="display:flex;flex-direction:column;gap:var(--s-4)">
          ${evs.map((e) => `<div style="border:1px solid var(--line);border-radius:var(--r-md);padding:var(--s-4)">
            <strong>${esc(e.title)}</strong>
            <div class="member-tile__meta">${esc(e.date)}${e.time ? ' · ' + esc(e.time) : ''}${e.venue ? ' · ' + esc(e.venue) : ''}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
              ${e.roles.map((r) => {
                const isMine = claimed.has(`${e.id}|${r.role}`);
                const full = r.open <= 0;
                return `<button type="button" class="chip" ${isMine || full ? 'disabled' : ''}
                  data-vsign="${esc(e.id)}" data-vrole="${esc(r.role)}"
                  style="${isMine ? 'background:var(--green);color:#fff;border-color:var(--green)' : full ? 'opacity:.5;cursor:not-allowed' : 'cursor:pointer'}"
                  title="${isMine ? "You're signed up for this" : full ? 'Already covered' : `${r.points} points`}">
                  ${isMine ? '✓ ' : ''}${esc(r.role)} · ${esc(r.points)} pts${full && !isMine ? ' · covered' : (isMine ? '' : ` · ${esc(r.open)} needed`)}
                </button>`;
              }).join('')}
            </div>
          </div>`).join('')}
        </div>` : '<p class="member-tile__meta mt-4">No events need volunteers right now — check back soon.</p>'}

        <p id="volMsg" class="notice mt-4" hidden></p>
        ${mine.length ? `<p class="member-tile__meta mt-4">You've helped at ${mine.length} shift${mine.length === 1 ? '' : 's'}. Thank you 🌿</p>` : ''}
      </div>`;

    const msg = document.getElementById('volMsg');
    const say = (t, bad) => { msg.hidden = !t; msg.textContent = t || ''; msg.style.borderColor = bad ? 'var(--red)' : 'var(--green)'; msg.style.color = bad ? 'var(--red)' : ''; };

    host.querySelectorAll('[data-vsign]').forEach((b) => b.addEventListener('click', async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        const r = await fetch(base + '/api/me/volunteer', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: b.dataset.vsign, role: b.dataset.vrole }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) { say(d.error || 'Could not sign you up.', true); b.disabled = false; return; }
        say(`You're down for "${b.dataset.vrole}" — thank you!`);
        mountVolunteer();
      } catch (e) { say('Could not reach the Chamber right now.', true); b.disabled = false; }
    }));
    host.querySelectorAll('[data-vcancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Cancel this volunteer shift?')) return;
      try {
        await api('/api/me/volunteer/' + encodeURIComponent(b.dataset.vcancel), { method: 'DELETE' });
        mountVolunteer();
      } catch (e) { say('Could not cancel that shift.', true); }
    }));
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
      msg.hidden = false; msg.style.borderColor = 'var(--line)'; msg.textContent = 'Uploading directory image…';
      try { logoUrl = await uploadImage(f, 'logo'); renderLogo(); msg.textContent = 'Directory image uploaded — remember to Save.'; }
      catch (err) { msg.textContent = 'Upload failed (PNG/JPG, max ~2.5MB).'; }
    });
    // Page Image — headshot used on the Board / Ambassador / Leaders pages.
    let pageImageUrl = m.pageImage || '';
    const piPrev = document.getElementById('pageImagePreview');
    const renderPageImage = () => { if (piPrev) piPrev.innerHTML = pageImageUrl ? `<img src="${esc(pageImageUrl)}" alt="page image" style="width:90px;height:90px;border-radius:50%;object-fit:cover">` : '<span class="member-tile__meta">No page image yet</span>'; };
    renderPageImage();
    const piInput = document.getElementById('pageImageFile');
    if (piInput) piInput.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      msg.hidden = false; msg.style.borderColor = 'var(--line)'; msg.textContent = 'Uploading page image…';
      try { pageImageUrl = await uploadImage(f, 'headshot'); renderPageImage(); msg.textContent = 'Page image uploaded — remember to Save.'; }
      catch (err) { msg.textContent = 'Upload failed (PNG/JPG, max ~2.5MB).'; }
    });
    // photos (up to 3 slots)
    let photos = Array.isArray(m.photos) ? m.photos.slice(0, 3) : [];
    const photoPrev = document.getElementById('photoPreview');
    const renderPhotos = () => {
      if (!photoPrev) return;
      photoPrev.innerHTML = photos.length
        ? photos.map((p, i) => `<span style="position:relative;display:inline-block;margin:0 6px 6px 0"><img src="${esc(p)}" alt="" style="width:80px;height:60px;border-radius:8px;object-fit:cover"><button type="button" data-rmphoto="${i}" title="Remove this photo" aria-label="Remove photo" style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;border:0;background:#c0392b;color:#fff;font-size:14px;line-height:1;cursor:pointer">×</button></span>`).join('')
        : '<span class="member-tile__meta">No photos yet</span>';
      photoPrev.querySelectorAll('[data-rmphoto]').forEach((b) => b.addEventListener('click', () => { photos.splice(Number(b.dataset.rmphoto), 1); renderPhotos(); }));
    };
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

    // ── Team members (optional) ──
    let team = Array.isArray(m.team) ? m.team.slice(0, 8) : [];
    const teamWrap = document.getElementById('teamRows');
    const teamRowHtml = (t, i) => `
      <div class="card" data-team-row="${i}" style="padding:var(--s-4);margin-bottom:var(--s-3)">
        <div class="grid grid-2" style="gap:var(--s-3)">
          <div class="field"><label>Name</label><input data-team-name value="${esc(t.name || '')}" /></div>
          <div class="field"><label>Title</label><input data-team-title value="${esc(t.title || '')}" /></div>
        </div>
        <div class="field"><label>Short bio</label><textarea data-team-bio rows="2">${esc(t.bio || '')}</textarea></div>
        <div class="grid grid-2" style="gap:var(--s-4);align-items:center">
          <div class="field"><label>Photo</label><input type="file" accept="image/*" data-team-photo-file /></div>
          <div>${t.photo ? `<img src="${esc(t.photo)}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover">` : '<span class="member-tile__meta">No photo</span>'}</div>
        </div>
        <input type="hidden" data-team-photo value="${esc(t.photo || '')}" />
        <div style="text-align:right">
          ${i === 0 ? '<span class="member-tile__meta" style="margin-right:8px">Primary — shown as “Meet…”</span>' : ''}
          <button type="button" class="btn btn--ghost btn--sm" data-team-remove>Remove</button>
        </div>
      </div>`;
    const collectRow = (i) => {
      const row = teamWrap.querySelector(`[data-team-row="${i}"]`);
      if (!row) return team[i] || {};
      return {
        name: row.querySelector('[data-team-name]').value.trim(),
        title: row.querySelector('[data-team-title]').value.trim(),
        bio: row.querySelector('[data-team-bio]').value.trim(),
        photo: row.querySelector('[data-team-photo]').value.trim(),
      };
    };
    const collectTeam = () => team.map((_, i) => collectRow(i)).filter((t) => t.name);
    function renderTeam() {
      if (!teamWrap) return;
      teamWrap.innerHTML = team.length
        ? team.map(teamRowHtml).join('')
        : '<p class="member-tile__meta">No team members yet. They appear in a “Meet the team” section on your public page.</p>';
      teamWrap.querySelectorAll('[data-team-remove]').forEach((b, i) =>
        b.addEventListener('click', () => { team = collectTeam(); team.splice(i, 1); renderTeam(); }));
      teamWrap.querySelectorAll('[data-team-photo-file]').forEach((inp, i) =>
        inp.addEventListener('change', async (e) => {
          const f = e.target.files[0]; if (!f) return;
          try { const url = await uploadImage(f, 'headshot'); team = collectTeam(); team[i] = { ...(team[i] || {}), photo: url }; renderTeam(); }
          catch (err) { msg.hidden = false; msg.style.borderColor = 'var(--red)'; msg.textContent = 'Photo upload failed (PNG/JPG, max ~2.5MB).'; }
        }));
    }
    renderTeam();
    const addTeamBtn = document.getElementById('addTeam');
    if (addTeamBtn) addTeamBtn.addEventListener('click', () => {
      team = collectTeam();
      if (team.length >= 8) return;
      team.push({ name: '', title: '', bio: '', photo: '' });
      renderTeam();
    });

    // primary image preference (default to whichever image exists)
    const primaryDefault = m.primaryImage || (m.logo ? 'logo' : ((team[0] && team[0].photo) ? 'person' : 'logo'));
    form.querySelectorAll('[data-primary]').forEach((r) => { r.checked = (r.value === primaryDefault); });

    // ── AI: draft a tagline + description (does not save) ──
    const aiBtn = document.getElementById('aiRewrite');
    const aiPrev = document.getElementById('aiPreview');
    const descEl = form.querySelector('[data-field="description"]');
    const tagEl = form.querySelector('[data-field="tagline"]');
    if (aiBtn) aiBtn.addEventListener('click', async () => {
      aiBtn.disabled = true; const orig = aiBtn.textContent; aiBtn.textContent = 'Thinking…';
      try {
        const r = await api('/api/me/profile/ai-rewrite', {
          method: 'POST',
          body: JSON.stringify({ field: 'both', current: { tagline: tagEl.value, description: descEl.value } }),
        });
        if (r.unavailable) {
          aiPrev.hidden = false; aiPrev.className = 'notice'; aiPrev.textContent = r.message || 'AI is unavailable right now.';
          return;
        }
        aiPrev.hidden = false; aiPrev.className = 'card'; aiPrev.style.padding = 'var(--s-4)';
        aiPrev.innerHTML = `
          <div class="member-tile__meta">Suggested tagline</div><p>${esc(r.tagline || '(unchanged)')}</p>
          <div class="member-tile__meta">Suggested description</div><p>${esc(r.description || '(unchanged)')}</p>
          <div class="btn-row" style="margin-top:var(--s-3)">
            <button type="button" class="btn btn--forest btn--sm" data-ai-use>Use this</button>
            <button type="button" class="btn btn--ghost btn--sm" data-ai-cancel>Cancel</button>
          </div>`;
        aiPrev.querySelector('[data-ai-use]').addEventListener('click', () => {
          if (r.tagline) tagEl.value = r.tagline;
          if (r.description) descEl.value = r.description;
          aiPrev.hidden = true;
        });
        aiPrev.querySelector('[data-ai-cancel]').addEventListener('click', () => { aiPrev.hidden = true; });
      } catch (e) {
        aiPrev.hidden = false; aiPrev.className = 'notice'; aiPrev.textContent = 'Could not reach the AI service.';
      } finally { aiBtn.disabled = false; aiBtn.textContent = orig; }
    });

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
      patch.logo = logoUrl; patch.pageImage = pageImageUrl; patch.photos = photos;
      patch.team = collectTeam();
      const primarySel = form.querySelector('[data-primary]:checked');
      if (primarySel) patch.primaryImage = primarySel.value;
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

    // ── My posts: edit, repost, remove (Felicia, Jul 29 2026) ──
    // A member can now manage what they put up instead of emailing the office
    // to change a typo. Editing sends it back through staff review.
    let editingId = null;
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitLabel = submitBtn ? submitBtn.textContent : 'Submit';
    const stopEditing = () => {
      editingId = null;
      if (submitBtn) submitBtn.textContent = submitLabel;
      const c = document.getElementById('postCancelEdit');
      if (c) c.remove();
    };
    const startEditing = (p, duplicate) => {
      editingId = duplicate ? null : p.id;
      const radio = form.querySelector(`input[name="type"][value="${p.type}"]`);
      if (radio) { radio.checked = true; syncTypeFields(); }
      form.querySelector('[name="title"]').value = duplicate ? `${p.title} (copy)` : (p.title || '');
      form.querySelector('[name="body"]').value = p.body || '';
      const setIf = (n, v) => { const el = form.querySelector(`[name="${n}"]`); if (el) el.value = v || ''; };
      setIf('ctaLabel', p.ctaLabel); setIf('ctaUrl', p.ctaUrl || p.linkUrl); setIf('code', p.code);
      const m = p.meta || {};
      setIf('jobType', m.jobType); setIf('jobLocation', m.location); setIf('payRange', m.payRange); setIf('applyEmail', m.applyEmail);
      setIf('listingType', m.listingType); setIf('dealType', m.dealType); setIf('price', m.price);
      setIf('listingAddress', m.address); setIf('beds', m.beds); setIf('baths', m.baths); setIf('sqft', m.sqft);
      imageUrl = p.imageUrl || '';
      if (submitBtn) submitBtn.textContent = editingId ? 'Save changes (goes back for review)' : 'Submit the copy for review';
      if (submitBtn && !document.getElementById('postCancelEdit')) {
        const c = document.createElement('button');
        c.type = 'button'; c.id = 'postCancelEdit'; c.className = 'btn btn--ghost';
        c.style.marginLeft = '8px'; c.textContent = 'Cancel';
        c.addEventListener('click', () => { form.reset(); imageUrl = ''; syncTypeFields(); stopEditing(); });
        submitBtn.insertAdjacentElement('afterend', c);
      }
      msg.hidden = false; msg.style.borderColor = 'var(--gold)';
      msg.textContent = editingId
        ? 'Editing your posting below. Saving sends it back to Chamber staff for a quick review.'
        : 'Copied into the form below — change what you need, then submit it.';
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    async function loadMine() {
      const list = document.getElementById('myPosts');
      if (!list) return;
      let mine = [];
      try { mine = (await api('/api/me/posts')).posts || []; } catch (e) { return; }
      list.innerHTML = mine.length ? mine.map((p) => `
        <div class="card" style="padding:var(--s-4)" data-post="${esc(p.id)}">
          <div style="display:flex;justify-content:space-between;gap:var(--s-3)">
            <strong>${esc(p.title)}</strong>
            <span class="badge ${p.status === 'approved' ? 'badge--gold' : p.status === 'rejected' ? 'badge--bronze' : ''}">${esc(p.status)}</span>
          </div>
          <div class="member-tile__meta">${esc(TYPE_LABEL[p.type] || p.type)}${p.created ? ' · ' + new Date(p.created).toLocaleDateString() : ''}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
            <button type="button" class="btn btn--ghost btn--sm" data-pedit>Edit</button>
            <button type="button" class="btn btn--ghost btn--sm" data-pdupe title="Start a new posting from this one">Repost / duplicate</button>
            <button type="button" class="btn btn--ghost btn--sm" data-pdel style="color:var(--red)">Remove</button>
          </div>
        </div>`).join('') : '<p class="member-tile__meta">You haven\'t posted anything yet.</p>';

      list.querySelectorAll('[data-post]').forEach((card) => {
        const p = mine.find((x) => x.id === card.dataset.post);
        card.querySelector('[data-pedit]')?.addEventListener('click', () => startEditing(p, false));
        card.querySelector('[data-pdupe]')?.addEventListener('click', () => startEditing(p, true));
        card.querySelector('[data-pdel]')?.addEventListener('click', async () => {
          if (!confirm(`Remove "${p.title}"?\n\nIt comes off the website right away and can't be undone.`)) return;
          try {
            await api('/api/me/post/' + encodeURIComponent(p.id), { method: 'DELETE' });
            if (editingId === p.id) { form.reset(); imageUrl = ''; syncTypeFields(); stopEditing(); }
            msg.hidden = false; msg.style.borderColor = 'var(--green)'; msg.textContent = 'Removed.';
            loadMine();
          } catch (err) { msg.hidden = false; msg.style.borderColor = 'var(--red)'; msg.textContent = 'Could not remove that posting.'; }
        });
      });
    }
    await loadMine();

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
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      // Captured so a FAILED save puts the button back the way it was; a
      // successful one is relabelled by stopEditing() instead.
      const wasLabel = btn.textContent;
      let ok = false;
      btn.textContent = editingId ? 'Saving…' : 'Submitting…';
      try {
        if (editingId) {
          await api('/api/me/post/' + encodeURIComponent(editingId), { method: 'PATCH', body: JSON.stringify(body) });
          msg.hidden = false; msg.style.borderColor = 'var(--green)';
          msg.textContent = 'Saved — it goes back to Chamber staff for a quick review, then updates on the site.';
        } else {
          await api('/api/me/post', { method: 'POST', body: JSON.stringify(body) });
          msg.hidden = false; msg.style.borderColor = 'var(--green)'; msg.textContent = 'Submitted! The Chamber will review it before it goes live.';
        }
        ok = true;
        form.reset(); imageUrl = ''; syncTypeFields(); stopEditing();
        loadMine();
      } catch (err) { msg.hidden = false; msg.style.borderColor = 'var(--red)'; msg.textContent = 'Could not submit (title and details are required).'; }
      finally { btn.disabled = false; if (!ok) btn.textContent = wasLabel; }
    });
  }

  // ── Add an event (group leaders publish straight to the calendar) ──
  async function initEventForm() {
    let data; try { data = await api('/api/me/events'); } catch (e) { return; }
    const form = document.getElementById('eventForm');
    const gate = document.getElementById('eventGate');
    const msg = document.getElementById('eventMsg');
    const listEl = document.getElementById('myEvents');

    function renderMyEvents(events) {
      if (!listEl) return;
      if (!events || !events.length) { listEl.innerHTML = ''; return; }
      const seen = new Set(); const rows = [];
      for (const ev of events) {
        const key = ev.seriesId || ev.id;
        if (seen.has(key)) continue; seen.add(key);
        const count = ev.seriesId ? events.filter((e) => e.seriesId === ev.seriesId).length : 1;
        const host = ev.hostName || ev.groupName || '';
        rows.push(`<div class="card" style="padding:var(--s-4);margin-bottom:var(--s-3);display:flex;justify-content:space-between;align-items:center;gap:var(--s-3)">
          <div><strong>${esc(ev.title)}</strong>${host ? ` <span class="badge badge--gold" style="font-size:.62rem;vertical-align:middle">${esc(host)}</span>` : ''}<div class="member-tile__meta">${esc(ev.date || '')}${ev.time ? ' · ' + esc(ev.time) : ''}${count > 1 ? ' · repeats weekly (' + count + ' dates)' : ''}${ev.venue ? ' · ' + esc(ev.venue) : ''}</div></div>
          <button class="btn btn--ghost btn--sm" data-del="${esc(ev.id)}">Remove</button></div>`);
      }
      listEl.innerHTML = '<h3>Your events on the calendar</h3>' + rows.join('');
      listEl.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Remove this event (and all of its weekly repeat dates) from the calendar?')) return;
        b.disabled = true;
        try { await api('/api/me/event/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); const d = await api('/api/me/events'); renderMyEvents(d.events || []); }
        catch (e) { b.disabled = false; alert('Could not remove the event.'); }
      }));
    }

    // Any member with a listing can submit an event. Leaders/board/chairs
    // publish immediately; everyone else's event is reviewed by the office
    // before it goes live (per the office, Jul 16 — restores the old site's
    // "members post their own events" with a quick approval step).
    if (!data.canSubmit) {
      if (gate) { gate.hidden = false; gate.innerHTML = 'Your login isn\'t linked to a member listing yet. Call the Chamber office at (818) 347-4737 and we\'ll connect it so you can post events.'; }
      renderMyEvents(data.events || []);
      return;
    }
    if (gate && !data.isLeader) { gate.hidden = false; gate.style.background = 'var(--cream,#faf6ea)'; gate.innerHTML = '✓ You can add your events here. Because you\'re not a group leader, each one is quickly reviewed by the Chamber office before it appears on the public calendar.'; }
    if (form) form.hidden = false;

    // "Posting as" — a chair chooses whether this event is on behalf of their
    // business or a group they lead (replaces the old two-logins setup).
    const identities = Array.isArray(data.identities) ? data.identities : [];
    const postAsField = document.getElementById('postAsField');
    const postAsSelect = document.getElementById('postAsSelect');
    const postAsHint = document.getElementById('postAsHint');
    if (postAsSelect && identities.length) {
      postAsSelect.innerHTML = identities.map((i) =>
        `<option value="${esc(i.key)}">${i.kind === 'group' ? esc(i.name) + ' (group)' : esc(i.name) + ' (my business)'}</option>`).join('');
      const drawHint = () => {
        const cur = identities.find((i) => i.key === postAsSelect.value) || identities[0];
        postAsHint.textContent = cur && cur.kind === 'group'
          ? 'This event will show “Hosted by ' + cur.name + '” and appear on that group’s page.'
          : 'This event will show “Hosted by ' + (cur ? cur.name : 'your business') + '.”';
      };
      // Only worth showing the picker when there's an actual choice to make.
      if (identities.length > 1 && postAsField) { postAsField.hidden = false; drawHint(); postAsSelect.addEventListener('change', drawHint); }
    }

    const untilField = document.getElementById('untilField');
    form.querySelectorAll('input[name="recurrence"]').forEach((r) => r.addEventListener('change', () => {
      const weekly = (form.querySelector('input[name="recurrence"]:checked') || {}).value === 'weekly';
      if (untilField) untilField.hidden = !weekly;
    }));

    let flyerUrl = '';
    const flyerPrev = document.getElementById('flyerPreview');
    const flyerInput = document.getElementById('eventFlyer');
    if (flyerInput) flyerInput.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      msg.hidden = false; msg.style.borderColor = 'var(--line)'; msg.textContent = 'Uploading flyer…';
      try { flyerUrl = await uploadImage(f, 'photo'); if (flyerPrev) flyerPrev.innerHTML = `<img src="${esc(flyerUrl)}" alt="" style="width:90px;height:90px;border-radius:10px;object-fit:cover">`; msg.textContent = 'Flyer attached — remember to add the event.'; }
      catch (err) { msg.textContent = 'Flyer upload failed (PNG/JPG, max ~2.5MB).'; }
    });

    renderMyEvents(data.events || []);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      form.querySelectorAll('[data-ev]').forEach((el) => { body[el.dataset.ev] = el.value.trim(); });
      body.recurrence = (form.querySelector('input[name="recurrence"]:checked') || {}).value || 'none';
      if (flyerUrl) body.flyer = flyerUrl;
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'Adding…';
      try {
        const r = await api('/api/me/event', { method: 'POST', body: JSON.stringify(body) });
        msg.hidden = false; msg.style.borderColor = 'var(--green)';
        const many = r.count > 1 ? ('Your ' + r.count + ' dates were submitted') : 'Your event was submitted';
        msg.textContent = r.published
          ? (r.count > 1 ? ('Added ' + r.count + ' weekly dates to the calendar.') : 'Added to the calendar.')
          : (many + ' — the Chamber office will review it and it will appear on the calendar shortly.');
        form.reset(); if (flyerPrev) flyerPrev.innerHTML = ''; flyerUrl = ''; if (untilField) untilField.hidden = true;
        const d = await api('/api/me/events'); renderMyEvents(d.events || []);
      } catch (err) {
        msg.hidden = false; msg.style.borderColor = 'var(--red)';
        msg.textContent = 'Could not add the event. Check the title and date, then try again.';
      } finally { btn.disabled = false; btn.textContent = 'Add to calendar'; }
    });
  }

  return { initDashboard, initProfile, initAccount, initPost, initEventForm, logout, esc };
})();
