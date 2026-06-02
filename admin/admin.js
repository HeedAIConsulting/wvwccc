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
      if (s.source === 'seed') {
        document.getElementById('dashNotice').innerHTML =
          'Showing the <strong>preview roster</strong>. Run the ChamberWare import to load all ~864 members.';
        document.getElementById('dashNotice').hidden = false;
      }
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
        <td><span class="saved-flash" data-flash>saved ✓</span></td>
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

  // ── Events (read-only management view for now) ──
  async function initEvents() {
    mountShell('events');
    try {
      const data = await (await fetch('../data/events.json')).json();
      const evs = (data.events || []).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      document.getElementById('eventRows').innerHTML = evs.map((e) => `
        <tr><td><span class="name">${esc(e.title)}</span><div class="sub">${esc(e.category || '')}</div></td>
        <td>${e.confirmed ? esc(e.month + ' ' + e.day) : '<span class="pill pill--pending">TBA</span>'}</td>
        <td>${esc(e.venue || e.neighborhood || '')}</td>
        <td>${e.ticketed ? 'Ticketed' : 'RSVP'}${e.ticketCap ? ' · cap ' + e.ticketCap : ''}</td>
        <td>${e.featured ? '<span class="pill pill--approved">Featured</span>' : ''}</td></tr>`).join('');
    } catch (e) { console.error(e); }
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body = { type: fd.get('type'), title: fd.get('title'), body: fd.get('body'), linkUrl: fd.get('linkUrl'), featuredHome: fd.get('featuredHome') === 'on' };
      const btn = form.querySelector('button[type="submit"]'); btn.disabled = true;
      try { await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(body) }); form.reset(); msg.hidden = false; msg.textContent = 'Published.'; load(); }
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
