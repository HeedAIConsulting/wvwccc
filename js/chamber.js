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
  // Signed-in reads/writes (member photo uploads). `credentials: include` is
  // explicit because RENDER_API_BASE can put the API on another origin, where
  // fetch's same-origin default would silently drop the session cookie.
  async function getAuthed(path) {
    const res = await fetch(path, { cache: 'no-cache', credentials: 'include' });
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res.json();
  }
  async function postJSON(path, body) {
    const res = await fetch(path, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${path} → ${res.status}`);
    return data;
  }
  /* Shrink a phone photo before upload. Straight off a camera these are 4-12MB
     and bounce off the /api/me/asset cap — the same trap that made Felicia's
     Canva flyers "not replace" in July. Longest edge 1800px, JPEG q0.85. */
  function downscaleImage(file, maxDim = 1800, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not an image.'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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
    'Type to filter…': 'Escriba para filtrar…', 'Filter the list': 'Filtrar la lista',
    'All': 'Todos', 'Clear ✕': 'Limpiar ✕', 'Clear filters': 'Limpiar filtros',
    'No members match those filters.': 'Ningún miembro coincide con esos filtros.',
    'Chamber members attend free — use RSVP. Guests:': 'Los miembros de la Cámara asisten gratis — use RSVP. Invitados:',
    'Play as a slideshow': 'Ver como presentación', 'Previous photo': 'Foto anterior', 'Next photo': 'Foto siguiente',
    'Pause': 'Pausar', 'Play': 'Reproducir', 'Speed': 'Velocidad', 'Mute music': 'Silenciar música',
    'Full screen': 'Pantalla completa', 'Close': 'Cerrar',
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
    // Accept watch, embed, live, shorts, /v/, and youtu.be short links.
    const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|live\/|shorts\/|v\/)|youtu\.be\/)([\w-]{6,})/i);
    const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
    const wrap = (inner) => `<div class="video-embed mt-5">${inner}</div>`;
    // referrerpolicy makes the player receive our origin. The site's
    // Referrer-Policy is `no-referrer`, and with no referrer YouTube refuses
    // embedded playback with "Error 153" even for videos that allow embedding
    // (Diana Rain / UrBrand Studio, Jul 2026). The attribute overrides the
    // document policy for just this request, so the strict default stands elsewhere.
    if (yt) return wrap(`<iframe src="https://www.youtube.com/embed/${yt[1]}" title="Member video" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen loading="lazy"></iframe>`);
    if (vm) return wrap(`<iframe src="https://player.vimeo.com/video/${vm[1]}" title="Member video" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay;fullscreen;picture-in-picture" allowfullscreen loading="lazy"></iframe>`);
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
  // `compact` drops Email/Text and the "Share" caption — used under each photo
  // in an album, where a six-button row per image swamps the photos themselves.
  function shareMenu(title, url, compact) {
    const t = encodeURIComponent(title || 'West Valley · Warner Center Chamber');
    const u = encodeURIComponent(url);
    const body = encodeURIComponent((title ? title + ' — ' : '') + url);
    return `<div class="share-row${compact ? ' share-row--compact' : ''}" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;align-items:center">
      ${compact ? '' : `<span class="member-tile__meta" style="font-size:.72rem;text-transform:uppercase;letter-spacing:.04em">${tr('Share')}</span>`}
      <a class="chip" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${u}" aria-label="Share on Facebook">Facebook</a>
      <a class="chip" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${t}&url=${u}" aria-label="Share on X">X</a>
      <a class="chip" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" aria-label="Share on LinkedIn">LinkedIn</a>
      ${compact ? '' : `<a class="chip" href="mailto:?subject=${t}&body=${body}" aria-label="Share by email">Email</a>
      <a class="chip" href="sms:?&body=${body}" aria-label="Share by text message">Text</a>`}
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

  // "Hosted by …" attribution — a group they chair (links to the group page)
  // or the member's business. Set when a leader posts an event and chooses
  // which identity they are posting as (per the office, Jul 15 2026).
  function hostLine(ev, base = '') {
    const name = ev.hostName || ev.groupName || ev.submittedByName || '';
    if (!name) return '';
    const slug = ev.hostSlug || (ev.hostKind === 'business' ? '' : ev.groupSlug) || '';
    const inner = slug
      ? `<a href="${base}groups/${esc(slug)}" style="color:inherit;text-decoration:underline">${esc(name)}</a>`
      : esc(name);
    // A community submission is labelled as such (Michael, Jul 29 2026): the
    // date is published as a service to the calendar, and the Chamber is not
    // implying it hosts or endorses someone else's event.
    const community = ev.hostKind === 'community'
      ? ` <span style="font-weight:400;opacity:.85" title="Submitted by a local organization that is not a Chamber member. Listed so members can see what else is happening that day.">· community event</span>`
      : '';
    return `<div style="color:var(--gold-deep,#8a6d1a)">🏷️ Hosted by ${inner}${community}</div>`;
  }

  // Sold Out notice (per Felicia, Jul 24 2026) — replaces the RSVP/Buy buttons
  // on an event flagged soldOut: still styled like a button so the card reads
  // the same, but not clickable.
  function soldOutBtn(small) {
    const label = /\/es\//.test(location.pathname) ? 'Agotado' : 'Sold out';
    return `<span class="btn${small ? ' btn--sm' : ''}" aria-disabled="true" style="pointer-events:none;cursor:default;background:var(--slate-mid,#5d6b63);border-color:transparent;color:#fff">${label}</span>`;
  }
  // Label for the paid action button. The office can override the wording per
  // event (Felicia, Jul 29 2026) because "Buy Tickets" is wrong when what's for
  // sale is an ad, a name badge or a sponsorship. Blank falls back to the
  // standard translated label.
  const buyLabel = (ev, fallback) => (ev && ev.ctaLabel ? ev.ctaLabel : tr(fallback));

  // ── Where the two event buttons land ───────────────────────────────────
  // Tickets and RSVP share ONE checkout screen; `tier` decides which row it
  // opens on. Felicia, Jul 30 2026: "when the guest goes directly [to] the
  // Purchase tickets [button] … it is literally just a place to RSVP." Both
  // buttons opened on the FIRST row, which on a mixer is the free member tier
  // — so a guest never saw the $15 option or a card field. Purchase now opens
  // the first PAID row, RSVP the first FREE one. Events with no priced rows
  // still fall back to the general contact form.
  const hasTiers = (ev) => Array.isArray(ev.ticketTypes)
    && ev.ticketTypes.some((t) => t.available !== false && t.name);
  const ticketHref = (ev, base, tier, grpQ = '') =>
    `${base}checkout.html?type=ticket&event=${esc(ev.id)}${tier ? '&tier=' + tier : ''}${grpQ}`;
  const rsvpHrefOf = (ev, base, grpQ = '') => (hasTiers(ev)
    ? ticketHref(ev, base, 'free', grpQ)
    : `${base}contact.html?event=${esc(ev.id)}${grpQ}`);

  // Full detail card for an event — used by the dedicated event page (and by
  // the legacy modal). Per the office, Jul 2026: events open on their OWN page
  // with room for sponsors, logos, and photo galleries.
  function eventDetailCard(ev, base, opts = {}) {
    const loc = [ev.venue, ev.address, ev.neighborhood].filter(Boolean).join(' · ');
    // Full flyer leads the modal (portrait-friendly); the image strip follows.
    // Hero: the portrait flyer leads; fall back to the first photo so the modal
    // always feels image-forward (logos/flyers/images — Felicia's request).
    // Flyers: main flyer plus any additional flyers (admin can attach several).
    const flyers = [ev.flyer].concat(Array.isArray(ev.flyers) ? ev.flyers : []).map(evImgOf).filter(Boolean);
    const hero = flyers[0] || ev.thumbnail || evImgOf(ev.images && ev.images[0]) || '';
    // The office picks what fills this slot (Felicia, Jul 29 2026). A flyer-less
    // event used to render the chamber logo at full 560px height, pushing the
    // date/venue/RSVP below the fold — `logoBar` is the compact alternative.
    const mode = ['auto', 'flyer', 'logo', 'both', 'none'].includes(ev.imageMode) ? ev.imageMode : 'auto';
    // Felicia, Jul 30 2026: "The photo at the top is looking strange." A
    // flyer-less event dropped one shrunken seal into an empty green box, which
    // reads as a broken image — and the same seal was already sitting next to
    // the title 40px above it. Make it a deliberate title card instead: the
    // mark at a legible size, the Chamber wordmark, and the date.
    const barWhen = (ev.confirmed && ev.day)
      ? `${ev.month || ''} ${ev.day}${ev.time ? ' · ' + ev.time : ''}`.trim() : '';
    const logoBar = `<div class="ev-card__logobar">
            <img src="${base}images/wvwccc-logo.png" alt="" onerror="this.style.display='none'">
            <div class="ev-card__logobar-txt">
              <span class="ev-card__logobar-name">West Valley · Warner Center<b>Chamber of Commerce</b></span>
              ${barWhen ? `<span class="ev-card__logobar-when">${esc(barWhen)}</span>` : ''}
            </div></div>`;
    const heroImg = hero
      ? `<img class="ev-card__flyer" src="${esc(evImgSrc(hero, base))}" alt="${esc(ev.title)} flyer" onerror="this.onerror=null;this.src='${base}images/wvwccc-logo.png';this.classList.add('ev-card__flyer--ph')">`
      : '';
    let flyerImg;
    if (mode === 'none') flyerImg = '';
    else if (mode === 'logo') flyerImg = logoBar;
    else if (mode === 'both') flyerImg = logoBar + heroImg;
    else if (mode === 'flyer') flyerImg = heroImg;                 // nothing when no flyer
    else flyerImg = heroImg || logoBar;                            // auto
    const moreFlyers = mode === 'none' || mode === 'logo' ? '' : flyers.slice(1).map((u) => `<img class="ev-card__flyer" src="${esc(evImgSrc(u, base))}" alt="${esc(ev.title)} flyer" loading="lazy">`).join('');
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
    // Featured links (type 'featured') get a prominent banner right under the
    // event meta — e.g. the Gala program (per Michael, Jul 24) — instead of
    // being buried below the flyer and description with the other buttons.
    const featured = (ev.links || []).filter((l) => l.type === 'featured');
    const featuredRow = featured.length
      ? `<div class="ev-card__featured" style="margin:4px 0 16px;display:grid;gap:10px">${featured.map((l) =>
          `<a href="${esc(l.url)}" target="_blank" rel="noopener" style="display:block;text-align:center;padding:15px 20px;border-radius:12px;background:linear-gradient(135deg,var(--green-ink,#12241a),var(--green,#1b3326));color:#f3e8c8;font-weight:700;font-size:1.08rem;letter-spacing:.01em;text-decoration:none;border:1.5px solid var(--gold,#C9A227);box-shadow:0 4px 16px rgba(18,36,26,.28)">${esc(l.label || 'View')} →</a>`).join('')}</div>`
      : '';
    const plainLinks = (ev.links || []).filter((l) => l.type !== 'featured');
    const links = plainLinks.length
      ? `<div class="ev-card__row">${plainLinks.map((l) => `<a class="btn btn--gold btn--sm" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.label || l.type || 'Details')}</a>`).join('')}</div>` : '';
    // Attached PDFs (donation form, sponsorship levels, …).
    const docs = (ev.documents && ev.documents.length)
      ? `<div class="ev-card__row">${ev.documents.map((dme) => `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(evImgSrc(dme.url, base))}">📄 ${esc(dme.label || 'Document')}</a>`).join('')}</div>` : '';
    const grpQ = _groupCtx ? `&group=${encodeURIComponent(_groupCtx.slug)}` : '';
    // ticketed → Buy; ticketed + alsoRsvp → BOTH buttons (e.g. members RSVP
    // free, guests buy); soldOut → a non-clickable Sold Out notice; else RSVP.
    // RSVP destination (Felicia + Diana, Jul 29 2026): when the event has
    // registration tiers set up, RSVP goes to the same screen tickets use — it
    // names the event, shows the tier ("Member — free with pre-registration")
    // and collects attendee details. Only tier-less events fall back to the
    // general contact form.
    // grpQ rides along either way, so a group's RSVP still notifies that
    // group's leaders (not just the office).
    const rsvpBtn = `<a class="btn btn--forest" href="${rsvpHrefOf(ev, base, grpQ)}">RSVP</a>`;
    const buyBtn = `<a class="btn btn--gold" href="${ticketHref(ev, base, 'paid', grpQ)}">${esc(buyLabel(ev, 'Get tickets'))}</a>`;
    // hideCta = the office picked "None" — this event takes neither an RSVP
    // nor a payment, so it shows no button anywhere (Felicia, Jul 30 2026).
    const cta = ev.hideCta ? ''
      : (ev.soldOut ? soldOutBtn() : (ev.ticketed ? (ev.alsoRsvp ? rsvpBtn + ' ' + buyBtn : buyBtn) : rsvpBtn.replace('>RSVP<', '>RSVP / Notify me<')));
    // A member paid $15 for a free-to-members mixer (Felicia + Diana, Aug 3
    // 2026): with just "RSVP" and a gold "Purchase" side by side, nothing on
    // THIS page says which button is whose — the first hint was a note at
    // checkout, after the wrong click. When the tiers split free-member /
    // paid-guest, say so right under the buttons.
    const tkLive = (t) => t.available !== false && !t.soldOut;
    const freeMemberTier = ev.ticketed && ev.alsoRsvp && Array.isArray(ev.ticketTypes)
      && ev.ticketTypes.some((t) => tkLive(t) && String(t.group || '').toLowerCase() === 'member' && !(Number(t.price) > 0));
    const paidGuestTier = freeMemberTier
      && ev.ticketTypes.find((t) => tkLive(t) && String(t.group || '').toLowerCase() === 'guest' && Number(t.price) > 0);
    const ctaHint = (!ev.hideCta && !ev.soldOut && paidGuestTier)
      ? `<p class="member-tile__meta" style="margin:6px 0 0;text-align:right">${tr('Chamber members attend free — use RSVP. Guests:')} $${Number(paidGuestTier.price).toFixed(2)}.</p>`
      : '';
    const desc = ev.description || ev.summary || '';
    // Rich description (admin editor) renders as sanitized HTML; plain text is
    // escaped + auto-linked so pasted URLs and "click here" links actually work.
    const descHtml = ev.descriptionHtml ? ev.descriptionHtml : (desc ? linkify(desc) : '');
    const mapU = evMapUrl(ev);
    const shareUrl = location.origin + '/events/view.html?id=' + encodeURIComponent(ev.id);
    return `
      <div class="ev-card"${opts.dialog ? ' role="dialog" aria-modal="true"' : ''} style="${opts.dialog ? '' : 'max-width:860px;margin:0 auto'}">
        <div class="ev-card__accent"></div>
        ${opts.dialog ? '<button aria-label="Close" data-ev-close class="ev-card__x">×</button>' : ''}
        <div class="ev-card__body">
          <div class="ev-card__head">
            <img class="ev-card__seal" src="/images/wvwccc-logo.png" alt="" onerror="this.style.display='none'">
            <div>
              <span class="ev-card__kicker">${esc(ev.category || 'Chamber Event')}</span>
              <h1 class="ev-card__title">${esc(ev.title)}</h1>
            </div>
          </div>
          <div class="ev-card__meta">
            <div class="ev-card__when">📅 ${esc(fullDate(ev))}</div>
            ${loc ? `<div>📍 ${mapU ? `<a href="${esc(mapU)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline" title="Open in Google Maps for directions">${esc(loc)}</a> <span style="font-size:.78rem;color:var(--gold-deep)">(map ↗)</span>` : esc(loc)}</div>` : ''}
            ${hostLine(ev, base)}
          </div>
          ${featuredRow}
          ${imgs}
          ${descHtml ? `<div class="ev-card__desc${ev.descriptionHtml ? ' rt-typo' : ''}"${ev.descriptionHtml ? ' style="white-space:normal"' : ''}>${descHtml}</div>` : ''}
          ${sponsorRow}
          ${links}
          ${docs}
          <div id="evAlbums"></div>
          <div class="ev-card__foot">
            ${ev.confirmed ? calendarMenu(ev) : ''}
            ${shareMenu(ev.title, shareUrl)}
            <div class="ev-card__cta">${cta}${ctaHint}</div>
          </div>
        </div>
      </div>`;
  }
  // Legacy inline modal — kept for compatibility; the site now navigates to
  // the full event page instead.
  function openEventModal(ev) {
    if (!ev) return;
    const base = /\/(events|members|member|community|admin|auth|es|groups|guides|jobs)\//.test(location.pathname) ? '../' : '';
    const overlay = document.createElement('div');
    overlay.className = 'ev-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(14,42,22,.62);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;z-index:9999;overflow-y:auto';
    overlay.innerHTML = eventDetailCard(ev, base, { dialog: true });
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-ev-close]')) close(); });
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });
    document.body.appendChild(overlay);
  }
  // Dedicated event page (events/view.html?id=…) — per the office, Jul 2026:
  // "We want the events to open in full page when we click on them. We need
  // to display the sponsors/logos/many images."
  async function initEventView() {
    const el = document.getElementById('eventView'); if (!el) return;
    const id = new URLSearchParams(location.search).get('id') || decodeURIComponent((location.hash || '').replace(/^#/, ''));
    let ev = null;
    if (id) {
      try { ev = await getJSON(ChamberAPI.url('/api/events/' + encodeURIComponent(id))); } catch (e) { /* not found */ }
    }
    if (!ev || !ev.id) {
      el.innerHTML = '<p class="notice" style="max-width:640px;margin:0 auto">This event could not be found — it may have been removed or unpublished. <a href="index.html">See all upcoming events →</a></p>';
      return;
    }
    _eventReg[ev.id] = ev;
    document.title = `${ev.title} — West Valley · Warner Center Chamber of Commerce`;
    el.innerHTML = eventDetailCard(ev, '../');
    // Photos from this event (Diana, Jul 30 2026). Loaded after the card so a
    // slow album fetch never delays the event details themselves.
    const mount = document.getElementById('evAlbums');
    if (mount) mount.innerHTML = await albumSection('event=' + encodeURIComponent(ev.id), 'Photos from this event');
  }
  if (typeof document !== 'undefined' && !window.__wvEventBound) {
    window.__wvEventBound = true;
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-ev-detail]');
      if (!t) return;
      if (e.target.closest('a,button')) return; // let real buttons/links work
      e.preventDefault();
      // Events open on their own full page (per the office, Jul 2026 — room
      // for sponsors, logos, and galleries; no more popup).
      const base = /\/(events|members|member|community|admin|auth|es|groups|guides|jobs)\//.test(location.pathname) ? '../' : '';
      const href = base + 'events/view.html?id=' + encodeURIComponent(t.getAttribute('data-ev-detail'));
      if (t.getAttribute('data-ev-newtab')) window.open(href, '_blank', 'noopener');
      else location.href = href;
    });
  }

  function eventCard(ev, depth = 0, opts = {}) {
    _eventReg[ev.id] = ev;
    const base = depth ? '../' : '';
    // On the All-Events list we open the detail in a NEW TAB (deep link to the
    // same events page, which auto-opens the event from the hash). Same-folder
    // link works for both the English and Spanish events pages.
    const newTab = opts.newTab ? ' data-ev-newtab="1"' : '';
    const confirmed = ev.confirmed && ev.day;
    const dateBlock = confirmed
      ? `<div class="event-date"><div class="event-date__mo">${esc(ev.month)}</div><div class="event-date__day">${esc(ev.day)}</div></div>`
      : `<div class="event-date"><div class="event-date__mo">${esc(ev.month || 'TBA')}</div><div class="event-date__day" style="font-size:1rem;padding-top:6px">·</div></div>`;
    const when = confirmed ? `${esc(ev.month)} ${esc(ev.day)} · ${esc(ev.time || '')}` : 'Date to be announced';
    const cta = ev.hideCta ? '' : ev.soldOut ? soldOutBtn(true) : ev.ticketed
      ? (confirmed
          ? `${ev.alsoRsvp ? `<a class="btn btn--ghost btn--sm" href="${rsvpHrefOf(ev, base)}">RSVP</a> ` : ''}<a class="btn btn--gold btn--sm" href="${ticketHref(ev, base, 'paid')}">${esc(buyLabel(ev, 'Get tickets'))}</a>`
          : `<a class="btn btn--ghost btn--sm" href="${base}contact.html?event=${esc(ev.id)}">Notify me</a>`)
      : `<a class="btn btn--ghost btn--sm" href="${rsvpHrefOf(ev, base)}">RSVP</a>`;
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
          ${shareMenu(ev.title, location.origin + '/events/view.html?id=' + encodeURIComponent(ev.id))}
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
    const cta = ev.hideCta ? '' : ev.soldOut ? soldOutBtn(true) : ev.ticketed
      ? `${ev.alsoRsvp ? `<a class="btn btn--ghost btn--sm" href="${rsvpHrefOf(ev, base)}">RSVP</a> ` : ''}<a class="btn btn--gold btn--sm" href="${ticketHref(ev, base, 'paid')}">${esc(buyLabel(ev, 'Tickets'))}</a>`
      : `<a class="btn btn--ghost btn--sm" href="${rsvpHrefOf(ev, base)}">RSVP</a>`;
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
    const cta = ev.hideCta ? '' : ev.soldOut ? soldOutBtn(true) : ev.ticketed
      ? `${ev.alsoRsvp ? `<a class="btn btn--forest btn--sm" href="${rsvpHrefOf(ev, base)}">RSVP</a> ` : ''}<a class="btn btn--gold btn--sm" href="${ticketHref(ev, base, 'paid')}">${esc(buyLabel(ev, 'Buy tickets'))}</a>`
      : `<a class="btn btn--forest btn--sm" href="${rsvpHrefOf(ev, base)}">RSVP</a>`;
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
    // Member/manager photo albums for this group (Diana, Jul 30 2026) — the
    // whole reason albums carry a groupSlug: a group page that shows what the
    // group actually did is what gets members posting.
    const albMount = document.getElementById('gAlbums');
    if (albMount) albMount.innerHTML = await albumSection('group=' + encodeURIComponent(g.slug), 'Photo albums');
    // upcoming events that match this group
    if (g.eventMatch) {
      try {
        const evs = (await getJSON(ChamberAPI.url('/api/events'))).events || [];
        const today = new Date().toISOString().slice(0, 10);
        // A leader posting "as this group" tags the event with groupSlug — the
        // most reliable match. Otherwise fall back to the group's name appearing
        // in the title or category (auto-generated meetings, old-site style).
        const mm = (g.eventMatch || '').toLowerCase();
        const mine = evs.filter((e) => e.confirmed && e.date >= today &&
          (e.groupSlug === g.slug || (mm && ((e.title || '').toLowerCase().includes(mm) || (e.category || '').toLowerCase().includes(mm)))))
          .sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))) // soonest first, so a posted one-off isn't buried by recurring meetings
          .slice(0, 4);
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

  /* ── Photo albums (Diana, Jul 30 2026) ────────────────────────────────
     Albums hang off an event, a group, or nothing at all (the Gala). Every
     photo carries its own share row, because "all the images should be
     shareable to social" — sharing one good shot from a mixer is what pulls
     people back to the site, not sharing the gallery index. */
  const albumUrl = (a) => `${location.origin}/albums/${encodeURIComponent(a.id)}`;
  function albumCard(a) {
    const cover = a.cover
      ? `<img src="${esc(a.cover)}" alt="" loading="lazy">`
      : `<div class="alb-card__ph"><img src="/images/wvwccc-logo.png" alt=""></div>`;
    const n = a.count || 0;
    return `<a class="alb-card" href="/albums/${encodeURIComponent(a.id)}">
      <div class="alb-card__img">${cover}<span class="alb-card__count">${n} photo${n === 1 ? '' : 's'}</span></div>
      <div class="alb-card__body">
        <h3>${esc(a.title)}</h3>
        ${a.body ? `<p>${esc(a.body)}</p>` : ''}
      </div></a>`;
  }
  // One photo, with its own share row. shareMenu already handles Facebook / X /
  // LinkedIn / email / text / copy, so a photo shares exactly like an event.
  function photoFigure(p, i, album) {
    const link = albumUrl(album) + '#p' + i;
    const cap = p.caption || album.title;
    // The tile shows the thumbnail; the full-size photo is what the lightbox
    // and "Open full size" use. Photos uploaded before thumbnails existed carry
    // no `thumb` and fall back to the full image, exactly as before.
    return `<figure class="gallery-card" id="p${i}">
      <a href="${esc(p.url)}" data-albumbox="${i}"><img src="${esc(p.thumb || p.url)}" alt="${esc(cap)}" loading="lazy" decoding="async"></a>
      ${p.caption || p.by ? `<figcaption>${esc(p.caption || '')}${p.by ? `<span class="alb-by">📷 ${esc(p.by)}</span>` : ''}</figcaption>` : ''}
      ${shareMenu(cap, link, true)}
    </figure>`;
  }
  async function initGallery() {
    const grid = document.getElementById('galleryGrid');
    if (!grid) return;
    let albums = [];
    try { albums = (await getJSON(ChamberAPI.url('/api/albums'))).albums || []; } catch (e) {}
    // Legacy loose gallery posts (pre-album) still show, as one "Chamber photos"
    // album, so nothing that was already published disappears.
    let loose = [];
    try { loose = ((await getJSON(ChamberAPI.url('/api/posts?type=gallery'))).posts || []).filter((p) => p.imageUrl); } catch (e) {}
    if (!albums.length && !loose.length) {
      grid.className = '';
      grid.innerHTML = `<p class="notice"><strong>No photo albums yet.</strong> Albums are how the Chamber shares
        ribbon cuttings, mixers, and group activity. The office creates one in Admin → Photo Albums, and members
        can add their own shots from the member portal.</p>`;
      return;
    }
    grid.className = 'alb-grid';
    grid.innerHTML = albums.map(albumCard).join('')
      + (loose.length ? albumCard({ id: '_loose', title: 'Chamber photos', cover: loose[0].imageUrl, count: loose.length, body: '' }).replace(`href="/albums/_loose"`, 'href="/gallery.html?all=1"') : '');
    // ?all=1 → the old flat wall of every loose photo.
    if (new URLSearchParams(location.search).get('all')) {
      grid.className = 'gallery-grid gallery-grid--lg';
      const album = { id: '_loose', title: 'Chamber photos' };
      grid.innerHTML = loose.map((p, i) => photoFigure({ url: p.imageUrl, caption: p.title || '' }, i, album)).join('');
      bindLightbox(grid, loose.map((p) => ({ url: p.imageUrl, caption: p.title || '' })));
    }
  }
  async function initAlbumView() {
    const grid = document.getElementById('albumGrid');
    const head = document.getElementById('albumHead');
    if (!grid) return;
    const id = (location.pathname.match(/\/albums\/([^/?#]+)/) || [])[1]
      || new URLSearchParams(location.search).get('album') || '';
    let album = null;
    try { album = (await getJSON(ChamberAPI.url('/api/albums/' + encodeURIComponent(id)))).album; } catch (e) {}
    if (!album) {
      head.innerHTML = '<h1>Album not found</h1>';
      grid.innerHTML = '<p class="notice">This album may have been removed. <a href="/gallery.html">See all albums →</a></p>';
      return;
    }
    document.title = `${album.title} — West Valley · Warner Center Chamber of Commerce`;
    head.innerHTML = `<span class="kicker">Photo album</span>
      <h1>${esc(album.title)}</h1>
      ${album.body ? `<p class="lead" style="max-width:62ch">${esc(album.body)}</p>` : ''}
      <p class="member-tile__meta">${album.count} photo${album.count === 1 ? '' : 's'}</p>
      <div class="btn-row mt-3">
        ${album.photos.length ? `<button type="button" class="btn btn--gold" id="albPlay">▶ ${tr('Play as a slideshow')}</button>` : ''}
        ${shareMenu(album.title, albumUrl(album))}
      </div>`;
    grid.innerHTML = album.photos.length
      ? album.photos.map((p, i) => photoFigure(p, i, album)).join('')
      : '<p class="notice">No photos in this album yet.</p>';
    bindLightbox(grid, album.photos);
    document.getElementById('albPlay')?.addEventListener('click', () => playSlideshow(album, 0));
    mountAlbumUpload(album);
    if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView({ block: 'center' }); }
  }
  /* "Play as a slideshow" — the album as a video without rendering one.
     A 683-photo album is nobody's idea of a scroll, and an encoded MP4 would
     be a huge file the office would have to re-make every time they add a
     photo. This plays the same photos full-screen with crossfades and an
     optional soundtrack, so it is always in step with the album.
     Deliberate choices: full-size images (this is the "look at the photos"
     mode, not the grid), only the next couple preloaded so a phone on data
     never pulls the whole album, and the whole thing honours
     prefers-reduced-motion by cutting instead of drifting. */
  function playSlideshow(album, startAt) {
    const photos = album.photos || [];
    if (!photos.length) return;
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let i = Math.max(0, Math.min(startAt || 0, photos.length - 1));
    let playing = true;
    let secs = 5;
    let timer = null;

    const ov = document.createElement('div');
    ov.className = 'wv-show';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', album.title + ' — slideshow');
    ov.innerHTML = `
      <div class="wv-show__stage">
        <img class="wv-show__img" alt="">
        <img class="wv-show__img wv-show__img--next" alt="" aria-hidden="true">
      </div>
      <div class="wv-show__bar" aria-hidden="true"><span class="wv-show__fill"></span></div>
      <div class="wv-show__cap"></div>
      <div class="wv-show__ui">
        <button type="button" data-sh="prev" aria-label="${tr('Previous photo')}">‹</button>
        <button type="button" data-sh="play" aria-label="${tr('Pause')}">❚❚</button>
        <button type="button" data-sh="next" aria-label="${tr('Next photo')}">›</button>
        <span class="wv-show__n" aria-live="polite"></span>
        <label class="wv-show__spd">${tr('Speed')}
          <select data-sh="speed">
            <option value="3">3s</option><option value="5" selected>5s</option>
            <option value="8">8s</option><option value="12">12s</option>
          </select></label>
        ${album.music ? `<button type="button" data-sh="mute" aria-label="${tr('Mute music')}">🔊</button>` : ''}
        <button type="button" data-sh="full" aria-label="${tr('Full screen')}">⛶</button>
        <button type="button" data-sh="x" aria-label="${tr('Close')}">✕ ${tr('Close')}</button>
      </div>`;

    const imgA = ov.querySelector('.wv-show__img:not(.wv-show__img--next)');
    const imgB = ov.querySelector('.wv-show__img--next');
    const fill = ov.querySelector('.wv-show__fill');
    const capEl = ov.querySelector('.wv-show__cap');
    const nEl = ov.querySelector('.wv-show__n');
    const playBtn = ov.querySelector('[data-sh="play"]');
    let front = imgA, back = imgB;

    // The click that opened this counts as the gesture browsers require, so
    // audio is allowed to start. It still may fail on some phones — never let
    // that stop the pictures.
    let audio = null;
    if (album.music) {
      audio = new Audio(album.music);
      audio.loop = true;
      audio.volume = 0.55;
      audio.play().catch(() => {});
    }

    const preload = (n) => {
      for (let k = 1; k <= 2; k++) {
        const p = photos[(n + k) % photos.length];
        if (p) { const im = new Image(); im.src = p.url; }
      }
    };

    function show(n, instant) {
      i = (n + photos.length) % photos.length;
      const p = photos[i];
      back.src = p.url;
      const swap = () => {
        back.classList.add('is-on');
        front.classList.remove('is-on');
        const t = front; front = back; back = t;
        capEl.textContent = p.caption || '';
        capEl.style.display = p.caption ? '' : 'none';
        nEl.textContent = (i + 1) + ' / ' + photos.length;
        preload(i);
      };
      if (instant || calm || back.complete) swap();
      else back.onload = swap;
      restart();
    }

    function restart() {
      clearTimeout(timer);
      fill.style.transition = 'none';
      fill.style.width = '0%';
      if (!playing) return;
      // Next frame, so the reset above actually paints before the run starts.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        fill.style.transition = `width ${secs}s linear`;
        fill.style.width = '100%';
      }));
      timer = setTimeout(() => show(i + 1), secs * 1000);
    }

    const setPlaying = (on) => {
      playing = on;
      playBtn.textContent = on ? '❚❚' : '▶';
      playBtn.setAttribute('aria-label', on ? tr('Pause') : tr('Play'));
      if (audio) { if (on) audio.play().catch(() => {}); else audio.pause(); }
      if (on) restart(); else { clearTimeout(timer); fill.style.transition = 'none'; }
    };

    const close = () => {
      clearTimeout(timer);
      if (audio) { audio.pause(); audio.src = ''; }
      document.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      ov.remove();
      document.body.style.overflow = '';
    };

    function onKey(e) {
      if (e.key === 'Escape') return close();
      if (e.key === 'ArrowRight') { setPlaying(false); show(i + 1, true); }
      if (e.key === 'ArrowLeft') { setPlaying(false); show(i - 1, true); }
      if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
      if (e.key.toLowerCase() === 'm' && audio) { audio.muted = !audio.muted; ov.querySelector('[data-sh="mute"]').textContent = audio.muted ? '🔇' : '🔊'; }
    }

    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sh]');
      if (!b) return;
      const a = b.dataset.sh;
      if (a === 'x') return close();
      if (a === 'prev') { setPlaying(false); show(i - 1, true); }
      if (a === 'next') { setPlaying(false); show(i + 1, true); }
      if (a === 'play') setPlaying(!playing);
      if (a === 'mute' && audio) { audio.muted = !audio.muted; b.textContent = audio.muted ? '🔇' : '🔊'; }
      if (a === 'full') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else ov.requestFullscreen?.().catch(() => {});
      }
    });
    ov.querySelector('[data-sh="speed"]').addEventListener('change', (e) => {
      secs = Number(e.target.value) || 5; restart();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    show(i, true);
    setPlaying(true);
    if (album.musicCredit) {
      const c = document.createElement('p');
      c.className = 'wv-show__credit';
      c.textContent = '♫ ' + album.musicCredit;
      ov.appendChild(c);
    }
  }

  // Shared lightbox for album grids.
  function bindLightbox(grid, photos) {
    grid.addEventListener('click', (e) => {
      const a = e.target.closest('[data-albumbox]'); if (!a) return;
      e.preventDefault();
      let i = +a.dataset.albumbox;
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(14,42,22,.94);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px';
      const draw = () => {
        const p = photos[i];
        ov.innerHTML = `<img src="${esc(p.url)}" alt="" style="max-width:92vw;max-height:78vh;border-radius:12px;box-shadow:0 30px 80px rgba(0,0,0,.5)">
          <p style="color:rgba(255,255,255,.88);margin-top:14px;text-align:center;max-width:70ch">${esc(p.caption || '')}${p.by ? ` <span style="opacity:.7">📷 ${esc(p.by)}</span>` : ''}</p>
          <p style="color:rgba(255,255,255,.6);margin-top:4px;font-size:.85rem">${i + 1} of ${photos.length} · ← → to browse · Esc to close</p>
          <div style="margin-top:10px;display:flex;gap:8px">
            <button type="button" data-prev class="btn btn--ghost-light btn--sm">← Previous</button>
            <a class="btn btn--gold btn--sm" href="${esc(p.url)}" target="_blank" rel="noopener">Open full size ↗</a>
            <button type="button" data-next class="btn btn--ghost-light btn--sm">Next →</button>
          </div>`;
      };
      const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
      const step = (d) => { i = (i + d + photos.length) % photos.length; draw(); };
      const onKey = (ev) => {
        if (ev.key === 'Escape') close();
        if (ev.key === 'ArrowRight') step(1);
        if (ev.key === 'ArrowLeft') step(-1);
      };
      ov.addEventListener('click', (ev) => {
        if (ev.target.closest('[data-prev]')) return step(-1);
        if (ev.target.closest('[data-next]')) return step(1);
        if (ev.target === ov) close();
      });
      document.addEventListener('keydown', onKey);
      draw();
      document.body.appendChild(ov);
    });
  }
  /* Signed-in members add their own shots right on the album — the point of the
     feature (Diana: "so that the members and group managers are encouraged to
     share activity"). Photos go live immediately, so the confirmation says so. */
  async function mountAlbumUpload(album) {
    const wrap = document.getElementById('albumAdd');
    if (!wrap) return;
    let me = null;
    try { me = await getAuthed(ChamberAPI.url('/api/me/albums')); } catch (e) { /* signed out */ }
    if (!me || !me.canAdd) {
      wrap.innerHTML = `<p class="notice mt-5">Chamber members can add their own photos to this album.
        <a href="/auth/login.html">Sign in</a> to add yours.</p>`;
      return;
    }
    if (album.locked && !(me.myGroups || []).includes(String(album.groupSlug || '').toLowerCase())) {
      wrap.innerHTML = '<p class="notice mt-5">This album is closed to new photos.</p>';
      return;
    }
    wrap.innerHTML = `<div class="card mt-6" style="border-left:4px solid var(--gold)">
      <h3>Add your photos</h3>
      <p class="member-tile__meta">Were you there? Add your shots — they appear on this page right away.</p>
      <label class="btn btn--gold mt-3" style="cursor:pointer">＋ Choose photos<input type="file" accept="image/*" multiple hidden id="albUp"></label>
      <div id="albQueue" class="mt-3"></div>
      <p id="albMsg" class="notice mt-3" hidden></p></div>`;
    const msg = document.getElementById('albMsg');
    const say = (t, bad) => { msg.hidden = !t; msg.textContent = t || ''; msg.style.color = bad ? 'var(--red,#b00020)' : ''; };
    document.getElementById('albUp').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []).slice(0, 20);
      e.target.value = '';
      if (!files.length) return;
      say(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`);
      const photos = [];
      for (const f of files) {
        try {
          // Full size for the lightbox + a 400px thumbnail for the grid, so a
          // member's additions stay as light to browse as the office's.
          const dataUrl = await downscaleImage(f, 1800, 0.85);
          const up = await postJSON(ChamberAPI.url('/api/me/asset'), { dataUrl });
          if (!up || !up.url) continue;
          let thumb = '';
          try {
            const tUp = await postJSON(ChamberAPI.url('/api/me/asset'), { dataUrl: await downscaleImage(f, 400, 0.82) });
            thumb = (tUp && tUp.url) || '';
          } catch (e) { /* no thumb just means the grid uses the full photo */ }
          photos.push({ url: up.url, thumb });
        } catch (err) { /* skip the one that failed, keep the rest */ }
      }
      if (!photos.length) return say('None of those uploaded — try smaller image files.', true);
      try {
        const r = await postJSON(ChamberAPI.url(`/api/me/albums/${encodeURIComponent(album.id)}/photos`), { photos });
        say(`Added ${r.added} photo${r.added === 1 ? '' : 's'} ✓ — they are live on this page now.`);
        setTimeout(() => location.reload(), 900);
      } catch (err) { say(err.message || 'Could not add the photos.', true); }
    });
  }
  // An album section for an event or a group page.
  async function albumSection(query, heading) {
    let albums = [];
    try { albums = (await getJSON(ChamberAPI.url('/api/albums?' + query))).albums || []; } catch (e) {}
    const withPhotos = albums.filter((a) => a.count > 0 || a.cover);
    if (!withPhotos.length) return '';
    return `<div class="alb-section">
      <h3>${esc(heading)}</h3>
      <div class="alb-grid alb-grid--sm">${withPhotos.map(albumCard).join('')}</div>
    </div>`;
  }

  /* ── "Pay the Chamber any amount" portal ───────────────────────────────
     Lives on pay.html (below the three shortcut cards) and on pay-now.html,
     which is nothing but this — Felicia, Jul 30 2026: "a link that will take
     someone directly to a clean page ... with just the Pay the Chamber any
     amount on that page and nothing else above it." Same logic both places, so
     the two can never drift; each page supplies the markup IDs below. */
  async function initPayPortal() {
    const wrap = document.getElementById('payItems');
    const totalEl = document.getElementById('payTotal');
    const msg = document.getElementById('payMsg');
    if (!wrap) return;

    // What people actually pay the Chamber for, from the office's own list.
    // Picking from a menu beats typing a description and guessing an amount.
    let CATALOG = [];

    function row(desc, amt) {
      const div = document.createElement('div');
      div.className = 'pay-item';
      div.style.cssText = 'display:grid;grid-template-columns:1fr 130px 34px;gap:8px;align-items:start';
      div.innerHTML = `
        <div>
          <select class="pi-pick" style="width:100%;padding:10px 12px;border:1px solid var(--gold-soft);border-radius:8px;font:inherit;background:var(--paper)">
            <option value="">What is this for?…</option>
            ${CATALOG.map((c, i) => `<option value="${i}">${esc(c.label)}${c.amount != null ? ` — $${Number(c.amount).toFixed(2)}` : ''}</option>`).join('')}
            <option value="other">Something else — I'll type it in</option>
          </select>
          <input type="text" class="pi-desc" placeholder="What is this for? (e.g., Name badge)" value="${esc(desc || '')}" hidden
                 style="width:100%;margin-top:8px;padding:10px 12px;border:1px solid var(--gold-soft);border-radius:8px;font:inherit" />
          <p class="pi-note member-tile__meta" style="margin:4px 0 0"></p>
        </div>
        <input type="number" class="pi-amt" placeholder="0.00" min="0" step="0.01" inputmode="decimal" value="${esc(amt || '')}" style="padding:10px 12px;border:1px solid var(--gold-soft);border-radius:8px;font:inherit" />
        <button type="button" class="pi-x" aria-label="Remove item" style="background:none;border:1px solid var(--gold-soft);border-radius:8px;height:38px;cursor:pointer;color:var(--slate-mid)">×</button>`;
      const pick = div.querySelector('.pi-pick');
      const descEl = div.querySelector('.pi-desc');
      const amtEl = div.querySelector('.pi-amt');
      const noteEl = div.querySelector('.pi-note');
      pick.addEventListener('change', () => {
        msg.hidden = true;
        if (pick.value === 'other') {
          descEl.hidden = false; descEl.value = ''; noteEl.textContent = ''; descEl.focus();
        } else if (pick.value === '') {
          descEl.hidden = true; noteEl.textContent = '';
        } else {
          const c = CATALOG[Number(pick.value)];
          descEl.hidden = true; descEl.value = c.label;
          noteEl.textContent = c.note || '';
          // A catalog price fills the amount; a blank one means "the office
          // quoted you" — leave it for the payer to enter.
          if (c.amount != null) amtEl.value = Number(c.amount).toFixed(2);
          else { amtEl.value = ''; noteEl.textContent = (c.note ? c.note + ' — ' : '') + 'enter the amount the office gave you.'; }
        }
        total();
      });
      // A deep link (pay-now.html?for=…) arrives with a description already set.
      if (desc) {
        const hit = CATALOG.findIndex((c) => c.label.toLowerCase() === String(desc).toLowerCase());
        if (hit >= 0) { pick.value = String(hit); pick.dispatchEvent(new Event('change')); if (amt) amtEl.value = amt; }
        else { pick.value = 'other'; descEl.hidden = false; descEl.value = desc; }
      }
      div.querySelector('.pi-x').addEventListener('click', () => { div.remove(); if (!wrap.children.length) row(); total(); });
      amtEl.addEventListener('input', total);
      descEl.addEventListener('input', () => { msg.hidden = true; });
      wrap.appendChild(div);
      return div;
    }

    function items() {
      return Array.from(wrap.querySelectorAll('.pay-item')).map((d) => ({
        desc: d.querySelector('.pi-desc').value.trim(),
        amt: parseFloat(d.querySelector('.pi-amt').value) || 0,
      })).filter((i) => i.desc || i.amt > 0);
    }
    function total() {
      const t = items().reduce((s, i) => s + i.amt, 0);
      totalEl.textContent = '$' + t.toFixed(2);
      msg.hidden = true;
      return t;
    }

    document.getElementById('addItem').addEventListener('click', () => { row().querySelector('.pi-pick').focus(); });
    document.getElementById('payGo').addEventListener('click', () => {
      const list = items();
      const t = total();
      if (!t || t < 1) { msg.textContent = 'Please enter what you’re paying for and an amount of at least $1.'; msg.hidden = false; return; }
      if (list.some((i) => !i.desc)) { msg.textContent = 'Please describe each item so it appears on your receipt.'; msg.hidden = false; return; }
      const label = list.map((i) => `${i.desc} ($${i.amt.toFixed(2)})`).join(' + ');
      const base = location.pathname.replace(/[^/]*$/, '');
      location.href = `${base}checkout.html?type=payment&for=${encodeURIComponent(label)}&amount=${encodeURIComponent(t.toFixed(2))}`;
    });

    // Load the office's list first so the first row already has the menu, then
    // fall back to a plain text box if the API is unreachable.
    try {
      const d = await getJSON(ChamberAPI.url('/api/pay-items'));
      CATALOG = Array.isArray(d.items) ? d.items : [];
    } catch (e) { CATALOG = []; }
    const q = new URLSearchParams(location.search);
    row(q.get('for') || '', q.get('amount') || '');
    if (!CATALOG.length) {                      // no catalog → free text only
      const d0 = wrap.querySelector('.pay-item');
      if (d0) { d0.querySelector('.pi-pick').hidden = true; d0.querySelector('.pi-desc').hidden = false; }
    }
    total();
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
      // Admin picks WHICH events appear; on the page they always read top-to-
      // bottom by date (per the Chamber office, Jul 2026 — a dated list, not a
      // grid of squares).
      const events = (picked.length ? picked : pool).slice(0, 4)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const elist = document.getElementById('eventList');
      if (elist) elist.innerHTML = events.length
        ? events.map((e) => eventCard(e, 0)).join('')
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
      circle: params.get('g') || '',
    };
    let members = [];
    let circles = [];                 // [{ name, slug, ids:Set }]
    const circlesOf = new Map();      // member id -> Set of group names
    try {
      const dir = await getJSON(ChamberAPI.url('/api/members'));
      // Chamber staff appear on the Board & Leadership page, not in the
      // business directory (they're the office, not member businesses).
      members = (dir.members || []).filter((m) => m.leaderStatus !== 'Staff');
      if (dir._meta && dir._meta.source === 'seed') {
        document.getElementById('dataNotice').innerHTML =
          '<span class="badge badge--bronze">Preview roster</span>';
      }
    } catch (e) { console.error(e); }

    /* Groups & connection circles (Diana, Aug 18 2026). Rosters are kept on the
       group, not on the member, so the index is built here. Entries carry a
       memberId when the office picked the member out of the directory, and only
       a typed name/business when they did not — so fall back to matching those
       against the listing name and contact name. A circle with nobody matched is
       left out of the picker rather than offering a filter that finds nothing. */
    try {
      const gs = await getJSON(ChamberAPI.url('/api/groups'));
      const list = (gs && (gs.groups || gs)) || [];
      const norm = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const byId = new Map(members.map((m) => [String(m.id), m]));
      const byName = new Map();
      for (const m of members) {
        for (const k of [m.name, m.contactName]) { const n = norm(k); if (n && !byName.has(n)) byName.set(n, m); }
      }
      circles = list.map((g) => {
        const ids = new Set();
        for (const gm of (g.members || [])) {
          if (gm && gm.status === 'pending') continue;
          const hit = (gm && gm.memberId && byId.get(String(gm.memberId)))
            || byName.get(norm(gm && gm.business)) || byName.get(norm(gm && gm.name));
          if (hit) ids.add(hit.id);
        }
        for (const id of ids) {
          if (!circlesOf.has(id)) circlesOf.set(id, new Set());
          circlesOf.get(id).add(g.name);
        }
        return { name: g.name, slug: g.slug, ids };
      }).filter((c) => c.ids.size).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { /* the directory still works without the circle picker */ }

    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b));
    // The dropdown lists every real business category from the member records
    // (the full list that came over from the old site — Merchant Services,
    // CPA, Insurance Services, …), per the office, Aug 2026. The quick-pick
    // chips stay on the ~20 broad parent groups, so a facet value can be
    // either level — catMatch accepts both.
    const cats = uniq(members.flatMap((m) => [m.category, ...(Array.isArray(m.categories) ? m.categories : [])]));
    const hoods = uniq(members.map((m) => m.neighborhood));
    const catMatch = (m, v) => (m.group || 'Other') === v || m.category === v
      || (Array.isArray(m.categories) && m.categories.includes(v));

    // Collapsed green dropdown: a button that opens a list of choices (Chamber feedback).
    function closeAllDD() {
      document.querySelectorAll('.dd__menu').forEach((mn) => { mn.hidden = true; });
      document.querySelectorAll('.dd__btn[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
    function buildDropdown(elId, allLabel, options, key) {
      const el = document.getElementById(elId);
      if (!el) return;
      const cur = state[key];
      // Long lists (the full ~230-category dropdown) get a type-to-filter box
      // pinned to the top of the menu so nobody has to scroll the whole list.
      const filterable = options.length > 24;
      el.innerHTML = `
        <button type="button" class="dd__btn${cur ? ' is-set' : ''}" aria-expanded="false" aria-haspopup="listbox">
          <span>${esc(cur || allLabel)}</span><span class="dd__caret" aria-hidden="true">▾</span>
        </button>
        <div class="dd__menu" role="listbox" hidden>
          ${filterable ? `<div style="position:sticky;top:0;background:#fff;padding:8px;border-bottom:1px solid var(--line,#e2dcc9);z-index:1"><input type="search" class="dd__filter" placeholder="${esc(tr('Type to filter…'))}" aria-label="${esc(tr('Filter the list'))}" autocomplete="off" style="width:100%;padding:7px 10px;border:1px solid var(--line,#d8d2c0);border-radius:8px;font:inherit;font-size:.9rem" /></div>` : ''}
          <button type="button" class="dd__opt${!cur ? ' is-active' : ''}" data-val="" role="option">${esc(allLabel)}</button>
          ${options.map((o) => `<button type="button" class="dd__opt${cur === o ? ' is-active' : ''}" data-val="${esc(o)}" role="option">${esc(o)}</button>`).join('')}
        </div>`;
      const btn = el.querySelector('.dd__btn'); const menu = el.querySelector('.dd__menu');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const willOpen = menu.hidden; closeAllDD();
        menu.hidden = !willOpen; btn.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) { const f = menu.querySelector('.dd__filter'); if (f) { f.value = ''; f.dispatchEvent(new Event('input')); f.focus(); } }
      });
      const filter = menu.querySelector('.dd__filter');
      if (filter) {
        // Clicks/keys inside the filter box must not bubble to the document
        // click-away handler (it would close the menu mid-typing).
        filter.addEventListener('click', (e) => e.stopPropagation());
        filter.addEventListener('input', () => {
          const q = filter.value.trim().toLowerCase();
          menu.querySelectorAll('.dd__opt').forEach((o) => {
            o.hidden = !!q && !!o.dataset.val && !o.dataset.val.toLowerCase().includes(q);
          });
        });
      }
      menu.querySelectorAll('.dd__opt').forEach((o) => o.addEventListener('click', () => {
        state[key] = o.dataset.val; closeAllDD(); render();
      }));
    }
    function buildFacets() {
      buildDropdown('categoryDD', tr('All categories'), cats, 'category');
      buildDropdown('hoodDD', tr('All areas'), hoods, 'hood');
      const clr = document.getElementById('clearAll');
      if (clr) clr.hidden = !(state.category || state.hood || state.circle);
    }
    // Real radio inputs, because that is what was asked for and what the old
    // site had — one per group, plus "All members" to come back out of a circle.
    function buildCircles() {
      const wrap = document.getElementById('dirCircles');
      const el = document.getElementById('dirCircleOpts');
      if (!wrap || !el) return;
      if (!circles.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      const opt = (val, label, count) => `
        <label class="chip${state.circle === val ? ' active' : ''}" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
          <input type="radio" name="dirCircle" value="${esc(val)}"${state.circle === val ? ' checked' : ''} style="margin:0">
          <span>${esc(label)}${count != null ? ` (${count})` : ''}</span>
        </label>`;
      el.innerHTML = opt('', tr('All members'), null)
        + circles.map((c) => opt(c.name, c.name, c.ids.size)).join('');
      el.querySelectorAll('input[name="dirCircle"]').forEach((r) => r.addEventListener('change', () => {
        state.circle = r.value; render();
      }));
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
      if (state.category && !catMatch(m, state.category)) return -1;
      if (state.hood && m.neighborhood !== state.hood) return -1;
      if (state.circle && !(circlesOf.get(m.id) || new Set()).has(state.circle)) return -1;
      if (!state.q) return 0;
      // Curated fields decide whether a business is a result. The free-text
      // description only *boosts ranking* — it can't qualify a listing on its
      // own, so a plumber whose blurb happens to mention "restaurants" no longer
      // surfaces under a "restaurant" search (per the office, Jul 2026 —
      // "Reckon & Reckon Plumbing keeps showing on the restaurants page").
      const fields = [[m.name, 10], [m.category, 6], [(m.categories || []).join(' '), 6], [m.typeOfBusiness, 6], [(m.keywords || []).join(' '), 5], [m.group, 5],
        [m.neighborhood, 4], [m.city, 4], [m.contactName, 3], [m.tagline, 3],
        [(m.tags || []).join(' '), 2]];
      const boosters = [[m.description, 1]];
      const words = state.q.toLowerCase().replace(/&/g, ' ').split(/\s+/)
        .filter((w) => w && !STOP.has(w));
      if (!words.length) return 0;
      const scoreIn = (w, wb, list) => {
        let best = 0;
        for (const [val, wt] of list) {
          if (!val) continue;
          const lv = String(val).toLowerCase();
          if (wb.test(lv)) best = Math.max(best, wt * 2);
          else if (lv.includes(w)) best = Math.max(best, wt);
        }
        return best;
      };
      let total = 0;
      for (const w of words) {
        const wb = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        const best = scoreIn(w, wb, fields);
        if (best === 0) return -1;   // a query word hit no curated field → not a result
        total += best + scoreIn(w, wb, boosters);   // description only sweetens ranking
      }
      return total;
    }

    function render() {
      buildFacets();
      buildTopCats();
      buildCircles();
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
        (state.hood ? ` · ${state.hood}` : '') +
        (state.circle ? ` · ${state.circle}` : '');
      document.getElementById('emptyState').hidden = list.length > 0;
    }

    const form = document.getElementById('dirSearch');
    const input = document.getElementById('dirQuery');
    input.value = state.q;
    form.addEventListener('submit', (e) => { e.preventDefault(); state.q = input.value.trim(); render(); });
    input.addEventListener('input', () => { state.q = input.value.trim(); render(); });
    const reset = () => { state.q = ''; state.category = ''; state.hood = ''; state.circle = ''; input.value = ''; render(); };
    const clear = document.getElementById('clearFilters');
    if (clear) clear.addEventListener('click', reset);
    const clearAll = document.getElementById('clearAll');
    if (clearAll) clearAll.addEventListener('click', () => { state.category = ''; state.hood = ''; state.circle = ''; render(); });

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
      // Old shared links (#event-id) land on the event's full page now.
      if (ev) location.replace('view.html?id=' + encodeURIComponent(id));
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

    mountCommunityEventForm();
  }

  /* Community (non-member) event submission — verify the email, then submit.
     Felicia, Jul 29 2026: the chamber wants visibility of other organizations'
     dates; Michael's condition was that every listing is attributable. */
  function mountCommunityEventForm() {
    const form = document.getElementById('communityEventForm');
    if (!form) return;
    const step1 = document.getElementById('ceStep1');
    // Anchor to step 1: the captcha is checked by /api/public/event/verify, which
    // fires from the step-1 "Email me a code" button. The default placement (before
    // the submit button) would bury the widget inside the hidden #ceStep2, where it
    // never renders — the visitor could never get a token and step 1 would always
    // fail. Step 2 is gated by the emailed code instead, so it needs no captcha.
    mountTurnstile(form, step1);
    const step2 = document.getElementById('ceStep2');
    const m1 = document.getElementById('ceMsg');
    const m2 = document.getElementById('ceMsg2');
    const say = (el, t, bad) => {
      el.hidden = !t; el.textContent = t || '';
      el.style.borderColor = bad ? 'var(--red)' : 'var(--green)';
      el.style.color = bad ? 'var(--red)' : '';
    };
    const emailEl = form.querySelector('[name="email"]');

    const sendCode = async (btn, msgEl) => {
      const addr = (emailEl.value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return say(msgEl, 'Enter your email address first.', true);
      const was = btn.textContent; btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await fetch(ChamberAPI.url('/api/public/event/verify'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: addr, 'cf-turnstile-response': ChamberAPI.turnstileToken(form) }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) return say(msgEl, d.error || 'Could not send the code.', true);
        step2.hidden = false;
        say(msgEl, `Code sent to ${addr}. Enter it below to finish — it expires in 30 minutes.`);
        form.querySelector('[name="code"]').focus();
      } catch (e) { say(msgEl, 'Could not reach the Chamber right now. Please try again.', true); }
      // The token is single-use and now spent — clear it so "Send a new code"
      // (and any retry after an error) starts from a fresh challenge.
      finally { btn.disabled = false; btn.textContent = was; resetTurnstile(form); }
    };
    document.getElementById('ceSendCode')?.addEventListener('click', (e) => sendCode(e.target, m1));
    document.getElementById('ceResend')?.addEventListener('click', (e) => sendCode(e.target, m2));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      if (!String(fd.get('code') || '').trim()) return say(m2, 'Enter the 6-digit code from your email.', true);
      const btn = form.querySelector('[type="submit"]');
      const was = btn.textContent; btn.disabled = true; btn.textContent = 'Submitting…';
      try {
        const r = await fetch(ChamberAPI.url('/api/public/event'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: fd.get('email'), code: fd.get('code'),
            title: fd.get('title'), organization: fd.get('organization'),
            date: fd.get('date'), time: fd.get('time'),
            venue: fd.get('venue'), address: fd.get('address'),
            summary: fd.get('summary'), website: fd.get('website'),
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.ok === false) return say(m2, d.error || 'Could not submit the event.', true);
        form.reset(); step2.hidden = true; say(m1, '');
        say(m2, 'Thank you — your event is with Chamber staff for review and appears on the community calendar once approved.');
        m2.hidden = false;
      } catch (err) { say(m2, 'Could not reach the Chamber right now. Please try again, or call (818) 347-4737.', true); }
      finally { btn.disabled = false; btn.textContent = was; }
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
    // The Pay button always names the exact charge (per the office, Jul 2026 —
    // a "$1 test" on a ticket checkout charged the real $200 ticket price and
    // nothing on screen said so before the tap).
    const payBtnEl = document.getElementById('payBtn');
    // Free (RSVP) mode — a $0 tier means there is nothing to charge, so the card
    // section and amount box come off the screen and the button confirms an RSVP
    // on this same page (Felicia + Diana, Jul 29 2026: an RSVP should look like
    // the ticket screen, naming the event, not a generic "contact us" form).
    let freeMode = false;
    const setFreeMode = (on) => {
      freeMode = !!on;
      const cardBlock = document.getElementById('payCardBlock');
      const amountField = document.getElementById('amountField');
      const secureNote = document.getElementById('paySecureNote');
      const rsvpNote = document.getElementById('rsvpNote');
      if (cardBlock) cardBlock.hidden = freeMode;
      if (amountField) amountField.hidden = freeMode;
      if (secureNote) secureNote.hidden = freeMode;
      if (rsvpNote) rsvpNote.hidden = !freeMode;
      // A hidden required field would block submit with an un-focusable error,
      // and a free RSVP has no card to run AVS against — so billing goes too.
      if (amountInput) amountInput.required = !freeMode;
      const form0 = document.getElementById('payForm');
      // A free RSVP submits through /api/contact, which verifies Turnstile — so
      // this path needs a widget or it fails the captcha outright. Paid orders go
      // to /api/pay (card details are their own bot cost) and stay untouched.
      // mountTurnstile is idempotent, so repeated toggles add only one widget.
      if (freeMode && form0) mountTurnstile(form0, payBtnEl);
      const billing = document.getElementById('payBillingBlock');
      if (billing) billing.hidden = freeMode;
      ['address1', 'zip'].forEach((n) => {
        const el = form0 && form0.querySelector(`[name="${n}"]`);
        if (el) el.required = !freeMode;
      });
      syncPayBtn();
    };
    const syncPayBtn = () => {
      if (!payBtnEl) return;
      if (freeMode) { payBtnEl.textContent = 'Confirm my RSVP'; return; }
      const a = Number(amountInput && amountInput.value);
      payBtnEl.textContent = a > 0 ? `Pay $${a.toFixed(2)} securely` : 'Pay securely';
    };
    if (amountInput) amountInput.addEventListener('input', syncPayBtn);

    // Submit a free RSVP through the same inquiry pipeline the office already
    // watches (Inquiries + the RSVP view on the event), then show the same
    // confirmation panel a paid order gets.
    async function submitFreeRsvp() {
      const fd = new FormData(form);
      const attendees = Array.from(document.querySelectorAll('#tixNames [data-att-row]'))
        .map((r) => ({
          name: (r.querySelector('[data-attendee]')?.value || '').trim(),
          email: (r.querySelector('[data-att-email]')?.value || '').trim(),
          phone: (r.querySelector('[data-att-phone]')?.value || '').trim(),
        })).filter((a) => a.name || a.email || a.phone);
      const payload = {
        kind: 'rsvp',
        reason: 'RSVP',
        firstName: fd.get('firstName') || '', lastName: fd.get('lastName') || '',
        email: fd.get('email') || '', phone: fd.get('phone') || '', company: fd.get('company') || '',
        event: extra.eventTitle ? `${extra.eventTitle} [${params.get('event') || ''}]` : (params.get('event') || ''),
        // The same details as structured fields (Felicia, Aug 18 2026). The
        // office's notification is built from these, so it can read like the
        // old site's RSVP confirmation instead of a wall of text with the raw
        // event id in it. `message` stays as-is for Admin -> Inquiries.
        eventTitle: extra.eventTitle || '',
        ticketType: extra.ticketType || '',
        quantity: Number(extra.quantity) || 1,
        attendees,
        // Carried from a group page so the group's leaders get notified too.
        ...(params.get('group') ? { group: params.get('group') } : {}),
        message: [
          label,
          extra.ticketType ? `Registration type: ${extra.ticketType}` : '',
          extra.quantity ? `Attending: ${extra.quantity}` : '',
          attendees.length ? 'Attendees:\n' + attendees.map((a, i) => `  ${i + 1}. ${a.name} · ${a.email} · ${a.phone}`).join('\n') : '',
        ].filter(Boolean).join('\n'),
      };
      payload['cf-turnstile-response'] = ChamberAPI.turnstileToken(form);
      const r = await fetch(ChamberAPI.url('/api/contact'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      resetTurnstile(form); // single-use token — spent whether or not this succeeded
      if (!r.ok || data.ok === false) throw new Error(data.error || 'Could not record your RSVP.');
      form.hidden = true;
      const ok = document.getElementById('paySuccess');
      if (ok) {
        ok.hidden = false;
        const h = ok.querySelector('h3'); if (h) h.textContent = 'You’re on the list — thank you!';
        const p = ok.querySelector('p');
        if (p) p.innerHTML = `We’ve got your RSVP for <strong>${esc(extra.eventTitle || 'the event')}</strong>. `
          + 'A confirmation is on its way to your email. See you there!';
      }
      // A free RSVP is still a conversion — filling the room is the point of the
      // event page, so it should show up next to paid tickets in GA4.
      if (window.wvTrack) window.wvTrack('generate_lead', {
        currency: 'USD',
        value: 0,
        lead_type: 'event_rsvp',
        event_title: extra.eventTitle || '',
        ticket_type: extra.ticketType || '',
        quantity: Number(extra.quantity) || 1,
      });
    }

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
      // Secret link-key prices (e.g. board-member gala tickets) only appear
      // when the shared link carries ?key=<their key>.
      const linkKey = String(params.get('key') || '').trim().toLowerCase();
      // FREE tiers belong here too (Felicia, Jul 29 2026). The old filter
      // required a price above zero, so a "Member — Free with pre-registration"
      // row silently disappeared: an event whose only rows were a free member
      // tier and a guest tier with the price left blank fell through to the
      // "enter the amount shown" box, which is what she saw instead of $15.
      // Any named, available row now shows — free ones read "Free".
      const types = (ev && Array.isArray(ev.ticketTypes) ? ev.ticketTypes : [])
        .filter((t) => t.available !== false && t.name)
        .filter((t) => !t.linkKey || t.linkKey === linkKey);
      // Sold out (per the office, Jul 24 2026): the whole event is flagged, or
      // every listed price is individually sold out — close the checkout.
      if ((ev && ev.soldOut) || (types.length && types.every((t) => t.soldOut))) {
        title.textContent = 'Sold out';
        summary.innerHTML = `${evMeta}<p class="notice mt-3"><strong>This event is sold out</strong> — ticket sales are closed. Questions? Call the Chamber office at (818) 347-4737 or email <a href="mailto:felicia@woodlandhillscc.net">felicia@woodlandhillscc.net</a>.</p>`;
        const payForm = document.getElementById('payForm');
        ['payBtn', 'amountField', 'payError', 'sandboxNotice'].forEach((i2) => { const el2 = document.getElementById(i2); if (el2) el2.style.display = 'none'; });
        const left = payForm && payForm.querySelector('div'); if (left) left.style.display = 'none';
        return;
      }
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
          // Free tiers read "Free" — and when the name already spells out the
          // terms ("Member — free with pre-registration") the dropdown shows
          // exactly that wording, which is what Diana asked for.
          const p = priceOf(t);
          const priceTxt = t.soldOut ? 'SOLD OUT' : (p > 0 ? '$' + p.toFixed(2) : 'Free');
          const spellsItOut = p <= 0 && /free/i.test(t.name);
          bucket.items.push(`<option value="${i}"${t.soldOut ? ' disabled' : ''}>${esc(t.name)}${spellsItOut && !t.soldOut ? '' : ' — ' + priceTxt}</option>`);
        });
        if (groups.length === 1 && groups[0].g === '') return groups[0].items.join('');
        // The admin stores audience as 'member' / 'guest' — show it the way a
        // visitor reads it, not the raw value.
        const groupLabel = (g) => ({ member: 'Members', guest: 'Guests' }[String(g).toLowerCase()] || g);
        return groups.map((b) => b.g ? `<optgroup label="${esc(groupLabel(b.g))}">${b.items.join('')}</optgroup>` : b.items.join('')).join('');
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
          <div class="field" id="tixInvitedWrap" hidden style="margin-bottom:var(--s-2)"><label for="tixInvited">Invited by <span class="member-tile__meta">(which board member invited you?)</span></label>
            <input id="tixInvited" placeholder="Board member's name" /></div>
          <p class="notice" id="tixOther" hidden style="margin:0 0 var(--s-2)"></p>
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
        // Name + email + phone REQUIRED for every attendee (per the office,
        // Jul 14 2026 — the buyer often isn't attendee 1, and the office needs
        // to reach each guest). Values survive qty changes.
        const buildNames = (qty) => {
          const prev = Array.from(namesDiv.querySelectorAll('[data-att-row]')).map((r) => ({
            name: r.querySelector('[data-attendee]')?.value || '',
            email: r.querySelector('[data-att-email]')?.value || '',
            phone: r.querySelector('[data-att-phone]')?.value || '',
          }));
          namesDiv.innerHTML = Array.from({ length: qty }, (_, i) => `
            <div data-att-row style="margin-bottom:var(--s-2)">
              <div class="field" style="margin:0 0 6px"><label>Attendee ${i + 1} name *</label>
                <input data-attendee required value="${esc(prev[i]?.name || '')}" placeholder="${i === 0 ? 'Who is this ticket for?' : 'Guest name'}" /></div>
              <div class="grid grid-2" style="gap:var(--s-2)">
                <div class="field" style="margin:0"><label>Their email *</label>
                  <input data-att-email type="email" required value="${esc(prev[i]?.email || '')}" placeholder="guest@email.com" /></div>
                <div class="field" style="margin:0"><label>Their phone *</label>
                  <input data-att-phone type="tel" required value="${esc(prev[i]?.phone || '')}" placeholder="(818) 555-0100" /></div>
              </div>
            </div>`).join('');
        };
        const update = () => {
          buildQty();
          const t = types[Number(typeSel.value)] || types[0];
          const qty = Number(qtySel.value) || 1;
          buildNames(qty);
          // Link-key tickets (e.g. the board-member gala price) capture who
          // invited the buyer, so the office can see who sold what (Diana, Jul 14).
          const invWrap = document.getElementById('tixInvitedWrap');
          if (invWrap) invWrap.hidden = !t.linkKey;
          const unit = priceOf(t);
          const total = unit * qty;
          amountInput.value = total.toFixed(2);
          calc.textContent = unit > 0
            ? `${qty} × ${t.name} @ $${unit.toFixed(2)} = $${total.toFixed(2)}`
            : `${qty} × ${t.name} — no charge`;
          label = unit > 0
            ? `Tickets — ${ev.title} · ${qty} × ${t.name} @ $${unit.toFixed(2)}`
            : `RSVP — ${ev.title} · ${qty} × ${t.name}`;
          sku = `ticket:${id}:${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
          extra.eventTitle = ev.title; extra.ticketType = t.name; extra.quantity = qty;
          // A free tier is an RSVP, not a sale — hide the card fields entirely so
          // a member choosing "Member — free with pre-registration" completes on
          // this same screen (with the event named at the top) instead of being
          // sent to a generic "contact the chamber" form (Felicia + Diana, Jul 29).
          setFreeMode(total <= 0);
          // Mixers are mixed: members free, guests $15. Whichever row they are
          // on, point at the other kind by name, so nobody registers free by
          // accident or hunts for the paid option (Felicia, Jul 30 2026).
          const other = document.getElementById('tixOther');
          if (other) {
            const alt = unit > 0
              ? types.find((x) => !x.soldOut && priceOf(x) <= 0)
              : types.find((x) => !x.soldOut && priceOf(x) > 0);
            other.hidden = !alt;
            if (alt) {
              other.innerHTML = unit > 0
                ? `Chamber member? <strong>${esc(alt.name)}</strong> is free — switch to it above.`
                : `Not a member? Choose <strong>${esc(alt.name)}</strong> above — that one is $${priceOf(alt).toFixed(2)}.`;
            }
          }
          syncPayBtn();
        };
        typeSel.addEventListener('change', update);
        qtySel.addEventListener('change', update);
        // Which row to open on. `&tier=paid` comes from the Purchase / Get
        // tickets button, `&tier=free` from RSVP (Felicia, Jul 30 2026 — both
        // buttons used to land on row 1, the free member tier, so Purchase
        // looked "literally just a place to RSVP"). Also accepts an audience
        // ('member' / 'guest') or a row number, for links the office writes by
        // hand into an event description.
        const want = String(params.get('tier') || '').trim().toLowerCase();
        const buyable = (t) => !t.soldOut;
        const wanted = (() => {
          if (!want) return -1;
          if (want === 'paid') return types.findIndex((t) => buyable(t) && priceOf(t) > 0);
          if (want === 'free') return types.findIndex((t) => buyable(t) && priceOf(t) <= 0);
          if (/^\d+$/.test(want)) return types[Number(want)] ? Number(want) : -1;
          return types.findIndex((t) => buyable(t)
            && (String(t.group || '').toLowerCase() === want || String(t.name || '').toLowerCase() === want));
        })();
        // The browser preselects the first <option> even when it's disabled —
        // fall back to the first price that is actually buyable (not sold out).
        const firstBuyable = types.findIndex(buyable);
        const startAt = wanted >= 0 ? wanted : firstBuyable;
        if (startAt > 0) typeSel.value = String(startAt);
        update();
        // Free-only events read as a registration, not a sale.
        if (types.every((t) => priceOf(t) <= 0)) title.textContent = 'Event registration';
      } else {
        // No registration tiers configured on this event yet. Rather than an
        // open amount box (Felicia, Jul 29 — "it doesn't say $15, it has all
        // other numbers"), send them to the office and say why.
        summary.innerHTML = `${evMeta}<p class="notice mt-3">Registration for this event isn't set up online yet.
          Please call the Chamber office at <strong>(818) 347-4737</strong> or email
          <a href="mailto:felicia@woodlandhillscc.net">felicia@woodlandhillscc.net</a> and we'll take care of it.</p>`;
        ['payBtn', 'amountField', 'payError', 'payCardBlock', 'payBillingBlock', 'paySecureNote'].forEach((i2) => {
          const el2 = document.getElementById(i2); if (el2) el2.style.display = 'none';
        });
        const pf = document.getElementById('payForm');
        const left = pf && pf.querySelector('div'); if (left) left.style.display = 'none';
        return;
      }
    } else if (kind === 'membership') {
      // Reached from the Join application (Felicia, Jul 31 2026: "hit submit,
      // it should take them to the payment portal and the amount of their
      // membership should be populated"). The application stashes the contact
      // details in sessionStorage so nobody types their name twice — read once,
      // clear immediately.
      const item = findSku('memberships', skuParam);
      const tier = item ? item.tier : (params.get('tier') || 'membership');
      sku = item ? item.sku : `membership:${tier}`;
      title.textContent = 'Chamber membership';
      label = `Membership — ${item ? item.label : tier}`;
      if (item && item.amount != null && !presetAmount) presetAmount = String(item.amount);
      let fromApp = null;
      try {
        fromApp = JSON.parse(sessionStorage.getItem('wvJoinPrefill') || 'null');
        sessionStorage.removeItem('wvJoinPrefill');
      } catch (e) { /* no stash — a direct visit */ }
      if (fromApp) {
        const pf = document.getElementById('payForm');
        ['firstName', 'lastName', 'email', 'phone', 'company'].forEach((n) => {
          const el = pf && pf.querySelector(`[name="${n}"]`);
          if (el && !el.value && fromApp[n]) el.value = String(fromApp[n]);
        });
      }
      // With a dues + activation breakdown on the sku (2026 dues sheet), the
      // total is a first-year figure — calling it "Annual dues" would misstate
      // what renews next year, so the line spells out both parts.
      const firstYear = item && item.dues != null && item.activation;
      summary.innerHTML = (fromApp ? '<p class="notice" style="margin:0 0 var(--s-3)"><strong>✓ Application received.</strong> One last step — pay your first-year dues below and you’re in.</p>' : '')
        + (item
          ? `<strong>${esc(item.label)}</strong><br><span class="member-tile__meta">${firstYear
              ? `First year · $${esc(item.amount)} — $${esc(item.dues)} annual dues + a one-time $${esc(item.activation)} activation fee`
              : `Annual dues · $${esc(item.amount)}`}</span>${item.blurb ? `<p class="member-tile__meta mt-2">${esc(item.blurb)}</p>` : ''}<p class="member-tile__meta mt-2">Charged once today for your first year — renewals are arranged by the Chamber office. Questions? Call (818) 347-4737.</p>`
          : `<strong>Annual membership</strong><br><span class="member-tile__meta">${esc(tier)}</span><p class="notice mt-3">Dues are based on your tier — enter the amount the office gave you, or call (818) 347-4737.</p>`);
      amountLabel.textContent = firstYear ? 'First-year total (USD)' : 'Dues amount (USD)';
      // A catalog level has one price — lock the box so a typo can't charge
      // the wrong dues (the server refuses a mismatched amount regardless).
      if (item && item.amount != null) {
        amountInput.readOnly = true;
        amountInput.style.background = 'var(--cream-deep, #f3ecda)';
      }
    } else if (kind === 'payment') {
      // Office-directed payment link: the Chamber emails a URL like
      //   checkout.html?type=payment&for=2026%20Dues%20Renewal&amount=450
      // `for` labels the charge on the receipt; `amount` presets (still editable).
      const what = params.get('for') || 'Chamber payment';
      sku = 'payment:' + what.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
      title.textContent = 'Make a payment';
      label = `Payment: ${what}`;
      // A link the office generated carries lock=1: the amount is fixed, so the
      // payer cannot type $2,000 in place of $200 (Michael, Jul 29 — no more
      // "did you mean to pay that?" follow-up calls).
      const locked = params.get('lock') === '1' && Number(params.get('amount')) > 0;
      summary.innerHTML = `<strong>${esc(what)}</strong><p class="member-tile__meta mt-2">${locked
        ? 'This amount was set by the Chamber office. Pay securely by card below.'
        : 'Pay the Chamber securely by card. If the amount was not filled in for you, enter the amount provided by the Chamber office.'}</p>`;
      amountLabel.textContent = locked ? 'Amount due (USD)' : 'Amount (USD)';
      if (locked) {
        amountInput.readOnly = true;
        amountInput.style.background = 'var(--cream-deep, #f3ecda)';
      }
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
    syncPayBtn();

    // (Promo-code UI removed Jul 2026 — the Chamber decided against promo codes.)

    const cfg = window.WVWCCC_PAY || {};
    const form = document.getElementById('payForm');
    const errEl = document.getElementById('payError');
    const showErr = (m) => { errEl.textContent = m; errEl.hidden = false; };

    // No tokenization key yet → show notice, keep UI but block live submit.
    // A FREE RSVP still goes through: it never touches the card gateway.
    if (!cfg.tokenizationKey) {
      document.getElementById('sandboxNotice').hidden = false;
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); errEl.hidden = true;
        if (!form.reportValidity()) return;
        if (freeMode) {
          try { await submitFreeRsvp(); } catch (err) { showErr(err.message || 'Could not record your RSVP.'); }
          return;
        }
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
                email: (r.querySelector('[data-att-email]')?.value || '').trim(),
                phone: (r.querySelector('[data-att-phone]')?.value || '').trim(),
              })).filter((a) => a.name || a.email || a.phone),
            invitedBy: (document.getElementById('tixInvited')?.value || '').trim().slice(0, 80),
            description: label,
            ...extra,
          };
          // Membership dues charge ONCE — no auto-recurring plan. Renewals are
          // the office's call (they often quote a different rate), so nobody
          // gets silently re-billed a year later.
          const r = await fetch(ChamberAPI.url('/api/pay'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
          const data = await r.json();
          if (!data.ok) return showErr(data.error || 'Payment declined.');
          form.hidden = true;
          document.getElementById('paySuccess').hidden = false;
          document.getElementById('txnId').textContent = data.transactionId || '—';
          // GA4 ecommerce conversion. `amount` is the locked qty x price total,
          // so the per-item price is that divided back out. wvTrack is a no-op
          // when analytics.js is blocked — the receipt above already rendered.
          const gaQty = Number(extra.quantity) || 1;
          const gaTotal = Number(amountInput.value) || 0;
          if (window.wvTrack) window.wvTrack('purchase', {
            transaction_id: data.transactionId || '',
            value: gaTotal,
            currency: 'USD',
            items: [{
              item_id: sku,
              item_name: extra.eventTitle || label,
              item_category: kind,
              item_variant: extra.ticketType || '',
              price: gaQty ? gaTotal / gaQty : gaTotal,
              quantity: gaQty,
            }],
          });
        } catch (e) { showErr('Could not complete payment. Please try again.'); }
      },
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault(); errEl.hidden = true;
      if (!form.reportValidity()) return;
      // Free tier → record the RSVP; there is no charge to tokenize.
      if (freeMode) {
        const btn = payBtnEl; const was = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
        try { await submitFreeRsvp(); }
        catch (err) { showErr(err.message || 'Could not record your RSVP. Please call the office at (818) 347-4737.'); }
        finally { if (btn) { btn.disabled = false; btn.textContent = was; } }
        return;
      }
      window.CollectJS.startPaymentRequest();
    });
  }

  // ── Generic lead/contact form → /api/contact ────────────
  // Cloudflare Turnstile captcha — added to a form when a site key is configured
  // (js/api-base.js). The widget injects a hidden cf-turnstile-response input that
  // FormData picks up; verified server-side. No-op until the key is set.
  // The implementation lives in api-base.js next to the key, so the landing pages
  // (which do not load chamber.js) get the same widget from one definition.
  function mountTurnstile(form, anchor) { return ChamberAPI.mountTurnstile(form, anchor); }
  function resetTurnstile(form) { return ChamberAPI.resetTurnstile(form); }

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
  function initLeadForm(formId, msgId, kind, opts) {
    const form = document.getElementById(formId);
    const msg = document.getElementById(msgId);
    if (!form) return;
    mountTurnstile(form);
    // Honeypot — bots fill every box; humans never see this one. Formspree
    // discards `_gotcha` submissions natively and /api/contact files them as
    // spam, so both delivery channels stay clean (Felicia, Jul 31 2026).
    if (!form.querySelector('[name="_gotcha"]')) {
      const hp = document.createElement('input');
      hp.type = 'text'; hp.name = '_gotcha'; hp.tabIndex = -1;
      hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true');
      hp.style.cssText = 'position:absolute;left:-9999px';
      form.appendChild(hp);
    }
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
      // A filled honeypot means a bot — pretend it worked and send nothing.
      const hpEl = form.querySelector('[name="_gotcha"]');
      if (hpEl && hpEl.value) {
        msg.hidden = false;
        msg.textContent = 'Thank you — your message has been sent. The Chamber will be in touch.';
        return;
      }
      if (!form.reportValidity()) return;
      const payload = { kind };
      new FormData(form).forEach((v, k) => { if (k !== '_gotcha') payload[k] = v; });
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
        // The applicant's chosen password goes ONLY to our server (hashed on
        // arrival); the office's email copy just notes that one was chosen.
        const fsPayload = Object.assign({ _subject: subject }, payload);
        if (fsPayload.password) { fsPayload.password = undefined; fsPayload.chosePassword = 'yes — stored securely, active on approval'; }
        const fsP = fetch(leadFsEndpoint(kind), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(fsPayload),
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
          // A membership application is a conversion (GA4 key event) — same
          // signal the free-RSVP path sends.
          if (kind === 'membership-application' && window.wvTrack) {
            window.wvTrack('generate_lead', { lead_type: 'membership_application', currency: 'USD', value: 0 });
          }
          // Page-specific follow-through (join.html hands off to the payment
          // page here, with the submitted fields still in hand post-reset).
          if (opts && typeof opts.onSuccess === 'function') { try { opts.onSuccess(payload); } catch (err2) { /* thank-you already shown */ } }
        } else {
          msg.textContent = 'Something went wrong. Please call (818) 347-4737.';
        }
      } catch (err) {
        msg.hidden = false;
        msg.textContent = 'Could not send right now. Please call the office at (818) 347-4737.';
      } finally { btn.disabled = false; btn.textContent = label; resetTurnstile(form); }
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
              ${meta.community ? ` · <span title="Posted by a local business that is not a Chamber member. Listed as a community service — the Chamber does not vouch for the employer.">${tr('Community posting')}</span>` : ''}
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

    // Non-member job submission (Felicia, Jul 29 2026) → staff review queue.
    const pjf = document.getElementById('publicJobForm');
    if (pjf) {
      mountTurnstile(pjf);
      const pjm = document.getElementById('publicJobMsg');
      const say = (t, bad) => {
        pjm.hidden = !t; pjm.textContent = t || '';
        pjm.style.borderColor = bad ? 'var(--red)' : 'var(--green)';
        pjm.style.color = bad ? 'var(--red)' : '';
      };
      pjf.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!pjf.reportValidity()) return;
        const fd = new FormData(pjf);
        const btn = pjf.querySelector('[type="submit"]');
        const was = btn.textContent; btn.disabled = true; btn.textContent = 'Submitting…';
        try {
          const r = await fetch(ChamberAPI.url('/api/public/job'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: fd.get('title'), company: fd.get('company'), email: fd.get('email'),
              body: fd.get('body'), applyUrl: fd.get('applyUrl'),
              meta: { jobType: fd.get('jobType'), location: fd.get('location'), payRange: fd.get('payRange') },
              'cf-turnstile-response': ChamberAPI.turnstileToken(pjf),
            }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || d.ok === false) { say(d.error || 'Could not submit the posting — please try again.', true); return; }
          pjf.reset();
          say('Thank you — your posting is with Chamber staff for review. It appears on this page once approved, usually within a business day.');
        } catch (err) { say('Could not reach the Chamber right now. Please try again, or call (818) 347-4737.', true); }
        // Single-use token: a server-side field error (missing title, flagged
        // wording) burns it, so without this a corrected resubmit would fail the
        // captcha instead. pjf.reset() also wipes the input on success.
        finally { btn.disabled = false; btn.textContent = was; resetTurnstile(pjf); }
      });
    }
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
  const LEADER_GROUP_LABEL = { 'Staff': 'Chamber Staff', 'Leader': 'Executive Officers', 'Board Member': 'Board of Directors', 'Past President': 'Past Presidents', 'Ambassador': 'Ambassadors' };
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
    // Staff leads the page (per Diana, Jul 13 — board meeting order: Staff / Officers / Board).
    const ORDER = ['Staff', 'Leader', 'Board Member', 'Past President'];
    const base = depth ? '../' : '';
    // Sub-nav so visitors can jump to the Board or officers view.
    const tabs = [['', 'Everyone'], ['Staff', 'Staff'], ['Leader', 'Officers'], ['Board Member', 'Board of Directors']];
    // Ambassadors live on their own page (Felicia, Aug 10 2026) — the last
    // chip crosses over rather than filtering this one.
    const subnav = `<nav class="chips" style="justify-content:center;margin-bottom:var(--s-6)" aria-label="Leadership groups">${tabs.map(([g, l]) =>
      `<a class="chip${only === g ? ' chip--gold' : ''}" href="${base}leadership.html${g ? ('?group=' + encodeURIComponent(g)) : ''}">${l}</a>`).join('')}<a class="chip" href="${base}ambassadors.html">Ambassadors →</a></nav>`;
    const want = only && ORDER.includes(only) ? [only] : ORDER;
    // Officers rank by office, per Diana (Jul 13): President → President Elect
    // → VP → CFO → Secretary. Everyone else reads like a printed roster,
    // alphabetical by last name.
    const officerRank = (m) => {
      const t = String(m.boardTitle || '').toLowerCase();
      if (t.includes('president of the board')) return 0;
      if (t.includes('president elect') || t.includes('president-elect')) return 1;
      if (t.includes('vice president') || /\bvp\b/.test(t)) return 2;
      if (t.includes('financial') || /\bcfo\b/.test(t)) return 3;
      if (t.includes('secretary')) return 4;
      return 5;
    };
    // Staff: the CEO leads, everyone else alphabetical.
    const staffRank = (m) => {
      const t = String(m.boardTitle || '').toLowerCase();
      return (t.includes('chief executive') || /\bceo\b/.test(t)) ? 0 : 1;
    };
    // A member counts for a section via their primary designation OR any
    // extra designation (per the office, Jul 2026 — e.g. someone who is a
    // Board Member AND an Ambassador appears on every matching page).
    const hasDesig = (m, g) => m.leaderStatus === g || (Array.isArray(m.designations) && m.designations.includes(g));
    const groups = {};
    want.forEach((g) => {
      const list = members.filter((m) => hasDesig(m, g))
        .sort((a, b) => (g === 'Leader' ? officerRank(a) - officerRank(b) : g === 'Staff' ? staffRank(a) - staffRank(b) : 0) || lastNameOf(a).localeCompare(lastNameOf(b)));
      if (list.length) groups[g] = list;
    });
    if (!Object.keys(groups).length) { el.innerHTML = subnav + '<p class="notice">This roster is being finalized — check back soon. (Admins: set each member\'s designation under Members.)</p>'; return; }
    const section = (g, list) => {
      const officers = g === 'Leader' || g === 'Staff';
      // Staff and officers sit up top, larger, on their own centered rows; the
      // board is a classic 4-up gallery. Gold hairline rules frame each section title.
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

  // ── Ambassadors page — its own page, separate from Board & Leadership and
  // Chamber Leaders (Felicia, Aug 10 2026). Everyone designated Ambassador
  // (primary status OR an extra designation), as a printed-roster gallery,
  // alphabetical by last name.
  async function initAmbassadors(depth = 0) {
    const el = document.getElementById('ambassadorGrid'); if (!el) return;
    ensureBoardCss();
    let members = [];
    try { members = (await getJSON(ChamberAPI.url('/api/members'))).members || []; }
    catch (e) { el.innerHTML = '<p class="notice">Could not load the roster right now.</p>'; return; }
    const list = members.filter((m) => m.leaderStatus === 'Ambassador'
      || (Array.isArray(m.designations) && m.designations.includes('Ambassador')))
      .sort((a, b) => lastNameOf(a).localeCompare(lastNameOf(b)));
    if (!list.length) { el.innerHTML = '<p class="notice">This roster is being finalized — check back soon. (Admins: set a member\'s designation to Ambassador under Members.)</p>'; return; }
    el.innerHTML = `
      <div class="board-rule"><h2 style="margin:0;white-space:nowrap">${esc(LEADER_GROUP_LABEL.Ambassador)}</h2></div>
      <div class="grid grid-4" style="gap:var(--s-6)">${list.map((m) => boardCard(m, depth)).join('')}</div>`;
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
        // Only show members that are actually dining spots (a stray "|| true"
        // here let ANY member Wendy mentioned — e.g. a plumber — render as a
        // restaurant card; per Felicia, Jul 14).
        const picks = (r.members || []).filter((m) => DINING_RE.test(m.category || '') || (m.tags || []).some((t) => DINING_RE.test(t)) || (m.keywords || []).some((t) => DINING_RE.test(t))).slice(0, 3);
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

  return { initHome, initEventView, initDirectory, initProfile, initEvents, initCheckout, initLeadForm, initJobs, initDeals, initCommunity, initNews, initBizBuzz, initBoard, initLeaders, initDining, offerCard, postCard, newsCard, memberTile, eventCard, eventPreviewCard, initLeaderBanner, initGroups, initGroupView, initGallery, initAlbumView, initPayPortal, initAmbassadors, initFeaturedSlot, joinCtaHtml, mountJoinCta, initGuides, initGuideView, initRealEstate, getJSON, esc };
})();
