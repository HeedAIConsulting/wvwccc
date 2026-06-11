/* ============================================================
   WVWCCC — Shared header & footer partials
   Pages call window.ChamberPartials.mount({ active, depth, lang })
   depth = 0 for root pages, 1 for subdirectory pages
   lang  = 'en' | 'es'
   Production scope: Directory · Events · Jobs · Donate · Join
   ============================================================ */
window.ChamberPartials = (function () {
  function p(depth, path) { return (depth ? '../' : '') + path; }

  // Real, verified contact data only. Social handles intentionally
  // omitted until verified — see footer placeholder.
  const CONTACT = {
    phone: '(818) 347-4737',
    area: 'Tarzana · Woodland Hills · Reseda · Warner Center',
    since: 'Est. 1930',
  };

  function header(active, depth, lang) {
    const L = lang === 'es';
    const t = L ? {
      login: 'Acceso', staff: 'Personal', contact: 'Contacto',
      home: 'Inicio', dir: 'Directorio', dining: 'Comida', events: 'Eventos', jobs: 'Empleos',
      deals: 'Ofertas', community: 'Comunidad', news: 'Noticias', resources: 'Recursos', about: 'La Cámara', join: 'Únete'
    } : {
      login: 'Sign In', staff: 'Staff', contact: 'Contact',
      home: 'Home', dir: 'Directory', dining: 'Dining', events: 'Events', jobs: 'Jobs',
      deals: 'Deals', community: 'Community', news: 'Biz Buzz', resources: 'Resources', about: 'The Chamber', join: 'Join'
    };
    const base = depth ? '../' : '';
    return `
<header class="site-header">
  <div class="site-header__top">
    <div class="container">
      <div class="site-header__top-meta">
        <span>&#128222; ${CONTACT.phone}</span>
        <span>&#128205; ${CONTACT.area}</span>
        <span>&#128336; ${CONTACT.since}</span>
      </div>
      <div class="site-header__top-actions">
        <a href="${p(depth, 'auth/login.html')}">${t.login}</a>
        <span style="color:rgba(255,255,255,.3)">·</span>
        <a href="${p(depth, 'contact.html')}">${t.contact}</a>
        <span style="color:rgba(255,255,255,.3)">·</span>
        <span class="lang-switch">
          <a href="${base}index.html" class="${!L?'active':''}">EN</a>
          <a href="${base}es/index.html" class="${L?'active':''}">ES</a>
        </span>
      </div>
    </div>
  </div>
  <div class="container">
    <div class="site-header__main">
      <a href="${p(depth, 'index.html')}" class="brand" aria-label="WVWCCC home">
        <img class="brand__logo" src="${p(depth,'images/wvwccc-logo.png')}" alt="West Valley · Warner Center Chamber of Commerce seal" width="56" height="56">
        <span class="brand__text">
          <span class="brand__name">West Valley · Warner Center</span>
          <span class="brand__sub">Chamber of Commerce · Since 1930</span>
        </span>
      </a>
      <nav class="nav" aria-label="Main">
        <a href="${p(depth, 'index.html')}" ${active==='home'?'class="active"':''}>${t.home}</a>
        <a href="${p(depth, 'members/directory.html')}" ${active==='members'?'class="active"':''}>${t.dir}</a>
        <a href="${p(depth, 'events/index.html')}" ${active==='events'?'class="active"':''}>${t.events}</a>
        <div class="nav-dd">
          <button type="button" aria-haspopup="true">${t.community} <span aria-hidden="true">▾</span></button>
          <div class="nav-dd__menu" data-dd="Our Community">
            <a href="${p(depth, 'community/news.html')}">${t.news}</a>
            <a href="${p(depth, 'community/board.html')}">${L?'Tablón Comunitario':'Community Board'}</a>
            <a href="${p(depth, 'community/our-community.html')}">${L?'Nuestra Comunidad':'Our Community'}</a>
            <a href="${p(depth, 'community/grateful-hearts.html')}">Grateful Hearts</a>
            <div class="nav-dd__sep">${L?'Más':'More'}</div>
            <div data-dd-pages="Our Community"></div>
          </div>
        </div>
        <div class="nav-dd">
          <button type="button" aria-haspopup="true">${t.resources} <span aria-hidden="true">▾</span></button>
          <div class="nav-dd__menu" data-dd="Resources & Visitor Info">
            <a href="${p(depth, 'dining.html')}">${t.dining}</a>
            <a href="${p(depth, 'deals.html')}">${t.deals}</a>
            <a href="${p(depth, 'jobs/index.html')}">${t.jobs}</a>
            <a href="${p(depth, 'resources.html')}">${L?'Todos los recursos':'All Resources'}</a>
            <div class="nav-dd__sep">${L?'Info para visitantes':'Visitor info'}</div>
            <div data-dd-pages="Resources & Visitor Info"></div>
          </div>
        </div>
        <div class="nav-dd">
          <button type="button" aria-haspopup="true">${t.about} <span aria-hidden="true">▾</span></button>
          <div class="nav-dd__menu" data-dd="About & Membership">
            <a href="${p(depth, 'about.html')}">${L?'Acerca de':'About Us'}</a>
            <a href="${p(depth, 'leadership.html')}">${L?'Junta y Liderazgo':'Board & Leadership'}</a>
            <div class="nav-dd__sep">${L?'Membresía':'Membership'}</div>
            <div data-dd-pages="About & Membership"></div>
          </div>
        </div>
        <a href="${p(depth, 'join.html')}" class="btn btn--gold btn--sm nav-cta">${t.join}</a>
      </nav>
      <button class="menu-toggle" aria-label="Toggle menu" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    </div>
  </div>
</header>`;
  }

  function footer(depth, lang) {
    const L = lang === 'es';
    const t = L ? { tag:'Conectando a las empresas y residentes de Tarzana, Woodland Hills, Reseda y Warner Center desde 1930.',
      members:'Miembros', engage:'Participa', about:'Acerca de', join:'Únete', dir:'Directorio',
      login:'Acceso de Miembros', events:'Eventos', jobs:'Bolsa de Empleo', donate:'Donar', sponsor:'Patrocinar',
      chamber:'La Cámara', contact:'Contacto', access:'Accesibilidad', privacy:'Privacidad' }
      : { tag:'Connecting the businesses and residents of Tarzana, Woodland Hills, Reseda, and the Warner Center since 1930.',
      members:'Members', engage:'Engage', about:'About', join:'Join Now', dir:'Directory',
      login:'Member Login', events:'Events', jobs:'Jobs Board', donate:'Donate', sponsor:'Sponsor',
      chamber:'The Chamber', contact:'Contact', access:'Accessibility', privacy:'Privacy' };
    return `
<section class="leaders-wall" data-leader-section hidden aria-label="Chamber leaders">
  <div class="container">
    <h3 class="leaders-wall__title">${L ? 'Líderes' : 'Leaders'}</h3>
    <div id="leadersWall"></div>
  </div>
</section>
<footer class="site-footer">
  <div class="container">
    <div class="site-footer__grid">
      <div class="site-footer__brand">
        <div class="brand">
          <img class="brand__logo" src="${p(depth,'images/wvwccc-logo.png')}" alt="West Valley · Warner Center Chamber of Commerce seal" width="56" height="56">
          <span class="brand__text">
            <span class="brand__name">West Valley · Warner Center</span>
            <span class="brand__sub">Chamber of Commerce · Since 1930</span>
          </span>
        </div>
        <p class="mt-4">${t.tag}</p>
        <!-- SOCIAL LINKS: [NEEDS REAL DATA] — verify each handle by visiting the
             actual account before rendering. Do NOT ship "#" placeholders. -->
      </div>
      <div>
        <h4>${t.members}</h4>
        <ul>
          <li><a href="${p(depth,'join.html')}">${t.join}</a></li>
          <li><a href="${p(depth,'members/directory.html')}">${t.dir}</a></li>
          <li><a href="${p(depth,'auth/login.html')}">${t.login}</a></li>
          <li><a href="${p(depth,'auth/login.html')}">${L?'Acceso Personal / Admin':'Staff / Admin'}</a></li>
        </ul>
      </div>
      <div>
        <h4>${t.engage}</h4>
        <ul>
          <li><a href="${p(depth,'events/index.html')}">${t.events}</a></li>
          <li><a href="${p(depth,'community/news.html')}">${L?'Noticias':'Valley Biz Buzz'}</a></li>
          <li><a href="${p(depth,'jobs/index.html')}">${t.jobs}</a></li>
          <li><a href="${p(depth,'donate.html')}">${t.donate}</a></li>
          <li><a href="${p(depth,'inquire.html')}?type=sponsorship">${t.sponsor}</a></li>
          <li><a href="${p(depth,'inquire.html')}?type=membership">${L?'Consultas':'Inquiries'}</a></li>
        </ul>
      </div>
      <div>
        <h4>${t.about}</h4>
        <ul>
          <li><a href="${p(depth,'about.html')}">${t.chamber}</a></li>
          <li><a href="${p(depth,'leadership.html')}">${L?'Junta y Liderazgo':'Board & Leadership'}</a></li>
          <li><a href="${p(depth,'community/our-community.html')}">${L?'Nuestra Comunidad':'Our Community'}</a></li>
          <li><a href="${p(depth,'community/grateful-hearts.html')}">Grateful Hearts</a></li>
          <li><a href="${p(depth,'community/history.html')}">${L?'Historia':'Our History'}</a></li>
          <li><a href="${p(depth,'contact.html')}">${t.contact}</a></li>
          <li><a href="${p(depth,'accessibility.html')}">${t.access}</a></li>
          <li><a href="${p(depth,'privacy.html')}">${t.privacy}</a></li>
        </ul>
      </div>
    </div>
    <div class="site-footer__bottom">
      <div>© 2026 West Valley · Warner Center Chamber of Commerce. All rights reserved.</div>
      <div>Built, managed, and hosted by <a href="https://heedbusinesssolutions.com" target="_blank" rel="noopener" style="color:var(--gold-bright)">Heed Business Solutions</a></div>
    </div>
  </div>
</footer>`;
  }

  // ElevenLabs ConvAI agent — one agent serves the whole public site, all
  // languages. Skipped on /admin/ and /auth/ pages. (Pulled from the POC.)
  var ELEVENLABS_AGENT_ID = 'agent_8201kqnjhzyrfpdvtqwgf9e0034y';
  function mountElevenLabs() {
    if (/\/(admin|auth)\//.test(window.location.pathname)) return;
    // Hidden on mobile (phones) — the floating widget crowds small screens.
    if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) return;
    if (!document.querySelector('elevenlabs-convai')) {
      var el = document.createElement('elevenlabs-convai');
      el.setAttribute('agent-id', ELEVENLABS_AGENT_ID);
      el.setAttribute('action-text', 'Ask Wendy');
      el.setAttribute('start-call-text', 'Talk to Wendy');
      document.body.appendChild(el);
    }
    if (!document.querySelector('script[src*="@elevenlabs/convai-widget-embed"]')) {
      var s = document.createElement('script');
      s.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
      s.async = true; s.type = 'text/javascript';
      document.body.appendChild(s);
    }
  }

  // ADA / WCAG accessibility toolkit on every page except the admin console.
  function mountAccessibility(depth) {
    if (/\/admin\//.test(window.location.pathname)) return;
    if (document.querySelector('script[src*="accessibility.js"]')) return;
    var s = document.createElement('script');
    s.src = p(depth, 'js/accessibility.js'); s.async = true;
    document.body.appendChild(s);
  }

  function mount({ active = '', depth = 0, lang = 'en' } = {}) {
    const h = document.querySelector('[data-partial="header"]');
    const f = document.querySelector('[data-partial="footer"]');
    if (h) h.outerHTML = header(active, depth, lang);
    if (f) f.outerHTML = footer(depth, lang);

    // mobile menu toggle (bind after injection)
    const toggle = document.querySelector('.menu-toggle');
    const nav = document.querySelector('.nav');
    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', String(open));
      });
    }
    // mega-menu dropdown styles (once)
    if (!document.getElementById('wv-navdd-css')) {
      const st = document.createElement('style'); st.id = 'wv-navdd-css';
      st.textContent = '.nav-dd{position:relative}'
        // trigger sits on the dark-green header (and dark mobile panel) → always light text
        + '.nav-dd>button{background:none;border:none;font:inherit;cursor:pointer;color:rgba(255,255,255,.82);font-weight:500;font-size:.85rem;padding:0;display:inline-flex;align-items:center;gap:4px;transition:color .2s}'
        + '.nav-dd>button:hover,.nav-dd:hover>button,.nav-dd:focus-within>button{color:#fff}'
        + '.nav-dd__menu{position:absolute;top:calc(100% + 8px);left:0;min-width:244px;background:#fff;border:1px solid var(--gold-soft,#e6dcbf);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.16);padding:8px;display:none;z-index:300;max-height:74vh;overflow:auto}'
        + '.nav-dd:hover .nav-dd__menu,.nav-dd:focus-within .nav-dd__menu{display:block}'
        + '.nav-dd__menu a{display:block;padding:7px 12px;border-radius:8px;color:var(--green-ink,#1b3326);text-decoration:none;font-size:.92rem;white-space:nowrap}'
        + '.nav-dd__menu a:hover{background:var(--cream-deep,#f3ecda)}'
        + '.nav-dd__sep{font-family:var(--mono);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-deep);padding:9px 12px 3px}'
        // mobile: nav becomes a dark panel (≤1260px) → menu goes inline with LIGHT links
        + '@media(max-width:1260px){.nav-dd{display:block}'
          + '.nav-dd__menu{position:static;display:block;background:none;box-shadow:none;border:none;padding:0 0 6px 14px;max-height:none;min-width:0}'
          + '.nav-dd>button{font-weight:600;padding:6px 0}'
          + '.nav-dd__menu a{color:rgba(255,255,255,.82)}'
          + '.nav-dd__menu a:hover{background:rgba(255,255,255,.08);color:#fff}'
          + '.nav-dd__sep{color:var(--gold-bright)}}';
      document.head.appendChild(st);
    }
    // fill dropdowns with migrated content pages, grouped
    const ddTargets = document.querySelectorAll('[data-dd-pages]');
    if (ddTargets.length) {
      const base = depth ? '../' : '';
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const url = (window.ChamberAPI ? ChamberAPI.url('/api/pages') : base + 'api/pages');
      fetch(url).then((r) => r.json()).then((d) => {
        const byGroup = {};
        (d.pages || []).forEach((pg) => { (byGroup[pg.group] = byGroup[pg.group] || []).push(pg); });
        ddTargets.forEach((c) => {
          const list = (byGroup[c.getAttribute('data-dd-pages')] || []).slice().sort((a, b) => a.title.localeCompare(b.title));
          c.innerHTML = list.map((pg) => `<a href="${base}p/${encodeURIComponent(pg.slug)}">${esc(pg.title)}</a>`).join('');
        });
      }).catch(() => {});
    }

    mountElevenLabs();
    mountAccessibility(depth);

    // Sticky header lifts off the page once scrolled (soft shadow).
    const hdr = document.querySelector('.site-header');
    if (hdr) {
      const onScroll = () => hdr.classList.toggle('is-scrolled', window.scrollY > 8);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    // Gentle rise-in for below-fold content only — anything already on screen
    // renders instantly (no flash, nothing ever stuck hidden). Respects
    // prefers-reduced-motion. MutationObserver catches dynamically loaded cards.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window
        && window.innerHeight > 200) { // skip in degenerate/headless viewports — never risk hidden content
      const io = new IntersectionObserver((ents) => {
        for (const e of ents) if (e.isIntersecting) { e.target.classList.add('sr-in'); io.unobserve(e.target); }
      }, { rootMargin: '0px 0px -36px 0px', threshold: 0.06 });
      const SEL = '.section-head, .evp, .pricing-card, .leaders-wall__title';
      const seen = new WeakSet();
      const register = () => document.querySelectorAll(SEL).forEach((el) => {
        if (seen.has(el)) return; seen.add(el);
        if (el.getBoundingClientRect().top > window.innerHeight) { el.classList.add('sr'); io.observe(el); }
      });
      register();
      new MutationObserver(() => requestAnimationFrame(register)).observe(document.body, { childList: true, subtree: true });
    }

    // Leaders wall — tiered, at the bottom of every public page (admin-assigned tiers).
    // (Skips admin/auth; safe no-op if the directory app isn't loaded.)
    if (!/\/(admin|auth)\//.test(window.location.pathname) && window.Chamber && Chamber.initLeaderBanner) {
      Chamber.initLeaderBanner('#leadersWall', { depth: depth });
    }
  }

  return { mount };
})();
