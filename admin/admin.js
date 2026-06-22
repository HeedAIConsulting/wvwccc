/* ============================================================
   WVWCCC Admin Console — shell + page logic (vanilla)
   ============================================================ */
window.Admin = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const apiBase = (window.ChamberAPI ? ChamberAPI.url('') : '');

  // Downscale an image File to a JPEG data URL (keeps uploads small + within vision limits).
  function downscaleImage(file, maxDim = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.round(w * scale); h = Math.round(h * scale);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject; img.src = fr.result;
      };
      fr.onerror = reject; fr.readAsDataURL(file);
    });
  }

  async function api(pathname, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const res = await fetch(apiBase + pathname, { credentials: 'same-origin', ...opts, headers });
    if (res.status === 401 || res.status === 403) {
      // not signed in (or not staff) → send to staff login
      location.href = '../auth/staff-login.html';
      throw new Error('auth required');
    }
    if (!res.ok) throw new Error(`${pathname} → ${res.status}`);
    return res.json();
  }

  // Sign out — clears the session cookie server-side, then back to staff login.
  // Direct fetch (not api()) so a stale session 401 doesn't hijack the redirect.
  async function logout() {
    try { await fetch(apiBase + '/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
    location.href = '../auth/staff-login.html';
  }

  const NAV = [
    { grp: 'Manage' },
    { href: 'index.html', icon: '▦', label: 'Dashboard', key: 'dashboard' },
    { href: 'members.html', icon: '◉', label: 'Members', key: 'members' },
    { href: 'renewals.html', icon: '↻', label: 'Renewals', key: 'renewals' },
    { href: 'approvals.html', icon: '✓', label: 'Approvals', key: 'approvals' },
    { href: 'events.html', icon: '◆', label: 'Events', key: 'events' },
    { href: 'groups.html', icon: '◎', label: 'Groups', key: 'groups' },
    { href: 'content.html', icon: '✎', label: 'Content', key: 'content' },
    { href: 'slides.html', icon: '▭', label: 'Hero Slider', key: 'slides' },
    { href: 'sponsorships.html', icon: '★', label: 'Sponsorships', key: 'sponsorships' },
    { href: 'ai-assistant.html', icon: '✦', label: 'AI Assistant', key: 'assistant' },
    { href: 'users.html', icon: '⚷', label: 'Users & Roles', key: 'users' },
    { grp: 'Revenue & contact' },
    { href: 'payments.html', icon: '$', label: 'Pay Log', key: 'payments' },
    { href: 'leads.html', icon: '✉', label: 'Inquiries', key: 'leads' },
  ];

  function mountShell(active) {
    document.body.classList.add('admin');
    const side = document.querySelector('[data-admin-nav]');
    if (side) {
      side.innerHTML = `
        <div class="admin-brand">
          <img src="../images/wvwccc-logo.png" alt="WVWCCC" />
          <div><b>WVWCCC</b><span>Admin Console</span></div>
        </div>
        <nav class="admin-nav">
          ${NAV.map((n) => n.grp
            ? `<div class="grp">${esc(n.grp)}</div>`
            : `<a href="${n.href}" class="${n.key === active ? 'active' : ''}"><span class="ico">${n.icon}</span>${esc(n.label)}</a>`).join('')}
        </nav>
        <div class="admin-sidebar__foot">
          <a href="../index.html">↗ View live site</a>
          <button type="button" class="admin-logout" data-admin-logout>⎋ Sign out</button>
        </div>`;
      const out = side.querySelector('[data-admin-logout]');
      if (out) out.addEventListener('click', logout);
    }
    // Also surface Sign out in the top bar — far more discoverable than the
    // sidebar foot, especially for non-technical staff (Chamber feedback).
    const bar = document.querySelector('.admin-topbar');
    if (bar && !bar.querySelector('[data-admin-logout-top]')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'admin-logout';
      b.setAttribute('data-admin-logout-top', '');
      b.setAttribute('aria-label', 'Sign out');
      b.textContent = '⎋ Sign out';
      b.addEventListener('click', logout);
      bar.appendChild(b);
    }
  }

  function statusPill(s) { s = s || 'approved'; return `<span class="pill pill--${s}">${esc(s)}</span>`; }

  // ── Dashboard ──
  async function initDashboard() {
    mountShell('dashboard');
    try {
      const s = await api('/api/admin/summary');
      const cards = [
        { num: s.members, lbl: 'Members', href: 'members.html' },
        { num: s.pendingMembers, lbl: 'Pending approval', accent: s.pendingMembers > 0, href: 'approvals.html' },
        { num: s.leaders, lbl: 'Leaders / Board', href: 'members.html' },
        { num: s.newLeads, lbl: 'New inquiries', accent: s.newLeads > 0, href: 'leads.html' },
        { num: s.pendingPosts, lbl: 'Pending content', accent: s.pendingPosts > 0, href: 'content.html' },
        { num: s.orders, lbl: 'Payments logged', href: 'payments.html' },
        { num: '$' + (s.revenue || 0).toLocaleString(), lbl: 'Revenue processed', href: 'payments.html' },
      ];
      // Every stat card is a shortcut to its section (Chamber feedback: make the dashboard clickable).
      document.getElementById('statRow').innerHTML = cards.map((c) =>
        `<a class="stat-card${c.accent ? ' accent' : ''}" href="${c.href}" style="text-decoration:none;color:inherit;cursor:pointer"><div class="num">${esc(c.num)}</div><div class="lbl">${esc(c.lbl)} →</div></a>`).join('');
      // (Roster is the imported live membership; no import-needed notice.)
      const leads = (await api('/api/admin/leads')).leads.slice(0, 5);
      document.getElementById('recentLeads').innerHTML = leads.length
        ? leads.map((l) => `<tr><td><a class="name" href="leads.html" title="Open inquiries">${esc(l.name || '—')}</a><div class="sub">${esc(l.email)}</div></td><td>${esc(l.reason || l.kind)}</td><td>${statusPill(l.status)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="sub">No inquiries yet.</td></tr>';
    } catch (e) { showAuthError(e); }

    // ── Renewals at a glance + newest members + quick-renew ──
    try {
      const { members } = await api('/api/admin/members');
      const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
      const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const nextRenewal = (m) => {
        if (m.expireDate) { const e = new Date(m.expireDate + 'T12:00:00'); if (!isNaN(e)) return e; }
        if (!m.joinDate) return null;
        const jd = new Date(m.joinDate + 'T12:00:00'); if (isNaN(jd)) return null;
        const term = Number(m.termMonths) || 12; const today = startOfToday(); let r = new Date(jd); let g = 0;
        while (r < today && g++ < 300) r.setMonth(r.getMonth() + term);
        return r;
      };
      const daysUntil = (d) => Math.round((d - startOfToday()) / 86400000);
      const rows = members.map((m) => ({ m, r: nextRenewal(m) })).filter((x) => x.r).map((x) => ({ ...x, days: daysUntil(x.r) })).sort((a, b) => a.days - b.days);
      const c30 = rows.filter((x) => x.days <= 30).length, c60 = rows.filter((x) => x.days <= 60).length, c90 = rows.filter((x) => x.days <= 90).length;
      const glance = document.getElementById('renewGlance');
      if (glance) {
        glance.innerHTML = `<div class="stat-row" style="margin-bottom:14px">
          <div class="stat-card ${c30 ? 'accent' : ''}"><div class="num">${c30}</div><div class="lbl">due in 30 days</div></div>
          <div class="stat-card"><div class="num">${c60}</div><div class="lbl">due in 60 days</div></div>
          <div class="stat-card"><div class="num">${c90}</div><div class="lbl">due in 90 days</div></div>
        </div>
        <table class="admin-table"><thead><tr><th>Member</th><th>Renews</th><th>In</th><th>Offline renewal</th></tr></thead><tbody id="renewSoon"></tbody></table>`;
        const soon = rows.filter((x) => x.days <= 90).slice(0, 8);
        const tb = document.getElementById('renewSoon');
        tb.innerHTML = soon.length ? soon.map(({ m, r, days }) => `<tr data-id="${esc(m.id)}">
          <td><a class="name" href="members.html?focus=${encodeURIComponent(m.id)}" title="Open in Members">${esc(m.name)}</a></td>
          <td>${r.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
          <td>${days <= 0 ? 'now' : days + ' days'}</td>
          <td><button class="btn btn--forest btn--sm" data-renew>Renew +1 yr</button> <span class="saved-flash" data-flash>renewed ✓</span></td></tr>`).join('')
          : '<tr><td colspan="4" class="sub">Nothing due within 90 days. 🎉</td></tr>';
        tb.querySelectorAll('tr[data-id]').forEach((tr) => {
          const id = tr.dataset.id, flash = tr.querySelector('[data-flash]');
          tr.querySelector('[data-renew]').addEventListener('click', async (e) => {
            const btn = e.target; btn.disabled = true;
            const cur = rows.find((x) => x.m.id === id);
            const nd = new Date(cur.r); nd.setFullYear(nd.getFullYear() + 1);
            try { await api('/api/admin/members/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ expireDate: ymd(nd) }) }); flash.classList.add('show'); btn.textContent = 'Renewed → ' + ymd(nd); }
            catch (err) { btn.disabled = false; alert('Could not renew.'); }
          });
        });
      }
      const newest = members.filter((m) => m.joinDate).sort((a, b) => String(b.joinDate).localeCompare(String(a.joinDate))).slice(0, 8);
      const nm = document.getElementById('newestMembers');
      if (nm) nm.innerHTML = newest.length ? newest.map((m) => `<tr><td><a class="name" href="members.html?focus=${encodeURIComponent(m.id)}" title="Open in Members">${esc(m.name)}</a><div class="sub">${esc(m.neighborhood || m.city || '')}</div></td><td>${esc(m.category || '')}</td><td>${esc(m.joinDate || '')}</td></tr>`).join('') : '<tr><td colspan="3" class="sub">—</td></tr>';
    } catch (e) { /* dashboard extras best-effort */ }
  }

  // ── Members (status radios) ──
  async function initMembers() {
    mountShell('members');
    let opts = { leaderOptions: ['', 'Leader', 'Board Member', 'New Member', 'Past President', 'Ambassador'], statusOptions: ['approved', 'pending', 'suspended', 'inactive'] };
    try { opts = await api('/api/admin/options'); } catch (e) {}
    const tiers = ['platinum', 'gold', 'silver', 'bronze', 'supporter', 'friend', 'member', 'in-kind', 'complimentary'];
    const tbody = document.getElementById('memberRows');
    const search = document.getElementById('memberSearch');
    const memberById = {};

    // Add-member form (offline signup)
    const addToggle = document.getElementById('addMemberToggle');
    const addForm = document.getElementById('addMemberForm');
    if (addToggle && addForm) {
      addToggle.addEventListener('click', () => { addForm.style.display = addForm.style.display === 'none' ? 'block' : 'none'; });
      addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('addMemberMsg');
        const fd = new FormData(addForm);
        const body = Object.fromEntries(fd.entries());
        if (!body.name) { msg.hidden = false; msg.textContent = 'Name is required.'; return; }
        const btn = addForm.querySelector('button[type="submit"]'); btn.disabled = true;
        try {
          const r = await api('/api/admin/members', { method: 'POST', body: JSON.stringify(body) });
          msg.hidden = false; msg.style.borderColor = 'var(--green)';
          msg.textContent = 'Added: ' + (r.member ? r.member.name : body.name) + (r.login ? ' — ' + r.login : '');
          addForm.reset();
          load(search.value.trim());
        } catch (err) { msg.hidden = false; msg.textContent = 'Could not add member.'; }
        finally { btn.disabled = false; }
      });
    }

    async function load(q) {
      try {
        const { members } = await api('/api/admin/members' + (q ? `?q=${encodeURIComponent(q)}` : ''));
        document.getElementById('memberCount').textContent = `${members.length} members`;
        // Chunked render — the full roster is ~25k DOM nodes; paint the first 80
        // instantly and expand on demand. Search still queries the whole roster.
        const CHUNK = 80;
        members.forEach((m) => { memberById[m.id] = m; });
        const renderRows = (list) => { tbody.innerHTML = list.map((m) => row(m)).join(''); bind(); };
        if (members.length > CHUNK + 20) {
          renderRows(members.slice(0, CHUNK));
          const tr = document.createElement('tr');
          tr.innerHTML = `<td colspan="9" style="text-align:center;padding:14px"><button class="btn btn--ghost btn--sm" type="button">Show all ${members.length} members ↓</button><div class="sub" style="margin-top:6px">Showing first ${CHUNK} — or use search above</div></td>`;
          tr.querySelector('button').addEventListener('click', () => renderRows(members));
          tbody.appendChild(tr);
        } else renderRows(members);
      } catch (e) { showAuthError(e); }
    }
    function row(m) {
      const id = esc(m.id);
      const radios = opts.leaderOptions.map((o) => {
        const checked = (m.leaderStatus || '') === o ? 'checked' : '';
        const lbl = o || 'None';
        return `<input type="radio" name="ld-${id}" id="ld-${id}-${esc(o || 'none')}" value="${esc(o)}" ${checked}><label for="ld-${id}-${esc(o || 'none')}">${esc(lbl)}</label>`;
      }).join('');
      const emailLine = m.email
        ? `<div class="sub">✉ <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>`
        : '<div class="sub" style="opacity:.7">no login email on file</div>';
      const pwActions = m.email
        ? `<button type="button" data-setpw="${esc(m.email)}" title="Set this member's password now" style="cursor:pointer;background:none;border:1px solid var(--line,#d7d2c6);border-radius:6px;padding:3px 8px;font-size:.8rem">Set password</button>
           <button type="button" data-resetlink="${esc(m.email)}" title="Copy a reset link to send them" style="cursor:pointer;background:none;border:1px solid var(--line,#d7d2c6);border-radius:6px;padding:3px 8px;font-size:.8rem">Reset link</button>`
        : `<button type="button" data-reset title="Force a password reset at next login" style="cursor:pointer;background:none;border:1px solid var(--line,#d7d2c6);border-radius:6px;padding:3px 8px;font-size:.8rem">Reset PW</button>`;
      return `<tr data-id="${id}">
        <td><button type="button" data-editname title="Edit this member" style="background:none;border:none;padding:0;font:inherit;font-weight:600;color:var(--green-deep,#1E5631);cursor:pointer;text-align:left">${esc(m.name)}</button><div class="sub">${esc(m.category || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</div>${emailLine}</td>
        <td><select class="admin-select" data-field="tier">${tiers.map((t) => `<option ${((m.tier || 'member') === t) ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><select class="admin-select" data-field="status">${opts.statusOptions.map((s) => `<option ${((m.status || 'approved') === s) ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><div class="radio-group" data-field="leaderStatus">${radios}</div></td>
        <td><label class="toggle"><input type="checkbox" data-field="featured" ${m.featured ? 'checked' : ''}><span class="track"></span></label></td>
        <td style="white-space:nowrap">
          <button type="button" data-edit title="Edit this member's public profile" style="cursor:pointer;background:var(--green-deep,#1E5631);color:#fff;border:none;border-radius:6px;padding:4px 10px;font-size:.8rem;margin-right:6px">Edit profile</button>
          <a href="../members/profile.html?id=${id}" target="_blank" title="View public profile" style="text-decoration:none;margin-right:6px">View ↗</a>
          ${pwActions}
          <span class="saved-flash" data-flash>saved ✓</span>
        </td>
      </tr>`;
    }
    function bind() {
      tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id;
        const flash = tr.querySelector('[data-flash]');
        const save = async (patch) => {
          try {
            await api(`/api/admin/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
            flash.classList.add('show'); setTimeout(() => flash.classList.remove('show'), 1200);
          } catch (e) { showAuthError(e); }
        };
        tr.querySelectorAll('[data-field="tier"],[data-field="status"]').forEach((el) =>
          el.addEventListener('change', () => save({ [el.dataset.field]: el.value })));
        tr.querySelectorAll('[data-field="leaderStatus"] input').forEach((el) =>
          el.addEventListener('change', () => save({ leaderStatus: el.value })));
        tr.querySelector('[data-field="featured"]').addEventListener('change', (e) =>
          save({ featured: e.target.checked }));
        tr.querySelector('[data-reset]')?.addEventListener('click', async () => {
          if (!confirm('Force this member to set a new password at next login? Their current password will stop working.')) return;
          try {
            const r = await api(`/api/admin/members/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
            flash.classList.add('show'); setTimeout(() => flash.classList.remove('show'), 1500);
            alert(r.message || 'Password reset queued.');
          } catch (e) { showAuthError(e); }
        });
        tr.querySelector('[data-edit]')?.addEventListener('click', () => openProfileEditor(memberById[id]));
        // Clicking the business name opens the same admin editor.
        tr.querySelector('[data-editname]')?.addEventListener('click', () => openProfileEditor(memberById[id]));
        // Set this member's password now (e.g. over the phone).
        tr.querySelector('[data-setpw]')?.addEventListener('click', async (e) => {
          const email = e.currentTarget.dataset.setpw;
          const pw = prompt(`Set a new password for ${email} (minimum 8 characters).\nThe member can sign in with it immediately.`);
          if (pw === null) return;
          if (pw.length < 8) { alert('Password must be at least 8 characters.'); return; }
          try { await api('/api/admin/users/' + encodeURIComponent(email) + '/set-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
            flash.classList.add('show'); setTimeout(() => flash.classList.remove('show'), 1500); alert('Password set for ' + email); }
          catch (err) { alert('Could not set password: ' + (err.message || '')); }
        });
        // Copy a reset link to send the member (works before email is configured).
        tr.querySelector('[data-resetlink]')?.addEventListener('click', async (e) => {
          try {
            const r = await api('/api/admin/users/' + encodeURIComponent(e.currentTarget.dataset.resetlink) + '/reset-link');
            const copied = navigator.clipboard ? await navigator.clipboard.writeText(r.link).then(() => true).catch(() => false) : false;
            window.prompt(copied ? 'Reset link copied — paste it to the member (expires in 1 hour):' : 'Copy this reset link and send it to the member (expires in 1 hour):', r.link);
          } catch (err) { alert('Could not generate a reset link: ' + (err.message || '')); }
        });
      });
    }

    // ── Profile editor modal: admins edit the member's PUBLIC listing ──
    function openProfileEditor(m) {
      if (!m) return;
      const F = [
        ['name', 'Business name'], ['category', 'Category'], ['contactName', 'Contact name'],
        ['phone', 'Phone'], ['website', 'Website'], ['address', 'Address'],
        ['city', 'City'], ['zip', 'ZIP'], ['neighborhood', 'Neighborhood'],
        ['tagline', 'Tagline (one line on the card)'], ['video', 'Video URL (YouTube/Vimeo)'],
      ];
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(14,42,22,.5);z-index:500;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow-y:auto';
      ov.innerHTML = `
        <form class="panel" style="max-width:640px;width:100%;padding:var(--s-6);margin:0" role="dialog" aria-modal="true">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s-4)">
            <h3 style="margin:0">Edit profile — ${esc(m.name)}</h3>
            <button type="button" data-x style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--muted)">×</button>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            ${F.map(([k, lbl]) => `<div class="field" style="margin:0;${k === 'tagline' || k === 'name' ? 'grid-column:1/-1' : ''}">
              <label>${lbl}</label><input name="${k}" value="${esc(m[k] || '')}" /></div>`).join('')}
            <div class="field" style="grid-column:1/-1;margin:0"><label>Description</label>
              <textarea name="description" rows="4">${esc(m.description || '')}</textarea></div>
          </div>
          <p data-msg class="sub" style="margin:10px 0 0" hidden></p>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:var(--s-4)">
            <button type="button" data-x class="btn btn--ghost btn--sm">Cancel</button>
            <button type="submit" class="btn btn--forest btn--sm">Save profile</button>
          </div>
        </form>`;
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
      ov.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = Object.fromEntries([...fd.entries()].filter(([, v]) => true));
        const btn = e.target.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await api(`/api/admin/members/${encodeURIComponent(m.id)}/profile`, { method: 'PATCH', body: JSON.stringify(body) });
          close(); load(search.value.trim());
        } catch (err) {
          const msg = ov.querySelector('[data-msg]'); msg.hidden = false; msg.textContent = 'Save failed — try again.';
          btn.disabled = false; btn.textContent = 'Save profile';
        }
      });
      document.body.appendChild(ov);
      ov.querySelector('input')?.focus();
    }

    let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(search.value.trim()), 250); });
    // Deep links from the dashboard / other admin pages: ?q= prefills search,
    // ?focus=<memberId> opens that member's editor straight away.
    const params = new URLSearchParams(location.search);
    const focusId = params.get('focus');
    const q = params.get('q') || '';
    if (q && search) search.value = q;
    load(q).then(() => { if (focusId && memberById[focusId]) openProfileEditor(memberById[focusId]); });
  }

  // ── Approvals queue ──
  async function initApprovals() {
    mountShell('approvals');
    try {
      const { members } = await api('/api/admin/members?status=pending');
      const wrap = document.getElementById('approvalList');
      wrap.innerHTML = members.length ? members.map((m) => `
        <tr data-id="${esc(m.id)}">
          <td><span class="name">${esc(m.name)}</span><div class="sub">${esc(m.contactName || '')} · ${esc(m.email || m.phone || '')}</div></td>
          <td>${esc(m.category || '')}</td>
          <td>
            <button class="btn btn--forest btn--sm" data-approve>Approve</button>
            <button class="btn btn--ghost btn--sm" data-suspend>Decline</button>
          </td>
        </tr>`).join('')
        : '<tr><td colspan="3" class="sub">Nothing waiting for approval. 🎉</td></tr>';
      wrap.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id;
        const act = async (status) => {
          await api(`/api/admin/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
          tr.remove();
        };
        tr.querySelector('[data-approve]')?.addEventListener('click', () => act('approved'));
        tr.querySelector('[data-suspend]')?.addEventListener('click', () => act('suspended'));
      });
    } catch (e) { showAuthError(e); }
  }

  // ── Pay Log ──
  async function initOrders() {
    mountShell('payments');
    try {
      const { orders } = await api('/api/admin/orders');
      document.getElementById('orderRows').innerHTML = orders.length ? orders.map((o) => `
        <tr><td>${esc(new Date(o.created).toLocaleDateString())}</td>
        <td><span class="name">${esc(o.name || o.email || '—')}</span><div class="sub">${esc(o.email || '')}</div></td>
        <td>${esc(o.kind)}${o.sku ? ' · ' + esc(o.sku) : ''}</td>
        <td>$${Number(o.amount || 0).toFixed(2)}</td>
        <td class="sub">$${Number(o.heedShare || 0).toFixed(2)}</td>
        <td><span class="sub">${esc(o.transactionId || '')}</span></td></tr>`).join('')
        : '<tr><td colspan="6" class="sub">No payments yet. Transactions appear here once AGMS checkout is live.</td></tr>';
    } catch (e) { showAuthError(e); }
  }

  // ── Inquiries / notifications ──
  async function initLeads() {
    mountShell('leads');
    const tbody = document.getElementById('leadRows');
    async function load() {
      try {
        const { leads } = await api('/api/admin/leads');
        tbody.innerHTML = leads.length ? leads.map((l) => `
          <tr data-id="${esc(l.id)}">
            <td><span class="name">${esc(l.name || '—')}</span><div class="sub">${esc(l.email)}${l.phone ? ' · ' + esc(l.phone) : ''}</div></td>
            <td>${esc(l.reason || l.kind)}${l.company ? '<div class="sub">' + esc(l.company) + '</div>' : ''}</td>
            <td class="sub">${esc((l.message || '').slice(0, 80))}</td>
            <td>${statusPill(l.status)}</td>
            <td><select class="admin-select" data-mark><option value="new" ${l.status === 'new' ? 'selected' : ''}>New</option><option value="read" ${l.status === 'read' ? 'selected' : ''}>Read</option><option value="done" ${l.status === 'done' ? 'selected' : ''}>Done</option></select></td>
          </tr>`).join('')
          : '<tr><td colspan="5" class="sub">No inquiries yet.</td></tr>';
        tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
          tr.querySelector('[data-mark]')?.addEventListener('change', async (e) => {
            await api(`/api/admin/leads/${encodeURIComponent(tr.dataset.id)}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
            load();
          });
        });
      } catch (e) { showAuthError(e); }
    }
    load();
  }

  // ── Events (full CRUD: create / edit / delete, up to 3 images, ticket/sponsor links) ──
  async function initEvents() {
    mountShell('events');
    const form = document.getElementById('eventForm');
    const msg = document.getElementById('eventMsg');
    const rowsEl = document.getElementById('eventRows');
    const imgWrap = document.getElementById('evImages');
    const linkWrap = document.getElementById('evLinks');
    const docWrap = document.getElementById('evDocs');
    const tixWrap = document.getElementById('evTickets');
    let editingId = null;
    let images = [];
    let links = [];
    let documents = [];
    let ticketTypes = [];
    let flyerUrl = '';
    let thumbnail = '';

    // Single-image uploader factory (flyer, thumbnail).
    function bindSingleImage(inputId, prevId, set, get) {
      const inp = document.getElementById(inputId);
      const prev = document.getElementById(prevId);
      const draw = () => { if (prev) prev.innerHTML = get() ? `<img src="${esc(get())}" alt="" style="max-width:140px;border-radius:8px"> <button type="button" data-clr class="btn btn--ghost btn--sm">remove</button>` : ''; if (prev) { const c = prev.querySelector('[data-clr]'); if (c) c.addEventListener('click', () => { set(''); draw(); }); } };
      if (inp) inp.addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = async () => { try { const up = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl: r.result }) }); set(up.url); draw(); } catch (err) { msg.hidden = false; msg.textContent = 'Image upload failed (PNG/JPG, ≤2.5MB).'; } };
        r.readAsDataURL(f);
      });
      draw._draw = draw; return draw;
    }
    const drawFlyer = bindSingleImage('evFlyerImg', 'evFlyerPrev', (v) => { flyerUrl = v; }, () => flyerUrl);
    const drawThumb = bindSingleImage('evThumb', 'evThumbPrev', (v) => { thumbnail = v; }, () => thumbnail);

    function renderDocs() {
      docWrap.innerHTML = documents.map((dme, i) => `<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center;flex-wrap:wrap">
        <a href="${esc(dme.url)}" target="_blank" rel="noopener">📄</a>
        <input data-dlbl="${i}" placeholder="Label (e.g. Sponsorship levels)" value="${esc(dme.label || '')}" style="flex:1;min-width:160px">
        <button type="button" data-rmdoc="${i}" class="btn btn--ghost btn--sm">×</button>
      </div>`).join('') + (documents.length < 3
        ? `<label class="btn btn--ghost btn--sm" style="cursor:pointer">+ PDF<input type="file" accept="application/pdf,.pdf" hidden id="evDocInput"></label>`
        : '<span class="sub">Max 3 PDFs.</span>');
      const inp = document.getElementById('evDocInput');
      if (inp) inp.addEventListener('change', (e) => {
        const f = e.target.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = async () => { try { const up = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ dataUrl: r.result }) }); documents.push({ label: (f.name || 'Document').replace(/\.pdf$/i, ''), url: up.url }); renderDocs(); } catch (err) { msg.hidden = false; msg.textContent = 'PDF upload failed (max ~6MB).'; } };
        r.readAsDataURL(f);
      });
      docWrap.querySelectorAll('[data-dlbl]').forEach((el) => el.addEventListener('input', () => { documents[+el.dataset.dlbl].label = el.value; }));
      docWrap.querySelectorAll('[data-rmdoc]').forEach((b) => b.addEventListener('click', () => { documents.splice(+b.dataset.rmdoc, 1); renderDocs(); }));
    }
    function renderTickets() {
      tixWrap.innerHTML = ticketTypes.map((t, i) => `<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center">
        <input data-tk="${i}" data-f="name" placeholder="Ticket name (e.g. General)" value="${esc(t.name || '')}" style="flex:2;min-width:140px">
        <input data-tk="${i}" data-f="price" type="number" min="0" step="0.01" placeholder="Price" value="${t.price != null ? esc(t.price) : ''}" style="width:90px">
        <input data-tk="${i}" data-f="qty" type="number" min="0" placeholder="Qty" value="${t.qty != null ? esc(t.qty) : ''}" style="width:70px" title="Leave blank for unlimited">
        <label style="display:inline-flex;align-items:center;gap:4px;font-size:.85rem"><input data-tk="${i}" data-f="available" type="checkbox" ${t.available !== false ? 'checked' : ''}> available</label>
        <button type="button" data-rmtk="${i}" class="btn btn--ghost btn--sm">×</button>
      </div>`).join('') + `<button type="button" id="evAddTix" class="btn btn--ghost btn--sm">+ Ticket type</button>`;
      tixWrap.querySelector('#evAddTix').addEventListener('click', () => { ticketTypes.push({ name: '', price: 0, qty: null, available: true }); renderTickets(); });
      tixWrap.querySelectorAll('[data-tk]').forEach((el) => el.addEventListener('input', () => {
        const t = ticketTypes[+el.dataset.tk]; const f = el.dataset.f;
        t[f] = f === 'available' ? el.checked : (f === 'price' ? el.value : (f === 'qty' ? (el.value === '' ? null : el.value) : el.value));
      }));
      tixWrap.querySelectorAll('[data-rmtk]').forEach((b) => b.addEventListener('click', () => { ticketTypes.splice(+b.dataset.rmtk, 1); renderTickets(); }));
    }

    function renderImages() {
      imgWrap.innerHTML = images.map((u, i) => `<span style="position:relative;display:inline-block;margin:0 8px 8px 0">
        <img src="${esc(u)}" style="width:88px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--line,#ddd)">
        <button type="button" data-rmimg="${i}" title="Remove" style="position:absolute;top:-7px;right:-7px;border:none;background:#b00020;color:#fff;border-radius:50%;width:20px;height:20px;line-height:18px;cursor:pointer">×</button>
      </span>`).join('') + (images.length < 3
        ? `<label class="btn btn--ghost btn--sm" style="cursor:pointer">+ Image<input type="file" accept="image/*" hidden id="evImgInput"></label>`
        : '<span class="sub">Max 3 images.</span>');
      const inp = document.getElementById('evImgInput');
      if (inp) inp.addEventListener('change', onImg);
      imgWrap.querySelectorAll('[data-rmimg]').forEach((b) => b.addEventListener('click', () => { images.splice(+b.dataset.rmimg, 1); renderImages(); }));
    }
    function onImg(e) {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try { const up = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl: r.result }) }); images.push(up.url); renderImages(); }
        catch (err) { msg.hidden = false; msg.textContent = 'Image upload failed (PNG/JPG/GIF/WebP, ≤2.5MB).'; }
      };
      r.readAsDataURL(f);
    }
    function renderLinks() {
      linkWrap.innerHTML = links.map((l, i) => `<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center">
        <select data-lk="${i}" data-f="type" class="admin-select">
          ${['tickets', 'register', 'sponsors', 'info'].map((t) => `<option value="${t}" ${l.type === t ? 'selected' : ''}>${t === 'info' ? 'Details' : t[0].toUpperCase() + t.slice(1)}</option>`).join('')}
        </select>
        <input data-lk="${i}" data-f="label" placeholder="Button label" value="${esc(l.label)}" style="flex:1;min-width:120px">
        <input data-lk="${i}" data-f="url" placeholder="https://…" value="${esc(l.url)}" style="flex:2;min-width:180px">
        <button type="button" data-rmlk="${i}" class="btn btn--ghost btn--sm">×</button>
      </div>`).join('') + `<button type="button" id="evAddLink" class="btn btn--ghost btn--sm">+ Add link</button>`;
      linkWrap.querySelector('#evAddLink').addEventListener('click', () => { links.push({ label: '', url: '', type: 'tickets' }); renderLinks(); });
      linkWrap.querySelectorAll('[data-lk]').forEach((el) => el.addEventListener('input', () => { links[+el.dataset.lk][el.dataset.f] = el.value; }));
      linkWrap.querySelectorAll('[data-rmlk]').forEach((b) => b.addEventListener('click', () => { links.splice(+b.dataset.rmlk, 1); renderLinks(); }));
    }
    function fillForm(ev) {
      editingId = ev ? ev.id : null;
      const v = (k, d = '') => (ev && ev[k] != null ? ev[k] : d);
      form.title.value = v('title'); form.category.value = v('category'); form.date.value = v('date');
      form.time.value = v('time'); form.endDate.value = v('endDate'); form.endTime.value = v('endTime');
      form.venue.value = v('venue'); form.address.value = v('address'); form.neighborhood.value = v('neighborhood');
      form.summary.value = v('summary'); form.description.value = v('description');
      form.ticketCap.value = ev && ev.ticketCap != null ? ev.ticketCap : '';
      form.rsvpCutoff.value = v('rsvpCutoff'); form.status.value = v('status', 'approved');
      form.ticketed.checked = !!(ev && ev.ticketed); form.featured.checked = !!(ev && ev.featured);
      form.showOnCalendar.checked = ev ? (ev.showOnCalendar !== false) : true;
      form.homeOrder.value = ev && ev.homeOrder != null ? ev.homeOrder : '';
      form.homeBlurb.value = v('homeBlurb');
      flyerUrl = ev && ev.flyer ? ev.flyer : '';
      thumbnail = ev && ev.thumbnail ? ev.thumbnail : '';
      images = ev && ev.images ? ev.images.slice() : [];
      links = ev && ev.links ? ev.links.map((l) => ({ ...l })) : [];
      documents = ev && ev.documents ? ev.documents.map((d) => ({ ...d })) : [];
      ticketTypes = ev && ev.ticketTypes ? ev.ticketTypes.map((t) => ({ ...t })) : [];
      renderImages(); renderLinks(); renderDocs(); renderTickets(); drawFlyer(); drawThumb();
      document.getElementById('evFormTitle').textContent = editingId ? 'Edit event' : 'New event';
      document.getElementById('evCancel').hidden = !editingId;
      msg.hidden = true;
    }
    async function load() {
      try {
        const { events } = await api('/api/admin/events');
        events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        rowsEl.innerHTML = events.length ? events.map((e) => `<tr data-id="${esc(e.id)}">
          <td><span class="name">${esc(e.title)}</span><div class="sub">${esc(e.category || '')}${e.images && e.images.length ? ' · ' + e.images.length + ' img' : ''}${e.links && e.links.length ? ' · ' + e.links.length + ' link' + (e.links.length > 1 ? 's' : '') : ''}</div></td>
          <td>${e.date ? esc((e.month || '') + ' ' + (e.day || '')) : '<span class="pill pill--pending">TBA</span>'}<div class="sub">${esc(e.time || '')}</div></td>
          <td>${esc(e.venue || e.neighborhood || '')}</td>
          <td>${statusPill(e.status || 'approved')}${e.featured ? ' <span class="pill pill--approved">home</span>' : ''}${e.ticketed ? ' 🎟' : ''}</td>
          <td style="white-space:nowrap"><button class="btn btn--ghost btn--sm" data-edit>Edit</button> <button class="btn btn--ghost btn--sm" data-del>Delete</button></td>
        </tr>`).join('') : '<tr><td colspan="5" class="sub">No events yet. Create one above.</td></tr>';
        rowsEl.querySelectorAll('tr[data-id]').forEach((tr) => {
          const id = tr.dataset.id;
          tr.querySelector('[data-edit]').addEventListener('click', () => { fillForm(events.find((x) => x.id === id)); window.scrollTo({ top: 0, behavior: 'smooth' }); });
          tr.querySelector('[data-del]').addEventListener('click', async () => { if (!confirm('Delete this event?')) return; await api('/api/admin/events/' + encodeURIComponent(id), { method: 'DELETE' }); load(); });
        });
      } catch (e) { showAuthError(e); }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        title: form.title.value.trim(), category: form.category.value.trim(), date: form.date.value,
        time: form.time.value.trim(), endDate: form.endDate.value, endTime: form.endTime.value.trim(),
        venue: form.venue.value.trim(), address: form.address.value.trim(), neighborhood: form.neighborhood.value.trim(),
        summary: form.summary.value.trim(), description: form.description.value.trim(),
        ticketed: form.ticketed.checked, ticketCap: form.ticketCap.value ? Number(form.ticketCap.value) : null,
        rsvpCutoff: form.rsvpCutoff.value || null, featured: form.featured.checked, status: form.status.value,
        showOnCalendar: form.showOnCalendar.checked,
        homeOrder: form.homeOrder.value === '' ? null : Number(form.homeOrder.value),
        homeBlurb: form.homeBlurb.value.trim(),
        flyer: flyerUrl, thumbnail,
        documents: documents.filter((d) => d.url),
        ticketTypes: ticketTypes.filter((t) => (t.name || '').trim()),
        images, links: links.filter((l) => l.url),
      };
      if (!body.title) { msg.hidden = false; msg.textContent = 'Title is required.'; return; }
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        if (editingId) await api('/api/admin/events/' + encodeURIComponent(editingId), { method: 'PATCH', body: JSON.stringify(body) });
        else await api('/api/admin/events', { method: 'POST', body: JSON.stringify(body) });
        fillForm(null); msg.hidden = false; msg.textContent = editingId ? 'Saved ✓' : 'Event created ✓'; load();
      } catch (err) { msg.hidden = false; msg.textContent = 'Could not save event.'; }
      finally { btn.disabled = false; }
    });
    document.getElementById('evCancel').addEventListener('click', () => fillForm(null));

    // Flyer → event (AI vision prefill)
    const flyer = document.getElementById('evFlyer');
    const flyerMsg = document.getElementById('evFlyerMsg');
    if (flyer) flyer.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      // PDFs can't go through the canvas downscaler (image-only) — read them raw.
      const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      flyerMsg.textContent = 'Reading flyer with AI…';
      try {
        const dataUrl = isPdf
          ? await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(f); })
          : await downscaleImage(f, 1600, 0.85);
        const out = await api('/api/admin/events/from-flyer', { method: 'POST', body: JSON.stringify({ dataUrl }) });
        const d = out.draft || {};
        // Attach the flyer as the event image only when it's an actual image —
        // a PDF isn't a usable display image, so the admin adds a square one below.
        let imgs = [];
        if (!isPdf) { try { const up = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl }) }); imgs = [up.url]; } catch (_) {} }
        fillForm({ ...d, images: imgs, links: Array.isArray(d.links) ? d.links : [], status: 'pending' });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        flyerMsg.textContent = isPdf
          ? 'Filled from PDF — review the fields, add a square image, and click Save.'
          : 'Filled from flyer — review the fields and click Save.';
      } catch (err) { flyerMsg.textContent = 'Could not read the flyer (' + (err.message || 'error') + ').'; }
      finally { flyer.value = ''; }
    });

    fillForm(null);
    load();
  }

  // ── Content & approvals (posts) ──
  async function initContent() {
    mountShell('content');
    const TYPES = ['news', 'announcement', 'discount', 'member_post', 'event'];
    const form = document.getElementById('postForm');
    const msg = document.getElementById('postMsg');
    const postById = {};

    // Click a content title to open it for review/edit.
    function openPostEditor(p) {
      if (!p) return;
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(14,42,22,.5);z-index:600;display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;overflow-y:auto';
      ov.innerHTML = `
        <form class="panel" style="max-width:620px;width:100%;padding:var(--s-6);margin:0" role="dialog" aria-modal="true">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s-4)">
            <h3 style="margin:0">Edit content <span class="sub">(${esc(p.type)})</span></h3>
            <button type="button" data-x style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--muted)">×</button>
          </div>
          ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" style="max-width:100%;max-height:200px;border-radius:8px;margin-bottom:12px">` : ''}
          <div class="field"><label>Title</label><input name="title" value="${esc(p.title || '')}" /></div>
          <div class="field"><label>Body</label><textarea name="body" rows="5">${esc(p.body || '')}</textarea></div>
          <div class="field"><label>Link (optional)</label><input name="linkUrl" type="url" value="${esc(p.linkUrl || '')}" placeholder="https://" /></div>
          <label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="checkbox" name="featuredHome" ${p.featuredHome ? 'checked' : ''}> Feature on the home page</label>
          <p data-msg class="sub" style="margin:8px 0 0" hidden></p>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:var(--s-4)">
            <button type="button" data-x class="btn btn--ghost btn--sm">Cancel</button>
            <button type="submit" class="btn btn--forest btn--sm">Save</button>
          </div>
        </form>`;
      const close = () => ov.remove();
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) close(); });
      ov.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('[type="submit"]'); btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await api('/api/admin/posts/' + encodeURIComponent(p.id), { method: 'PATCH', body: JSON.stringify({ title: fd.get('title'), body: fd.get('body'), linkUrl: fd.get('linkUrl'), featuredHome: fd.get('featuredHome') === 'on' }) });
          close(); load();
        } catch (err) { const m = ov.querySelector('[data-msg]'); m.hidden = false; m.textContent = 'Save failed — try again.'; btn.disabled = false; btn.textContent = 'Save'; }
      });
      document.body.appendChild(ov);
      ov.querySelector('input[name="title"]').focus();
    }

    async function load() {
      try {
        const { posts } = await api('/api/admin/posts');
        posts.forEach((p) => { postById[p.id] = p; });
        const pending = posts.filter((p) => p.status === 'pending');
        const live = posts.filter((p) => p.status !== 'pending');
        document.getElementById('pendingWrap').innerHTML = pending.length
          ? pending.map((p) => rowFor(p, true)).join('')
          : '<tr><td colspan="4" class="sub">Nothing waiting for review. 🎉</td></tr>';
        document.getElementById('liveWrap').innerHTML = live.length
          ? live.map((p) => rowFor(p, false)).join('')
          : '<tr><td colspan="4" class="sub">No published content yet.</td></tr>';
        bind();
      } catch (e) { showAuthError(e); }
    }
    function rowFor(p, isPending) {
      const id = esc(p.id);
      return `<tr data-id="${id}">
        <td><button type="button" class="name" data-editpost title="Open / edit" style="background:none;border:none;padding:0;font:inherit;font-weight:600;color:var(--green-deep);cursor:pointer;text-align:left">${esc(p.title)}</button><div class="sub">${esc(p.authorName || '')}</div></td>
        <td>${esc(p.type)}</td>
        <td>${statusPill(p.status)}${p.featuredHome ? ' <span class="pill pill--approved">home</span>' : ''}</td>
        <td>
          ${isPending ? `<button class="btn btn--forest btn--sm" data-approve>Approve</button> <button class="btn btn--ghost btn--sm" data-reject>Reject</button>`
            : `<button class="btn btn--ghost btn--sm" data-feature>${p.featuredHome ? 'Unfeature' : 'Feature'}</button> <button class="btn btn--ghost btn--sm" data-del>Delete</button>`}
        </td></tr>`;
    }
    function bind() {
      document.querySelectorAll('#pendingWrap tr[data-id], #liveWrap tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id;
        const patch = async (body) => { await api('/api/admin/posts/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) }); load(); };
        tr.querySelector('[data-approve]')?.addEventListener('click', () => patch({ status: 'approved' }));
        tr.querySelector('[data-reject]')?.addEventListener('click', () => patch({ status: 'rejected' }));
        tr.querySelector('[data-feature]')?.addEventListener('click', () => patch({ featuredHome: !tr.querySelector('.pill--approved') }));
        tr.querySelector('[data-del]')?.addEventListener('click', async () => { await api('/api/admin/posts/' + encodeURIComponent(id), { method: 'DELETE' }); load(); });
        tr.querySelector('[data-editpost]')?.addEventListener('click', () => openPostEditor(postById[id]));
      });
    }
    // image upload (event photos for slider, or any post image)
    let imageUrl = '';
    const imgInput = document.getElementById('postImage');
    if (imgInput) imgInput.addEventListener('change', (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const up = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl: r.result }) });
          imageUrl = up.url;
          document.getElementById('postImgPrev').innerHTML = `<img src="${imageUrl}" style="max-width:220px;border-radius:8px">`;
        } catch (err) { msg.hidden = false; msg.textContent = 'Image upload failed.'; }
      };
      r.readAsDataURL(f);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      if (fd.get('type') === 'slide' && !imageUrl) { msg.hidden = false; msg.textContent = 'A slider photo needs an image.'; return; }
      const body = { type: fd.get('type'), title: fd.get('title'), body: fd.get('body'), linkUrl: fd.get('linkUrl'), imageUrl, featuredHome: fd.get('featuredHome') === 'on' };
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      try { await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(body) }); form.reset(); document.getElementById('postImgPrev').innerHTML = ''; imageUrl = ''; msg.hidden = false; msg.textContent = 'Published.'; load(); }
      catch (err) { msg.hidden = false; msg.textContent = 'Could not publish (title required).'; }
      finally { btn.disabled = false; }
    });
    load();

    // ── Site pages: hide outdated migrated pages / restore them ──
    const pageRows = document.getElementById('pageRows');
    if (pageRows) {
      let allPages = [];
      const renderPages = (q = '') => {
        const list = !q ? allPages : allPages.filter((p) =>
          (p.title + ' ' + p.slug + ' ' + (p.group || '')).toLowerCase().includes(q.toLowerCase()));
        pageRows.innerHTML = list.length ? list.map((p) => `
          <tr data-slug="${esc(p.slug)}">
            <td><span class="name" ${p.hidden ? 'style="opacity:.55;text-decoration:line-through"' : ''}>${esc(p.title)}</span>
              <div class="sub"><a href="../p/${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">/p/${esc(p.slug)}</a></div></td>
            <td>${esc(p.group || '—')}</td>
            <td>${p.hidden ? '<span class="pill pill--suspended">hidden</span>' : '<span class="pill pill--approved">live</span>'}</td>
            <td>${p.hidden
              ? '<button class="btn btn--forest btn--sm" data-pg-restore>Restore</button>'
              : '<button class="btn btn--ghost btn--sm" data-pg-hide>Remove from site</button>'}
              <span class="saved-flash" data-flash>done ✓</span></td>
          </tr>`).join('') : '<tr><td colspan="4" class="sub">No pages match.</td></tr>';
        pageRows.querySelectorAll('tr[data-slug]').forEach((tr) => {
          const slug = tr.dataset.slug;
          const set = async (hidden) => {
            await api('/api/admin/pages/' + encodeURIComponent(slug), { method: 'PATCH', body: JSON.stringify({ hidden }) });
            const pg = allPages.find((x) => x.slug === slug); if (pg) pg.hidden = hidden;
            renderPages(document.getElementById('pageSearch').value.trim());
          };
          tr.querySelector('[data-pg-hide]')?.addEventListener('click', () => set(true));
          tr.querySelector('[data-pg-restore]')?.addEventListener('click', () => set(false));
        });
      };
      api('/api/admin/pages').then((d) => { allPages = d.pages || []; renderPages(); })
        .catch(() => { pageRows.innerHTML = '<tr><td colspan="4" class="sub">Could not load pages.</td></tr>'; });
      const ps = document.getElementById('pageSearch');
      if (ps) ps.addEventListener('input', () => renderPages(ps.value.trim()));
    }
  }

  // ── Sponsorships: featured-member placements per page/guide ──
  async function initSponsorships() {
    mountShell('sponsorships');
    const tbody = document.getElementById('placementRows');
    let members = [];
    try { members = (await api('/api/admin/members')).members || []; } catch (e) { showAuthError(e); return; }
    const findMembers = (q) => {
      q = q.toLowerCase();
      return members.filter((m) => (m.status || 'approved') === 'approved'
        && [m.name, m.category, m.contactName].filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0, 8);
    };
    async function load() {
      let placements = [];
      try { placements = (await api('/api/admin/placements')).placements || []; } catch (e) { showAuthError(e); return; }
      tbody.innerHTML = placements.map((p) => `
        <tr data-slot="${esc(p.slot)}">
          <td><span class="name">${esc(p.label)}</span><div class="sub"><a href="..${esc(p.page)}" target="_blank" rel="noopener">${esc(p.page)}</a></div></td>
          <td>${p.memberName
            ? `<span class="name">★ ${esc(p.memberName)}</span>`
            : '<span class="sub">— open —</span>'}</td>
          <td style="position:relative">
            <input class="admin-select" data-search placeholder="Search members…" autocomplete="off" style="min-width:220px" />
            <div class="sp-suggest" data-suggest hidden></div>
          </td>
          <td>${p.memberId ? '<button class="btn btn--ghost btn--sm" data-clear>Remove</button>' : ''}
            <span class="saved-flash" data-flash>saved ✓</span></td>
        </tr>`).join('');
      tbody.querySelectorAll('tr[data-slot]').forEach((tr) => {
        const slot = tr.dataset.slot;
        const input = tr.querySelector('[data-search]');
        const sug = tr.querySelector('[data-suggest]');
        const flash = tr.querySelector('[data-flash]');
        const assign = async (memberId) => {
          await api('/api/admin/placements', { method: 'POST', body: JSON.stringify({ slot, memberId }) });
          flash.classList.add('show'); setTimeout(() => load(), 450);
        };
        input.addEventListener('input', () => {
          const q = input.value.trim();
          if (q.length < 2) { sug.hidden = true; return; }
          const hits = findMembers(q);
          sug.innerHTML = hits.length
            ? hits.map((m) => `<button type="button" data-pick="${esc(m.id)}"><b>${esc(m.name)}</b><span>${esc(m.category || '')}</span></button>`).join('')
            : '<div class="sub" style="padding:8px 10px">No matches</div>';
          sug.hidden = false;
          sug.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => assign(b.dataset.pick)));
        });
        input.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 250));
        tr.querySelector('[data-clear]')?.addEventListener('click', () => assign(null));
      });
    }
    load();
  }

  // ── Renewals (manual date override, else join-date + term) ──
  async function initRenewals() {
    mountShell('renewals');
    const tbody = document.getElementById('renewRows');
    const summary = document.getElementById('renewSummary');
    let windowDays = 30, all = [];
    const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
    const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    function nextRenewal(m) {
      if (m.expireDate) { const e = new Date(m.expireDate + 'T12:00:00'); if (!isNaN(e)) return { date: e, manual: true }; }
      if (!m.joinDate) return null;
      const jd = new Date(m.joinDate + 'T12:00:00'); if (isNaN(jd)) return null;
      const term = Number(m.termMonths) || 12;
      const today = startOfToday();
      let r = new Date(jd);
      let guard = 0;
      while (r < today && guard++ < 200) r.setMonth(r.getMonth() + term);
      return { date: r, manual: false };
    }
    const daysUntil = (d) => Math.round((d - startOfToday()) / 86400000);
    function tenure(joinDate) {
      const jd = new Date(joinDate + 'T12:00:00'); if (isNaN(jd)) return '';
      const y = Math.floor((Date.now() - jd) / (365.25 * 86400000));
      return y >= 1 ? y + ' yr' + (y > 1 ? 's' : '') : '<1 yr';
    }
    function render() {
      const rows = all.map((m) => ({ m, nr: nextRenewal(m) })).filter((x) => x.nr)
        .map((x) => ({ ...x, days: daysUntil(x.nr.date) })).sort((a, b) => a.days - b.days);
      const c30 = rows.filter((x) => x.days <= 30).length, c60 = rows.filter((x) => x.days <= 60).length, c90 = rows.filter((x) => x.days <= 90).length;
      summary.innerHTML = `<strong>${c30}</strong> renewing within 30 days · <strong>${c60}</strong> within 60 · <strong>${c90}</strong> within 90 · ${rows.length} dated members`;
      const list = windowDays >= 9999 ? rows : rows.filter((x) => x.days <= windowDays);
      tbody.innerHTML = list.length ? list.map(({ m, nr, days }) => {
        const terms = [12, 24, 36, 48, 60];
        const termSel = `<select data-f="termMonths" class="admin-select" style="width:auto">${terms.map((t) => `<option value="${t}" ${(Number(m.termMonths) || 12) === t ? 'selected' : ''}>${t / 12} yr</option>`).join('')}</select>`;
        return `<tr data-id="${esc(m.id)}">
          <td><span class="name">${esc(m.name)}</span><div class="sub">${esc(m.category || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</div></td>
          <td>${esc(m.joinDate || '—')}<div class="sub">${tenure(m.joinDate)} member</div></td>
          <td>${nr.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ${nr.manual ? '<span class="pill pill--approved">set</span>' : '<span class="sub">est.</span>'}<div class="sub">${days === 0 ? 'today' : days + ' days'}</div></td>
          <td>
            <input type="date" data-f="expireDate" value="${nr.manual ? esc(ymd(nr.date)) : ''}" class="admin-select" style="width:auto">
            ${termSel}
            <button class="btn btn--forest btn--sm" data-save>Save</button>
            ${nr.manual ? '<button class="btn btn--ghost btn--sm" data-clear>Clear</button>' : ''}
            <span class="saved-flash" data-flash>saved ✓</span>
          </td>
        </tr>`;
      }).join('') : '<tr><td colspan="4" class="sub">No members renewing in this window.</td></tr>';
      tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
        const id = tr.dataset.id, flash = tr.querySelector('[data-flash]');
        const patch = async (body) => {
          try {
            await api('/api/admin/members/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(body) });
            const m = all.find((x) => x.id === id);
            if (m) { if ('expireDate' in body) m.expireDate = body.expireDate || undefined; if (body.termMonths) m.termMonths = body.termMonths; }
            flash.classList.add('show'); setTimeout(() => { flash.classList.remove('show'); render(); }, 700);
          } catch (e) { showAuthError(e); }
        };
        tr.querySelector('[data-save]').addEventListener('click', () => patch({
          expireDate: tr.querySelector('[data-f="expireDate"]').value || null,
          termMonths: Number(tr.querySelector('[data-f="termMonths"]').value) || 12,
        }));
        tr.querySelector('[data-clear]')?.addEventListener('click', () => patch({ expireDate: null }));
      });
    }
    document.querySelectorAll('[data-win]').forEach((b) => b.addEventListener('click', () => {
      windowDays = +b.dataset.win;
      document.querySelectorAll('[data-win]').forEach((x) => x.classList.toggle('active', x === b));
      render();
    }));
    try { all = (await api('/api/admin/members')).members; render(); } catch (e) { showAuthError(e); }
  }

  // ── Minimal, safe Markdown → HTML (assistant output only) ──
  // Escapes first, then renders headings, lists, tables, bold/italic/code, links, hr.
  function mdToHtml(src) {
    const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = (t) => e(t)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const lines = String(src == null ? '' : src).replace(/\r\n/g, '\n').split('\n');
    const isSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(s);
    const cells = (s) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
    let out = '', i = 0, para = [];
    const flush = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
    while (i < lines.length) {
      const ln = lines[i];
      if (!ln.trim()) { flush(); i++; continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(ln))) { flush(); const lvl = Math.min(Math.max(m[1].length, 2), 4); out += `<h${lvl}>${inline(m[2])}</h${lvl}>`; i++; continue; }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out += '<hr>'; i++; continue; }
      if (/^\s*\|.*\|/.test(ln) && i + 1 < lines.length && isSep(lines[i + 1])) {
        flush(); const head = cells(ln); i += 2; const rows = [];
        while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out += '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
          + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) { flush(); out += '<ul>'; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`; i++; } out += '</ul>'; continue; }
      if (/^\s*\d+\.\s+/.test(ln)) { flush(); out += '<ol>'; while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { out += `<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`; i++; } out += '</ol>'; continue; }
      para.push(ln); i++;
    }
    flush();
    return out;
  }

  // ── Internal AI assistant (Claude) ──
  async function initAssistant() {
    mountShell('assistant');
    const log = document.getElementById('chatLog');
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    const filesBar = document.getElementById('chatFiles');
    const attachInput = document.getElementById('chatAttach');
    let messages = [];
    let attachments = [];      // { name, dataUrl }
    let currentThreadId = null;

    function bubble(role, text, opts) {
      opts = opts || {};
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin:0 0 14px;display:flex;' + (role === 'user' ? 'justify-content:flex-end' : '');
      const who = role === 'user' ? 'You' : 'Claude';
      const inner = role === 'assistant' && !opts.plain
        ? `<div class="md" style="background:#fff;border:1px solid var(--line,#e4e0d6);border-radius:12px;padding:12px 14px">${mdToHtml(text)}</div>`
        : `<div style="white-space:pre-wrap;line-height:1.55;background:${role === 'user' ? 'var(--forest,#1f4d3a)' : '#fff'};color:${role === 'user' ? '#fff' : 'inherit'};border:1px solid var(--line,#e4e0d6);border-radius:12px;padding:12px 14px">${esc(text)}</div>`;
      const fileNote = (opts.files && opts.files.length)
        ? `<div class="sub" style="margin-top:5px;${role === 'user' ? 'text-align:right' : ''}">📎 ${opts.files.map((f) => esc(f)).join(', ')}</div>` : '';
      wrap.innerHTML = `<div style="max-width:760px;width:fit-content">
        <div class="sub" style="margin-bottom:3px;${role === 'user' ? 'text-align:right' : ''}">${who}</div>
        ${inner}${fileNote}
        ${role === 'assistant' && !opts.plain ? '<button class="btn btn--ghost btn--sm" data-copy style="margin-top:6px">Copy</button>' : ''}</div>`;
      if (role === 'assistant' && !opts.plain) {
        const cp = wrap.querySelector('[data-copy]');
        if (cp) cp.addEventListener('click', () => { if (navigator.clipboard) navigator.clipboard.writeText(text); cp.textContent = 'Copied ✓'; setTimeout(() => cp.textContent = 'Copy', 1400); });
      }
      log.appendChild(wrap); log.scrollTop = log.scrollHeight;
      return wrap;
    }

    function renderFiles() {
      if (!filesBar) return;
      filesBar.hidden = !attachments.length;
      filesBar.innerHTML = attachments.map((a, idx) => `<span class="chat-file">📎 ${esc(a.name)} <button type="button" data-rmfile="${idx}" aria-label="Remove">×</button></span>`).join('');
      filesBar.querySelectorAll('[data-rmfile]').forEach((b) => b.addEventListener('click', () => { attachments.splice(+b.dataset.rmfile, 1); renderFiles(); }));
    }
    const readFile = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
    if (attachInput) attachInput.addEventListener('change', async () => {
      for (const f of Array.from(attachInput.files || [])) {
        if (attachments.length >= 4) { alert('Up to 4 files per message.'); break; }
        if (f.size > 8 * 1024 * 1024) { alert(`"${f.name}" is over 8MB — please attach a smaller file.`); continue; }
        try { attachments.push({ name: f.name, dataUrl: await readFile(f) }); } catch (e) {}
      }
      attachInput.value = ''; renderFiles();
    });

    async function send(text) {
      text = (text || '').trim();
      if (!text && !attachments.length) return;
      if (!text) text = 'Please review the attached file(s).';
      const empty = document.getElementById('chatEmpty'); if (empty) empty.hidden = true;
      const sentFiles = attachments.map((a) => a.name);
      const payloadAtt = attachments.map((a) => a.dataUrl);
      messages.push({ role: 'user', content: text });
      bubble('user', text, { files: sentFiles });
      input.value = ''; input.style.height = 'auto';
      attachments = []; renderFiles();
      const thinking = bubble('assistant', '…thinking', { plain: true });
      try {
        const r = await api('/api/staff-assistant', { method: 'POST', body: JSON.stringify({ messages, attachments: payloadAtt }) });
        thinking.remove();
        messages.push({ role: 'assistant', content: r.answer });
        bubble('assistant', r.answer);
      } catch (e) { thinking.remove(); bubble('assistant', 'Sorry — I could not reach the assistant (' + (e.message || 'error') + ').', { plain: true }); }
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 180) + 'px'; });
    document.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => { input.value = b.textContent; input.focus(); }));

    // ── New chat / Save / History ──
    function clearBubbles() { Array.from(log.children).forEach((n) => { if (n.id !== 'chatEmpty') n.remove(); }); }
    function resetChat() {
      messages = []; attachments = []; currentThreadId = null; renderFiles();
      clearBubbles();
      const empty = document.getElementById('chatEmpty'); if (empty) empty.hidden = false;
    }
    function rebuild() {
      clearBubbles();
      const empty = document.getElementById('chatEmpty'); if (empty) empty.hidden = true;
      messages.forEach((m) => bubble(m.role, m.content));
    }
    const newBtn = document.getElementById('chatNew');
    if (newBtn) newBtn.addEventListener('click', resetChat);
    const saveBtn = document.getElementById('chatSave');
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      if (!messages.length) { alert('Nothing to save yet — start a conversation first.'); return; }
      const def = (messages.find((m) => m.role === 'user') || {}).content || 'Conversation';
      const title = prompt('Name this saved conversation:', def.slice(0, 80));
      if (title === null) return;
      saveBtn.disabled = true;
      try {
        const r = await api('/api/admin/assistant/threads', { method: 'POST', body: JSON.stringify({ id: currentThreadId, title, messages }) });
        currentThreadId = r.thread.id; saveBtn.textContent = '✓ Saved'; setTimeout(() => saveBtn.textContent = '⭑ Save conversation', 1600);
      } catch (e) { alert('Could not save: ' + (e.message || 'error')); }
      finally { saveBtn.disabled = false; }
    });

    const histBtn = document.getElementById('chatHistoryBtn');
    const histPop = document.getElementById('chatHistoryPop');
    async function loadHistory() {
      histPop.innerHTML = '<div class="sub" style="padding:8px 10px">Loading…</div>';
      try {
        const r = await api('/api/admin/assistant/threads');
        const list = r.threads || [];
        if (!list.length) { histPop.innerHTML = '<div class="sub" style="padding:8px 10px">No saved conversations yet.</div>'; return; }
        histPop.innerHTML = list.map((t) => `<div class="chat-pop__item" data-open="${esc(t.id)}">
          <span class="grow"><b>${esc(t.title || 'Conversation')}</b><span class="sub">${esc((t.savedBy || '').split('@')[0])} · ${esc(String(t.updated || '').slice(0, 10))}</span></span>
          <button data-del="${esc(t.id)}" title="Delete">🗑</button></div>`).join('');
        histPop.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', (ev) => {
          if (ev.target.closest('[data-del]')) return;
          const t = list.find((x) => x.id === el.dataset.open); if (!t) return;
          messages = (t.messages || []).map((m) => ({ role: m.role, content: m.content }));
          currentThreadId = t.id; rebuild(); histPop.hidden = true;
        }));
        histPop.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!confirm('Delete this saved conversation?')) return;
          try { await api('/api/admin/assistant/threads/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); loadHistory(); } catch (e) { alert('Could not delete.'); }
        }));
      } catch (e) { histPop.innerHTML = '<div class="sub" style="padding:8px 10px">Could not load.</div>'; }
    }
    if (histBtn) histBtn.addEventListener('click', (e) => { e.stopPropagation(); const show = histPop.hidden; histPop.hidden = !show; if (show) loadHistory(); });
    document.addEventListener('click', (e) => { if (histPop && !histPop.hidden && !e.target.closest('.chat-menu')) histPop.hidden = true; });

    initTemplates({ insertToChat: (text) => { input.value = text; input.focus(); input.dispatchEvent(new Event('input')); } });
  }

  // ── Message-template library + AI redraft ──
  async function initTemplates({ insertToChat }) {
    const modal = document.getElementById('tplModal');
    if (!modal) return;
    const listEl = document.getElementById('tplList');
    const form = document.getElementById('tplForm');
    const msg = document.getElementById('tplMsg');
    const draftWrap = document.getElementById('tplDraft');
    let active = null;

    const open = () => { modal.hidden = false; load(); };
    const close = () => { modal.hidden = true; draftWrap.hidden = true; };
    document.getElementById('tplOpen').addEventListener('click', open);
    document.getElementById('tplClose').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    async function load() {
      listEl.innerHTML = '<p class="sub">Loading…</p>';
      try {
        const r = await api('/api/admin/templates');
        const list = r.templates || [];
        listEl.innerHTML = list.length ? '' : '<p class="sub">No templates yet. Add one below — paste an email Felicia reuses.</p>';
        list.forEach((t) => {
          const row = document.createElement('div'); row.className = 'tpl-row';
          row.innerHTML = `<span class="grow"><b>${esc(t.name)}</b><span class="sub">${esc(t.category || '')}${t.subject ? ' · ' + esc(t.subject) : ''}</span></span>
            <span class="actions"><button class="btn btn--gold btn--sm" data-use>Use</button>
            <button class="btn btn--ghost btn--sm" data-edit>Edit</button>
            <button class="btn btn--ghost btn--sm" data-del title="Delete">🗑</button></span>`;
          row.querySelector('[data-use]').addEventListener('click', () => startDraft(t));
          row.querySelector('[data-edit]').addEventListener('click', () => {
            form.id.value = t.id; form.name.value = t.name; form.category.value = t.category || '';
            form.subject.value = t.subject || ''; form.body.value = t.body || '';
            document.getElementById('tplNewWrap').open = true; form.scrollIntoView({ behavior: 'smooth' });
          });
          row.querySelector('[data-del]').addEventListener('click', async () => {
            if (!confirm('Delete template “' + t.name + '”?')) return;
            try { await api('/api/admin/templates/' + encodeURIComponent(t.id), { method: 'DELETE' }); load(); } catch (e) { alert('Could not delete.'); }
          });
          listEl.appendChild(row);
        });
      } catch (e) { listEl.innerHTML = '<p class="notice">Could not load templates.</p>'; }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.hidden = true;
      const body = { id: form.id.value || undefined, name: form.name.value, category: form.category.value, subject: form.subject.value, body: form.body.value };
      try {
        await api('/api/admin/templates', { method: 'POST', body: JSON.stringify(body) });
        form.reset(); form.id.value = ''; document.getElementById('tplNewWrap').open = false; load();
      } catch (err) { msg.hidden = false; msg.textContent = err.message || 'Could not save.'; }
    });

    function startDraft(t) {
      active = t;
      draftWrap.hidden = false;
      document.getElementById('tplDraftName').textContent = t.name;
      document.getElementById('tplDraftInstr').value = '';
      document.getElementById('tplDraftOut').hidden = true;
      document.getElementById('tplDraftStatus').textContent = '';
      draftWrap.scrollIntoView({ behavior: 'smooth' });
    }
    document.getElementById('tplDraftCancel').addEventListener('click', () => { draftWrap.hidden = true; });
    document.getElementById('tplDraftGo').addEventListener('click', async () => {
      if (!active) return;
      const status = document.getElementById('tplDraftStatus');
      status.textContent = 'Drafting…';
      try {
        const r = await api('/api/admin/template-draft', { method: 'POST', body: JSON.stringify({ templateId: active.id, instructions: document.getElementById('tplDraftInstr').value }) });
        document.getElementById('tplDraftText').textContent = r.draft || '';
        document.getElementById('tplDraftOut').hidden = false; status.textContent = '';
      } catch (e) { status.textContent = 'Could not draft: ' + (e.message || 'error'); }
    });
    document.getElementById('tplDraftCopy').addEventListener('click', () => {
      const txt = document.getElementById('tplDraftText').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      const b = document.getElementById('tplDraftCopy'); b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = 'Copy', 1400);
    });
    document.getElementById('tplDraftToChat').addEventListener('click', () => {
      const txt = document.getElementById('tplDraftText').textContent;
      if (insertToChat) insertToChat('Here is a draft — help me refine it:\n\n' + txt);
      close();
    });
  }

  // ── Users & Roles (super-admin can grant/revoke admin) ──
  async function initUsers() {
    mountShell('users');
    const tbody = document.getElementById('userRows');
    const note = document.getElementById('superNote');
    const ROLES = ['member', 'staff', 'admin'];
    async function load() {
      try {
        const [r, mres] = await Promise.all([api('/api/admin/users'), api('/api/admin/members').catch(() => ({ members: [] }))]);
        const byId = {}; (mres.members || []).forEach((m) => { byId[m.id] = m; });
        const isSuper = !!r.isSuper;
        if (note) note.textContent = isSuper
          ? 'You are a Super Admin — change roles, and set membership expiration per account below.'
          : 'Only a Super Admin can change roles. You can view accounts, set expirations, and create logins.';
        tbody.innerHTML = (r.users || []).map((u) => {
          const fixed = u.source === 'bootstrap' || u.role === 'super_admin' || !isSuper;
          const roleCell = fixed
            ? `<span class="pill ${u.role === 'member' ? '' : 'pill--approved'}">${esc(u.role)}</span>${u.source === 'bootstrap' ? ' <span class="sub">(env)</span>' : ''}`
            : `<select class="admin-select" data-role data-email="${esc(u.email)}">${ROLES.map((x) => `<option ${u.role === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
          const m = u.memberId ? byId[u.memberId] : null;
          const biz = m ? `<span class="name">${esc(m.name)}</span><div class="sub">${esc(m.category || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</div>` : '<span class="sub">—</span>';
          const level = m ? esc(m.tier || 'member') : '<span class="sub">—</span>';
          const contact = m ? (esc(m.contactName || '') || '<span class="sub">—</span>') : '<span class="sub">—</span>';
          const exp = m ? `<input type="date" data-exp data-id="${esc(m.id)}" value="${esc(m.expireDate || '')}" class="admin-select" style="width:auto"> <span class="saved-flash" data-flash>✓</span>` : '<span class="sub">—</span>';
          const pwCell = `<button type="button" class="btn btn--forest btn--sm" data-setpw="${esc(u.email)}">Set password</button>
            <button type="button" class="btn btn--ghost btn--sm" data-resetlink="${esc(u.email)}" title="Copy a reset link to send the member">Reset link</button>`;
          return `<tr>
            <td><span class="name">${esc(u.username || u.email)}</span><div class="sub">${esc(u.email)}</div></td>
            <td>${biz}</td><td>${level}</td><td>${contact}</td><td>${exp}</td><td>${roleCell}</td><td style="white-space:nowrap">${pwCell}</td></tr>`;
        }).join('') || '<tr><td colspan="7" class="sub">No accounts yet.</td></tr>';
        tbody.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
          try { await api('/api/admin/users/' + encodeURIComponent(sel.dataset.email) + '/role', { method: 'PATCH', body: JSON.stringify({ role: sel.value }) }); }
          catch (e) { alert('Could not change role: ' + (e.message || '')); load(); }
        }));
        // Set a password directly (office sets it for a member over the phone).
        tbody.querySelectorAll('[data-setpw]').forEach((b) => b.addEventListener('click', async () => {
          const email = b.dataset.setpw;
          const pw = prompt(`Set a new password for ${email} (minimum 8 characters).\nThe member can sign in with it immediately.`);
          if (pw === null) return;
          if (pw.length < 8) { alert('Password must be at least 8 characters.'); return; }
          b.disabled = true; const old = b.textContent; b.textContent = 'Saving…';
          try { await api('/api/admin/users/' + encodeURIComponent(email) + '/set-password', { method: 'POST', body: JSON.stringify({ password: pw }) });
            b.textContent = 'Set ✓'; setTimeout(() => { b.textContent = old; b.disabled = false; }, 1600); }
          catch (e) { alert('Could not set password: ' + (e.message || '')); b.textContent = old; b.disabled = false; }
        }));
        // Generate a reset link to copy/send (works even before email is configured).
        tbody.querySelectorAll('[data-resetlink]').forEach((b) => b.addEventListener('click', async () => {
          try {
            const r = await api('/api/admin/users/' + encodeURIComponent(b.dataset.resetlink) + '/reset-link');
            const copied = navigator.clipboard ? await navigator.clipboard.writeText(r.link).then(() => true).catch(() => false) : false;
            window.prompt(copied ? 'Reset link copied — paste it to the member (expires in 1 hour):' : 'Copy this reset link and send it to the member (expires in 1 hour):', r.link);
          } catch (e) { alert('Could not generate a reset link: ' + (e.message || '')); }
        }));
        tbody.querySelectorAll('[data-exp]').forEach((inp) => inp.addEventListener('change', async () => {
          const flash = inp.parentElement.querySelector('[data-flash]');
          try { await api('/api/admin/members/' + encodeURIComponent(inp.dataset.id), { method: 'PATCH', body: JSON.stringify({ expireDate: inp.value || null }) }); if (flash) { flash.classList.add('show'); setTimeout(() => flash.classList.remove('show'), 1000); } }
          catch (e) { alert('Could not set expiration.'); }
        }));
      } catch (e) { showAuthError(e); }
    }
    const cf = document.getElementById('createUserForm');
    if (cf) cf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('cuMsg');
      const b = Object.fromEntries(new FormData(cf).entries());
      const btn = cf.querySelector('button[type="submit"]'); btn.disabled = true;
      try { await api('/api/admin/users', { method: 'POST', body: JSON.stringify(b) }); msg.hidden = false; msg.textContent = 'Account created.'; cf.reset(); load(); }
      catch (err) { msg.hidden = false; msg.textContent = 'Could not create (need email + 8+ char password).'; }
      finally { btn.disabled = false; }
    });
    load();
  }

  function showAuthError(e) {
    const m = document.getElementById('adminError');
    if (m) { m.hidden = false; m.textContent = 'Could not load admin data (' + e.message + '). If a token is required, set it via the console.'; }
    console.error(e);
  }

  // ── Groups & networks manager ──
  async function initGroups() {
    mountShell('groups');
    const form = document.getElementById('groupForm');
    const tbody = document.getElementById('groupRows');
    const msg = document.getElementById('grpMsg');
    const title = document.getElementById('grpFormTitle');
    let heroUrl = '', photos = [];

    const note = (t, ok) => { msg.hidden = false; msg.textContent = t; msg.style.color = ok ? 'var(--green)' : 'inherit'; };
    const upload = async (file) => {
      const dataUrl = await downscaleImage(file, 1600, 0.85);
      const r = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl }) });
      return r.url;
    };
    document.getElementById('grpHero').addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      note('Uploading hero…');
      try { heroUrl = await upload(f); document.getElementById('grpHeroPrev').textContent = '✓ hero set'; note('Hero uploaded — remember to Save.', true); }
      catch (err) { note('Hero upload failed (max ~2.5MB).'); }
    });
    document.getElementById('grpPhotos').addEventListener('change', async (e) => {
      note('Uploading photos…');
      for (const f of [...e.target.files].slice(0, 12 - photos.length)) {
        try { photos.push(await upload(f)); } catch (err) {}
      }
      document.getElementById('grpPhotosPrev').textContent = `✓ ${photos.length} photo${photos.length === 1 ? '' : 's'}`;
      note('Photos uploaded — remember to Save.', true);
    });

    const fill = (g) => {
      title.textContent = g ? `Edit — ${g.name}` : 'New group';
      form.id_ = g ? g.id : '';
      form.querySelector('[name="id"]').value = g ? g.id : '';
      ['name', 'tagline', 'meetingSchedule', 'contactEmail', 'eventMatch', 'status', 'description', 'meetingNotes']
        .forEach((k) => { const el = form.querySelector(`[name="${k}"]`); if (el) el.value = g ? (g[k] || '') : (k === 'status' ? 'approved' : ''); });
      heroUrl = g ? (g.heroImage || '') : '';
      photos = g ? (g.photos || []).slice() : [];
      document.getElementById('grpHeroPrev').textContent = heroUrl ? '✓ hero set' : '';
      document.getElementById('grpPhotosPrev').textContent = photos.length ? `✓ ${photos.length} photos` : '';
      window.scrollTo({ top: 0 });
    };
    document.getElementById('grpReset').addEventListener('click', () => fill(null));

    async function loadList() {
      try {
        const { groups } = await api('/api/admin/groups');
        tbody.innerHTML = groups.length ? groups.map((g) => `
          <tr data-id="${esc(g.id)}">
            <td><span class="name">${esc(g.name)}</span><div class="sub">/groups/${esc(g.slug)}</div></td>
            <td class="sub">${esc(g.meetingSchedule || '—')}</td>
            <td>${g.status === 'approved' ? '<span class="pill pill--approved">live</span>' : '<span class="pill pill--pending">draft</span>'}</td>
            <td style="white-space:nowrap">
              <button type="button" data-edit class="btn btn--ghost btn--sm">Edit</button>
              <a class="btn btn--ghost btn--sm" href="../groups/${esc(g.slug)}" target="_blank">View ↗</a>
              <button type="button" data-del class="btn btn--ghost btn--sm" style="color:var(--red)">Delete</button>
            </td>
          </tr>`).join('') : '<tr><td colspan="4" class="sub">No groups yet — create the first one above.</td></tr>';
        tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
          const g = groups.find((x) => x.id === tr.dataset.id);
          tr.querySelector('[data-edit]')?.addEventListener('click', () => fill(g));
          tr.querySelector('[data-del]')?.addEventListener('click', async () => {
            if (!confirm(`Delete "${g.name}"? The public page goes away immediately.`)) return;
            try { await api('/api/admin/groups/' + encodeURIComponent(g.id), { method: 'DELETE' }); loadList(); }
            catch (e) { showAuthError(e); }
          });
        });
      } catch (e) { showAuthError(e); }
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      if (!body.id) delete body.id;
      body.heroImage = heroUrl; body.photos = photos;
      const btn = form.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        await api('/api/admin/groups', { method: 'POST', body: JSON.stringify(body) });
        note('Saved ✓', true); fill(null); loadList();
      } catch (err) { note('Save failed — check required fields.'); }
      finally { btn.disabled = false; }
    });

    loadList();
  }

  // ── Hero slider manager (add / delete / reorder) ──
  async function initSlides() {
    mountShell('slides');
    const form = document.getElementById('slideForm');
    const msg = document.getElementById('slideMsg');
    const tbody = document.getElementById('slideRows');
    const prev = document.getElementById('slideImgPrev');
    let imageUrl = '';
    let slides = [];

    const imgInput = document.getElementById('slideImage');
    if (imgInput) imgInput.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      msg.hidden = false; msg.textContent = 'Uploading image…';
      try {
        const dataUrl = await downscaleImage(f, 1800, 0.85);
        const up = await api('/api/me/asset', { method: 'POST', body: JSON.stringify({ kind: 'photo', dataUrl }) });
        imageUrl = up.url;
        if (prev) prev.innerHTML = `<img src="${imageUrl}" alt="" style="max-width:260px;border-radius:8px;margin-top:8px">`;
        msg.textContent = 'Image ready — add an optional title, then click Add slide.';
      } catch (err) { msg.textContent = 'Image upload failed (PNG/JPG, ≤2.5MB).'; }
    });

    async function persistOrder() {
      try { await api('/api/admin/slides/reorder', { method: 'POST', body: JSON.stringify({ order: slides.map((s) => s.id) }) }); }
      catch (e) { showAuthError(e); }
    }
    async function load() {
      try { slides = (await api('/api/admin/slides')).slides || []; render(); }
      catch (e) { showAuthError(e); }
    }
    function render() {
      if (!slides.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="sub">No slides yet — the homepage hero stays solid green until you add one above.</td></tr>';
        return;
      }
      tbody.innerHTML = slides.map((s, i) => `
        <tr data-id="${esc(s.id)}">
          <td style="white-space:nowrap">
            <button type="button" class="btn btn--ghost btn--sm" data-up ${i === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn btn--ghost btn--sm" data-down ${i === slides.length - 1 ? 'disabled' : ''}>↓</button>
          </td>
          <td>${s.imageUrl ? `<img src="${esc(s.imageUrl)}" alt="" style="width:120px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--line,#ddd)">` : '<span class="sub">no image</span>'}</td>
          <td><span class="name">${esc(s.title || 'Hero slide')}</span>${s.linkUrl ? `<div class="sub">${esc(s.linkUrl)}</div>` : ''}${s.status !== 'approved' ? ' <span class="pill pill--pending">draft</span>' : ''}</td>
          <td><button type="button" class="btn btn--ghost btn--sm" data-del style="color:var(--red)">Delete</button></td>
        </tr>`).join('');
      tbody.querySelectorAll('tr[data-id]').forEach((tr, i) => {
        const id = tr.dataset.id;
        tr.querySelector('[data-up]')?.addEventListener('click', async () => {
          if (i <= 0) return; [slides[i - 1], slides[i]] = [slides[i], slides[i - 1]]; render(); await persistOrder();
        });
        tr.querySelector('[data-down]')?.addEventListener('click', async () => {
          if (i >= slides.length - 1) return; [slides[i + 1], slides[i]] = [slides[i], slides[i + 1]]; render(); await persistOrder();
        });
        tr.querySelector('[data-del]')?.addEventListener('click', async () => {
          if (!confirm('Delete this slide from the homepage hero?')) return;
          try { await api('/api/admin/posts/' + encodeURIComponent(id), { method: 'DELETE' }); load(); }
          catch (e) { showAuthError(e); }
        });
      });
    }

    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!imageUrl) { msg.hidden = false; msg.textContent = 'Upload a slide image first.'; return; }
      const fd = new FormData(form);
      const body = { type: 'slide', title: (fd.get('title') || '').trim() || 'Hero slide', linkUrl: fd.get('linkUrl') || '', imageUrl, status: 'approved' };
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(body) });
        form.reset(); imageUrl = ''; if (prev) prev.innerHTML = '';
        await load();           // new slide sorts to the end (no sortOrder yet)
        await persistOrder();   // lock in 0..n so its order is explicit
        msg.hidden = false; msg.textContent = 'Slide added ✓';
      } catch (err) { msg.hidden = false; msg.textContent = 'Could not add slide.'; }
      finally { btn.disabled = false; }
    });

    load();
  }

  return { mountShell, initDashboard, initMembers, initApprovals, initOrders, initLeads, initEvents, initContent, initAssistant, initRenewals, initUsers, initGroups, initSponsorships, initSlides, api, esc };
})();
