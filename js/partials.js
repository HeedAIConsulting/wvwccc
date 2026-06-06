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
      login: 'Acceso de Miembros', staff: 'Personal', contact: 'Contacto',
      home: 'Inicio', dir: 'Directorio', dining: 'Comida', events: 'Eventos', jobs: 'Empleos',
      deals: 'Ofertas', community: 'Comunidad', about: 'La Cámara', join: 'Únete'
    } : {
      login: 'Member Login', staff: 'Staff', contact: 'Contact',
      home: 'Home', dir: 'Directory', dining: 'Dining', events: 'Events', jobs: 'Jobs',
      deals: 'Deals', community: 'Community', about: 'The Chamber', join: 'Join'
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
        <a href="${p(depth, 'auth/member-login.html')}">${t.login}</a>
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
        <a href="${p(depth, 'dining.html')}" ${active==='dining'?'class="active"':''}>${t.dining}</a>
        <a href="${p(depth, 'events/index.html')}" ${active==='events'?'class="active"':''}>${t.events}</a>
        <a href="${p(depth, 'jobs/index.html')}" ${active==='jobs'?'class="active"':''}>${t.jobs}</a>
        <a href="${p(depth, 'deals.html')}" ${active==='deals'?'class="active"':''}>${t.deals}</a>
        <a href="${p(depth, 'community/board.html')}" ${active==='community'?'class="active"':''}>${t.community}</a>
        <a href="${p(depth, 'about.html')}" ${active==='about'?'class="active"':''}>${t.about}</a>
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
          <li><a href="${p(depth,'auth/member-login.html')}">${t.login}</a></li>
          <li><a href="${p(depth,'auth/staff-login.html')}">${L?'Acceso Personal / Admin':'Staff / Admin'}</a></li>
        </ul>
      </div>
      <div>
        <h4>${t.engage}</h4>
        <ul>
          <li><a href="${p(depth,'events/index.html')}">${t.events}</a></li>
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
          <li><a href="${p(depth,'community/history.html')}">${L?'Historia':'Our History'}</a></li>
          <li><a href="${p(depth,'contact.html')}">${t.contact}</a></li>
          <li><a href="${p(depth,'accessibility.html')}">${t.access}</a></li>
          <li><a href="${p(depth,'privacy.html')}">${t.privacy}</a></li>
        </ul>
      </div>
    </div>
    <div class="site-footer__bottom">
      <div>© 2026 West Valley · Warner Center Chamber of Commerce. All rights reserved.</div>
      <div>Built &amp; hosted by <a href="https://heedbusinesssolutions.com" style="color:var(--gold-bright)">Heed Business Solutions</a></div>
    </div>
  </div>
</footer>`;
  }

  // ElevenLabs ConvAI agent — one agent serves the whole public site, all
  // languages. Skipped on /admin/ and /auth/ pages. (Pulled from the POC.)
  var ELEVENLABS_AGENT_ID = 'agent_8201kqnjhzyrfpdvtqwgf9e0034y';
  function mountElevenLabs() {
    if (/\/(admin|auth)\//.test(window.location.pathname)) return;
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
    mountElevenLabs();
    mountAccessibility(depth);
  }

  return { mount };
})();
