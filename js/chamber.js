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

  // ── i18n ───────────────────────────────────────────────────
  // App pages under /es/ render the same data with Spanish UI microcopy.
  // tr(en) returns the Spanish string when the page is Spanish, else the
  // English key unchanged (so anything unlisted degrades gracefully).
  const LANG = (typeof document !== 'undefined' && document.documentElement.lang === 'es') ? 'es' : 'en';
  const ES = {
    'View profile →': 'Ver perfil →', 'View profile': 'Ver perfil', 'View details →': 'Ver detalles →',
    'Website': 'Sitio web', 'Directions': 'Cómo llegar', 'Call': 'Llamar', 'Email': 'Correo',
    'Search': 'Buscar', 'All categories': 'Todas las categorías', 'All areas': 'Todas las áreas',
    'All': 'Todos', 'Clear ✕': 'Limpiar ✕', 'Clear filters': 'Limpiar filtros',
    'No members match those filters.': 'Ningún miembro coincide con esos filtros.',
    'Loading…': 'Cargando…', 'Loading member restaurants…': 'Cargando restaurantes miembros…',
    'Could not load right now.': 'No se pudo cargar ahora.',
    'member': 'miembro', 'members': 'miembros',
    'Featured Member': 'Miembro Destacado', 'Featured this week': 'Destacado esta semana',
    'Offer': 'Oferta', 'Redeem': 'Canjear', 'Learn more': 'Más información', 'Read more': 'Leer más',
    'Read full post': 'Leer publicación completa', 'Full story': 'Historia completa',
    'Apply': 'Postular', 'Apply by email': 'Postular por correo', 'Post a job →': 'Publicar empleo →',
    'open position': 'puesto disponible', 'open positions': 'puestos disponibles',
    'All listings': 'Todos los anuncios', 'Commercial': 'Comercial', 'Residential': 'Residencial',
    'active listing': 'anuncio activo', 'active listings': 'anuncios activos',
    'Member Realtors & Brokers': 'Agentes y Corredores Miembros', 'member professionals': 'profesionales miembros',
    'Listed by': 'Publicado por', 'Details': 'Detalles',
    'Become a member': 'Hágase miembro', 'Share the join link': '🔗 Compartir el enlace para unirse',
    'View group →': 'Ver grupo →', 'Open guide →': 'Abrir guía →', 'All community guides': 'Todas las guías comunitarias',
    'Share': 'Compartir', 'Copy': 'Copiar', '✓ Copied': '✓ Copiado',
    'Asking Wendy…': 'Preguntando a Wendy…',
    'Could not reach Wendy right now — use the filter below.': 'No se pudo contactar a Wendy ahora — use el filtro abajo.',
    'Filter this guide…': 'Filtrar esta guía…',
    'business': 'negocio', 'businesses': 'negocios',
    'Officers & Leadership': 'Directiva y Liderazgo', 'Board of Directors': 'Junta Directiva',
    'Past Presidents': 'Ex Presidentes', 'Ambassadors': 'Embajadores',
    'Upcoming': 'Próximos', 'Next 30 days': 'Próximos 30 días', 'Next 90 days': 'Próximos 90 días',
    'This month': 'Este mes', 'All dates': 'Todas las fechas',
    'Get tickets': 'Comprar boletos', 'RSVP': 'Confirmar asistencia', 'Add to calendar': 'Agregar al calendario',
    'No upcoming events — check back soon.': 'No hay eventos próximos — vuelva pronto.',
    'No member offers yet — check back soon, or members can post one from their portal.': 'Aún no hay ofertas de miembros — vuelva pronto, o los miembros pueden publicar desde su portal.',
    'No news yet — check back soon.': 'Aún no hay noticias — vuelva pronto.',
    'No community posts yet. Members can post the first one from their portal.': 'Aún no hay publicaciones comunitarias. Los miembros pueden publicar la primera desde su portal.',
  };
  const tr = (s) => (LANG === 'es' && ES[s] != null) ? ES[s] : s;

  // Smart map link from a member's address (Google Maps universal URL).
  function mapUrl(m) {
    const q = [m.address, m.city, m.state, m.zip].filter(Boolean).join(' ') || m.name || '';
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  }

  // Member video → responsive embed. Accepts YouTube/Vimeo URLs or a direct file.
  function videoEmbed(url) {
    const u = String(url || '').trim(); if (!u) return '';
    const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/i);
    const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    const wrap = (inner) => `<div class="video-embed mt-5">${inner}</div>`;
    if (yt) return wrap(`<iframe src="https://www.youtube.com/embed/${yt[1]}" title="Member video" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe>`);
    if (vm) return wrap(`<iframe src="https://player.vimeo.com/video/${vm[1]}" title="Member video" allow="autoplay;fullscreen;picture-in-picture" allowfullscreen loading="lazy"></iframe>`);
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) return wrap(`<video src="${esc(u)}" controls preload="metadata" style="width:100%;border-radius:var(--r-lg)"></video>`);
    return '';
  }

  // Resolve the image for directory cards + the profile sidebar. The member
  // picks logo vs. their (team) photo; fall back to whatever image exists.
  function cardImage(m) {
    const logo = m.logo || '';
    const person = (Array.isArray(m.team) && m.team[0] && m.team[0].photo) || '';
    if (m.primaryImage === 'person' && person) return person;
    if (m.primaryImage === 'logo' && logo) return logo;
    return logo || person || (m.photos && m.photos[0]) || '';
  }

  function memberTile(m, depth, opts = {}) {
    const tier = (m.tier || 'member').toLowerCase();
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const href = m.slug ? '/members/' + m.slug : `${depth ? '' : 'members/'}profile.html?id=${encodeURIComponent(m.id)}`;
    // NOTE: no nested <a> inside another <a> (invalid HTML). Card is an <article>;
    // the name and the action links are separate, sibling anchors.
    const phoneDigits = (m.phone || '').replace(/[^\d]/g, '');
    const phone = m.phone ? `<a class="member-tile__row" href="tel:${phoneDigits}" aria-label="Call ${esc(m.name)}"><span aria-hidden="true">📞</span> ${esc(m.phone)}</a>` : '';
    // Smart address → opens a map. Visible "on first glance" per Chamber feedback.
    const addr = [m.address, m.city].filter(Boolean).join(', ');
    const addrLink = addr
      ? `<a class="member-tile__row" href="${esc(mapUrl(m))}" target="_blank" rel="noopener" aria-label="Map ${esc(m.name)}"><span aria-hidden="true">📍</span> ${esc(addr)}</a>` : '';
    const meta = [m.category, m.neighborhood].filter(Boolean).map(esc).join(' · ');
    const photo = cardImage(m);
    const seal = photo
      ? `<div class="member-tile__seal" style="padding:0;overflow:hidden"><img src="${esc(photo)}" alt="${esc(m.name || '')} logo" loading="lazy" style="width:100%;height:100%;object-fit:cover"></div>`
      : `<div class="member-tile__seal">${esc(m.seal || (m.name || '?')[0])}</div>`;
    return `
      <article class="card card--hover member-tile">
        <div class="member-tile__head">
          ${seal}
          <div class="member-tile__id">
            <a class="member-tile__name" href="${href}">${esc(m.name)}</a>
            ${m.contactName ? `<div class="member-tile__meta" style="color:var(--green-ink);font-weight:600">👤 ${esc(m.contactName)}</div>` : ''}
            <div class="member-tile__meta">${meta}</div>
          </div>
        </div>
        ${m.tagline && !opts.compact ? `<p class="member-tile__tag">${esc(m.tagline)}</p>` : ''}
        ${(addrLink || phone) && !opts.compact ? `<div class="member-tile__facts">${addrLink}${phone}</div>` : ''}
        <div class="member-tile__foot">
          <span class="badge badge--${tier}">${esc(tierLabel)}</span>
          <a class="btn btn--forest btn--sm" href="${href}">${tr('View profile →')}</a>
        </div>
      </article>`;
  }

  // Reusable share row: social + email + SMS + copy/native-share. Pure HTML;
  // the copy/native button is handled by one delegated listener (below).
  function shareMenu(title, url) {
    const t = encodeURIComponent(title || 'West Valley · Warner Center Chamber');
    const u = encodeURIComponent(url);
    const body = encodeURIComponent((title ? title + ' — ' : '') + url);
    return `<div class="share-row" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center">
      <span class="member-tile__meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.04em">${tr('Share')}</span>
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
  // When the modal is opened from a group page, RSVPs route to that group's
  // manager (via contact.html?group=…). Set by initGroupView, null elsewhere.
  let _groupCtx = null;
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
  // Event image src: leave absolute URLs (http, leading /, data:) alone; prefix
  // relative paths (e.g. "assets/events/11311.jpg") with the page base so they
  // resolve from subdirectory pages like /events/ instead of 404ing.
  function evImgSrc(u, base) { u = String(u || ''); return /^(https?:|\/|data:)/i.test(u) ? u : (base || '') + u; }
  // Event images may be plain URL strings or {src, href, label} objects (admin
  // can hyperlink an image, e.g. a sponsor logo → sponsor's site).
  function evImgOf(it) { return typeof it === 'string' ? it : String((it && it.src) || ''); }
  function evImgHref(it) { return (it && typeof it === 'object' && it.href) ? String(it.href) : ''; }
  // Escape text, then turn URLs and "Click here"-style bare links into real
  // anchors so links pasted into event descriptions are clickable.
  function linkify(text) {
    let s = esc(text);
    s = s.replace(/\bhttps?:\/\/[^\s<>"')]+/gi, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
    s = s.replace(/(^|[\s(])(www\.[^\s<>"')]+)/gi, (m0, pre, u) => `${pre}<a href="https://${u}" target="_blank" rel="noopener">${u}</a>`);
    return s;
  }
  // Google Maps link for an event's venue/address (clickable directions).
  function evMapUrl(ev) {
    const q = [ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' ');
    return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '';
  }
  // Friendly date for a group photo's optional date (YYYY-MM-DD → "Jun 8, 2026").
  function fmtPhotoDate(d) {
    if (!d) return '';
    const dt = new Date(String(d) + 'T12:00:00');
    return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function openEventModal(ev) {
    if (!ev) return;
    const base = /\/(events|members|member|community|admin|auth|es|groups|guides|jobs)\//.test(location.pathname) ? '../' : '';
    const loc = [ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · ');
    // Full flyer leads the modal (portrait-friendly); the image strip follows.
    // Hero: the portrait flyer leads; fall back to the first photo so the modal
    // always feels image-forward (logos/flyers/images — Felicia's request).
    // Flyers: main flyer plus any additional flyers (admin can attach several).
    const flyers = [ev.flyer].concat(Array.isArray(ev.flyers) ? ev.flyers : []).map(evImgOf).filter(Boolean);
    const hero = flyers[0] || ev.thumbnail || evImgOf(ev.images && ev.images[0]) || '';
    const flyerImg = hero
      ? `<img class="ev-card__flyer" src="${esc(evImgSrc(hero, base))}" alt="${esc(ev.title)} flyer" onerror="this.onerror=null;this.src='${base}images/wvwccc-logo.png';this.classList.add('ev-card__flyer--ph')">`
      : `<img class="ev-card__flyer ev-card__flyer--ph" src="${base}images/wvwccc-logo.png" alt="">`;
    const moreFlyers = flyers.slice(1).map((u) => `<img class="ev-card__flyer" src="${esc(evImgSrc(u, base))}" alt="${esc(ev.title)} flyer" loading="lazy">`).join('');
    // Photo strip: each image may carry a link (e.g. sponsor logo → sponsor site).
    const extra = (ev.images || []).filter((it) => evImgOf(it) && evImgOf(it) !== hero).slice(0, 6);
    const imgTag = (it) => {
      const im = `<img src="${esc(evImgSrc(evImgOf(it), base))}" alt="${esc((it && it.label) || '')}" loading="lazy">`;
      const href = evImgHref(it);
      return href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${im}</a>` : im;
    };
    const imgs = flyerImg + moreFlyers + (extra.length ? `<div class="ev-card__imgs">${extra.map(imgTag).join('')}</div>` : '');
    // Sponsor logos (each optionally linked to the sponsor's site).
    const sponsors = (Array.isArray(ev.sponsorLogos) ? ev.sponsorLogos : []).filter((s) => evImgOf(s));
    const sponsorRow = sponsors.length
      ? `<div class="ev-card__sponsors" style="display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:0 0 16px">${sponsors.map((s) => {
          const im = `<img src="${esc(evImgSrc(evImgOf(s), base))}" alt="${esc(s.label || 'Sponsor logo')}" loading="lazy" style="max-height:64px;max-width:160px;object-fit:contain">`;
          const href = evImgHref(s);
          return href ? `<a href="${esc(href)}" target="_blank" rel="noopener" title="${esc(s.label || '')}">${im}</a>` : im;
        }).join('')}</div>`
      : '';
    const links = (ev.links && ev.links.length)
      ? `<div class="ev-card__row">${ev.links.map((l) => `<a class="btn btn--gold btn--sm" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.label || l.type || 'Details')}</a>`).join('')}</div>` : '';
    // Attached PDFs (donation form, sponsorship levels, …).
    const docs = (ev.documents && ev.documents.length)
      ? `<div class="ev-card__row">${ev.documents.map((dme) => `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(evImgSrc(dme.url, base))}">📄 ${esc(dme.label || 'Document')}</a>`).join('')}</div>` : '';
    const grpQ = _groupCtx ? `&group=${encodeURIComponent(_groupCtx.slug)}` : '';
    // ticketed → Buy; ticketed + alsoRsvp → BOTH buttons (e.g. members RSVP
    // free, guests buy); otherwise RSVP only.
    const rsvpBtn = `<a class="btn btn--forest" href="${base}contact.html?event=${esc(ev.id)}${grpQ}">RSVP</a>`;
    const buyBtn = `<a class="btn btn--gold" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Get tickets</a>`;
    const cta = ev.ticketed ? (ev.alsoRsvp ? rsvpBtn + ' ' + buyBtn : buyBtn) : rsvpBtn.replace('>RSVP<', '>RSVP / Notify me<');
    const desc = ev.description || ev.summary || '';
    // Rich description (admin editor) renders as sanitized HTML; plain text is
    // escaped + auto-linked so pasted URLs and "click here" links actually work.
    const descHtml = ev.descriptionHtml ? ev.descriptionHtml : (desc ? linkify(desc) : '');
    const mapU = evMapUrl(ev);
    const overlay = document.createElement('div');
    overlay.className = 'ev-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,42,22,.62);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;z-index:9999;overflow-y:auto';
    overlay.innerHTML = `
      <div class="ev-card" role="dialog" aria-modal="true">
        <div class="ev-card__accent"></div>
        <button aria-label="Close" data-ev-close class="ev-card__x">×</button>
        <div class="ev-card__body">
          <div class="ev-card__head">
            <img class="ev-card__seal" src="/images/wvwccc-logo.png" alt="" onerror="this.style.display='none'">
            <div>
              <span class="ev-card__kicker">${esc(ev.category || 'Chamber Event')}</span>
              <h2 class="ev-card__title">${esc(ev.title)}</h2>
            </div>
          </div>
          <div class="ev-card__meta">
            <div class="ev-card__when">📅 ${esc(fullDate(ev))}</div>
            ${loc ? `<div>📍 ${mapU ? `<a href="${esc(mapU)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline" title="Open in Google Maps for directions">${esc(loc)}</a> <span style="font-size:.78rem;color:var(--gold-deep)">(map ↗)</span>` : esc(loc)}</div>` : ''}
          </div>
          ${imgs}
          ${descHtml ? `<div class="ev-card__desc"${ev.descriptionHtml ? ' style="white-space:normal"' : ''}>${descHtml}</div>` : ''}
          ${sponsorRow}
          ${links}
          ${docs}
          <div class="ev-card__foot">
            ${ev.confirmed ? calendarMenu(ev) : ''}
            ${shareMenu(ev.title, location.origin + (base ? '/' : location.pathname) + (base ? 'events/index.html' : '') + '#' + encodeURIComponent(ev.id))}
            <div class="ev-card__cta">${cta}</div>
          </div>
        </div>
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
      // On the All-Events list, open the event's detail in a new tab (the page
      // auto-opens the matching event from the URL hash). Elsewhere, open inline.
      const newTab = t.getAttribute('data-ev-newtab');
      if (newTab) { window.open(newTab, '_blank', 'noopener'); return; }
      openEventModal(_eventReg[t.getAttribute('data-ev-detail')]);
    });
  }

  function eventCard(ev, depth = 0, opts = {}) {
    _eventReg[ev.id] = ev;
    const base = depth ? '../' : '';
    // On the All-Events list we open the detail in a NEW TAB (deep link to the
    // same events page, which auto-opens the event from the hash). Same-folder
    // link works for both the English and Spanish events pages.
    const newTab = opts.newTab ? ` data-ev-newtab="index.html#${encodeURIComponent(ev.id)}"` : '';
    const confirmed = ev.confirmed && ev.day;
    const dateBlock = confirmed
      ? `<div class="event-date"><div class="event-date__mo">${esc(ev.month)}</div><div class="event-date__day">${esc(ev.day)}</div></div>`
      : `<div class="event-date"><div class="event-date__mo">${esc(ev.month || 'TBA')}</div><div class="event-date__day" style="font-size:1rem;padding-top:6px">·</div></div>`;
    const when = confirmed ? `${esc(ev.month)} ${esc(ev.day)} · ${esc(ev.time || '')}` : 'Date to be announced';
    const cta = ev.ticketed
      ? (confirmed
          ? `${ev.alsoRsvp ? `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a> ` : ''}<a class="btn btn--gold btn--sm" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Get tickets</a>`
          : `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">Notify me</a>`)
      : `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a>`;
    const imgs = (ev.images && ev.images.length)
      ? `<div class="event-imgs" style="display:flex;gap:6px;margin:8px 0 0;flex-wrap:wrap">${ev.images.slice(0, 3).map((u) => `<img src="${esc(evImgSrc(evImgOf(u), base))}" alt="" loading="lazy" style="width:88px;height:64px;object-fit:cover;border-radius:8px">`).join('')}</div>`
      : '';
    const links = (ev.links && ev.links.length)
      ? `<div class="event-links" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0">${ev.links.map((l) => `<a class="chip chip--gold" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.label || l.type || 'Details')}</a>`).join('')}</div>`
      : '';
    return `
      <div class="event-row" id="${esc(ev.id)}" data-ev-detail="${esc(ev.id)}"${newTab} style="cursor:pointer">
        ${dateBlock}
        <div>
          <span class="badge">${esc(ev.category || 'Event')}</span>${ev.featured ? '<span class="badge badge--gold" style="margin-left:6px">★ Featured</span>' : ''}
          <h4 style="margin:6px 0 4px">${esc(ev.title)} <span style="color:var(--gold-bright,#b8860b);font-size:.8rem;font-weight:600">${opts.newTab ? 'Open ↗' : 'Details →'}</span></h4>
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

  // Compact "quick view" row for the events index — mirrors the legacy
  // event_listings.php: date · title · category · M/D/YY · RSVP/Tickets, with
  // full details on click (opens the inline event modal). No flyer/summary here.
  function eventQuickRow(ev, depth = 0) {
    _eventReg[ev.id] = ev;
    const base = depth ? '../' : '';
    const mo = ev.month || (ev.date ? MONTHS[Number(ev.date.slice(5, 7)) - 1] : 'TBA');
    const day = ev.day || (ev.date ? String(Number(ev.date.slice(8, 10))) : '');
    const dateUS = ev.date ? `${ev.date.slice(5, 7)}/${ev.date.slice(8, 10)}/${ev.date.slice(2, 4)}` : 'Date TBA';
    const cta = ev.ticketed
      ? `${ev.alsoRsvp ? `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a> ` : ''}<a class="btn btn--gold btn--sm" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Tickets</a>`
      : `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a>`;
    return `
      <div class="ev-quick" data-ev-detail="${esc(ev.id)}" style="display:flex;align-items:center;gap:14px;padding:11px 14px;border-bottom:1px solid var(--gold-soft,#e6dcbf);cursor:pointer">
        <div style="flex:0 0 64px;text-align:center;line-height:1.05">
          <div style="font-weight:700;color:var(--green,#1b3326);text-transform:uppercase;font-size:.72rem;letter-spacing:.04em">${esc(mo)}</div>
          <div style="font-weight:800;color:var(--green-ink,#12241a);font-size:1.35rem">${esc(day)}</div>
        </div>
        <div style="flex:1 1 auto;min-width:0">
          <span class="ev-quick__title" style="font-weight:700;color:var(--green-ink,#12241a)">${esc(ev.title)}</span>
          ${ev.featured ? ' <span class="badge badge--gold" style="font-size:.68rem">★ Featured</span>' : ''}
          <div class="member-tile__meta">${esc(ev.category || 'Event')} · ${esc(dateUS)}</div>
        </div>
        <div style="flex:0 0 auto">${cta}</div>
      </div>`;
  }

  // Image-forward "upcoming events" preview (homepage). Big flyer thumbnail +
  // title/date/summary + CTAs; clicking anywhere but a real link opens the modal.
  function eventPreviewCard(ev, depth = 0) {
    _eventReg[ev.id] = ev;
    const base = depth ? '../' : '';
    const img = ev.thumbnail || ev.image || evImgOf(ev.images && ev.images[0]) || '';
    // The chamber-logo placeholder is ALWAYS the base; a real image layers on top and
    // removes itself on error — so a missing/broken/slow image never leaves a white box.
    const evPh = `<img src="${base}images/wvwccc-logo.png" alt="" class="evp__ph-logo"><span>${esc(ev.month || 'TBA')}</span><strong>${esc(ev.day || '·')}</strong>`;
    const media = `<div class="evp__media evp__media--ph" role="img" aria-label="${esc(ev.title)} flyer">${img ? `<img class="evp__cover" src="${esc(evImgSrc(img, base))}" alt="" loading="lazy" onerror="this.remove()">` : ''}${evPh}</div>`;
    const when = (ev.confirmed && ev.day)
      ? `${esc(ev.month)} ${esc(ev.day)}${ev.time ? ' · ' + esc(ev.time) : ''}`
      : 'Date to be announced';
    const loc = [ev.venue, ev.neighborhood].filter(Boolean).map(esc).join(' · ');
    // Don't repeat the venue line as the summary (common in imported events).
    const sumRaw = String(ev.summary || ev.description || '').trim();
    const sum = (sumRaw && sumRaw.toLowerCase() !== String(ev.venue || '').trim().toLowerCase()
      && sumRaw.toLowerCase() !== String(ev.neighborhood || '').trim().toLowerCase()) ? sumRaw : '';
    const cta = ev.ticketed
      ? `${ev.alsoRsvp ? `<a class="btn btn--forest btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a> ` : ''}<a class="btn btn--gold btn--sm" href="${base}checkout.html?type=ticket&event=${esc(ev.id)}">Buy tickets</a>`
      : `<a class="btn btn--forest btn--sm" href="${base}contact.html?event=${esc(ev.id)}">RSVP</a>`;
    return `
      <article class="evp card--hover" id="${esc(ev.id)}" data-ev-detail="${esc(ev.id)}">
        ${media}
        <div class="evp__body">
          <span class="badge">${esc(ev.category || 'Event')}</span>${ev.featured ? '<span class="badge badge--gold" style="margin-left:6px">★ Featured</span>' : ''}
          <h3 class="evp__title">${esc(ev.title)}</h3>
          <div class="evp__meta">📅 ${when}${loc ? ' · ' + loc : ''}</div>
          ${sum ? `<p class="evp__sum">${esc(sum)}</p>` : ''}
          <div class="evp__cta">
            <span class="btn btn--ghost btn--sm" role="button" tabindex="0">View details →</span>
            ${cta}
          </div>
        </div>
      </article>`;
  }

  // Leaders wall — members who invest in the Chamber's leader-level marketing
  // program. Grouped by tier (admin-assigned on each member). Renders at the
  // bottom of every page, matching the legacy site's tiered "Leaders" board.
  const LEADER_RANK = { platinum: 1, gold: 2, silver: 3, bronze: 4, supporter: 5, friend: 6 };
  const LEADER_LABEL = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', supporter: 'Supporter', friend: 'Friend Leaders' };
  async function initLeaderBanner(sel, opts = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return;
    const depth = opts.depth || 0;
    const section = el.closest('[data-leader-section]');
    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; }
    catch (e) { section?.setAttribute('hidden', ''); return; }
    const leaders = members
      .filter((m) => LEADER_RANK[(m.tier || '').toLowerCase()] && (m.leaderLogo || m.logo || (m.photos && m.photos[0])))
      .sort((a, b) => LEADER_RANK[a.tier.toLowerCase()] - LEADER_RANK[b.tier.toLowerCase()] || String(a.name).localeCompare(String(b.name)));
    if (!leaders.length) { section?.setAttribute('hidden', ''); return; }
    const fixUrl = (u) => (/^(https?:|\/)/.test(u) ? u : (depth ? '../' : '') + u);
    const hrefOf = (m) => m.slug ? `${depth ? '../' : ''}members/${m.slug}` : `${depth ? '../' : ''}members/profile.html?id=${encodeURIComponent(m.id)}`;
    const cell = (m) => {
      const tier = (m.tier || '').toLowerCase();
      const logo = m.leaderLogo || m.logo || (m.photos && m.photos[0]);
      return `<a class="leader-cell" href="${hrefOf(m)}" title="${esc(m.name)} · ${esc(LEADER_LABEL[tier] || tier)}">
        <span class="leader-cell__tier">${esc(LEADER_LABEL[tier] || tier)}</span>
        <span class="leader-cell__logo"><img src="${esc(fixUrl(logo))}" alt="${esc(m.name)}" loading="lazy"></span>
        <span class="leader-cell__name">${esc(m.name)}</span>
      </a>`;
    };
    // Main leaders (Platinum→Supporter) above the rule; Friend Leaders below it.
    const main = leaders.filter((m) => m.tier.toLowerCase() !== 'friend');
    const friends = leaders.filter((m) => m.tier.toLowerCase() === 'friend');
    el.innerHTML =
      `<div class="leader-wall-grid">${main.map(cell).join('')}</div>` +
      (friends.length ? `<hr class="leader-wall__rule"><div class="leader-wall-grid">${friends.map(cell).join('')}</div>` : '');
    section?.removeAttribute('hidden');
  }

  // ── Groups & networks (YPN, Home Improvement, …) ─────────
  async function initGroups() {
    const grid = document.getElementById('groupGrid');
    if (!grid) return;
    let groups = [];
    try { groups = (await getJSON(ChamberAPI.url('/api/groups'))).groups || []; }
    catch (e) { grid.innerHTML = '<p class="notice">Groups are loading slowly — please refresh.</p>'; return; }
    if (!groups.length) { grid.innerHTML = '<p class="notice">Groups are being set up — check back soon.</p>'; return; }
    grid.innerHTML = groups.map((g) => `
      <a class="group-card card--hover" href="/groups/${esc(g.slug)}">
        <div class="group-card__media" style="${g.heroImage ? `background-image:url('/${esc(g.heroImage).replace(/^\//, '')}')` : ''}"></div>
        <div class="group-card__body">
          <h3>${esc(g.name)}</h3>
          <p class="member-tile__meta">${esc(g.meetingSchedule || '')}</p>
          <p class="group-card__tag">${esc(g.tagline || '')}</p>
          <span class="btn btn--forest btn--sm">View group →</span>
        </div>
      </a>`).join('');
  }

  async function initGroupView() {
    const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    _groupCtx = { slug };
    let g = null;
    try { g = (await getJSON(ChamberAPI.url('/api/groups/' + encodeURIComponent(slug)))).group; } catch (e) {}
    if (!g) {
      document.getElementById('gName').textContent = 'Group not found';
      document.getElementById('gTagline').textContent = 'This group may have moved — see all groups below.';
      return;
    }
    document.title = `${g.name} — WVWCCC`;
    document.getElementById('gName').textContent = g.name;
    document.getElementById('gTagline').textContent = g.tagline || '';
    document.getElementById('gDescription').textContent = g.description || '';
    document.getElementById('gSchedule').textContent = g.meetingSchedule || 'Contact the Chamber office';
    if (g.manager && g.manager.name) {
      const sch = document.getElementById('gSchedule');
      const mgr = document.createElement('p');
      mgr.className = 'member-tile__meta';
      mgr.style.margin = '8px 0 0';
      mgr.textContent = `Group manager: ${g.manager.name}`;
      sch.insertAdjacentElement('afterend', mgr);
    }
    if (g.heroImage) document.getElementById('groupHero').style.backgroundImage = `url('/${String(g.heroImage).replace(/^\//, '')}')`;
    if (g.meetingNotes && g.meetingNotes.trim()) {
      document.getElementById('gNotes').hidden = false;
      document.getElementById('gNotesBody').textContent = g.meetingNotes;
    }
    if (Array.isArray(g.photos) && g.photos.length) {
      document.getElementById('gPhotos').hidden = false;
      document.getElementById('gPhotoGrid').innerHTML = g.photos.map((p) => {
        const url = String((p && p.url != null) ? p.url : p).replace(/^\//, '');
        const cap = [p && p.event, p && p.date ? fmtPhotoDate(p.date) : ''].filter(Boolean).join(' · ');
        return `<figure style="margin:0"><a href="/${esc(url)}" target="_blank" rel="noopener"><img src="/${esc(url)}" alt="${esc(g.name)} photo" loading="lazy"></a>${cap ? `<figcaption class="member-tile__meta" style="margin-top:4px">${esc(cap)}</figcaption>` : ''}</figure>`;
      }).join('');
    }
    // upcoming events that match this group
    if (g.eventMatch) {
      try {
        const evs = (await getJSON(ChamberAPI.url('/api/events'))).events || [];
        const today = new Date().toISOString().slice(0, 10);
        const mine = evs.filter((e) => e.confirmed && e.date >= today &&
          (e.title || '').toLowerCase().includes(g.eventMatch.toLowerCase())).slice(0, 4);
        if (mine.length) {
          document.getElementById('gEvents').hidden = false;
          document.getElementById('gEventList').innerHTML = mine.map((e) => eventPreviewCard(e, 1)).join('');
        }
      } catch (e) {}
    }
    // Members roster (active only — the API already strips pending/emails)
    if (Array.isArray(g.members) && g.members.length) {
      const sec = document.getElementById('gMembers');
      if (sec) {
        sec.hidden = false;
        const sorted = g.members.slice().sort((a, b) => (a.role === 'Member' ? 1 : 0) - (b.role === 'Member' ? 1 : 0));
        document.getElementById('gMemberList').innerHTML = sorted.map((m) => {
          const meta = m.business ? ` <span class="member-tile__meta">· ${esc(m.business)}</span>` : '';
          const role = (m.role && m.role !== 'Member') ? ` <span class="badge badge--gold" style="font-size:.62rem;vertical-align:middle">${esc(m.role)}</span>` : '';
          const inner = `<strong>${esc(m.name)}</strong>${meta}${role}`;
          return m.memberId
            ? `<a href="/members/profile.html?id=${encodeURIComponent(m.memberId)}" style="display:block;padding:9px 0;border-bottom:1px solid var(--line,#eee);text-decoration:none;color:inherit">${inner}</a>`
            : `<div style="padding:9px 0;border-bottom:1px solid var(--line,#eee)">${inner}</div>`;
        }).join('');
      }
    }

    // join form → a PENDING request on this group (admin approves it)
    const jf = document.getElementById('groupJoinForm');
    if (jf) {
      const jmsg = document.getElementById('groupJoinMsg');
      jf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(jf);
        const body = { name: fd.get('name'), email: fd.get('email'), business: fd.get('company') || '' };
        const btn = jf.querySelector('[type="submit"]'); if (btn) btn.disabled = true;
        try {
          const r = await fetch(ChamberAPI.url('/api/groups/' + encodeURIComponent(slug) + '/join'),
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!r.ok) throw new Error('failed');
          if (jmsg) { jmsg.hidden = false; jmsg.textContent = 'Thanks! Your request to join was sent — the Chamber will be in touch.'; }
          jf.reset();
        } catch (err) {
          if (jmsg) { jmsg.hidden = false; jmsg.textContent = 'Sorry — could not send your request. Please try again or call the office.'; }
        } finally { if (btn) btn.disabled = false; }
      });
    }
  }

  // ── Photo gallery (gallery.html) — grid + lightbox ───────
  async function initGallery() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    let posts = [];
    try { posts = (await getJSON(ChamberAPI.url('/api/posts?type=gallery'))).posts || []; } catch (e) {}
    const shots = posts.filter((p) => p.imageUrl);
    if (!shots.length) { grid.innerHTML = '<p class="notice">Photos are on the way — check back after our next event!</p>'; return; }
    grid.innerHTML = shots.map((p, i) => `
      <figure class="gallery-card">
        <a href="${esc(p.imageUrl)}" data-lightbox="${i}"><img src="${esc(p.imageUrl)}" alt="${esc(p.title || 'Chamber photo')}" loading="lazy"></a>
        ${p.title ? `<figcaption>${esc(p.title)}</figcaption>` : ''}
      </figure>`).join('');
    // lightbox: click → full-size overlay with caption; Esc / click closes
    grid.addEventListener('click', (e) => {
      const a = e.target.closest('[data-lightbox]'); if (!a) return;
      e.preventDefault();
      const p = shots[+a.dataset.lightbox];
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(14,42,22,.92);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';
      ov.innerHTML = `<img src="${esc(p.imageUrl)}" alt="" style="max-width:94vw;max-height:84vh;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.5)">
        ${p.title ? `<p style="color:rgba(255,255,255,.85);margin-top:14px;text-align:center;max-width:70ch">${esc(p.title)}</p>` : ''}`;
      const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = (ev) => { if (ev.key === 'Escape') close(); };
      ov.addEventListener('click', close);
      document.addEventListener('keydown', onKey);
      document.body.appendChild(ov);
    });
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
    // Resolve slide images root-absolute so they work on the homepage, the
    // /es/ homepage, and anywhere else (seed slides store relative paths).
    const heroSrc = (u) => { u = String(u || ''); return /^(https?:|data:|\/)/i.test(u) ? u : '/' + u.replace(/^\.?\//, ''); };
    const layer = document.createElement('div');
    layer.className = 'hero__slides';
    layer.innerHTML = slides.map((s, i) =>
      `<div class="hero__slide${i === 0 ? ' is-active' : ''}" style="background-image:url('${esc(heroSrc(s.imageUrl))}')"></div>`).join('')
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

      // featured members (or first 6) — compact tiles on the home page so we don't
      // show too much of a member's profile at first glance (Chamber feedback).
      const featured = members.filter((m) => m.featured);
      const show = (featured.length ? featured : members).slice(0, 6);
      const wrap = document.getElementById('featuredMembers');
      if (wrap) wrap.innerHTML = show.map((m) => memberTile(m, 0, { compact: true })).join('');

      // recently active members — top up with featured so the row is never sparse
      try {
        const recent = (await getJSON(ChamberAPI.url('/api/members/recent'))).members || [];
        const rwrap = document.getElementById('recentMembers');
        if (rwrap) {
          const seen = new Set(recent.map((m) => m.id));
          const filler = (featured.length ? featured : members).filter((m) => !seen.has(m.id));
          const show = recent.concat(filler).slice(0, 6); // top 6 only (Chamber feedback)
          if (show.length) {
            rwrap.innerHTML = show.map((m) => memberTile(m, 0, { compact: true })).join('');
            document.getElementById('recentSection').hidden = false;
          }
        }
      } catch (e) { /* no recent logins yet */ }

      // "Featured this week" spotlight — BLANK until staff explicitly pick a member
      // or upload an image in Admin → Sponsorships (Chamber feedback). No auto-fill.
      const heroAside = document.querySelector('.hero__feature');
      const hero = document.getElementById('heroFeature');
      if (heroAside) heroAside.hidden = true;            // stays blank until resolved
      try {
        const { spotlight } = await getJSON(ChamberAPI.url('/api/home-spotlight'));
        if (spotlight && hero) {
          if (spotlight.type === 'image' && spotlight.image) {
            const inner = `<img src="${esc(spotlight.image)}" alt="${esc(spotlight.caption || 'Featured this week')}" style="width:100%;border-radius:var(--r-md);display:block">`
              + (spotlight.caption ? `<p style="color:var(--green-ink,#143C20);font-weight:600;margin:10px 0 0">${esc(spotlight.caption)}</p>` : '');
            hero.innerHTML = spotlight.href ? `<a href="${esc(spotlight.href)}" style="text-decoration:none">${inner}</a>` : inner;
            heroAside.hidden = false;
          } else if (spotlight.member) {
            const m = spotlight.member;
            const photo = m.logo || (m.photos && m.photos[0]) || '';
            const seal = photo
              ? `<div class="member-tile__seal" style="padding:0;overflow:hidden"><img src="${esc(photo)}" alt="${esc(m.name)} logo" style="width:100%;height:100%;object-fit:cover"></div>`
              : `<div class="member-tile__seal">${esc(m.seal || m.name[0])}</div>`;
            const href = m.slug ? '/members/' + m.slug : 'members/profile.html?id=' + encodeURIComponent(m.id);
            hero.innerHTML = `
              <div class="member-tile">
                <div class="member-tile__head">
                  ${seal}
                  <div>
                    <a class="member-tile__name" href="${href}" style="color:#fff">${esc(m.name)}</a>
                    <div class="member-tile__meta" style="color:rgba(255,255,255,.65)">${esc(m.category || '')}${m.neighborhood ? ' · ' + esc(m.neighborhood) : ''}</div>
                  </div>
                </div>
                <div class="btn-row mt-3"><a class="btn btn--gold btn--sm" href="${href}">View profile →</a></div>
              </div>`;
            heroAside.hidden = false;
          }
        }
      } catch (e) { /* no spotlight set → the card stays blank */ }

      // events
      // The admin PICKS which events show on the homepage (Events → "Show on
      // homepage" + Home order 1–4). If any upcoming event is picked, ONLY the
      // picked events render, in the admin's order. With nothing picked, fall
      // back to the next four upcoming events so the section never goes empty.
      const todayISO = new Date().toISOString().slice(0, 10);
      const allEv = (evd.events || []).filter((e) => e.confirmed && e.date).sort((a, b) => a.date.localeCompare(b.date));
      const upcoming = allEv.filter((e) => e.date >= todayISO);
      const pool = upcoming.length ? upcoming : allEv.slice(-4);
      const homeOrd = (e) => { const n = Number(e.homeOrder); return Number.isFinite(n) && n > 0 ? n : 1e9; };
      const picked = pool.filter((e) => e.featured).sort((a, b) => homeOrd(a) - homeOrd(b) || a.date.localeCompare(b.date));
      const events = (picked.length ? picked : pool).slice(0, 4);
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

    // Collapsed green dropdown: a button that opens a list of choices (Chamber feedback).
    function closeAllDD() {
      document.querySelectorAll('.dd__menu').forEach((mn) => { mn.hidden = true; });
      document.querySelectorAll('.dd__btn[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
    function buildDropdown(elId, allLabel, options, key) {
      const el = document.getElementById(elId);
      if (!el) return;
      const cur = state[key];
      el.innerHTML = `
        <button type="button" class="dd__btn${cur ? ' is-set' : ''}" aria-expanded="false" aria-haspopup="listbox">
          <span>${esc(cur || allLabel)}</span><span class="dd__caret" aria-hidden="true">▾</span>
        </button>
        <div class="dd__menu" role="listbox" hidden>
          <button type="button" class="dd__opt${!cur ? ' is-active' : ''}" data-val="" role="option">${esc(allLabel)}</button>
          ${options.map((o) => `<button type="button" class="dd__opt${cur === o ? ' is-active' : ''}" data-val="${esc(o)}" role="option">${esc(o)}</button>`).join('')}
        </div>`;
      const btn = el.querySelector('.dd__btn'); const menu = el.querySelector('.dd__menu');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden; closeAllDD();
        menu.hidden = !willOpen; btn.setAttribute('aria-expanded', String(willOpen));
      });
      menu.querySelectorAll('.dd__opt').forEach((o) => o.addEventListener('click', () => {
        state[key] = o.dataset.val; closeAllDD(); render();
      }));
    }
    function buildFacets() {
      buildDropdown('categoryDD', tr('All categories'), cats, 'category');
      buildDropdown('hoodDD', tr('All areas'), hoods, 'hood');
      const clr = document.getElementById('clearAll');
      if (clr) clr.hidden = !(state.category || state.hood);
    }
    // Quick-pick buttons for the most-populated categories (Chamber feedback:
    // "both the field for the category AND choose from top categories buttons").
    const topCats = (() => {
      const counts = {};
      members.forEach((m) => { const g = m.group || 'Other'; counts[g] = (counts[g] || 0) + 1; });
      // Surface the most-populated *named* categories — "Other" isn't a useful pick.
      return Object.keys(counts).filter((g) => g && g !== 'Other').sort((a, b) => counts[b] - counts[a]).slice(0, 8);
    })();
    function buildTopCats() {
      const el = document.getElementById('dirTopCats');
      if (!el) return;
      el.innerHTML = `<button type="button" class="chip${!state.category ? ' active' : ''}" data-cat="">${esc(tr('All'))}</button>`
        + topCats.map((c) => `<button type="button" class="chip${state.category === c ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
      el.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { state.category = b.dataset.cat || ''; render(); }));
    }
    if (!window.__wvDDClose) { window.__wvDDClose = true; document.addEventListener('click', closeAllDD); }

    // Relevance score. -1 = filtered out / no match. Higher = better.
    // Each query word must hit SOME field; matches in name/category rank far
    // above incidental description mentions, and whole-word beats substring
    // (so "hospital" doesn't rank "hospitality" venues at the top).
    // Connector words ("and", "the", "for"…) are dropped so "health and wellness"
    // matches the "Health & Wellness" category; "&" and "and" are interchangeable.
    const STOP = new Set('a an and the of for in on at to or with near my our your find looking need want best top'.split(' '));
    function scoreOf(m) {
      if (state.category && (m.group || 'Other') !== state.category) return -1;
      if (state.hood && m.neighborhood !== state.hood) return -1;
      if (!state.q) return 0;
      const fields = [[m.name, 10], [m.category, 6], [(m.categories || []).join(' '), 6], [m.typeOfBusiness, 6], [(m.keywords || []).join(' '), 5], [m.group, 5],
        [m.neighborhood, 4], [m.city, 4], [m.contactName, 3], [m.tagline, 3],
        [(m.tags || []).join(' '), 2], [m.description, 1]];
      const words = state.q.toLowerCase().replace(/&/g, ' ').split(/\s+/)
        .filter((w) => w && !STOP.has(w));
      if (!words.length) return 0;
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
      buildTopCats();
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
        `${list.length} ${list.length === 1 ? tr('member') : tr('members')}` +
        (state.category ? ` · ${state.category}` : '') +
        (state.hood ? ` · ${state.hood}` : '');
      document.getElementById('emptyState').hidden = list.length > 0;
    }

    const form = document.getElementById('dirSearch');
    const input = document.getElementById('dirQuery');
    input.value = state.q;
    form.addEventListener('submit', (e) => { e.preventDefault(); state.q = input.value.trim(); render(); });
    input.addEventListener('input', () => { state.q = input.value.trim(); render(); });
    const reset = () => { state.q = ''; state.category = ''; state.hood = ''; input.value = ''; render(); };
    const clear = document.getElementById('clearFilters');
    if (clear) clear.addEventListener('click', reset);
    const clearAll = document.getElementById('clearAll');
    if (clearAll) clearAll.addEventListener('click', () => { state.category = ''; state.hood = ''; render(); });

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
    const SOCIAL = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', linkedinPersonal: 'LinkedIn (personal)', x: 'X', youtube: 'YouTube', tiktok: 'TikTok', nextdoor: 'Nextdoor' };
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
    const primaryImg = cardImage(m);
    const seal = primaryImg
      ? `<img src="${esc(primaryImg)}" alt="${esc(m.name)}" style="width:120px;height:120px;border-radius:var(--r-lg);object-fit:cover;margin:0 auto var(--s-4);box-shadow:var(--sh-sm)">`
      : `<div class="member-tile__seal" style="width:100px;height:100px;font-size:2.8rem;margin:0 auto var(--s-4)">${esc(m.seal || m.name[0])}</div>`;
    const fullAddr = [m.address, m.city, m.state].filter(Boolean).join(', ');
    const contactRows = [
      m.phone && `<li>📞 <a href="tel:${phoneDigits}">${esc(m.phone)}</a></li>`,
      m.website && `<li>🌐 <a href="${esc(m.website)}" target="_blank" rel="noopener" title="${esc(m.website)}">${esc(webLabel(m.website))}</a></li>`,
      m.address && `<li>📍 <a href="${esc(mapUrl(m))}" target="_blank" rel="noopener" title="Open in maps">${esc(fullAddr)}</a></li>`,
    ].filter(Boolean).join('');
    // Member video (YouTube/Vimeo URL → responsive embed; else native <video>).
    const video = m.video ? videoEmbed(m.video) : '';

    const teamArr = Array.isArray(m.team) ? m.team.filter((t) => t && t.name) : [];
    const personCard = (t, primary) => {
      const sz = primary ? 96 : 64;
      const ph = t.photo
        ? `<img src="${esc(t.photo)}" alt="${esc(t.name)}" loading="lazy" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;flex:none">`
        : `<div class="member-tile__seal" style="width:${sz}px;height:${sz}px;flex:none">${esc((t.name || '?')[0])}</div>`;
      return `<div style="display:flex;gap:var(--s-4);align-items:flex-start">
        ${ph}
        <div><strong>${esc(t.name)}</strong>${t.title ? `<div class="member-tile__meta">${esc(t.title)}</div>` : ''}
        ${t.bio ? `<p${primary ? '' : ' class="member-tile__meta"'} style="margin:6px 0 0">${esc(t.bio)}</p>` : ''}</div>
      </div>`;
    };
    const teamHtml = teamArr.length ? `
      <div class="meet-team mt-6">
        <h3>Meet the team</h3>
        ${personCard(teamArr[0], true)}
        ${teamArr.length > 1 ? `<div class="grid grid-2 mt-4">${teamArr.slice(1).map((t) => personCard(t, false)).join('')}</div>` : ''}
      </div>` : '';
    const richSection = (title, text) => (text && String(text).trim())
      ? `<div class="mt-5"><h3>${esc(title)}</h3><p style="white-space:pre-wrap;line-height:1.7">${esc(text)}</p></div>` : '';

    el.innerHTML = `
      <div class="grid" style="grid-template-columns:300px 1fr;gap:var(--s-7);align-items:start">
        <aside class="card" style="text-align:center;position:sticky;top:100px">
          ${seal}
          <span class="badge badge--${tier}">${esc(tierLabel === 'Member' ? 'Member' : tierLabel + ' Member')}</span>
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
          ${richSection('Services', m.services)}
          ${richSection('Accomplishments', m.accomplishments)}
          ${richSection('Associations', m.associations)}
          ${facts ? `<ul class="grid grid-3 mt-5" style="list-style:none;gap:var(--s-4)">${facts}</ul>` : ''}
          ${teamHtml}
          ${video}
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
    // Three views: 'quick' (compact legacy list — DEFAULT, per Chamber feedback),
    // 'details' (the image-rich cards), and 'grid' (the month calendar).
    let view = 'quick';
    function renderList() {
      const cat = catEl ? catEl.value : '';
      const when = whenEl ? whenEl.value : 'upcoming';
      const filtered = events.filter((e) => (!cat || e.category === cat) && inWindow(e, when));
      // Featured events float to the top (keeping date order within each group),
      // so the admin "Feature on homepage" toggle visibly affects placement here too.
      const ordered = filtered.filter((e) => e.featured).concat(filtered.filter((e) => !e.featured));
      if (view === 'grid') {
        listEl.hidden = true; gridEl.hidden = false;
      } else {
        gridEl.hidden = true; listEl.hidden = false;
        const empty = '<p class="notice">No events match these filters — try widening the timeframe or choosing “All categories.”</p>';
        listEl.style.gap = view === 'quick' ? '0' : 'var(--s-4)';
        listEl.innerHTML = ordered.length
          ? (view === 'quick'
              ? ordered.map((e) => eventQuickRow(e, 1)).join('')
              : ordered.map((e) => eventCard(e, 1, { newTab: true })).join(''))
          : empty;
      }
      if (countEl) countEl.textContent = filtered.length + ' event' + (filtered.length !== 1 ? 's' : '');
    }
    renderList();
    if (catEl) catEl.addEventListener('change', renderList);
    if (whenEl) whenEl.addEventListener('change', renderList);

    // Deep link: /events/index.html#<eventId> opens that event's detail directly
    // (this is what the new-tab click and Share links point to). Look in the full
    // list so it opens even if the current filter would hide it.
    function openFromHash() {
      const id = decodeURIComponent((location.hash || '').replace(/^#/, ''));
      if (!id) return;
      const ev = events.find((e) => e.id === id) || _eventReg[id];
      if (ev) openEventModal(ev);
    }
    openFromHash();
    window.addEventListener('hashchange', openFromHash);

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

    // view toggle (Quick list · Details · Calendar)
    document.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        view = btn.dataset.view;
        document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === btn));
        renderList();
      });
    });
  }

  // ── Checkout (AGMS / NMI Collect.js) ────────────────────
  async function initCheckout() {
    const params = new URLSearchParams(location.search);
    const kind = params.get('type') || 'donation';
    // Memberships are processed by the Chamber office only — no self-serve online
    // payment. Send anyone who lands here for membership to the application form.
    if (kind === 'membership') {
      location.replace(/\/es\//.test(location.pathname) ? '/es/join.html#apply' : '/join.html#apply');
      return;
    }
    const summary = document.getElementById('orderSummary');
    const title = document.getElementById('coTitle');
    const amountInput = document.getElementById('amount');
    const amountLabel = document.getElementById('amountLabel');

    // Build the order context. A `sku` param (from join.html / donate.html) is
    // resolved against the /api/skus catalog so prices have one source of truth.
    let label = 'Payment', sku = kind, presetAmount = params.get('amount') || '';
    // Receipt context (event title, ticket type/qty) — sent with /api/pay so the
    // emailed receipt can match the legacy ChamberWare format.
    const extra = {};
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
      // Admin-managed events (incl. ticket types set in Admin → Events) live in the
      // API store; the static seed file is only a fallback.
      try { ev = ((await getJSON(ChamberAPI.url('/api/events'))).events || []).find((e) => e.id === id); } catch (e) {}
      if (!ev) { try { ev = (await getJSON('data/events.json')).events.find((e) => e.id === id); } catch (e) {} }
      label = ev ? `Tickets — ${ev.title}` : 'Event tickets';
      const evMeta = ev
        ? `<strong>${esc(ev.title)}</strong><br><span class="member-tile__meta">${esc(ev.month || '')} ${esc(ev.day || '')} · ${esc(ev.venue || ev.neighborhood || '')}</span>`
        : '<strong>Event tickets</strong>';
      const types = (ev && Array.isArray(ev.ticketTypes) ? ev.ticketTypes : [])
        .filter((t) => t.available !== false && t.name && (Number(t.price) > 0 || Number(t.earlyPrice) > 0));
      // Effective price: use the early-bird price until its cutoff, then the standard price.
      const nowT = Date.now();
      const priceOf = (t) => (t.earlyPrice != null && t.earlyUntil && nowT < Date.parse(t.earlyUntil)) ? Number(t.earlyPrice) : Number(t.price);
      // Group options into <optgroup>s (Tickets / Sponsorships / Program Ads / …) when a group is set.
      const optionsHtml = (() => {
        const groups = [];
        types.forEach((t, i) => {
          const g = t.group || '';
          let bucket = groups.find((x) => x.g === g);
          if (!bucket) { bucket = { g, items: [] }; groups.push(bucket); }
          bucket.items.push(`<option value="${i}">${esc(t.name)} — $${priceOf(t).toFixed(2)}</option>`);
        });
        if (groups.length === 1 && groups[0].g === '') return groups[0].items.join('');
        return groups.map((b) => b.g ? `<optgroup label="${esc(b.g)}">${b.items.join('')}</optgroup>` : b.items.join('')).join('');
      })();
      if (types.length) {
        // Ticket picker: type dropdown + quantity → total auto-fills (amounts are
        // staff-entered in Admin → Events, so buyers never guess the price).
        summary.innerHTML = `${evMeta}
          <div class="field mt-4" style="margin-bottom:var(--s-3)"><label for="tixType">Ticket / item</label>
            <select id="tixType" style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:var(--r-md);font:inherit;background:var(--paper)">
              ${optionsHtml}
            </select></div>
          <div class="field" style="margin-bottom:var(--s-2)"><label for="tixQty">Quantity</label>
            <select id="tixQty" style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:var(--r-md);font:inherit;background:var(--paper)"></select></div>
          <div id="tixNames"></div>
          <p class="member-tile__meta" id="tixCalc" style="text-align:right"></p>`;
        amountLabel.textContent = 'Total (USD)';
        amountInput.readOnly = true;
        amountInput.style.background = 'var(--cream-deep, #f3ecda)';
        const typeSel = document.getElementById('tixType');
        const qtySel = document.getElementById('tixQty');
        const calc = document.getElementById('tixCalc');
        const buildQty = () => {
          const t = types[Number(typeSel.value)] || types[0];
          const max = Math.max(1, Math.min(10, t.qty || 10));
          const cur = Math.min(Number(qtySel.value) || 1, max);
          qtySel.innerHTML = Array.from({ length: max }, (_, i) => `<option${i + 1 === cur ? ' selected' : ''}>${i + 1}</option>`).join('');
        };
        const namesDiv = document.getElementById('tixNames');
        // Name + contact per ticket so the office knows who is attending
        // (matches the legacy ChamberWare receipts). Values survive qty changes.
        const buildNames = (qty) => {
          const prev = Array.from(namesDiv.querySelectorAll('[data-att-row]')).map((r) => ({
            name: r.querySelector('[data-attendee]')?.value || '',
            contact: r.querySelector('[data-att-contact]')?.value || '',
          }));
          namesDiv.innerHTML = Array.from({ length: qty }, (_, i) => `
            <div data-att-row style="margin-bottom:var(--s-2)">
              <div class="grid grid-2" style="gap:var(--s-2)">
                <div class="field" style="margin:0"><label>Attendee ${i + 1} name</label>
                  <input data-attendee value="${esc(prev[i]?.name || '')}" placeholder="${i === 0 ? 'Who is this ticket for?' : 'Guest name'}" /></div>
                <div class="field" style="margin:0"><label>Their email or phone</label>
                  <input data-att-contact value="${esc(prev[i]?.contact || '')}" placeholder="Optional" /></div>
              </div>
            </div>`).join('');
        };
        const update = () => {
          buildQty();
          const t = types[Number(typeSel.value)] || types[0];
          const qty = Number(qtySel.value) || 1;
          buildNames(qty);
          const unit = priceOf(t);
          const total = unit * qty;
          amountInput.value = total.toFixed(2);
          calc.textContent = `${qty} × ${t.name} @ $${unit.toFixed(2)} = $${total.toFixed(2)}`;
          label = `Tickets — ${ev.title} · ${qty} × ${t.name} @ $${unit.toFixed(2)}`;
          sku = `ticket:${id}:${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
          extra.eventTitle = ev.title; extra.ticketType = t.name; extra.quantity = qty;
        };
        typeSel.addEventListener('change', update);
        qtySel.addEventListener('change', update);
        update();
      } else {
        summary.innerHTML = `${evMeta}<p class="notice mt-3">Ticket pricing is set by the Chamber — enter the amount shown for your ticket type, or confirm with the office.</p>`;
        amountLabel.textContent = 'Ticket amount (USD)';
      }
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
    } else if (kind === 'payment') {
      // Office-directed payment link: the Chamber emails a URL like
      //   checkout.html?type=payment&for=2026%20Dues%20Renewal&amount=450
      // `for` labels the charge on the receipt; `amount` presets (still editable).
      const what = params.get('for') || 'Chamber payment';
      sku = 'payment:' + what.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      title.textContent = 'Make a payment';
      label = `Payment: ${what}`;
      summary.innerHTML = `<strong>${esc(what)}</strong><p class="member-tile__meta mt-2">Pay the Chamber securely by card. If the amount was not filled in for you, enter the amount provided by the Chamber office.</p>`;
      amountLabel.textContent = 'Amount (USD)';
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

    // (Promo-code UI removed Jul 2026 — the Chamber decided against promo codes.)

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
            company: fd.get('company'), phone: fd.get('phone'),
            // AVS: the gateway requires billing street + ZIP with every charge.
            address1: fd.get('address1'), city: fd.get('city'), state: fd.get('state'), zip: fd.get('zip'),
            // Masked card info from Collect.js (e.g. "411111******1111", "visa") —
            // shown on the emailed receipt as XXXX-1111; never the full number.
            cardLast4: (resp.card && resp.card.number ? String(resp.card.number).slice(-4) : ''),
            cardType: (resp.card && resp.card.type) || '',
            attendees: Array.from(document.querySelectorAll('#tixNames [data-att-row]'))
              .map((r) => ({
                name: (r.querySelector('[data-attendee]')?.value || '').trim(),
                contact: (r.querySelector('[data-att-contact]')?.value || '').trim(),
              })).filter((a) => a.name || a.contact),
            description: label,
            ...extra,
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

  // Formspree project forms (the office set these to reach Felicia). Lead forms
  // dual-send: Formspree (emails the office) + /api/contact (durable admin log).
  const LEAD_FS_PROJECT = '3015387617890926306';
  const LEAD_FS_KEY = { 'membership-application': 'membership', membership: 'membership', sponsorship: 'sponsorship', events: 'events', press: 'press' };
  const LEAD_FS_GENERAL = 'mojbggnq';
  function leadFsEndpoint(kind) {
    return LEAD_FS_KEY[kind]
      ? 'https://formspree.io/p/' + LEAD_FS_PROJECT + '/f/' + LEAD_FS_KEY[kind]
      : 'https://formspree.io/f/' + LEAD_FS_GENERAL;
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
    } else if (reason && params.get('event')) {
      // Arrived via an event's RSVP button → pre-select the RSVP reason.
      [...reason.options].forEach((o) => { if (/rsvp/i.test(o.value)) reason.value = o.value; });
    }
    // Resolve ?event=<id> to a human-readable title so the office email says
    // "RSVP — Health & Wellness Network (Jul 27)" instead of a raw "le-11182".
    let eventLabel = '';
    if (params.get('event')) {
      (async () => {
        try {
          const evs = (await getJSON(ChamberAPI.url('/api/events'))).events || [];
          const ev = evs.find((x) => x.id === params.get('event'));
          if (ev) eventLabel = `${ev.title}${ev.month && ev.day ? ` (${ev.month} ${ev.day})` : ''}`;
        } catch (e) { /* raw id still sent as fallback */ }
      })();
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const payload = { kind };
      new FormData(form).forEach((v, k) => { payload[k] = v; });
      if (params.get('event')) payload.event = eventLabel ? `${eventLabel} [${params.get('event')}]` : params.get('event');
      if (params.get('group')) payload.group = params.get('group');
      const btn = form.querySelector('button[type="submit"]');
      const label = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
      try {
        // 1) Formspree → emails the Chamber office (Felicia). 2) /api/contact →
        //    durable admin Inquiries log. Success if EITHER channel accepts.
        const who = [payload.firstName, payload.lastName].filter(Boolean).join(' ') || payload.name || payload.company || '';
        const subject = (/rsvp/i.test(payload.reason || '') && eventLabel)
          ? `RSVP — ${eventLabel}${who ? ' — ' + who : ''}`
          : kind === 'membership-application'
            ? `Membership application — ${payload.company || who}`
            : 'Website ' + (payload.reason || kind) + (eventLabel ? ' — ' + eventLabel : '') + (payload.company ? ' — ' + payload.company : who ? ' — ' + who : '');
        const fsP = fetch(leadFsEndpoint(kind), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(Object.assign({ _subject: subject }, payload)),
        }).then((r) => r.ok).catch(() => false);
        const apiP = fetch(ChamberAPI.url('/api/contact'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        }).then(async (r) => { try { return !!(await r.json()).ok; } catch (e) { return r.ok; } }).catch(() => false);
        const [fsOk, apiOk] = await Promise.all([fsP, apiP]);
        msg.hidden = false;
        if (fsOk || apiOk) {
          form.reset();
          msg.textContent = 'Thank you — your message has been sent. The Chamber will be in touch.';
          msg.style.borderColor = 'var(--green)';
        } else {
          msg.textContent = 'Something went wrong. Please call (818) 347-4737.';
        }
      } catch (err) {
        msg.hidden = false;
        msg.textContent = 'Could not send right now. Please call the office at (818) 347-4737.';
      } finally { btn.disabled = false; btn.textContent = label; }
    });
  }

  // ── Jobs board ──────────────────────────────────────────
  // Jobs board — member-submitted openings (admin-approved posts, type 'job').
  function jobCard(p) {
    const meta = p.meta || {};
    const apply = p.ctaUrl
      ? `<a class="btn btn--gold btn--sm" href="${esc(p.ctaUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || tr('Apply'))}</a>`
      : (meta.applyEmail ? `<a class="btn btn--gold btn--sm" href="mailto:${esc(meta.applyEmail)}?subject=${encodeURIComponent('Application: ' + (p.title || ''))}">${tr('Apply by email')}</a>` : '');
    return `
      <article class="card card--hover job-card">
        <div style="display:flex;justify-content:space-between;gap:var(--s-4);flex-wrap:wrap;align-items:flex-start">
          <div>
            <h3 style="margin-bottom:2px">${esc(p.title)}</h3>
            <div class="member-tile__meta">
              ${p.memberId ? `<a href="/members/profile.html?id=${esc(p.memberId)}">${esc(p.authorName || '')}</a>` : esc(p.authorName || '')}
              ${meta.location ? ' · 📍 ' + esc(meta.location) : ''}
            </div>
          </div>
          ${apply}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${meta.jobType ? `<span class="badge">${esc(meta.jobType)}</span>` : ''}
          ${meta.payRange ? `<span class="badge badge--gold">${esc(meta.payRange)}</span>` : ''}
        </div>
        ${p.body ? `<p class="mt-3">${esc(p.body)}</p>` : ''}
      </article>`;
  }
  async function initJobs() {
    initFeaturedSlot('jobs', '#jobsFeatured', { depth: 1 });
    const list = document.getElementById('jobsList');
    const count = document.getElementById('jobsCount');
    let jobs = [];
    try { jobs = (await getJSON(ChamberAPI.url('/api/posts?type=job'))).posts || []; } catch (e) {}
    const L = LANG === 'es';
    const render = (arr) => {
      list.innerHTML = arr.length ? arr.map(jobCard).join('')
        : (L ? '<div class="notice">No hay puestos disponibles ahora. Los negocios miembros publican vacantes gratis desde el <a href="/member/post.html">portal de miembros</a> — o <a href="/es/join.html">únase a la Cámara</a> para llegar al talento local.</div>'
             : '<div class="notice">No open positions right now. Member businesses post openings free from the <a href="/member/post.html">member portal</a> — or <a href="/join.html">join the Chamber</a> to reach local talent here.</div>');
    };
    count.textContent = jobs.length ? `${jobs.length} ${jobs.length === 1 ? tr('open position') : tr('open positions')}` : '';
    render(jobs);
    const sb = document.getElementById('jobsSearch');
    if (sb) sb.addEventListener('input', () => {
      const q = sb.value.trim().toLowerCase();
      render(!q ? jobs : jobs.filter((p) => [p.title, p.body, p.authorName, p.meta && p.meta.location, p.meta && p.meta.jobType].filter(Boolean).join(' ').toLowerCase().includes(q)));
    });
  }

  // ── Posts: discounts (offers) + member community board ──
  function offerCard(p) {
    return `
      <article class="card card--hover">
        ${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--r-md);margin-bottom:var(--s-3)">` : ''}
        <span class="badge badge--gold">${tr('Offer')}</span>
        <h3 style="margin:8px 0 4px">${esc(p.title)}</h3>
        ${p.authorName ? `<div class="member-tile__meta">${p.memberId ? `<a href="/members/profile.html?id=${esc(p.memberId)}">${esc(p.authorName)}</a>` : esc(p.authorName)}</div>` : ''}
        <p class="mt-2">${esc(p.body || '')}</p>
        ${p.code ? `<p class="mt-2"><span class="badge">${LANG==='es'?'Código':'Code'}: ${esc(p.code)}</span></p>` : ''}
        ${p.ctaUrl ? `<a class="btn btn--gold btn--sm mt-3" href="${esc(p.ctaUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || tr('Redeem'))}</a>` : ''}
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

  // Link previews — for posts that link out without their own image, pull the
  // linked page's og:image/title/description so the card shows a rich preview.
  async function loadPreviews(posts) {
    await Promise.all((posts || []).map(async (p) => {
      if (p.imageUrl || !p.linkUrl) return;
      try {
        const pv = await getJSON(ChamberAPI.url('/api/link-preview?url=' + encodeURIComponent(p.linkUrl)));
        if (pv && pv.ok && (pv.image || pv.description)) p._preview = pv;
      } catch (e) {}
    }));
    return posts;
  }
  const postImage = (p) => p.imageUrl || (p._preview && p._preview.image) || '';

  // Bulletin-board card for Valley Biz Buzz — clamped body that expands on click.
  function newsCard(p) {
    const d = p.created ? new Date(p.created) : null;
    const date = d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const body = String(p.body || '').trim();
    const long = body.length > 240 || body.split('\n').length > 4;
    const img = postImage(p);
    return `
      <article class="card" style="display:flex;gap:18px;padding:20px 22px;align-items:flex-start">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy" style="width:128px;height:128px;object-fit:cover;border-radius:12px;flex-shrink:0">`
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
      if (posts.length) { el.innerHTML = posts.map(render).join(''); await loadPreviews(posts); el.innerHTML = posts.map(render).join(''); }
      else { el.innerHTML = `<div class="notice">${empty}</div>`; }
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
      if (!offers.length) { el.className = ''; el.innerHTML = `<div class="notice">${tr('No member offers yet — check back soon, or members can post one from their portal.')}</div>`; return; }
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
    if (dl) dl.innerHTML = `<span>${LANG === 'es' ? 'Desde 1930' : 'Since 1930'}</span><span>${new Date().toLocaleDateString(LANG === 'es' ? 'es-ES' : undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span><span class="biz-hide-sm">Tarzana · Woodland Hills · Reseda · Warner Center</span>`;
    if (!posts.length) { el.innerHTML = '<p class="notice">No news yet — check back soon.</p>'; return; }
    const fmt = (p) => { const d = p.created ? new Date(p.created) : null; return d && !isNaN(d) ? d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : ''; };
    const render = () => {
      const lead = posts[0], rest = posts.slice(1);
      const leadImg = postImage(lead);
      const leadHtml = `<article style="display:grid;grid-template-columns:${leadImg ? '1.25fr 1fr' : '1fr'};gap:30px;align-items:start;padding-bottom:30px;border-bottom:3px double var(--green-ink,#1b3326);margin-bottom:30px" class="biz-lead">
        <div>
          <div style="font-family:var(--mono);font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-deep);margin-bottom:8px">Lead Story · ${esc(fmt(lead))}${lead._preview && lead._preview.siteName ? ' · ' + esc(lead._preview.siteName) : ''}</div>
          <h2 style="font-family:var(--display);font-size:clamp(1.9rem,3.8vw,3rem);line-height:1.08;margin:0 0 14px">${esc(lead.title)}</h2>
          <p data-biz-body style="line-height:1.75;color:var(--slate-mid,#33403a);white-space:pre-line;display:-webkit-box;-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden">${esc(lead.body || (lead._preview && lead._preview.description) || '')}</p>
          <div style="margin-top:14px">${lead.linkUrl ? `<a class="chip chip--gold" target="_blank" rel="noopener" href="${esc(lead.linkUrl)}">${esc(lead.ctaLabel || 'Read more')} ↗</a> ` : ''}<button class="chip" data-biz-more>Full story</button></div>
        </div>
        ${leadImg ? `<img src="${esc(leadImg)}" alt="" loading="lazy" style="width:100%;border:1px solid var(--green-ink,#1b3326);filter:grayscale(.15)">` : ''}
      </article>`;
      const colHtml = `<div class="biz-cols" style="column-count:3;column-gap:34px;column-rule:1px solid var(--gold-soft,#e6dcbf)">${rest.map((p) => { const im = postImage(p); return `
        <article style="break-inside:avoid;margin:0 0 26px;padding-bottom:20px;border-bottom:1px solid var(--gold-soft,#e6dcbf)">
          ${im ? `<img src="${esc(im)}" alt="" loading="lazy" style="width:100%;margin-bottom:9px;filter:grayscale(.15)">` : ''}
          <div style="font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-deep)">${esc(fmt(p))}${p._preview && p._preview.siteName ? ' · ' + esc(p._preview.siteName) : ''}</div>
          <h3 style="font-family:var(--display);font-size:1.2rem;line-height:1.2;margin:3px 0 7px">${esc(p.title)}</h3>
          <p data-biz-body style="font-size:.9rem;line-height:1.6;color:var(--slate-mid,#33403a);white-space:pre-line;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden">${esc(p.body || (p._preview && p._preview.description) || '')}</p>
          <div style="margin-top:7px">${p.linkUrl ? `<a style="font-size:.8rem;color:var(--gold-deep)" target="_blank" rel="noopener" href="${esc(p.linkUrl)}">${esc(p.ctaLabel || 'Read more')} ↗</a> · ` : ''}<button data-biz-more style="font-size:.8rem;color:var(--gold-deep);background:none;border:none;cursor:pointer;text-decoration:underline;padding:0">Read more</button></div>
        </article>`; }).join('')}</div>`;
      el.innerHTML = leadHtml + colHtml;
    };
    render();
    await loadPreviews(posts);
    render();
  }

  // ── Board of Directors / leadership (data-driven from leaderStatus) ──
  // Design: gold-ringed headshot medallions (Page Image → logo → initial),
  // person → office/title in gold small caps → business. Officers render larger.
  function ensureBoardCss() {
    if (document.getElementById('wv-board-css')) return;
    const st = document.createElement('style'); st.id = 'wv-board-css';
    st.textContent = '.board-card{display:block;text-decoration:none;color:inherit;padding:10px 6px;border-radius:16px;transition:transform .25s ease}'
      + '.board-card:hover{transform:translateY(-4px)}'
      + '.board-face{transition:transform .3s ease,box-shadow .3s ease}'
      + '.board-card:hover .board-face{transform:scale(1.045);box-shadow:0 0 0 3px #fff,0 0 0 6px var(--gold,#C9A227),0 16px 34px rgba(18,36,26,.26)!important}'
      + '.board-rule{display:flex;align-items:center;gap:14px;justify-content:center;margin:0 0 26px}'
      + '.board-rule::before,.board-rule::after{content:"";height:2px;width:64px;background:linear-gradient(90deg,transparent,var(--gold,#C9A227));display:block}'
      + '.board-rule::after{background:linear-gradient(90deg,var(--gold,#C9A227),transparent)}';
    document.head.appendChild(st);
  }
  function boardCard(m, depth, opts = {}) {
    ensureBoardCss();
    const base = depth ? '../' : '';
    const slug = m.slug || m.id;
    const person = m.contactName || m.name;
    // "Page Image" (headshot) leads on leadership pages; the directory logo is
    // only the fallback — members pick each image separately in their portal.
    // opts.noLogo (Leaders page) skips the logo fallback so a company mark is
    // never squashed into the round face slot.
    const face = m.pageImage || (opts.noLogo ? '' : m.logo);
    const size = opts.size || 128;
    // The gold initial medallion sits UNDERNEATH the photo — if the photo ever
    // fails to load it removes itself and the medallion shows instead of a
    // broken white circle (seen once mid-deploy, Jul 2026).
    const medallion = `<div aria-hidden="true" class="board-face" style="position:absolute;inset:0;border-radius:50%;background:linear-gradient(140deg,var(--green-deep,#1E5631),#12301c);color:var(--gold-bright,#e3c55f);display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:${Math.round(size / 2.5)}px;box-shadow:0 0 0 3px #fff,0 0 0 5px var(--gold-soft,#e6dcbf),0 10px 24px rgba(18,36,26,.12)">${esc((person || '?')[0].toUpperCase())}</div>`;
    const pic = `<div style="position:relative;width:${size}px;height:${size}px;margin:0 auto">${medallion}${face
      ? `<img class="board-face" src="${esc(face)}" alt="${esc(person)}" loading="lazy" onerror="this.remove()" style="position:absolute;inset:0;width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 3px #fff,0 0 0 5px var(--gold,#C9A227),0 10px 24px rgba(18,36,26,.16)">`
      : ''}</div>`;
    const title = m.boardTitle || m.leaderStatus;
    return `
      <article style="text-align:center">
        <a href="${base}members/${esc(slug)}" class="board-card">
          ${pic}
          <div style="font-family:var(--display);font-size:${opts.size && opts.size > 128 ? '1.3rem' : '1.16rem'};margin-top:16px;color:var(--green-ink,#1b3326)">${esc(person)}</div>
          ${title ? `<div style="color:var(--gold-deep,#8a6d1a);font-weight:700;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;margin-top:5px">${esc(title)}</div>` : ''}
          ${m.contactName && m.name !== m.contactName ? `<div class="member-tile__meta" style="margin-top:4px">${esc(m.name)}</div>` : ''}
          <div style="color:var(--gold-deep);font-size:.78rem;margin-top:7px;opacity:.75">View profile →</div>
        </a>
      </article>`;
  }
  const LEADER_GROUP_LABEL = { 'Leader': 'Executive Officers', 'Board Member': 'Board of Directors', 'Past President': 'Past Presidents', 'Ambassador': 'Ambassadors' };
  // Board pages read like a printed roster: alphabetical by LAST name.
  const lastNameOf = (m) => { const p = String(m.contactName || m.name).trim().split(/\s+/); return p[p.length - 1]; };
  async function initBoard(depth = 0) {
    const el = document.getElementById('boardGrid'); if (!el) return;
    // Each designation is its own deep-linkable view: leadership.html?group=<status>.
    const only = new URLSearchParams(location.search).get('group') || '';
    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; }
    catch (e) { el.innerHTML = '<p class="notice">Could not load the roster right now.</p>'; return; }
    // Ambassadors are cleared from this page for now (per the Chamber office,
    // Jul 2026). Re-add 'Ambassador' to ORDER + tabs to bring the section back.
    const ORDER = ['Leader', 'Board Member', 'Past President'];
    const base = depth ? '../' : '';
    // Sub-nav so visitors can jump to the Board or officers view.
    const tabs = [['', 'Everyone'], ['Leader', 'Officers'], ['Board Member', 'Board of Directors']];
    const subnav = `<nav class="chips" style="justify-content:center;margin-bottom:var(--s-6)" aria-label="Leadership groups">${tabs.map(([g, l]) =>
      `<a class="chip${only === g ? ' chip--gold' : ''}" href="${base}leadership.html${g ? ('?group=' + encodeURIComponent(g)) : ''}">${l}</a>`).join('')}</nav>`;
    const want = only && ORDER.includes(only) ? [only] : ORDER;
    // Officers rank by office (President → CFO → Secretary); everyone else
    // reads like a printed roster, alphabetical by last name.
    const officerRank = (m) => {
      const t = String(m.boardTitle || '').toLowerCase();
      if (t.includes('president of the board')) return 0;
      if (t.includes('financial')) return 1;
      if (t.includes('secretary')) return 2;
      return 3;
    };
    const board = members.filter((m) => want.includes(m.leaderStatus))
      .sort((a, b) => (ORDER.indexOf(a.leaderStatus) - ORDER.indexOf(b.leaderStatus))
        || (a.leaderStatus === 'Leader' ? officerRank(a) - officerRank(b) : 0)
        || lastNameOf(a).localeCompare(lastNameOf(b)));
    if (!board.length) { el.innerHTML = subnav + '<p class="notice">This roster is being finalized — check back soon. (Admins: set each member\'s designation under Members.)</p>'; return; }
    // group by designation
    const groups = {};
    board.forEach((m) => { (groups[m.leaderStatus] = groups[m.leaderStatus] || []).push(m); });
    const section = (g, list) => {
      const officers = g === 'Leader';
      // Officers sit up top, larger, on their own centered row; the board is a
      // classic 4-up gallery. Gold hairline rules frame each section title.
      const grid = officers
        ? `<div style="display:flex;flex-wrap:wrap;justify-content:center;gap:var(--s-7)">${list.map((m) => `<div style="flex:0 1 240px">${boardCard(m, depth, { size: 156 })}</div>`).join('')}</div>`
        : `<div class="grid grid-4" style="gap:var(--s-6)">${list.map((m) => boardCard(m, depth)).join('')}</div>`;
      return `
        <div style="margin-bottom:var(--s-8)">
          <div class="board-rule"><h2 style="margin:0;white-space:nowrap">${esc(LEADER_GROUP_LABEL[g] || g)}</h2></div>
          ${grid}
        </div>`;
    };
    // Single-group view: one section. Combined view: a section per group.
    const body = (only ? [only] : ORDER).filter((g) => groups[g]).map((g) => section(g, groups[g])).join('');
    el.innerHTML = subnav + body;
  }

  // ── Chamber Leaders page — members in the leader marketing package ──
  // Grouped by level (Platinum → Friend), designated via the member's tier in
  // the admin console. Cards match the Board/Ambassador page: headshot
  // (pageImage) or logo, person + company, linked to the member profile.
  async function initLeaders(depth = 0) {
    const el = document.getElementById('leadersGrid'); if (!el) return;
    ensureBoardCss();
    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; }
    catch (e) { el.innerHTML = '<p class="notice">Could not load the roster right now.</p>'; return; }
    const LEVELS = ['platinum', 'gold', 'silver', 'bronze', 'supporter', 'friend'];
    const LABEL = { platinum: 'Platinum', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', supporter: 'Supporter', friend: 'Friend' };
    const leaders = members.filter((m) => LEVELS.includes(String(m.tier || '').toLowerCase()));
    if (!leaders.length) {
      el.innerHTML = '<p class="notice">Our Chamber Leaders roster is being finalized — check back soon. (Admins: set a member\'s leader level under Members → Tier.)</p>';
      return;
    }
    // Leaders are BUSINESSES: show a headshot circle only when the member set a
    // Page Image; otherwise their logo in a clean contained tile (never crammed
    // into a circle), else the initial medallion.
    const base = depth ? '../' : '';
    const leaderCell = (m, levelLabel) => {
      const slug = m.slug || m.id;
      const media = m.pageImage
        ? `<div style="position:relative;width:112px;height:112px;margin:0 auto"><img class="board-face" src="${esc(m.pageImage)}" alt="${esc(m.contactName || m.name)}" loading="lazy" onerror="this.remove()" style="width:112px;height:112px;border-radius:50%;object-fit:cover;box-shadow:0 0 0 3px #fff,0 0 0 5px var(--gold,#C9A227),0 8px 20px rgba(18,36,26,.14)"></div>`
        : (m.leaderLogo || m.logo)
          ? `<div class="board-face" style="width:132px;height:96px;margin:0 auto;background:#fff;border:1px solid var(--gold-soft,#e6dcbf);border-radius:12px;display:flex;align-items:center;justify-content:center;padding:8px;box-shadow:0 8px 20px rgba(18,36,26,.08)"><img src="${esc(m.leaderLogo || m.logo)}" alt="${esc(m.name)} logo" loading="lazy" onerror="this.parentNode.textContent='${esc((m.name || '?')[0].toUpperCase())}'" style="max-width:100%;max-height:100%;object-fit:contain"></div>`
          : `<div aria-hidden="true" class="board-face" style="width:112px;height:112px;border-radius:50%;background:linear-gradient(140deg,var(--green-deep,#1E5631),#12301c);color:var(--gold-bright,#e3c55f);display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:44px;margin:0 auto;box-shadow:0 0 0 3px #fff,0 0 0 5px var(--gold-soft,#e6dcbf)">${esc((m.name || '?')[0].toUpperCase())}</div>`;
      return `
        <article style="text-align:center">
          <a href="${base}members/${esc(slug)}" class="board-card">
            ${media}
            <div style="font-family:var(--display);font-size:1.08rem;margin-top:14px;color:var(--green-ink,#1b3326)">${esc(m.name)}</div>
            <div style="color:var(--gold-deep,#8a6d1a);font-weight:700;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;margin-top:4px">${esc(levelLabel)} Leader</div>
            ${m.contactName ? `<div class="member-tile__meta" style="margin-top:3px">${esc(m.contactName)}</div>` : ''}
          </a>
        </article>`;
    };
    const groups = {};
    leaders.forEach((m) => { const t = String(m.tier).toLowerCase(); (groups[t] = groups[t] || []).push(m); });
    el.innerHTML = LEVELS.filter((t) => groups[t]).map((t) => `
      <div style="margin-bottom:var(--s-7)">
        <div class="board-rule"><h2 style="margin:0;white-space:nowrap">${LABEL[t]} Leaders</h2></div>
        <div class="grid grid-4" style="gap:var(--s-6)">${groups[t]
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
          .map((m) => leaderCell(m, LABEL[t])).join('')}</div>
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

  // ── Featured placement: one sponsored member per page/guide ──
  // Admin-assigned (Admin → Sponsorships). Renders a banner card above the
  // page's listings; stays hidden when the slot is unassigned.
  async function initFeaturedSlot(slot, sel, opts = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return;
    const depth = opts.depth || 0;
    let m = null;
    try { m = ((await getJSON(ChamberAPI.url('/api/featured?slots=' + encodeURIComponent(slot)))).featured || {})[slot]; }
    catch (e) { return; }
    if (!m) return;
    const href = m.slug ? `/members/${m.slug}` : `/members/profile.html?id=${encodeURIComponent(m.id)}`;
    const photo = m.logo || m.leaderLogo || (m.photos && m.photos[0]) || '';
    const fixUrl = (u) => (/^(https?:|\/)/.test(u) ? u : '/' + u);
    el.innerHTML = `
      <aside class="featured-spot" aria-label="${tr('Featured Member')}">
        <div class="featured-spot__badge">★ ${tr('Featured Member')}</div>
        ${photo ? `<a class="featured-spot__logo" href="${href}"><img src="${esc(fixUrl(photo))}" alt="${esc(m.name)} logo" loading="lazy"></a>` : ''}
        <div class="featured-spot__body">
          <a class="featured-spot__name" href="${href}">${esc(m.name)}</a>
          <div class="member-tile__meta">${[m.category, m.neighborhood].filter(Boolean).map(esc).join(' · ')}</div>
          ${m.tagline ? `<p class="featured-spot__tag">${esc(m.tagline)}</p>` : ''}
        </div>
        <div class="featured-spot__cta">
          <a class="btn btn--gold btn--sm" href="${href}">${tr('View profile →')}</a>
          ${m.website ? `<a class="btn btn--ghost btn--sm" href="${esc(m.website)}" target="_blank" rel="noopener">${tr('Website')}</a>` : ''}
        </div>
      </aside>`;
    el.hidden = false;
  }

  // ── Join / "list your business" CTA band (guides & resource pages) ──
  function joinCtaHtml(depth = 0, opts = {}) {
    const base = '../'.repeat(depth || 0);
    const L = LANG === 'es';
    const joinUrl = (typeof location !== 'undefined' ? location.origin : '') + (L ? '/es/join.html' : '/join.html');
    const what = opts.what || (L ? 'negocio' : 'business');
    const head = L ? `¿Su ${esc(what)} es parte de la historia del West Valley?` : `Is your ${esc(what)} part of the West Valley story?`;
    const sub = L ? `Únase a la Cámara para aparecer aquí — o comparta esto con un ${esc(what)} que debería estar en esta página.`
      : `Join the Chamber to be listed here — or share this with a ${esc(what)} that belongs on this page.`;
    return `
      <section class="join-cta">
        <div class="join-cta__inner">
          <div>
            <h2>${head}</h2>
            <p>${sub}</p>
          </div>
          <div class="join-cta__actions">
            <a class="btn btn--gold btn--lg" href="${base}join.html">${tr('Become a member')}</a>
            <button class="btn btn--ghost btn--lg" type="button" data-share-copy="${esc(joinUrl)}" style="color:#fff;border-color:rgba(255,255,255,.4)">${tr('Share the join link')}</button>
          </div>
        </div>
      </section>`;
  }
  function mountJoinCta(sel, opts = {}) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (el) el.outerHTML = joinCtaHtml(opts.depth || 0, opts);
  }

  // ── Community guides (/guides) ───────────────────────────
  async function initGuides() {
    const grid = document.getElementById('guideGrid');
    if (!grid) return;
    let guides = [];
    try { guides = (await getJSON(ChamberAPI.url('/api/guides'))).guides || []; } catch (e) {}
    const gbase = LANG === 'es' ? '/es/guides/' : '/guides/';
    grid.innerHTML = guides.length ? guides.map((g) => `
      <a class="card card--hover guide-card" href="${gbase}${esc(g.slug)}">
        <div class="guide-card__emoji" aria-hidden="true">${esc(g.emoji || '📘')}</div>
        <h3>${esc((LANG === 'es' && g.title_es) || g.title)}</h3>
        <p class="member-tile__meta">${esc((LANG === 'es' && g.lede_es) || g.lede || '')}</p>
        <span class="btn btn--forest btn--sm mt-3">${tr('Open guide →')}</span>
      </a>`).join('') : `<p class="notice">${LANG === 'es' ? 'Las guías se están preparando — vuelva pronto.' : 'Guides are being set up — check back soon.'}</p>`;
  }

  async function initGuideView(depth = 1) {
    const L = LANG === 'es';
    const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    let g = null;
    try { g = await getJSON(ChamberAPI.url('/api/guides/' + encodeURIComponent(slug))); } catch (e) {}
    if (!g || g.error) {
      document.getElementById('guideTitle').textContent = L ? 'Guía no encontrada' : 'Guide not found';
      document.getElementById('guideMembers').innerHTML = `<div class="notice">${L ? 'Esta guía pudo haberse movido — <a href="./">ver todas las guías</a>.' : 'This guide may have moved — <a href="/guides/">see all guides</a>.'}</div>`;
      return;
    }
    const gt = (L && g.title_es) || g.title, gl = (L && g.lede_es) || g.lede, gi = (L && g.intro_es) || g.intro, gk = (L && g.kicker_es) || g.kicker;
    document.title = `${gt} — West Valley · Warner Center Chamber of Commerce`;
    document.getElementById('guideKicker').textContent = gk || (L ? 'Guía Comunitaria' : 'Community Guide');
    document.getElementById('guideTitle').textContent = (g.emoji ? g.emoji + ' ' : '') + gt;
    document.getElementById('guideLede').textContent = gl || '';
    if (gi) document.getElementById('guideIntro').textContent = gi;

    initFeaturedSlot('guide:' + g.slug, '#guideFeatured', { depth });

    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; } catch (e) {}
    const cats = new Set((g.categories || []).map((c) => c.toLowerCase()));
    const kws = (g.keywords || []).map((k) => k.toLowerCase());
    const matches = members.filter((m) => {
      const mcats = [m.category].concat(m.categories || []).filter(Boolean).map((c) => c.toLowerCase());
      if (mcats.some((c) => cats.has(c))) return true;
      const hay = [m.name, m.category, m.tagline, m.typeOfBusiness, (m.keywords || []).join(' '), (m.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
      return kws.some((k) => hay.includes(k));
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const grid = document.getElementById('guideMembers');
    const count = document.getElementById('guideCount');
    if (count) count.textContent = matches.length ? `${matches.length} ${matches.length === 1 ? tr('business') : tr('businesses')}` : '';
    const upJoin = '../'.repeat(depth) + (L ? 'es/join.html' : 'join.html');
    const render = (list) => {
      grid.innerHTML = list.length
        ? list.map((m) => memberTile(m, depth)).join('')
        : `<div class="notice">${L ? '¿Conoce un negocio que pertenece aquí?' : 'No member businesses in this guide yet — know one that belongs here?'} <a href="${upJoin}">${L ? 'Invítelo a unirse →' : 'Invite them to join →'}</a></div>`;
    };
    render(matches);
    const sb = document.getElementById('guideSearch');
    if (sb) sb.addEventListener('input', () => {
      const q = sb.value.trim().toLowerCase();
      render(!q ? matches : matches.filter((m) => [m.name, m.category, m.neighborhood, m.tagline, (m.keywords || []).join(' ')].filter(Boolean).join(' ').toLowerCase().includes(q)));
    });
  }

  // ── Real estate (member-submitted listings, admin-approved) ──
  function listingCard(p) {
    const meta = p.meta || {};
    const facts = [meta.price, meta.beds && `${meta.beds} bd`, meta.baths && `${meta.baths} ba`, meta.sqft && `${Number(String(meta.sqft).replace(/[^\d]/g, '')) ? Number(String(meta.sqft).replace(/[^\d]/g, '')).toLocaleString() : meta.sqft} sq ft`].filter(Boolean);
    return `
      <article class="card card--hover listing-card">
        ${p.imageUrl ? `<img class="listing-card__img" src="${esc(p.imageUrl)}" alt="" loading="lazy">` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <span class="badge badge--gold">${esc(tr(meta.listingType) || 'Listing')}</span>
          <span class="badge">${esc(meta.dealType || '')}</span>
        </div>
        <h3 style="margin:0 0 4px">${esc(p.title)}</h3>
        ${meta.address ? `<div class="member-tile__meta">📍 ${esc(meta.address)}</div>` : ''}
        ${facts.length ? `<div class="listing-card__facts">${facts.map(esc).join(' · ')}</div>` : ''}
        <p class="mt-2">${esc(p.body || '')}</p>
        ${p.authorName ? `<div class="member-tile__meta mt-2">${tr('Listed by')} ${p.memberId ? `<a href="/members/profile.html?id=${esc(p.memberId)}">${esc(p.authorName)}</a>` : esc(p.authorName)}</div>` : ''}
        ${p.ctaUrl ? `<a class="btn btn--gold btn--sm mt-3" href="${esc(p.ctaUrl)}" target="_blank" rel="noopener">${esc(p.ctaLabel || tr('Details'))}</a>` : ''}
      </article>`;
  }
  async function initRealEstate() {
    const L = LANG === 'es';
    initFeaturedSlot('real-estate', '#reFeatured', { depth: 0 });
    const grid = document.getElementById('reList');
    const countEl = document.getElementById('reCount');
    let listings = [];
    try { listings = (await getJSON(ChamberAPI.url('/api/posts?type=listing'))).posts || []; } catch (e) {}
    // Realtor members directory strip
    try {
      const members = (await getJSON(ChamberAPI.url('/api/members'))).members || [];
      const realtors = members.filter((m) => /real estate|realtor|broker/i.test([m.category, ...(m.categories || [])].filter(Boolean).join(' ')))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const rgrid = document.getElementById('reAgents');
      if (rgrid && realtors.length) {
        rgrid.innerHTML = realtors.map((m) => memberTile(m, 0)).join('');
        const rc = document.getElementById('reAgentsCount');
        if (rc) rc.textContent = `${realtors.length} ${L ? 'profesionales miembros' : 'member professionals'}`;
      }
    } catch (e) {}
    let tab = 'all';
    const render = () => {
      const list = tab === 'all' ? listings : listings.filter((p) => (p.meta && p.meta.listingType) === tab);
      if (countEl) countEl.textContent = list.length ? `${list.length} ${list.length === 1 ? tr('active listing') : tr('active listings')}` : '';
      grid.innerHTML = list.length
        ? list.map(listingCard).join('')
        : (L ? `<div class="notice">Aún no hay anuncios. Los agentes miembros publican gratis desde el <a href="/member/post.html">portal de miembros</a> — y cualquier agente del West Valley puede <a href="/es/join.html">unirse a la Cámara</a> para anunciar aquí.</div>`
             : `<div class="notice">No ${tab === 'all' ? '' : tab.toLowerCase() + ' '}listings yet. Realtor members can post listings free from the <a href="/member/post.html">member portal</a> — and any West Valley realtor can <a href="/join.html">join the Chamber</a> to list here.</div>`);
    };
    document.querySelectorAll('[data-re-tab]').forEach((b) => b.addEventListener('click', () => {
      tab = b.getAttribute('data-re-tab');
      document.querySelectorAll('[data-re-tab]').forEach((x) => x.classList.toggle('chip--active', x === b));
      render();
    }));
    render();
  }

  return { initHome, initDirectory, initProfile, initEvents, initCheckout, initLeadForm, initJobs, initDeals, initCommunity, initNews, initBizBuzz, initBoard, initLeaders, initDining, offerCard, postCard, newsCard, memberTile, eventCard, eventPreviewCard, initLeaderBanner, initGroups, initGroupView, initGallery, initFeaturedSlot, joinCtaHtml, mountJoinCta, initGuides, initGuideView, initRealEstate, getJSON, esc };
})();
