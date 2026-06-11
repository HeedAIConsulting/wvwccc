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

  // Verified Chamber accounts only (each visited & confirmed).
  // Icons are static SVG files (official simple-icons paths, cream fill).
  const SOCIALS = [
    { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/westvalleywarnercenterchamber' },
    { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/westvalleywcchamber' },
    { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/wvwcchamberofcommerce' },
    { id: 'google', label: 'Google Business Profile', url: 'https://share.google/C7gUMpUcG75U8cz14' },
    { id: 'yelp', label: 'Yelp', url: 'https://www.yelp.com/biz/west-valley-warner-center-chamber-of-commerce-woodland-hills-2' },
  ];

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
            <a href="${p(depth, 'groups/index.html')}">${L?'Grupos y Redes':'Groups & Networks'}</a>
            <a href="${p(depth, 'gallery.html')}">${L?'Galería de Fotos':'Photo Gallery'}</a>
            <a href="${p(depth, 'community/news.html')}">${t.news}</a>
            <a href="${p(depth, 'community/board.html')}">${L?'Tablón Comunitario':'Community Board'}</a>
            <a href="${p(depth, 'community/our-community.html')}">${L?'Nuestra Comunidad':'Our Community'}</a>
            <a href="${p(depth, 'community/grateful-hearts.html')}">Grateful Hearts</a>
            <a href="${p(depth, 'community/history.html')}">${L?'Historia':'Our History'}</a>
          </div>
        </div>
        <div class="nav-dd">
          <button type="button" aria-haspopup="true">${t.resources} <span aria-hidden="true">▾</span></button>
          <div class="nav-dd__menu" data-dd="Resources & Visitor Info">
            <a href="${p(depth, 'dining.html')}">${t.dining}</a>
            <a href="${p(depth, 'deals.html')}">${t.deals}</a>
            <a href="${p(depth, 'jobs/index.html')}">${t.jobs}</a>
            <a href="${p(depth, 'real-estate.html')}">${L?'Bienes Raíces':'Real Estate'}</a>
            <a href="${p(depth, 'guides/index.html')}">${L?'Guías Comunitarias':'Community Guides'}</a>
            <a href="${p(depth, 'regional-resource-guide.html')}">${L?'Guía Regional 2026':'Regional Resource Guide'}</a>
            <a href="${p(depth, 'resources.html')}">${L?'Todos los recursos':'All Resources'} →</a>
          </div>
        </div>
        <div class="nav-dd">
          <button type="button" aria-haspopup="true">${t.about} <span aria-hidden="true">▾</span></button>
          <div class="nav-dd__menu" data-dd="About & Membership">
            <a href="${p(depth, 'about.html')}">${L?'Acerca de':'About Us'}</a>
            <a href="${p(depth, 'leadership.html')}">${L?'Junta y Liderazgo':'Board & Leadership'}</a>
            <a href="${p(depth, 'p/benefits-of-membership')}">${L?'Por qué unirse':'Why Join the Chamber'}</a>
            <a href="${p(depth, 'resources.html')}">${L?'Más sobre la Cámara':'More Chamber pages'} →</a>
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
        <div class="footer-social" aria-label="${L ? 'Redes sociales' : 'Social media'}">
          ${SOCIALS.map((s) => `<a href="${s.url}" target="_blank" rel="noopener" aria-label="${s.label}" title="${s.label}"><img src="${p(depth, 'images/social/' + s.id + '.svg')}" alt="" width="20" height="20" loading="lazy"></a>`).join('')}
        </div>
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
          <li><a href="${p(depth,'groups/index.html')}">${L?'Grupos y Redes':'Groups & Networks'}</a></li>
          <li><a href="${p(depth,'gallery.html')}">${L?'Galería de Fotos':'Photo Gallery'}</a></li>
          <li><a href="${p(depth,'community/news.html')}">${L?'Noticias':'Valley Biz Buzz'}</a></li>
          <li><a href="${p(depth,'jobs/index.html')}">${t.jobs}</a></li>
          <li><a href="${p(depth,'real-estate.html')}">${L?'Bienes Raíces':'Real Estate'}</a></li>
          <li><a href="${p(depth,'guides/index.html')}">${L?'Guías':'Community Guides'}</a></li>
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

  // Neighborhood Resource promo — a gentle, dismissible invitation to the 2026
  // Regional Resource Guide for visitors who want to learn about the community.
  // Shows once per visitor (30-day snooze), never on admin/auth or the guide itself.
  function mountGuidePromo(depth, lang) {
    if (/\/(admin|auth)\//.test(window.location.pathname)) return;
    if (/regional-resource-guide/.test(window.location.pathname)) return;
    try {
      const snooze = Number(localStorage.getItem('wv-guide-promo') || 0);
      if (snooze && Date.now() - snooze < 30 * 86400000) return;
    } catch (e) { /* private mode → just show it */ }
    const L = lang === 'es';
    const t = L ? {
      kicker: 'Nuevos por aquí?',
      title: 'Conozca el West Valley · Warner Center',
      body: 'Consulte nuestra Guía de Recursos del Vecindario — descubra quién y qué negocios están aquí, en nuestra parte del planeta.',
      cta: 'Ver la guía', close: 'Cerrar',
    } : {
      kicker: 'New to the area?',
      title: 'Get to know the West Valley · Warner Center',
      body: 'Check out our Neighborhood Resource Guide — learn who and what businesses are here in our part of the planet.',
      cta: 'Explore the guide', close: 'Dismiss',
    };
    if (!document.getElementById('wv-guidepromo-css')) {
      const st = document.createElement('style'); st.id = 'wv-guidepromo-css';
      st.textContent = '.guide-promo{position:fixed;left:18px;bottom:18px;z-index:1200;max-width:340px;'
        + 'background:var(--green-ink,#1b3326);color:#fff;border-radius:14px;padding:18px 20px;'
        + 'box-shadow:0 18px 48px rgba(0,0,0,.32);border:1px solid rgba(201,162,39,.45);'
        + 'background-image:radial-gradient(ellipse at 90% 0%,rgba(201,162,39,.22),transparent 60%);'
        + 'opacity:0;transform:translateY(14px);transition:opacity .45s,transform .45s}'
        + '.guide-promo.in{opacity:1;transform:none}'
        + '.guide-promo__kicker{font-family:var(--mono);font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-bright,#e3c35f)}'
        + '.guide-promo h4{font-family:var(--display);font-size:1.05rem;color:#fff;margin:6px 0 6px;line-height:1.3}'
        + '.guide-promo p{font-size:.86rem;color:rgba(255,255,255,.82);line-height:1.5;margin:0 0 12px}'
        + '.guide-promo__row{display:flex;gap:10px;align-items:center}'
        + '.guide-promo__close{position:absolute;top:8px;right:10px;background:none;border:none;color:rgba(255,255,255,.6);font-size:1.1rem;cursor:pointer;line-height:1;padding:4px}'
        + '.guide-promo__close:hover{color:#fff}'
        + '.guide-promo__later{background:none;border:none;color:rgba(255,255,255,.62);font-size:.8rem;cursor:pointer;text-decoration:underline;padding:0}'
        + '@media(max-width:560px){.guide-promo{left:12px;right:12px;max-width:none;bottom:12px}}';
      document.head.appendChild(st);
    }
    const card = document.createElement('aside');
    card.className = 'guide-promo';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', t.title);
    card.innerHTML = `
      <button class="guide-promo__close" type="button" aria-label="${t.close}">✕</button>
      <span class="guide-promo__kicker">${t.kicker}</span>
      <h4>${t.title}</h4>
      <p>${t.body}</p>
      <div class="guide-promo__row">
        <a class="btn btn--gold btn--sm" href="${p(depth, 'regional-resource-guide.html')}">${t.cta} →</a>
        <button class="guide-promo__later" type="button">${t.close}</button>
      </div>`;
    const dismiss = () => {
      try { localStorage.setItem('wv-guide-promo', String(Date.now())); } catch (e) {}
      card.classList.remove('in');
      setTimeout(() => card.remove(), 450);
    };
    card.querySelector('.guide-promo__close').addEventListener('click', dismiss);
    card.querySelector('.guide-promo__later').addEventListener('click', dismiss);
    card.querySelector('a').addEventListener('click', () => {
      try { localStorage.setItem('wv-guide-promo', String(Date.now())); } catch (e) {}
    });
    setTimeout(() => { document.body.appendChild(card); requestAnimationFrame(() => card.classList.add('in')); }, 6000);
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
        + '.nav-dd>button:hover,.nav-dd:hover>button,.nav-dd:focus-within>button,.nav-dd.dd-open>button{color:#fff}'
        + '.nav-dd__menu{position:absolute;top:calc(100% + 8px);left:0;min-width:244px;background:#fff;border:1px solid var(--gold-soft,#e6dcbf);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.16);padding:8px;display:none;z-index:300;max-height:74vh;overflow:auto}'
        // invisible hover bridge spans the 8px gap so the menu doesn't vanish in transit
        + '.nav-dd::after{content:"";position:absolute;left:-12px;right:-12px;top:100%;height:16px}'
        + '.nav-dd:hover .nav-dd__menu,.nav-dd:focus-within .nav-dd__menu,.nav-dd.dd-open .nav-dd__menu{display:block}'
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

    // Dropdown UX: click toggles (sticky until outside click), and hover gets a
    // grace period — menus no longer vanish while the mouse travels to them.
    document.querySelectorAll('.nav-dd').forEach((dd) => {
      const btn = dd.querySelector(':scope > button');
      if (!btn) return;
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.nav-dd.dd-open').forEach((o) => { if (o !== dd) o.classList.remove('dd-open'); });
        btn.setAttribute('aria-expanded', String(dd.classList.toggle('dd-open')));
      });
      let t;
      dd.addEventListener('mouseenter', () => { clearTimeout(t); dd.classList.add('dd-open'); });
      dd.addEventListener('mouseleave', () => { t = setTimeout(() => { dd.classList.remove('dd-open'); btn.setAttribute('aria-expanded', 'false'); }, 240); });
    });
    document.addEventListener('click', () => document.querySelectorAll('.nav-dd.dd-open').forEach((o) => o.classList.remove('dd-open')));
    // (Migrated content pages are no longer auto-listed in the dropdowns — they
    // live on resources.html, which every menu links to. Cleaner UI.)

    mountElevenLabs();
    mountAccessibility(depth);
    mountGuidePromo(depth, lang);

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
