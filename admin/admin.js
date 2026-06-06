/* ============================================================
   WVWCCC Admin Console — shell + page logic (vanilla)
   ============================================================ */
window.Admin = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const apiBase = (window.ChamberAPI ? ChamberAPI.url('') : '');

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

  const NAV = [
    { grp: 'Manage' },
    { href: 'index.html', icon: '▦', label: 'Dashboard', key: 'dashboard' },
    { href: 'members.html', icon: '◉', label: 'Members', key: 'members' },
    { href: 'approvals.html', icon: '✓', label: 'Approvals', key: 'approvals' },
    { href: 'events.html', icon: '◆', label: 'Events', key: 'events' },
    { href: 'content.html', icon: '✎', label: 'Content', key: 'content' },
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
        </div>`;
    }
  }

  function statusPill(s) { s = s || 'approved'; return `<span class="pill pill--${s}">${esc(s)}</span>`; }

  // ── Dashboard ──
  async function initDashboard() {
    mountShell('dashboard');
    try {
      const s = await api('/api/admin/summary');
      const cards = [
        { num: s.members, lbl: 'Members', },
        { num: s.pendingMembers, lbl: 'Pending approval', accent: s.pendingMembers > 0 },
        { num: s.leaders, lbl: 'Leaders / Board' },
        { num: s.newLeads, lbl: 'New inquiries', accent: s.newLeads > 0 },
        { num: s.pendingPosts, lbl: 'Pending content', accent: s.pendingPosts > 0 },
        { num: s.orders, lbl: 'Payments logged' },
        { num: '$' + (s.revenue || 0).toLocaleString(), lbl: 'Revenue processed' },
      ];
      document.getElementById('statRow').innerHTML = cards.map((c) =>
        `<div class="stat-card ${c.accent ? 'accent' : ''}"><div class="num">${esc(c.num)}</div><div class="lbl">${esc(c.lbl)}</div></div>`).join('');
      // (Roster is the imported live membership; no import-needed notice.)
      const leads = (await api('/api/admin/leads')).leads.slice(0, 5);
      document.getElementById('recentLeads').innerHTML = leads.length
        ? leads.map((l) => `<tr><td><span class="name">${esc(l.name || '—')}</span><div class="sub">${esc(l.email)}</div></td><td>${esc(l.reason || l.kind)}</td><td>${statusPill(l.status)}</td></tr>`).join('')
        : '<tr><td colspan="3" class="sub">No inquiries yet.</td></tr>';
    } catch (e) { showAuthError(e); }
  }

  // ── Members (status radios) ──
  async function initMembers() {
    mountShell('members');
    let opts = { leaderOptions: ['', 'Leader', 'Board Member', 'New Member', 'Past President', 'Ambassador'], statusOptions: ['approved', 'pending', 'suspended', 'inactive'] };
    try { opts = await api('/api/admin/options'); } catch (e) {}
    const tiers = ['platinum', 'gold', 'silver', 'bronze', 'supporter', 'member'];
    const tbody = document.getElementById('memberRows');
    const search = document.getElementById('memberSearch');

    async function load(q) {
      try {
        const { members } = await api('/api/admin/members' + (q ? `?q=${encodeURIComponent(q)}` : ''));
        document.getElementById('memberCount').textContent = `${members.length} members`;
        tbody.innerHTML = members.map((m) => row(m)).join('');
        bind();
      } catch (e) { showAuthError(e); }
    }
    function row(m) {
      const id = esc(m.id);
      const radios = opts.leaderOptions.map((o) => {
        const checked = (m.leaderStatus || '') === o ? 'checked' : '';
        const lbl = o || 'None';
        return `<input type="radio" name="ld-${id}" id="ld-${id}-${esc(o || 'none')}" value="${esc(o)}" ${checked}><label for="ld-${id}-${esc(o || 'none')}">${esc(lbl)}</label>`;
      }).join('');
      return `<tr data-id="${id}">
        <td><span class="name">${esc(m.name)}</span><div class="sub">${esc(m.category || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</div></td>
        <td><select class="admin-select" data-field="tier">${tiers.map((t) => `<option ${((m.tier || 'member') === t) ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><select class="admin-select" data-field="status">${opts.statusOptions.map((s) => `<option ${((m.status || 'approved') === s) ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
        <td><div class="radio-group" data-field="leaderStatus">${radios}</div></td>
        <td><label class="toggle"><input type="checkbox" data-field="featured" ${m.featured ? 'checked' : ''}><span class="track"></span></label></td>
        <td style="white-space:nowrap">
          <a href="../members/profile.html?id=${id}" target="_blank" title="View public profile" style="text-decoration:none;margin-right:8px">View ↗</a>
          <button type="button" data-reset title="Force a password reset at next login" style="cursor:pointer;background:none;border:1px solid var(--line,#d7d2c6);border-radius:6px;padding:3px 8px;font-size:.8rem">Reset PW</button>
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
      });
    }
    let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(search.value.trim()), 250); });
    load('');
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
    let editingId = null;
    let images = [];
    let links = [];

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
      images = ev && ev.images ? ev.images.slice() : [];
      links = ev && ev.links ? ev.links.map((l) => ({ ...l })) : [];
      renderImages(); renderLinks();
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
    fillForm(null);
    load();
  }

  // ── Content & approvals (posts) ──
  async function initContent() {
    mountShell('content');
    const TYPES = ['news', 'announcement', 'discount', 'member_post', 'event'];
    const form = document.getElementById('postForm');
    const msg = document.getElementById('postMsg');

    async function load() {
      try {
        const { posts } = await api('/api/admin/posts');
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
        <td><span class="name">${esc(p.title)}</span><div class="sub">${esc(p.authorName || '')}</div></td>
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
  }

  function showAuthError(e) {
    const m = document.getElementById('adminError');
    if (m) { m.hidden = false; m.textContent = 'Could not load admin data (' + e.message + '). If a token is required, set it via the console.'; }
    console.error(e);
  }

  return { mountShell, initDashboard, initMembers, initApprovals, initOrders, initLeads, initEvents, initContent, api, esc };
})();
