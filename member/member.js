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
    wrap.innerHTML = `
      <div class="grid" style="grid-template-columns:1.4fr .9fr;gap:var(--s-6);align-items:start">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;gap:var(--s-4);flex-wrap:wrap">
            <div>
              <span class="kicker">Your listing</span>
              <h2 style="margin:4px 0">${esc(member.name)}</h2>
              <div class="member-tile__meta">${esc(member.category || '')}${member.neighborhood ? ' · ' + esc(member.neighborhood) : ''}</div>
            </div>
            <span class="badge badge--${(member.tier || 'member')}">${esc(TIER_LABEL(member.tier))} Member</span>
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
            <li><a style="color:var(--gold-bright)" href="account.html">› Change password</a></li>
            <li><a style="color:var(--gold-bright)" href="../events/index.html">› Upcoming events</a></li>
            <li><a style="color:var(--gold-bright)" href="../donate.html">› Sponsor / donate</a></li>
          </ul>
        </aside>
      </div>`;
    bindLogout();
  }

  // ── Edit profile ──
  const FIELDS = [
    ['name', 'Business name'], ['category', 'Category'], ['neighborhood', 'Neighborhood'],
    ['contactName', 'Contact name'], ['phone', 'Phone'], ['website', 'Website'],
    ['address', 'Address'], ['city', 'City'], ['zip', 'ZIP'],
  ];
  async function initProfile() {
    let data; try { data = await api('/api/me'); } catch (e) { return; }
    const m = data.member;
    const form = document.getElementById('profileForm');
    if (!m) { form.innerHTML = '<div class="notice">No listing linked to your account yet — contact the Chamber.</div>'; return; }
    form.querySelectorAll('[data-field]').forEach((el) => { el.value = m[el.dataset.field] || ''; });
    const msg = document.getElementById('profileMsg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const patch = {};
      form.querySelectorAll('[data-field]').forEach((el) => { patch[el.dataset.field] = el.value; });
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await api('/api/me/profile', { method: 'PATCH', body: JSON.stringify(patch) });
        msg.hidden = false; msg.style.borderColor = 'var(--green)'; msg.textContent = 'Saved — your listing is updated.';
      } catch (err) { msg.hidden = false; msg.textContent = 'Could not save. Please try again.'; }
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

  return { initDashboard, initProfile, initAccount, logout, FIELDS, esc };
})();
