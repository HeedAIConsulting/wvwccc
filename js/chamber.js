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
    const href = m.slug ? '/members/' + m.slug : `${depth ? '' : 'members/'}profile.html?id=${encodeURIComponent(m.id)}`;
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

  // Reusable share row: social + email + SMS + copy/native-share. Pure HTML;
  // the copy/native button is handled by one delegated listener (below).
  function shareMenu(title, url) {
    const t = encodeURIComponent(title || 'West Valley · Warner Center Chamber');
    const u = encodeURIComponent(url);
    const body = encodeURIComponent((title ? title + ' — ' : '') + url);
    return `<div class="share-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center">
      <span class="member-tile__meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.04em">Share</span>
      <a class="chip" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${u}" aria-label="Share on Facebook">Facebook</a>
      <a class="chip" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${t}&url=${u}" aria-label="Share on X">X</a>
      <a class="chip" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" aria-label="Share on LinkedIn">LinkedIn</a>
      <a class="chip" href="mailto:?subject=${t}&body=${body}" aria-label="Share by email">Email</a>
      <a class="chip" href="sms:?&body=${body}" aria-label="Share by text message">Text</a>
      <button class="chip" type="button" data-share-copy="${esc(url)}" aria-label="Copy or share link">🔗 Copy</button>
    </div>`;
  }
  if (typeof document !== 'undefined' && !window.__wvShareBound) {
    window.__wvShareBound = true;
    document.addEventListener('click', (e) => {
      const c = e.target.closest('[data-share-copy]');
      if (!c) return;
      e.preventDefault();
      const url = c.getAttribute('data-share-copy');
      const flash = () => { const o = c.textContent; c.textContent = '✓ Copied'; setTimeout(() => { c.textContent = o; }, 1500); };
      if (navigator.share) { navigator.share({ url }).catch(() => {}); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(flash).catch(() => prompt('Copy this link:', url));
      else prompt('Copy this link:', url);
    });
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
          ${shareMenu(ev.title, location.origin + '/events/index.html#' + encodeURIComponent(ev.id))}
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
    const input = document.getElementById('conciergeInput');
    // results panel injected right after the form
    let panel = document.getElementById('conciergeResults');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'conciergeResults';
      panel.hidden = true;
      panel.style.cssText = 'margin-top:var(--s-4);text-align:left';
      form.insertAdjacentElement('afterend', panel);
    }
    const card = (m) => `<a class="card" href="${m.slug ? '/members/' + m.slug : 'members/profile.html?id=' + encodeURIComponent(m.id)}" style="display:flex;gap:12px;align-items:center;text-decoration:none;padding:12px">
        ${m.logo ? `<img src="${esc(m.logo)}" alt="" style="width:46px;height:46px;border-radius:10px;object-fit:cover;flex:none">` : `<span class="member-tile__seal" style="width:46px;height:46px;flex:none">${esc(m.seal || m.name[0])}</span>`}
        <span><strong>${esc(m.name)}</strong><br><span class="member-tile__meta">${esc(m.category || m.group || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</span></span></a>`;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      panel.hidden = false;
      panel.innerHTML = '<p class="member-tile__meta">Asking the Concierge…</p>';
      try {
        const res = await fetch(ChamberAPI.url('/api/concierge'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'failed');
        const members = data.members || [];
        panel.innerHTML =
          `<div class="card" style="background:var(--forest,#1f4d3a);color:#fff;padding:14px 16px;margin-bottom:12px">💬 ${esc(data.answer || '')}</div>` +
          (members.length ? `<div class="grid grid-2" style="gap:10px">${members.map(card).join('')}</div>` : '') +
          `<div class="mt-3"><a class="member-tile__meta" style="text-decoration:underline" href="members/directory.html?q=${encodeURIComponent(q)}">See all directory matches →</a></div>`;
      } catch (err) {
        // graceful fallback: send them to the ranked directory search
        location.href = `members/directory.html?q=${encodeURIComponent(q)}`;
      }
    });
  }

  // ── Hero event-photo slider (admin-managed) ──
  async function initHomeSlider() {
    const hero = document.querySelector('.hero');
    if (!hero) return;
    let slides = [];
    try { slides = (await getJSON(ChamberAPI.url('/api/slides'))).slides || []; } catch (e) { return; }
    if (!slides.length) return; // keep the solid green hero
    const layer = document.createElement('div');
    layer.className = 'hero__slides';
    layer.innerHTML = slides.map((s, i) =>
      `<div class="hero__slide${i === 0 ? ' is-active' : ''}" style="background-image:url('${esc(s.imageUrl)}')"></div>`).join('')
      + '<div class="hero__overlay"></div>';
    hero.prepend(layer);
    if (slides.length < 2) return;
    const dots = document.createElement('div');
    dots.className = 'hero__dots';
    dots.innerHTML = slides.map((_, i) => `<button class="${i === 0 ? 'is-active' : ''}" aria-label="Slide ${i + 1}"></button>`).join('');
    hero.appendChild(dots);
    const slideEls = [...layer.querySelectorAll('.hero__slide')];
    const dotEls = [...dots.querySelectorAll('button')];
    let idx = 0;
    const go = (n) => { idx = (n + slides.length) % slides.length; slideEls.forEach((el, i) => el.classList.toggle('is-active', i === idx)); dotEls.forEach((el, i) => el.classList.toggle('is-active', i === idx)); };
    dotEls.forEach((d, i) => d.addEventListener('click', () => go(i)));
    setInterval(() => go(idx + 1), 5500);
  }

  async function initHome() {
    initGeoBanner();
    initConcierge();
    initHomeSlider();
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

      // recently active members (members who signed in most recently)
      try {
        const recent = (await getJSON(ChamberAPI.url('/api/members/recent'))).members || [];
        const rwrap = document.getElementById('recentMembers');
        if (rwrap && recent.length) {
          rwrap.innerHTML = recent.slice(0, 8).map((m) => memberTile(m, 0)).join('');
          document.getElementById('recentSection').hidden = false;
        }
      } catch (e) { /* no recent logins yet */ }

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
    // Facet on the ~20 indexed parent groups, not the 600+ raw categories.
    const cats = uniq(members.map((m) => m.group || 'Other'));
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

    // Relevance score. -1 = filtered out / no match. Higher = better.
    // Each query word must hit SOME field; matches in name/category rank far
    // above incidental description mentions, and whole-word beats substring
    // (so "hospital" doesn't rank "hospitality" venues at the top).
    function scoreOf(m) {
      if (state.category && (m.group || 'Other') !== state.category) return -1;
      if (state.hood && m.neighborhood !== state.hood) return -1;
      if (!state.q) return 0;
      const fields = [[m.name, 10], [m.category, 6], [m.typeOfBusiness, 6], [m.group, 5],
        [m.neighborhood, 4], [m.city, 4], [m.contactName, 3], [m.tagline, 3],
        [(m.tags || []).join(' '), 2], [m.description, 1]];
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      let total = 0;
      for (const w of words) {
        const wb = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        let best = 0;
        for (const [val, wt] of fields) {
          if (!val) continue;
          const lv = String(val).toLowerCase();
          if (wb.test(lv)) best = Math.max(best, wt * 2);
          else if (lv.includes(w)) best = Math.max(best, wt);
        }
        if (best === 0) return -1;   // a query word matched nothing → not a result
        total += best;
      }
      return total;
    }

    function render() {
      buildFacets();
      const place = localStorage.getItem('wvwccc_place');
      let scored = members.map((m) => [m, scoreOf(m)]).filter(([, s]) => s >= 0);
      if (state.q) {
        scored.sort((a, b) => b[1] - a[1]);                                  // best matches first
      } else if (place) {
        scored.sort((a, b) => (b[0].neighborhood === place) - (a[0].neighborhood === place));
      }
      const list = scored.map(([m]) => m);
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
    // Resolve by ?id= (legacy) OR the slug in a pretty URL (/members/<slug>, /m/<slug>).
    let key = new URLSearchParams(location.search).get('id');
    if (!key) {
      const seg = location.pathname.split('/').filter(Boolean).pop() || '';
      if (seg && !/\.html?$/.test(seg)) key = decodeURIComponent(seg);
    }
    const el = document.getElementById('profile');
    if (!el) return;
    let m = null;
    try {
      const dir = await getJSON(ChamberAPI.url('/api/members'));
      m = (dir.members || []).find((x) => x.id === key || x.slug === key);
    } catch (e) { console.error(e); }
    if (!m) {
      el.innerHTML = '<p class="notice">That member could not be found. <a href="directory.html">Back to the directory</a>.</p>';
      return;
    }
    document.title = `${m.name} — WVWCCC Member`;
    const tier = (m.tier || 'member').toLowerCase();
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const phoneDigits = (m.phone || '').replace(/[^\d]/g, '');
    // Shorten long URLs (e.g. instagram.com/longhandle/) for the narrow card.
    const webLabel = (u) => { const s = String(u).replace(/^https?:\/\//i, '').replace(/\/$/, ''); return s.length > 28 ? s.slice(0, 27) + '…' : s; };
    const SOCIAL = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X', youtube: 'YouTube', tiktok: 'TikTok' };
    const social = m.social && typeof m.social === 'object'
      ? Object.entries(SOCIAL).filter(([k]) => m.social[k]).map(([k, label]) =>
          `<a class="chip" href="${esc(m.social[k])}" target="_blank" rel="noopener">${label}</a>`).join('') : '';
    const reviews = m.reviewLinks && typeof m.reviewLinks === 'object'
      ? ['google', 'yelp'].filter((k) => m.reviewLinks[k]).map((k) =>
          `<a class="chip" href="${esc(m.reviewLinks[k])}" target="_blank" rel="noopener">★ ${k === 'google' ? 'Google' : 'Yelp'} reviews</a>`).join('') : '';
    const ctas = Array.isArray(m.ctaLinks) ? m.ctaLinks.map((c) =>
      `<a class="btn btn--gold btn--sm" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a>`).join('') : '';
    const photos = Array.isArray(m.photos) && m.photos.length
      ? `<div class="grid grid-3 mt-5">${m.photos.map((p) => `<img src="${esc(p)}" alt="" loading="lazy" style="border-radius:var(--r-md);aspect-ratio:4/3;object-fit:cover;width:100%">`).join('')}</div>` : '';
    const facts = [
      m.occupation && ['Occupation', m.occupation],
      m.typeOfBusiness && ['Type of business', m.typeOfBusiness],
      m.yearEstablished && ['Established', m.yearEstablished],
      m.employees && ['Employees', m.employees],
      m.hours && ['Hours', m.hours],
    ].filter(Boolean).map(([k, v]) => `<li><span class="member-tile__meta">${esc(k)}</span><br>${esc(v)}</li>`).join('');
    const seal = m.logo
      ? `<img src="${esc(m.logo)}" alt="${esc(m.name)} logo" style="width:120px;height:120px;border-radius:var(--r-lg);object-fit:cover;margin:0 auto var(--s-4);box-shadow:var(--sh-sm)">`
      : `<div class="member-tile__seal" style="width:100px;height:100px;font-size:2.8rem;margin:0 auto var(--s-4)">${esc(m.seal || m.name[0])}</div>`;
    const contactRows = [
      m.phone && `<li>📞 <a href="tel:${phoneDigits}">${esc(m.phone)}</a></li>`,
      m.website && `<li>🌐 <a href="${esc(m.website)}" target="_blank" rel="noopener" title="${esc(m.website)}">${esc(webLabel(m.website))}</a></li>`,
      m.address && `<li>📍 ${esc(m.address)}</li>`,
    ].filter(Boolean).join('');

    el.innerHTML = `
      <div class="grid" style="grid-template-columns:300px 1fr;gap:var(--s-7);align-items:start">
        <aside class="card" style="text-align:center;position:sticky;top:100px">
          ${seal}
          <span class="badge badge--${tier}">${esc(tierLabel)} Member</span>
          ${m.leaderStatus ? `<div class="mt-3"><span class="badge badge--leader badge--dot">${esc(m.leaderStatus)}</span></div>` : ''}
          <ul style="list-style:none;margin-top:var(--s-4);display:flex;flex-direction:column;gap:10px;text-align:left;overflow-wrap:anywhere;word-break:break-word">${contactRows}</ul>
          ${ctas ? `<div class="btn-row mt-4" style="justify-content:center">${ctas}</div>` : ''}
          ${(social || reviews) ? `<div class="chips mt-4" style="justify-content:center">${social}${reviews}</div>` : ''}
        </aside>
        <div>
          <span class="kicker">${esc(m.category || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</span>
          <h1>${esc(m.name)}</h1>
          <p class="lead">${esc(m.tagline || '')}</p>
          ${m.description ? `<p>${esc(m.description)}</p>` : ''}
          ${facts ? `<ul class="grid grid-3 mt-5" style="list-style:none;gap:var(--s-4)">${facts}</ul>` : ''}
          ${photos}
          <div id="memberOffers" class="mt-6"></div>
          <div class="btn-row mt-6">
            <a class="btn btn--forest" href="directory.html">← Back to directory</a>
            ${m.website ? `<a class="btn btn--ghost" href="${esc(m.website)}" target="_blank" rel="noopener">Visit website ↗</a>` : ''}
            <button class="btn btn--ghost" id="copyShareLink" type="button">🔗 Copy link</button>
          </div>
        </div>
      </div>`;

    // Shareable short URL: chamberdomain/m/<slug>
    const shareBtn = document.getElementById('copyShareLink');
    if (shareBtn) shareBtn.addEventListener('click', () => {
      const url = location.origin + '/m/' + (m.slug || m.id);
      const done = () => { shareBtn.textContent = '✓ Link copied'; setTimeout(() => { shareBtn.textContent = '🔗 Copy link'; }, 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => prompt('Copy this link:', url));
      else prompt('Copy this link:', url);
    });

    // this member's active offers
    try {
      const offers = (await getJSON(ChamberAPI.url('/api/posts?type=discount'))).posts.filter((p) => p.memberId === m.id);
      if (offers.length) document.getElementById('memberOffers').innerHTML =
        `<h3>Member offers</h3><div class="grid grid-2 mt-3">${offers.map(offerCard).join('')}</div>`;
    } catch (e) {}
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
  // Cloudflare Turnstile captcha — added to a form when a site key is configured
  // (js/api-base.js). The widget injects a hidden cf-turnstile-response input that
  // FormData picks up; verified server-side. No-op until the key is set.
  function mountTurnstile(form) {
    const key = window.ChamberAPI && ChamberAPI.turnstileSiteKey;
    if (!key || !form || form.querySelector('.cf-turnstile')) return;
    if (!document.getElementById('cf-turnstile-script')) {
      const s = document.createElement('script');
      s.id = 'cf-turnstile-script';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    const div = document.createElement('div');
    div.className = 'cf-turnstile';
    div.setAttribute('data-sitekey', key);
    div.style.margin = '16px 0';
    const btn = form.querySelector('button[type="submit"]');
    if (btn) form.insertBefore(div, btn); else form.appendChild(div);
  }

  function initLeadForm(formId, msgId, kind) {
    const form = document.getElementById(formId);
    const msg = document.getElementById(msgId);
    if (!form) return;
    mountTurnstile(form);
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

  // ── Posts: discounts (offers) + member community board ──
  function offerCard(p) {
    return `
      <article class="card card--hover">
        ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-md);margin-bottom:var(--s-3)">` : ''}
        <span class="badge badge--gold">Offer</span>
        <h3 style="margin:8px 0 4px">${esc(p.title)}</h3>
        ${p.authorName ? `<div class="member-tile__meta">${p.memberId ? `<a href="members/profile.html?id=${esc(p.memberId)}">${esc(p.authorName)}</a>` : esc(p.authorName)}</div>` : ''}
        <p class="mt-2">${esc(p.body || '')}</p>
        ${p.code ? `<p class="mt-2"><span class="badge">Code: ${esc(p.code)}</span></p>` : ''}
        ${p.ctaUrl ? `<a class="btn btn--gold btn--sm mt-3" href="${esc(p.ctaUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || 'Redeem')}</a>` : ''}
        ${shareMenu((p.title || 'Member offer') + ' — WVWCCC', location.origin + '/deals.html')}
      </article>`;
  }
  function postCard(p) {
    return `
      <article class="card">
        ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-md);margin-bottom:var(--s-3)">` : ''}
        <div class="member-tile__meta">${esc(p.authorName || 'Member')}${p.created ? ' · ' + new Date(p.created).toLocaleDateString() : ''}</div>
        <h3 style="margin:4px 0">${esc(p.title)}</h3>
        <p>${esc(p.body || '')}</p>
        ${p.linkUrl ? `<a href="${esc(p.linkUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || 'Learn more')} ↗</a>` : ''}
        ${shareMenu((p.title || 'Chamber update') + ' — WVWCCC', location.origin + '/community/board.html')}
      </article>`;
  }
  async function initPostsFeed(type, containerId, render, empty) {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const posts = (await getJSON(ChamberAPI.url('/api/posts?type=' + type))).posts || [];
      el.innerHTML = posts.length ? posts.map(render).join('') : `<div class="notice">${empty}</div>`;
    } catch (e) { el.innerHTML = '<div class="notice">Could not load right now.</div>'; }
  }
  const initDeals = () => initPostsFeed('discount', 'dealsList', offerCard, 'No member offers yet — check back soon, or members can post one from their portal.');
  const initCommunity = () => initPostsFeed('member_post', 'communityList', postCard, 'No community posts yet. Members can post the first one from their portal.');

  // ── Dining Guide — Chamber member restaurants only ──
  const DINING_RE = /restaurant|dining|food|caf[eé]|bakery|steak|grill|eatery|coffee|catering|\bbar\b|brewery|deli|pizza|cuisine|kitchen|bistro|diner|\bpub\b|juice|dessert|ice ?cream|hoagie|sandwich|taco|sushi|bbq|churrasc/i;
  function diningCard(m) {
    const seal = m.logo
      ? `<img src="${esc(m.logo)}" alt="" loading="lazy" style="width:64px;height:64px;border-radius:12px;object-fit:cover">`
      : `<div class="member-tile__seal">${esc(m.seal || m.name[0])}</div>`;
    const phoneDigits = (m.phone || '').replace(/[^\d]/g, '');
    const tags = (m.tags || []).slice(0, 4).map((t) => `<span class="chip">${esc(t)}</span>`).join('');
    return `
      <article class="card card--hover member-tile">
        <div class="member-tile__head">${seal}
          <div><a class="member-tile__name" href="${m.slug ? '/members/' + m.slug : 'members/profile.html?id=' + encodeURIComponent(m.id)}">${esc(m.name)}</a>
          <div class="member-tile__meta">${esc(m.category || 'Dining')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</div></div>
        </div>
        <p class="member-tile__tag">${esc(m.tagline || '')}</p>
        ${tags ? `<div class="chips">${tags}</div>` : ''}
        <div class="member-tile__links">
          ${m.phone ? `<a href="tel:${phoneDigits}">${esc(m.phone)}</a>` : ''}
          ${m.website ? `<a href="${esc(m.website)}" target="_blank" rel="noopener">Menu / site ↗</a>` : ''}
        </div>
      </article>`;
  }
  async function initDining() {
    const grid = document.getElementById('diningGrid');
    if (!grid) return;
    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; } catch (e) {}
    const dining = members.filter((m) => DINING_RE.test(m.category || '') || (m.tags || []).some((t) => DINING_RE.test(t)));
    const cnt = document.getElementById('diningCount');
    if (cnt) cnt.textContent = dining.length ? `${dining.length} member dining spot${dining.length === 1 ? '' : 's'}` : '';
    grid.innerHTML = dining.length
      ? dining.map(diningCard).join('')
      : '<div class="notice">Member restaurants will appear here as the directory fills in. Are you a Chamber-member eatery? <a href="join.html">Join the Chamber</a>.</div>';
  }

  return { initHome, initDirectory, initProfile, initEvents, initCheckout, initLeadForm, initJobs, initDeals, initCommunity, initDining, offerCard, postCard, memberTile, eventCard, getJSON, esc };
})();
