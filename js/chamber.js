/* ============================================================
   WVWCCC — front-end app logic (vanilla)
   Renders directory + events from /data, geo banner, concierge stub.
   ============================================================ */
window.Chamber = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function getJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  }

  function memberTile(m, depth) {
    const tier = (m.tier || 'member').toLowerCase();
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const href = `${depth ? '' : 'members/'}profile.html?id=${encodeURIComponent(m.id)}`;
    // NOTE: no nested <a> inside another <a> (invalid HTML). Card is an <article>;
    // the name and the action links are separate, sibling anchors.
    const phoneDigits = (m.phone || '').replace(/[^\d]/g, '');
    const phone = m.phone ? `<a href="tel:${phoneDigits}">${esc(m.phone)}</a>` : '';
    const site = m.website
      ? `<a href="${esc(m.website)}" target="_blank" rel="noopener">Visit site ↗</a>` : '';
    const meta = [m.category, m.neighborhood].filter(Boolean).map(esc).join(' · ');
    return `
      <article class="card card--hover member-tile">
        <div class="member-tile__head">
          <div class="member-tile__seal">${esc(m.seal || (m.name || '?')[0])}</div>
          <div>
            <a class="member-tile__name" href="${href}">${esc(m.name)}</a>
            <div class="member-tile__meta">${meta}</div>
          </div>
        </div>
        <span class="badge badge--${tier}">${esc(tierLabel)}</span>
        <p class="member-tile__tag">${esc(m.tagline || '')}</p>
        <div class="member-tile__links">${phone}${site}</div>
      </article>`;
  }

  function eventCard(ev, depth = 0) {
    const base = depth ? '../' : '';
    const confirmed = ev.confirmed && ev.day;
    const dateBlock = confirmed
      ? `<div class="event-date"><div class="event-date__mo">${esc(ev.month)}</div><div class="event-date__day">${esc(ev.day)}</div></div>`
      : `<div class="event-date"><div class="event-date__mo">${esc(ev.month || 'TBA')}</div><div class="event-date__day" style="font-size:1rem;padding-top:6px">·</div></div>`;
    const when = confirmed ? `${esc(ev.month)} ${esc(ev.day)} · ${esc(ev.time || '')}` : 'Date to be announced';
    const cta = ev.ticketed
      ? (confirmed
          ? `<a class="btn btn--gold btn--sm" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Get tickets</a>`
          : `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">Notify me</a>`)
      : `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a>`;
    return `
      <div class="event-row" id="${esc(ev.id)}">
        ${dateBlock}
        <div>
          <span class="badge">${esc(ev.category || 'Event')}</span>
          <h4 style="margin:6px 0 4px">${esc(ev.title)}</h4>
          <div class="member-tile__meta">${when} · ${esc(ev.venue || ev.neighborhood || '')}</div>
          <p style="margin:6px 0 0;color:var(--slate-mid);font-size:.95rem">${esc(ev.summary || '')}</p>
        </div>
        <div>${cta}</div>
      </div>`;
  }

  function initGeoBanner() {
    const banner = document.getElementById('geoBanner');
    if (!banner) return;
    const saved = localStorage.getItem('wvwccc_place');
    if (saved) {
      document.getElementById('geoPlace').textContent = saved;
      banner.hidden = false;
    }
    const change = document.getElementById('geoChange');
    if (change) change.addEventListener('click', () => {
      const place = prompt('Which neighborhood are you near?', saved || 'Woodland Hills');
      if (place) { localStorage.setItem('wvwccc_place', place); location.reload(); }
    });
  }

  function initConcierge() {
    const form = document.getElementById('conciergeForm');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('conciergeInput').value.trim();
      if (!q) return;
      // Phase 3: POST to /api/concierge. For now route to directory search.
      location.href = `members/directory.html?q=${encodeURIComponent(q)}`;
    });
  }

  async function initHome() {
    initGeoBanner();
    initConcierge();
    try {
      const [dir, evd] = await Promise.all([
        getJSON(ChamberAPI.url('/api/members')),
        getJSON('data/events.json'),
      ]);

      const members = dir.members || [];
      const statEl = document.getElementById('statMembers');
      if (statEl) statEl.textContent = members.length ? members.length + '+' : '—';

      // featured members (or first 6)
      const featured = members.filter((m) => m.featured);
      const show = (featured.length ? featured : members).slice(0, 6);
      const wrap = document.getElementById('featuredMembers');
      if (wrap) wrap.innerHTML = show.map((m) => memberTile(m, 0)).join('');

      // hero spotlight = first featured
      const hero = document.getElementById('heroFeature');
      if (hero && show[0]) {
        const m = show[0];
        hero.innerHTML = `
          <div class="member-tile">
            <div class="member-tile__head">
              <div class="member-tile__seal">${esc(m.seal || m.name[0])}</div>
              <div>
                <div class="member-tile__name" style="color:#fff">${esc(m.name)}</div>
                <div class="member-tile__meta" style="color:rgba(255,255,255,.65)">${esc(m.category)} · ${esc(m.neighborhood || '')}</div>
              </div>
            </div>
            <p style="color:rgba(255,255,255,.82);font-size:.95rem;margin:12px 0 0">${esc(m.tagline || '')}</p>
          </div>`;
      }

      // events
      const events = (evd.events || []).filter((e) => e.featured).slice(0, 3);
      const elist = document.getElementById('eventList');
      if (elist) elist.innerHTML = events.length
        ? events.map(eventCard).join('')
        : '<p class="notice">The events calendar is coming online. Check back soon or contact the Chamber office.</p>';
    } catch (err) {
      console.error('Home render failed', err);
    }
  }

  // ── Directory page ──────────────────────────────────────
  async function initDirectory() {
    initConcierge();
    const grid = document.getElementById('memberGrid');
    const params = new URLSearchParams(location.search);
    const state = {
      q: params.get('q') || '',
      category: params.get('c') || '',
      hood: params.get('n') || '',
    };
    let members = [];
    try {
      const dir = await getJSON(ChamberAPI.url('/api/members'));
      members = dir.members || [];
      if (dir._meta && dir._meta.source === 'seed') {
        document.getElementById('dataNotice').innerHTML =
          '<span class="badge badge--bronze">Preview roster</span>';
      }
    } catch (e) { console.error(e); }

    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    const cats = uniq(members.map((m) => m.category));
    const hoods = uniq(members.map((m) => m.neighborhood));

    function facetButton(label, value, key) {
      const active = state[key] === value;
      const b = document.createElement('button');
      b.className = 'chip' + (active ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { state[key] = active ? '' : value; render(); });
      return b;
    }
    function buildFacets() {
      const cf = document.getElementById('categoryFacet');
      const hf = document.getElementById('hoodFacet');
      cf.innerHTML = ''; hf.innerHTML = '';
      cf.appendChild(facetButton('All categories', '', 'category'));
      cats.forEach((c) => cf.appendChild(facetButton(c, c, 'category')));
      hf.appendChild(facetButton('All areas', '', 'hood'));
      hoods.forEach((h) => hf.appendChild(facetButton(h, h, 'hood')));
    }

    function matches(m) {
      if (state.category && m.category !== state.category) return false;
      if (state.hood && m.neighborhood !== state.hood) return false;
      if (state.q) {
        const hay = [m.name, m.category, m.neighborhood, m.tagline, (m.tags || []).join(' ')]
          .join(' ').toLowerCase();
        if (!hay.includes(state.q.toLowerCase())) return false;
      }
      return true;
    }

    function render() {
      buildFacets();
      const place = localStorage.getItem('wvwccc_place');
      let list = members.filter(matches);
      // geo: bubble the visitor's neighborhood to the top
      if (place) {
        list = list.sort((a, b) =>
          (b.neighborhood === place) - (a.neighborhood === place));
      }
      grid.innerHTML = list.map((m) => memberTile(m, 1)).join('');
      document.getElementById('resultCount').textContent =
        `${list.length} member${list.length === 1 ? '' : 's'}` +
        (state.category ? ` · ${state.category}` : '') +
        (state.hood ? ` · ${state.hood}` : '');
      document.getElementById('emptyState').hidden = list.length > 0;
    }

    const form = document.getElementById('dirSearch');
    const input = document.getElementById('dirQuery');
    input.value = state.q;
    form.addEventListener('submit', (e) => { e.preventDefault(); state.q = input.value.trim(); render(); });
    input.addEventListener('input', () => { state.q = input.value.trim(); render(); });
    const clear = document.getElementById('clearFilters');
    if (clear) clear.addEventListener('click', () => { state.q = ''; state.category = ''; state.hood = ''; input.value = ''; render(); });

    render();
  }

  // ── Member profile page ─────────────────────────────────
  async function initProfile() {
    const id = new URLSearchParams(location.search).get('id');
    const el = document.getElementById('profile');
    if (!el) return;
    let m = null;
    try {
      const dir = await getJSON(ChamberAPI.url('/api/members'));
      m = (dir.members || []).find((x) => x.id === id);
    } catch (e) { console.error(e); }
    if (!m) {
      el.innerHTML = '<p class="notice">That member could not be found. <a href="directory.html">Back to the directory</a>.</p>';
      return;
    }
    document.title = `${m.name} — WVWCCC Member`;
    const tier = (m.tier || 'member').toLowerCase();
    const phoneDigits = (m.phone || '').replace(/[^\d]/g, '');
    const rows = [
      m.phone && `<a href="tel:${phoneDigits}">${esc(m.phone)}</a>`,
      m.website && `<a href="${esc(m.website)}" target="_blank" rel="noopener">${esc(m.website.replace(/^https?:\/\//, ''))}</a>`,
      m.address && esc(m.address),
    ].filter(Boolean).map((r) => `<li>${r}</li>`).join('');
    el.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 2fr;gap:var(--s-7);align-items:start">
        <div class="card" style="text-align:center">
          <div class="member-tile__seal" style="width:96px;height:96px;font-size:2.6rem;margin:0 auto var(--s-4)">${esc(m.seal || m.name[0])}</div>
          <span class="badge badge--${tier}">${esc(tier.charAt(0).toUpperCase() + tier.slice(1))} Member</span>
          <ul style="list-style:none;margin-top:var(--s-4);display:flex;flex-direction:column;gap:8px">${rows}</ul>
        </div>
        <div>
          <span class="kicker">${esc(m.category)}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</span>
          <h1>${esc(m.name)}</h1>
          <p class="lead">${esc(m.tagline || '')}</p>
          ${(m.tags || []).length ? `<div class="chips mt-4">${m.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="btn-row mt-6">
            <a class="btn btn--forest" href="directory.html">← Back to directory</a>
            ${m.website ? `<a class="btn btn--gold" href="${esc(m.website)}" target="_blank" rel="noopener">Visit website ↗</a>` : ''}
          </div>
        </div>
      </div>`;
  }

  // ── Events page (list + month grid) ─────────────────────
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  async function initEvents() {
    const listEl = document.getElementById('eventsList');
    const gridEl = document.getElementById('eventsGrid');
    if (!listEl) return;
    let events = [];
    try {
      const data = await getJSON('../data/events.json');
      events = (data.events || []).filter((e) => e.confirmed && e.date)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) { console.error(e); }

    listEl.innerHTML = events.length
      ? events.map((e) => eventCard(e, 1)).join('')
      : '<p class="notice">The calendar is coming online. Contact the Chamber office for the latest events.</p>';

    // month grid
    function buildGrid(year, month) {
      const first = new Date(year, month, 1);
      const startDay = first.getDay();
      const days = new Date(year, month + 1, 0).getDate();
      const byDay = {};
      events.forEach((e) => {
        const d = new Date(e.date + 'T12:00:00');
        if (d.getFullYear() === year && d.getMonth() === month) {
          (byDay[d.getDate()] = byDay[d.getDate()] || []).push(e);
        }
      });
      let cells = '';
      for (let i = 0; i < startDay; i++) cells += '<div class="cal-cell cal-cell--empty"></div>';
      for (let d = 1; d <= days; d++) {
        const evs = (byDay[d] || []).map((e) =>
          `<a class="cal-event" href="#${esc(e.id)}" title="${esc(e.title)}">${esc(e.title)}</a>`).join('');
        cells += `<div class="cal-cell"><span class="cal-day">${d}</span>${evs}</div>`;
      }
      gridEl.innerHTML =
        `<div class="cal-head">${MONTHS[month]} ${year}</div>
         <div class="cal-grid">
           ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
           ${cells}
         </div>`;
    }
    // default grid month = first upcoming event's month, else current
    const seed = events[0] ? new Date(events[0].date + 'T12:00:00') : new Date(2026, 5, 1);
    buildGrid(seed.getFullYear(), seed.getMonth());

    // view toggle
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
        listEl.hidden = view !== 'list';
        gridEl.hidden = view !== 'grid';
      });
    });
  }

  // ── Checkout (AGMS / NMI Collect.js) ────────────────────
  async function initCheckout() {
    const params = new URLSearchParams(location.search);
    const kind = params.get('type') || 'donation';
    const summary = document.getElementById('orderSummary');
    const title = document.getElementById('coTitle');
    const amountInput = document.getElementById('amount');
    const amountLabel = document.getElementById('amountLabel');

    // Build the order context.
    let label = 'Payment', sku = kind, presetAmount = params.get('amount') || '';
    if (kind === 'ticket') {
      const id = params.get('event'); sku = `ticket:${id}`;
      title.textContent = 'Event tickets';
      let ev = null;
      try { ev = (await getJSON('data/events.json')).events.find((e) => e.id === id); } catch (e) {}
      label = ev ? `Tickets — ${ev.title}` : 'Event tickets';
      summary.innerHTML = ev
        ? `<strong>${esc(ev.title)}</strong><br><span class="member-tile__meta">${esc(ev.month || '')} ${esc(ev.day || '')} · ${esc(ev.venue || ev.neighborhood || '')}</span><p class="notice mt-3">Ticket pricing is set by the Chamber — enter the amount shown for your ticket type, or confirm with the office.</p>`
        : '<strong>Event tickets</strong>';
      amountLabel.textContent = 'Ticket amount (USD)';
    } else if (kind === 'membership') {
      const tier = params.get('tier') || 'membership'; sku = `membership:${tier}`;
      title.textContent = 'Chamber membership';
      label = `Membership — ${tier}`;
      summary.innerHTML = `<strong>Annual membership</strong><br><span class="member-tile__meta">${esc(tier)}</span><p class="notice mt-3">Dues are based on number of employees — enter the amount from your tier, or contact the office.</p>`;
      amountLabel.textContent = 'Dues amount (USD)';
    } else {
      const project = params.get('project') || 'General Fund'; sku = `donation:${project}`;
      title.textContent = 'Make a donation';
      label = `Donation — ${project}`;
      summary.innerHTML = `<strong>Donation</strong><br><span class="member-tile__meta">${esc(project)}</span>`;
      amountLabel.textContent = 'Donation amount (USD)';
    }
    if (presetAmount) amountInput.value = presetAmount;

    const cfg = window.WVWCCC_PAY || {};
    const form = document.getElementById('payForm');
    const errEl = document.getElementById('payError');
    const showErr = (m) => { errEl.textContent = m; errEl.hidden = false; };

    // No tokenization key yet → show notice, keep UI but block live submit.
    if (!cfg.tokenizationKey) {
      document.getElementById('sandboxNotice').hidden = false;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        showErr('Card processing is not enabled yet (AGMS sandbox key pending). Your details look good — add the key to go live.');
      });
      return;
    }

    // Load Collect.js with the tokenization key and wire inline fields.
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = cfg.collectSrc;
      s.setAttribute('data-tokenization-key', cfg.tokenizationKey);
      s.onload = resolve; s.onerror = () => reject(new Error('Collect.js failed to load'));
      document.head.appendChild(s);
    }).catch((e) => showErr(e.message));

    if (!window.CollectJS) return;
    window.CollectJS.configure({
      variant: 'inline',
      fields: {
        ccnumber: { selector: '#ccnumber', placeholder: '•••• •••• •••• ••••' },
        ccexp: { selector: '#ccexp', placeholder: 'MM / YY' },
        cvv: { selector: '#cvv', placeholder: 'CVV' },
      },
      callback: async (resp) => {
        try {
          const fd = new FormData(form);
          const body = {
            kind, sku,
            paymentToken: resp.token,
            amount: amountInput.value,
            firstName: fd.get('firstName'), lastName: fd.get('lastName'), email: fd.get('email'),
            description: label,
          };
          if (kind === 'membership') body.recurring = { monthFrequency: 12, dayOfMonth: 1, planPayments: 0 };
          const r = await fetch(ChamberAPI.url('/api/pay'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const data = await r.json();
          if (!data.ok) return showErr(data.error || 'Payment declined.');
          form.hidden = true;
          document.getElementById('paySuccess').hidden = false;
          document.getElementById('txnId').textContent = data.transactionId || '—';
        } catch (e) { showErr('Could not complete payment. Please try again.'); }
      },
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault(); errEl.hidden = true;
      if (!form.reportValidity()) return;
      window.CollectJS.startPaymentRequest();
    });
  }

  // ── Generic lead/contact form → /api/contact ────────────
  function initLeadForm(formId, msgId, kind) {
    const form = document.getElementById(formId);
    const msg = document.getElementById(msgId);
    if (!form) return;
    // prefill reason from ?reason= or ?event=
    const params = new URLSearchParams(location.search);
    const reason = form.querySelector('[name="reason"]');
    if (reason && params.get('reason')) {
      [...reason.options].forEach((o) => { if (o.value === params.get('reason')) reason.value = o.value; });
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const payload = { kind };
      new FormData(form).forEach((v, k) => { payload[k] = v; });
      if (params.get('event')) payload.event = params.get('event');
      const btn = form.querySelector('button[type="submit"]');
      const label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await fetch(ChamberAPI.url('/api/contact'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        const data = await r.json();
        msg.hidden = false;
        if (data.ok) {
          form.reset();
          msg.textContent = 'Thank you — your message has been sent. The Chamber will be in touch.';
          msg.style.borderColor = 'var(--green)';
        } else {
          msg.textContent = data.error || 'Something went wrong. Please call (818) 347-4737.';
        }
      } catch (err) {
        msg.hidden = false;
        msg.textContent = 'Could not send right now. Please call the office at (818) 347-4737.';
      } finally { btn.disabled = false; btn.textContent = label; }
    });
  }

  // ── Jobs board ──────────────────────────────────────────
  async function initJobs() {
    const list = document.getElementById('jobsList');
    const count = document.getElementById('jobsCount');
    let jobs = [];
    try { jobs = (await getJSON('../data/jobs.json')).jobs || []; } catch (e) {}
    if (!jobs.length) {
      count.textContent = '';
      list.innerHTML = `<div class="notice">The jobs board is being imported from the Chamber's system. Check back soon — or <a href="../contact.html?reason=Jobs">post an opening</a> to be among the first listed.</div>`;
      return;
    }
    count.textContent = `${jobs.length} open position${jobs.length === 1 ? '' : 's'}`;
    list.innerHTML = jobs.map((j) => `
      <article class="card card--hover">
        <div style="display:flex;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap">
          <div>
            <h3>${esc(j.title)}</h3>
            <div class="member-tile__meta">${esc(j.company || '')}${j.location ? ' · ' + esc(j.location) : ''}${j.type ? ' · ' + esc(j.type) : ''}</div>
          </div>
          ${j.applyUrl ? `<a class="btn btn--gold btn--sm" href="${esc(j.applyUrl)}" target="_blank" rel="noopener">Apply</a>` : ''}
        </div>
        ${j.summary ? `<p class="mt-3">${esc(j.summary)}</p>` : ''}
      </article>`).join('');
  }

  return { initHome, initDirectory, initProfile, initEvents, initCheckout, initLeadForm, initJobs, memberTile, eventCard, getJSON, esc };
})();
