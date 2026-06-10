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

  // ── Add-to-calendar helpers (Google / Outlook web / Apple .ics) ──
  function _pad(n) { return String(n).padStart(2, '0'); }
  function _parseTime(s) {
    const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(String(s || ''));
    if (!m) return null;
    let h = parseInt(m[1], 10); const min = m[2] ? parseInt(m[2], 10) : 0;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return { h, min };
  }
  function _calRange(ev) {
    if (!ev.date) return null;
    const t = _parseTime(ev.time);
    if (!t) {
      const s = new Date(ev.date + 'T00:00:00');
      const e = new Date((ev.endDate || ev.date) + 'T00:00:00'); e.setDate(e.getDate() + 1);
      return { allDay: true, start: s, end: e };
    }
    const s = new Date(ev.date + 'T' + _pad(t.h) + ':' + _pad(t.min) + ':00');
    const et = _parseTime(ev.endTime);
    let e;
    if (ev.endDate || et) {
      const tt = et || { h: (t.h + 2) % 24, min: t.min };
      e = new Date((ev.endDate || ev.date) + 'T' + _pad(tt.h) + ':' + _pad(tt.min) + ':00');
    } else { e = new Date(s.getTime() + 2 * 3600 * 1000); }
    return { allDay: false, start: s, end: e };
  }
  function _ymd(d) { return '' + d.getFullYear() + _pad(d.getMonth() + 1) + _pad(d.getDate()); }
  function _hms(d) { return _pad(d.getHours()) + _pad(d.getMinutes()) + '00'; }
  function _gcal(d, allDay) { return allDay ? _ymd(d) : _ymd(d) + 'T' + _hms(d); }
  function _icsEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function calendarMenu(ev) {
    const r = _calRange(ev); if (!r) return '';
    const loc = ev.venue || ev.address || ev.neighborhood || '';
    const details = (ev.summary || '') + (ev.links && ev.links.length ? '\n\n' + ev.links.map((l) => l.label + ': ' + l.url).join('\n') : '');
    const g = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + '&text=' + encodeURIComponent(ev.title || 'Event')
      + '&dates=' + _gcal(r.start, r.allDay) + '%2F' + _gcal(r.end, r.allDay)
      + '&details=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(loc);
    const o = 'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent'
      + '&subject=' + encodeURIComponent(ev.title || 'Event')
      + '&startdt=' + encodeURIComponent(r.start.toISOString()) + '&enddt=' + encodeURIComponent(r.end.toISOString())
      + '&body=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(loc);
    const dtStart = r.allDay ? 'DTSTART;VALUE=DATE:' + _ymd(r.start) : 'DTSTART:' + _ymd(r.start) + 'T' + _hms(r.start);
    const dtEnd = r.allDay ? 'DTEND;VALUE=DATE:' + _ymd(r.end) : 'DTEND:' + _ymd(r.end) + 'T' + _hms(r.end);
    const now = new Date();
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WVWCCC//Events//EN', 'BEGIN:VEVENT',
      'UID:' + (ev.id || 'ev') + '@wvwccc', 'DTSTAMP:' + _ymd(now) + 'T' + _hms(now),
      dtStart, dtEnd, 'SUMMARY:' + _icsEsc(ev.title), 'LOCATION:' + _icsEsc(loc), 'DESCRIPTION:' + _icsEsc(details),
      'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const icsHref = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    return `<div class="cal-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center">
      <span class="member-tile__meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.04em">Add to calendar</span>
      <a class="chip" target="_blank" rel="noopener" href="${g}">Google</a>
      <a class="chip" target="_blank" rel="noopener" href="${o}">Outlook</a>
      <a class="chip" download="${esc((ev.id || 'event') + '.ics')}" href="${icsHref}">Apple / .ics</a>
    </div>`;
  }

  // ── Event detail modal (click an event to see full info, links, images) ──
  const _eventReg = {};
  function fullDate(ev) {
    if (!ev.date) return 'Date to be announced';
    const d = new Date(ev.date + 'T12:00:00');
    if (isNaN(d)) return ev.month ? ev.month + ' ' + ev.day : '';
    let s = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (ev.endDate && ev.endDate !== ev.date) {
      const e = new Date(ev.endDate + 'T12:00:00');
      if (!isNaN(e)) s += ' – ' + e.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    }
    if (ev.time) s += ' · ' + ev.time + (ev.endTime ? '–' + ev.endTime : '');
    return s;
  }
  function openEventModal(ev) {
    if (!ev) return;
    const base = /\/(events|members|member|community|admin|auth|es)\//.test(location.pathname) ? '../' : '';
    const loc = [ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · ');
    const imgs = (ev.images && ev.images.length)
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px">${ev.images.slice(0, 3).map((u) => `<img src="${esc(u)}" alt="" style="width:100%;max-width:180px;height:130px;object-fit:cover;border-radius:10px">`).join('')}</div>` : '';
    const links = (ev.links && ev.links.length)
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px">${ev.links.map((l) => `<a class="btn btn--gold btn--sm" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.label || l.type || 'Details')}</a>`).join('')}</div>` : '';
    const cta = ev.ticketed
      ? `<a class="btn btn--gold" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Get tickets</a>`
      : `<a class="btn btn--forest" href="${base}contact.html?event=${esc(ev.id)}">RSVP / Notify me</a>`;
    const desc = ev.description || ev.summary || '';
    const overlay = document.createElement('div');
    overlay.className = 'ev-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,30,25,.55);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;z-index:9999;overflow-y:auto';
    overlay.innerHTML = `
      <div role="dialog" aria-modal="true" style="background:#fff;max-width:680px;width:100%;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:24px 26px;position:relative">
        <button aria-label="Close" data-ev-close style="position:absolute;top:12px;right:14px;border:none;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:#666">×</button>
        <span class="badge">${esc(ev.category || 'Event')}</span>
        <h2 style="margin:8px 0 6px;font-size:1.5rem">${esc(ev.title)}</h2>
        <div style="color:var(--forest,#1f4d3a);font-weight:600;margin-bottom:4px">📅 ${esc(fullDate(ev))}</div>
        ${loc ? `<div class="member-tile__meta" style="margin-bottom:14px">📍 ${esc(loc)}</div>` : '<div style="margin-bottom:10px"></div>'}
        ${imgs}
        ${desc ? `<div style="white-space:pre-wrap;line-height:1.6;color:var(--slate-mid,#333);margin:0 0 16px">${esc(desc)}</div>` : ''}
        ${links}
        ${ev.confirmed ? calendarMenu(ev) : ''}
        ${shareMenu(ev.title, location.origin + (base ? '/' : location.pathname) + (base ? 'events/index.html' : '') + '#' + encodeURIComponent(ev.id))}
        <div style="margin-top:18px">${cta}</div>
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-ev-close]')) close(); });
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });
    document.body.appendChild(overlay);
  }
  if (typeof document !== 'undefined' && !window.__wvEventBound) {
    window.__wvEventBound = true;
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ev-detail]');
      if (!t) return;
      if (e.target.closest('a,button')) return; // let real buttons/links work
      e.preventDefault();
      openEventModal(_eventReg[t.getAttribute('data-ev-detail')]);
    });
  }

  function eventCard(ev, depth = 0) {
    _eventReg[ev.id] = ev;
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
    const imgs = (ev.images && ev.images.length)
      ? `<div class="event-imgs" style="display:flex;gap:6px;margin:8px 0 0;flex-wrap:wrap">${ev.images.slice(0, 3).map((u) => `<img src="${esc(u)}" alt="" loading="lazy" style="width:88px;height:64px;object-fit:cover;border-radius:8px">`).join('')}</div>`
      : '';
    const links = (ev.links && ev.links.length)
      ? `<div class="event-links" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0">${ev.links.map((l) => `<a class="chip chip--gold" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.label || l.type || 'Details')}</a>`).join('')}</div>`
      : '';
    return `
      <div class="event-row" id="${esc(ev.id)}" data-ev-detail="${esc(ev.id)}" style="cursor:pointer">
        ${dateBlock}
        <div>
          <span class="badge">${esc(ev.category || 'Event')}</span>
          <h4 style="margin:6px 0 4px">${esc(ev.title)} <span style="color:var(--gold-bright,#b8860b);font-size:.8rem;font-weight:600">Details →</span></h4>
          <div class="member-tile__meta">${when} · ${esc(ev.venue || ev.neighborhood || '')}</div>
          <p style="margin:6px 0 0;color:var(--slate-mid);font-size:.95rem">${esc(ev.summary || '')}</p>
          ${imgs}
          ${links}
          ${confirmed ? calendarMenu(ev) : ''}
          ${shareMenu(ev.title, location.origin + '/events/index.html#' + encodeURIComponent(ev.id))}
        </div>
        <div>${cta}</div>
      </div>`;
  }

  // Image-forward "upcoming events" preview (homepage). Big flyer thumbnail +
  // title/date/summary + CTAs; clicking anywhere but a real link opens the modal.
  function eventPreviewCard(ev, depth = 0) {
    _eventReg[ev.id] = ev;
    const base = depth ? '../' : '';
    const img = ev.image || (ev.images && ev.images[0]) || '';
    const media = img
      ? `<div class="evp__media" style="background-image:url('${esc(base + img)}')" role="img" aria-label="${esc(ev.title)} flyer"></div>`
      : `<div class="evp__media evp__media--ph"><span>${esc(ev.month || 'TBA')}</span><strong>${esc(ev.day || '·')}</strong></div>`;
    const when = (ev.confirmed && ev.day)
      ? `${esc(ev.month)} ${esc(ev.day)}${ev.time ? ' · ' + esc(ev.time) : ''}`
      : 'Date to be announced';
    const loc = [ev.venue, ev.neighborhood].filter(Boolean).map(esc).join(' · ');
    const cta = ev.ticketed
      ? `<a class="btn btn--gold btn--sm" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Buy tickets</a>`
      : `<a class="btn btn--forest btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a>`;
    return `
      <article class="evp card--hover" id="${esc(ev.id)}" data-ev-detail="${esc(ev.id)}">
        ${media}
        <div class="evp__body">
          <span class="badge">${esc(ev.category || 'Event')}</span>
          <h3 class="evp__title">${esc(ev.title)}</h3>
          <div class="evp__meta">📅 ${when}${loc ? ' · ' + loc : ''}</div>
          <p class="evp__sum">${esc(ev.summary || ev.description || '')}</p>
          <div class="evp__cta">
            <span class="btn btn--ghost btn--sm" role="button" tabindex="0">View details →</span>
            ${cta}
          </div>
        </div>
      </article>`;
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
      panel.innerHTML = '<p class="member-tile__meta">Asking Wendy…</p>';
      try {
        const res = await fetch(ChamberAPI.url('/api/concierge'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'failed');
        const members = data.members || [];
        panel.innerHTML =
          `<div class="card" style="background:var(--forest,#1f4d3a);color:#fff;padding:14px 16px;margin-bottom:12px"><strong>💬 Wendy:</strong> ${esc(data.answer || '')}</div>` +
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
        getJSON(ChamberAPI.url('/api/events')).catch(() => getJSON('data/events.json')).catch(() => ({ events: [] })),
      ]);

      const members = dir.members || [];
      const statEl = document.getElementById('statMembers');
      if (statEl) statEl.textContent = members.length ? members.length + '+' : '—';

      // featured members (or first 6)
      const featured = members.filter((m) => m.featured);
      const show = (featured.length ? featured : members).slice(0, 6);
      const wrap = document.getElementById('featuredMembers');
      if (wrap) wrap.innerHTML = show.map((m) => memberTile(m, 0)).join('');

      // recently active members — top up with featured so the row is never sparse
      try {
        const recent = (await getJSON(ChamberAPI.url('/api/members/recent'))).members || [];
        const rwrap = document.getElementById('recentMembers');
        if (rwrap) {
          const seen = new Set(recent.map((m) => m.id));
          const filler = (featured.length ? featured : members).filter((m) => !seen.has(m.id));
          const show = recent.concat(filler).slice(0, 8);
          if (show.length) {
            rwrap.innerHTML = show.map((m) => memberTile(m, 0)).join('');
            document.getElementById('recentSection').hidden = false;
          }
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
      // Featured events first; otherwise the next upcoming confirmed events.
      const todayISO = new Date().toISOString().slice(0, 10);
      const allEv = (evd.events || []).filter((e) => e.confirmed && e.date).sort((a, b) => a.date.localeCompare(b.date));
      const upcoming = allEv.filter((e) => e.date >= todayISO);
      // Upcoming first (featured upcoming float to the top); fall back to most recent.
      const pool = upcoming.length ? upcoming : allEv.slice(-4);
      const events = pool.filter((e) => e.featured).concat(pool.filter((e) => !e.featured)).slice(0, 4);
      const elist = document.getElementById('eventList');
      if (elist) elist.innerHTML = events.length
        ? events.map((e) => eventPreviewCard(e, 0)).join('')
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
      const fields = [[m.name, 10], [m.category, 6], [(m.categories || []).join(' '), 6], [m.typeOfBusiness, 6], [(m.keywords || []).join(' '), 5], [m.group, 5],
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
    const pickSort = (data) => (data.events || []).filter((e) => e.confirmed && e.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    try {
      events = pickSort(await getJSON(ChamberAPI.url('/api/events')));
    } catch (e) {
      try { events = pickSort(await getJSON('../data/events.json')); } catch (_) { console.error(e); }
    }

    // ── Filters: category + timeframe ──
    const catEl = document.getElementById('evCat');
    const whenEl = document.getElementById('evWhen');
    const countEl = document.getElementById('evCount');
    if (catEl) {
      const cats = [...new Set(events.map((e) => e.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      catEl.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
    }
    function inWindow(e, when) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const d = new Date(e.date + 'T12:00:00');
      if (when === 'all') return true;
      if (when === 'upcoming') return d >= today;
      if (when === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
      const days = Number(when);
      if (days) { const end = new Date(today); end.setDate(end.getDate() + days); return d >= today && d <= end; }
      return true;
    }
    function renderList() {
      const cat = catEl ? catEl.value : '';
      const when = whenEl ? whenEl.value : 'upcoming';
      const filtered = events.filter((e) => (!cat || e.category === cat) && inWindow(e, when));
      listEl.innerHTML = filtered.length
        ? filtered.map((e) => eventCard(e, 1)).join('')
        : '<p class="notice">No events match these filters — try widening the timeframe or choosing “All categories.”</p>';
      if (countEl) countEl.textContent = filtered.length + ' event' + (filtered.length !== 1 ? 's' : '');
    }
    renderList();
    if (catEl) catEl.addEventListener('change', renderList);
    if (whenEl) whenEl.addEventListener('change', renderList);

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

    // Build the order context. A `sku` param (from join.html / donate.html) is
    // resolved against the /api/skus catalog so prices have one source of truth.
    let label = 'Payment', sku = kind, presetAmount = params.get('amount') || '';
    const skuParam = params.get('sku') || '';
    let catalog = null;
    if (skuParam || kind === 'membership' || kind === 'donation') {
      try { catalog = await getJSON(ChamberAPI.url('/api/skus')); }
      catch (e) { try { catalog = await getJSON('data/skus.json'); } catch (e2) {} }
    }
    const findSku = (list, id) => (catalog && (catalog[list] || []).find((x) => x.sku === id)) || null;

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
      const item = findSku('memberships', skuParam);
      const tier = item ? item.tier : (params.get('tier') || 'membership');
      sku = item ? item.sku : `membership:${tier}`;
      title.textContent = 'Chamber membership';
      label = `Membership — ${item ? item.label : tier}`;
      if (item && item.amount != null && !presetAmount) presetAmount = String(item.amount);
      summary.innerHTML = item
        ? `<strong>${esc(item.label)}</strong><br><span class="member-tile__meta">Annual dues · $${esc(item.amount)}/year</span>${item.blurb ? `<p class="member-tile__meta mt-2">${esc(item.blurb)}</p>` : ''}<p class="notice mt-3">Billed annually. Confirm the amount below, or contact the office with questions.</p>`
        : `<strong>Annual membership</strong><br><span class="member-tile__meta">${esc(tier)}</span><p class="notice mt-3">Dues are based on your tier — enter the amount, or contact the office.</p>`;
      amountLabel.textContent = 'Dues amount (USD)';
    } else {
      const item = findSku('donations', skuParam);
      const project = params.get('project') || 'General Fund';
      sku = skuParam ? `donation:${skuParam}` : `donation:${project}`;
      title.textContent = 'Make a donation';
      label = `Donation — ${project}`;
      if (item && item.amount != null && !presetAmount) presetAmount = String(item.amount);
      summary.innerHTML = `<strong>Donation</strong><br><span class="member-tile__meta">${esc(project)}</span><p class="member-tile__meta mt-2">Your tax-deductible gift supports Chamber community programs.</p>`;
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
        <p style="white-space:pre-line;line-height:1.55">${esc(p.body || '')}</p>
        ${p.linkUrl ? `<a href="${esc(p.linkUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || 'Learn more')} ↗</a>` : ''}
        ${shareMenu((p.title || 'Chamber update') + ' — WVWCCC', location.origin + '/community/board.html')}
      </article>`;
  }

  // Bulletin-board card for Valley Biz Buzz — clamped body that expands on click.
  function newsCard(p) {
    const d = p.created ? new Date(p.created) : null;
    const date = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const body = String(p.body || '').trim();
    const long = body.length > 240 || body.split('\n').length > 4;
    return `
      <article class="card" style="display:flex;gap:18px;padding:20px 22px;align-items:flex-start">
        ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" style="width:128px;height:128px;object-fit:cover;border-radius:12px;flex-shrink:0">`
          : `<div aria-hidden="true" style="width:56px;height:56px;border-radius:12px;flex-shrink:0;background:var(--gold-soft);color:var(--gold-deep);display:flex;align-items:center;justify-content:center;font-size:1.4rem">📣</div>`}
        <div style="min-width:0;flex:1">
          <div class="member-tile__meta" style="margin-bottom:5px">${esc(p.authorName || 'WVWC Chamber')}${date ? ' · ' + esc(date) : ''}</div>
          <h3 style="margin:0 0 7px;font-size:1.18rem;line-height:1.25">${esc(p.title)}</h3>
          <p data-biz-body style="white-space:pre-line;color:var(--slate-mid,#444);line-height:1.6;margin:0;${long ? 'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden' : ''}">${esc(body)}</p>
          <div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            ${long ? '<button class="chip" data-biz-more>Read full post</button>' : ''}
            ${p.linkUrl ? `<a class="chip chip--gold" href="${esc(p.linkUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || 'Learn more')} ↗</a>` : ''}
          </div>
        </div>
      </article>`;
  }
  if (typeof document !== 'undefined' && !window.__wvBizBound) {
    window.__wvBizBound = true;
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-biz-more]');
      if (!b) return;
      const body = b.closest('article').querySelector('[data-biz-body]');
      if (body) { body.style.webkitLineClamp = 'unset'; body.style.display = 'block'; body.style.overflow = 'visible'; b.remove(); }
    });
  }
  async function initPostsFeed(type, containerId, render, empty) {
    const el = document.getElementById(containerId);
    if (!el) return;
    try {
      const posts = (await getJSON(ChamberAPI.url('/api/posts?type=' + type))).posts || [];
      el.innerHTML = posts.length ? posts.map(render).join('') : `<div class="notice">${empty}</div>`;
    } catch (e) { el.innerHTML = '<div class="notice">Could not load right now.</div>'; }
  }
  function offerRow(p) {
    return `<article class="card" style="display:flex;gap:14px;align-items:center;padding:12px 16px">
      ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" style="width:66px;height:66px;object-fit:cover;border-radius:9px;flex-shrink:0">`
        : '<div aria-hidden="true" style="width:66px;height:66px;border-radius:9px;background:var(--gold-soft);color:var(--gold-deep);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">%</div>'}
      <div style="flex:1;min-width:0">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><strong>${esc(p.title)}</strong>${p.code ? `<span class="badge">Code: ${esc(p.code)}</span>` : ''}</div>
        <div class="member-tile__meta">${p.memberId ? `<a href="members/profile.html?id=${esc(p.memberId)}">${esc(p.authorName || 'Member')}</a>` : esc(p.authorName || '')}</div>
        <p style="margin:4px 0 0;color:var(--slate-mid,#444);font-size:.92rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.body || '')}</p>
      </div>
      ${p.ctaUrl ? `<a class="btn btn--gold btn--sm" href="${esc(p.ctaUrl)}" target="_blank" rel="noopener" style="flex-shrink:0">${esc(p.ctaLabel || 'Redeem')}</a>` : ''}
    </article>`;
  }
  async function initDeals() {
    const el = document.getElementById('dealsList'); if (!el) return;
    let offers = [];
    try { offers = (await getJSON(ChamberAPI.url('/api/posts?type=discount'))).posts || []; }
    catch (e) { el.innerHTML = '<div class="notice">Could not load offers right now.</div>'; return; }
    let view = 'grid';
    function render() {
      if (!offers.length) { el.className = ''; el.innerHTML = '<div class="notice">No member offers yet — check back soon, or members can post one from their portal.</div>'; return; }
      if (view === 'grid') { el.className = 'grid grid-3'; el.style.gap = 'var(--s-5)'; el.innerHTML = offers.map(offerCard).join(''); }
      else { el.className = ''; el.removeAttribute('style'); el.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px;max-width:780px;margin:0 auto">${offers.map(offerRow).join('')}</div>`; }
    }
    render();
    document.querySelectorAll('[data-deals-view]').forEach((b) => b.addEventListener('click', () => {
      view = b.dataset.dealsView;
      document.querySelectorAll('[data-deals-view]').forEach((x) => x.classList.toggle('active', x === b));
      render();
    }));
  }
  const initCommunity = () => initPostsFeed('member_post', 'communityList', postCard, 'No community posts yet. Members can post the first one from their portal.');
  const initNews = () => initPostsFeed('news', 'newsList', newsCard, 'No news yet — check back soon.');

  // Newspaper layout for Valley Biz Buzz (masthead + lead story + columns).
  async function initBizBuzz() {
    const el = document.getElementById('bizbuzz'); if (!el) return;
    let posts = [];
    try { posts = (await getJSON(ChamberAPI.url('/api/posts?type=news'))).posts || []; }
    catch (e) { el.innerHTML = '<div class="notice">Could not load right now.</div>'; return; }
    const dl = document.getElementById('bizDateline');
    if (dl) dl.innerHTML = `<span>Since 1930</span><span>${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span><span class="biz-hide-sm">Tarzana · Woodland Hills · Reseda · Warner Center</span>`;
    if (!posts.length) { el.innerHTML = '<p class="notice">No news yet — check back soon.</p>'; return; }
    const fmt = (p) => { const d = p.created ? new Date(p.created) : null; return d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : ''; };
    const lead = posts[0], rest = posts.slice(1);
    const leadHtml = `<article style="display:grid;grid-template-columns:${lead.imageUrl ? '1.25fr 1fr' : '1fr'};gap:30px;align-items:start;padding-bottom:30px;border-bottom:3px double var(--green-ink,#1b3326);margin-bottom:30px" class="biz-lead">
      <div>
        <div style="font-family:var(--mono);font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-deep);margin-bottom:8px">Lead Story · ${esc(fmt(lead))}</div>
        <h2 style="font-family:var(--display);font-size:clamp(1.9rem,3.8vw,3rem);line-height:1.08;margin:0 0 14px">${esc(lead.title)}</h2>
        <p data-biz-body style="line-height:1.75;color:var(--slate-mid,#33403a);white-space:pre-line;display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden">${esc(lead.body || '')}</p>
        <div style="margin-top:14px">${lead.linkUrl ? `<a class="chip chip--gold" target="_blank" rel="noopener" href="${esc(lead.linkUrl)}">${esc(lead.ctaLabel || 'Read more')} ↗</a> ` : ''}<button class="chip" data-biz-more>Full story</button></div>
      </div>
      ${lead.imageUrl ? `<img src="${esc(lead.imageUrl)}" alt="" loading="lazy" style="width:100%;border:1px solid var(--green-ink,#1b3326);filter:grayscale(.15)">` : ''}
    </article>`;
    const colHtml = `<div class="biz-cols" style="column-count:3;column-gap:34px;column-rule:1px solid var(--gold-soft,#e6dcbf)">${rest.map((p) => `
      <article style="break-inside:avoid;margin:0 0 26px;padding-bottom:20px;border-bottom:1px solid var(--gold-soft,#e6dcbf)">
        ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" style="width:100%;margin-bottom:9px;filter:grayscale(.15)">` : ''}
        <div style="font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-deep)">${esc(fmt(p))}</div>
        <h3 style="font-family:var(--display);font-size:1.2rem;line-height:1.2;margin:3px 0 7px">${esc(p.title)}</h3>
        <p data-biz-body style="font-size:.9rem;line-height:1.6;color:var(--slate-mid,#33403a);white-space:pre-line;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden">${esc(p.body || '')}</p>
        <div style="margin-top:7px">${p.linkUrl ? `<a style="font-size:.8rem;color:var(--gold-deep)" target="_blank" rel="noopener" href="${esc(p.linkUrl)}">${esc(p.ctaLabel || 'Read more')} ↗</a> · ` : ''}<button data-biz-more style="font-size:.8rem;color:var(--gold-deep);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0">Read more</button></div>
      </article>`).join('')}</div>`;
    el.innerHTML = leadHtml + colHtml;
  }

  // ── Board of Directors / leadership (data-driven from leaderStatus) ──
  function boardCard(m, depth) {
    const base = depth ? '../' : '';
    const slug = m.slug || m.id;
    const person = m.contactName || m.name;
    const pic = m.logo
      ? `<img src="${esc(m.logo)}" alt="${esc(person)}" loading="lazy" style="width:128px;height:128px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 3px var(--gold-soft)">`
      : `<div aria-hidden="true" style="width:128px;height:128px;border-radius:50%;background:var(--green-deep,#1f4d3a);color:var(--gold-bright);display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:2.6rem;margin:0 auto">${esc((person || '?')[0].toUpperCase())}</div>`;
    return `
      <article style="text-align:center">
        <a href="${base}members/${esc(slug)}" style="text-decoration:none;color:inherit;display:block">
          ${pic}
          <div style="font-family:var(--display);font-size:1.18rem;margin-top:14px;color:var(--green-ink,#1b3326)">${esc(person)}</div>
          <div class="member-tile__meta" style="color:var(--gold-deep);font-weight:700;letter-spacing:.02em">${esc(m.leaderStatus)}</div>
          ${m.contactName && m.name !== m.contactName ? `<div class="member-tile__meta">${esc(m.name)}</div>` : ''}
          <div style="color:var(--gold-deep);font-size:.8rem;margin-top:6px;opacity:.8">View profile →</div>
        </a>
      </article>`;
  }
  async function initBoard(depth = 0) {
    const el = document.getElementById('boardGrid'); if (!el) return;
    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; }
    catch (e) { el.innerHTML = '<p class="notice">Could not load the roster right now.</p>'; return; }
    const ORDER = ['Leader', 'Board Member', 'Past President', 'Ambassador'];
    const board = members.filter((m) => ORDER.includes(m.leaderStatus))
      .sort((a, b) => (ORDER.indexOf(a.leaderStatus) - ORDER.indexOf(b.leaderStatus)) || String(a.contactName || a.name).localeCompare(b.contactName || b.name));
    if (!board.length) { el.innerHTML = '<p class="notice">Our board &amp; leadership roster is being finalized — check back soon. (Admins: set each member\'s designation under Members.)</p>'; return; }
    // group by designation
    const groups = {};
    board.forEach((m) => { (groups[m.leaderStatus] = groups[m.leaderStatus] || []).push(m); });
    el.innerHTML = ORDER.filter((g) => groups[g]).map((g) => `
      <div style="margin-bottom:var(--s-7)">
        <h2 style="text-align:center;margin-bottom:var(--s-5)">${esc(g === 'Leader' ? 'Officers & Leadership' : g === 'Board Member' ? 'Board of Directors' : g === 'Past President' ? 'Past Presidents' : 'Ambassadors')}</h2>
        <div class="grid grid-4" style="gap:var(--s-6)">${groups[g].map((m) => boardCard(m, depth)).join('')}</div>
      </div>`).join('');
  }

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
    const dining = members.filter((m) => DINING_RE.test(m.category || '') || (m.tags || []).some((t) => DINING_RE.test(t)) || (m.keywords || []).some((t) => DINING_RE.test(t)));
    const cnt = document.getElementById('diningCount');
    if (cnt) cnt.textContent = dining.length ? `${dining.length} member dining spot${dining.length === 1 ? '' : 's'}` : '';
    function renderList(list) {
      grid.innerHTML = list.length
        ? list.map(diningCard).join('')
        : '<div class="notice">No matches — try a different search, or browse all below.</div>';
    }
    renderList(dining);

    // instant filter
    const sb = document.getElementById('diningSearch');
    if (sb) sb.addEventListener('input', () => {
      const q = sb.value.trim().toLowerCase();
      if (!q) return renderList(dining);
      renderList(dining.filter((m) => [m.name, m.category, m.neighborhood, m.city, m.tagline, (m.tags || []).join(' '), (m.keywords || []).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(q)));
    });

    // Ask Wendy (AI concierge, scoped to dining)
    const ask = document.getElementById('diningAsk');
    if (ask) ask.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('diningAskInput');
      const out = document.getElementById('diningAskOut');
      const q = input.value.trim(); if (!q) return;
      out.innerHTML = '<div class="member-tile__meta">Asking Wendy…</div>';
      try {
        const r = await (await fetch(ChamberAPI.url('/api/concierge'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q: q + ' (restaurant / dining in the West Valley)' }) })).json();
        const picks = (r.members || []).filter((m) => DINING_RE.test(m.category || '') || true).slice(0, 3);
        out.innerHTML = `<div style="background:#fff;border:1px solid var(--gold-soft,#e6dcbf);border-radius:10px;padding:12px 14px"><strong>💬 Wendy:</strong> ${esc(r.answer || 'Here are a few spots.')}</div>`
          + (picks.length ? `<div class="grid grid-3 mt-3" style="gap:var(--s-4)">${picks.map((m) => diningCard(m)).join('')}</div>` : '');
      } catch (err) { out.innerHTML = '<div class="notice">Could not reach Wendy right now — use the filter below.</div>'; }
    });
  }

  return { initHome, initDirectory, initProfile, initEvents, initCheckout, initLeadForm, initJobs, initDeals, initCommunity, initNews, initBizBuzz, initBoard, initDining, offerCard, postCard, newsCard, memberTile, eventCard, eventPreviewCard, getJSON, esc };
})();
