/* ============================================================
   WVWCCC — Launch welcome + guided tour (self-contained)
   Public homepage: a dismissible "Welcome to our new website" card
   under the hero, offering an optional spotlight tour.
   Member portal: a first-login welcome modal offering a tour of
   the dashboard. Injects its own CSS; brand green → gold.

   Pages opt in:  WVTour.boot('home')  |  WVTour.boot('member')
   Replay anywhere:  WVTour.start('home') / WVTour.startWelcome('home')
   No external dependencies. Steps with a missing target are skipped.
   ============================================================ */
window.WVTour = (function () {
  'use strict';
  if (window.__wvTour) return window.__wvTour;

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };
  function seen(key) { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } }
  function mark(key) { try { localStorage.setItem(key, '1'); } catch (e) {} }

  // ── Tour definitions ────────────────────────────────────────
  // Each step: a CSS selector (first match wins; comma = fallbacks),
  // a title and a short body. Missing targets are skipped at runtime.
  var TOURS = {
    home: [
      { sel: '.nav a[href$="/members/directory.html"]', title: 'Find a business 🔎',
        text: 'Browse our member directory — search by name, category, or neighborhood to find trusted local businesses.' },
      { sel: '.nav a[href$="/events/index.html"]', title: 'Events & tickets 🎟️',
        text: 'See what’s coming up — mixers, ribbon cuttings, and workshops — and grab tickets right here.' },
      { sel: '.nav a[href$="/help.html"]', title: 'Help & FAQ 💬',
        text: 'New here? The Help page answers the most common questions for visitors and members alike.' },
      { sel: '.nav-cta, .nav a[href$="/join.html"]', title: 'Join the Chamber 🌿',
        text: 'Ready to grow your business with us? Becoming a member takes just a few minutes.' },
      { sel: 'a[href="/auth/login.html"]', title: 'Member sign-in 🔑',
        text: 'Already a member? Sign in to manage your listing. Had an account on the old site? Use your same email — you’ll be asked to set a new password.' },
    ],
    member: [
      { sel: '#memberBody a[href="profile.html"]', title: 'Edit your listing ✏️',
        text: 'Keep your business info, logo, photos, hours, and links up to date — this is what the public sees in the directory.' },
      { sel: '#memberBody a[href="post.html"]', title: 'Post offers & news 📣',
        text: 'Share a member deal or a community announcement. Posts can appear around the site for extra visibility.' },
      { sel: '#memberBody a[href="account.html"]', title: 'Account & password 🔐',
        text: 'Change your password and manage your account here. We recommend setting a fresh password on your first visit.' },
      { sel: '.wv-sup-btn', title: 'Need a hand? 🛟',
        text: 'The Support button is on every page — send us a note (and a screenshot) and the Chamber team will help.' },
      { sel: '[data-logout]', title: 'Sign out 👋',
        text: 'When you’re done, sign out here. That’s the tour — welcome aboard!' },
    ],
  };

  // ── Styles (injected once) ──────────────────────────────────
  function injectCss() {
    if (document.getElementById('wv-tour-css')) return;
    var st = document.createElement('style'); st.id = 'wv-tour-css';
    st.textContent = ''
      // welcome card (homepage, inline under hero)
      + '.wvt-welcome{position:relative;margin:0 auto;max-width:var(--container,1200px);width:calc(100% - 2*var(--s-4,24px));'
      + 'background:var(--green-ink,#143C20);color:#fff;border:1px solid rgba(201,162,39,.45);border-radius:16px;'
      + 'padding:20px 52px 20px 24px;margin-top:18px;margin-bottom:6px;'
      + 'background-image:radial-gradient(ellipse at 92% 0%,rgba(201,162,39,.22),transparent 60%);'
      + 'box-shadow:0 14px 38px rgba(0,0,0,.16)}'
      + '.wvt-welcome__kicker{font-family:var(--mono,ui-monospace);font-size:.6rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold-bright,#E4BE45)}'
      + '.wvt-welcome h2{font-family:var(--display,Georgia,serif);font-size:1.3rem;color:#fff;margin:6px 0 6px;line-height:1.25}'
      + '.wvt-welcome p{font-size:.92rem;color:rgba(255,255,255,.85);line-height:1.5;margin:0 0 14px;max-width:64ch}'
      + '.wvt-welcome__row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}'
      + '.wvt-welcome__x{position:absolute;top:12px;right:14px;background:none;border:none;color:rgba(255,255,255,.65);font-size:1.4rem;line-height:1;cursor:pointer;padding:4px}'
      + '.wvt-welcome__x:hover{color:#fff}'
      // shared overlay (modal + spotlight)
      + '.wvt-ov{position:fixed;inset:0;z-index:99500;background:rgba(14,42,22,.55);display:flex;align-items:center;justify-content:center;padding:5vh 16px}'
      + '.wvt-modal{background:#fff;color:#16202c;max-width:480px;width:100%;border-radius:18px;box-shadow:0 28px 70px rgba(0,0,0,.34);padding:26px 26px 22px;position:relative;text-align:center;font-family:system-ui,sans-serif}'
      + '.wvt-modal__seal{width:64px;height:64px;border-radius:50%;margin:0 auto 10px;display:block;box-shadow:0 0 0 1px rgba(201,162,39,.5)}'
      + '.wvt-modal h2{font-family:var(--display,Georgia,serif);font-size:1.5rem;color:var(--green-ink,#143C20);margin:0 0 8px}'
      + '.wvt-modal p{font-size:.95rem;color:#42505c;line-height:1.55;margin:0 0 18px}'
      + '.wvt-modal__row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}'
      + '.wvt-modal__x{position:absolute;top:12px;right:14px;background:none;border:none;font-size:1.5rem;line-height:1;cursor:pointer;color:#9aa;padding:4px}'
      // buttons
      + '.wvt-btn{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:10px 18px;font:600 .92rem system-ui;cursor:pointer;border:1.5px solid transparent;text-decoration:none}'
      + '.wvt-btn--gold{background:var(--gold,#C9A227);color:#3a2e05;border-color:var(--gold,#C9A227)}'
      + '.wvt-btn--gold:hover{background:var(--gold-bright,#E4BE45)}'
      + '.wvt-btn--ghost{background:transparent;color:#42505c;border-color:#cdd5dd}'
      + '.wvt-btn--ghost:hover{background:#f1f4f7}'
      + '.wvt-btn--lightghost{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.4)}'
      + '.wvt-btn--lightghost:hover{background:rgba(255,255,255,.16)}'
      // spotlight
      + '.wvt-spot{position:fixed;z-index:99500;border-radius:12px;box-shadow:0 0 0 9999px rgba(14,42,22,.62),0 0 0 3px var(--gold-bright,#E4BE45);'
      + 'pointer-events:none;transition:' + (REDUCED ? 'none' : 'all .28s cubic-bezier(.4,0,.2,1)') + '}'
      + '.wvt-pop{position:fixed;z-index:99501;max-width:330px;width:calc(100vw - 32px);background:#fff;color:#16202c;border-radius:14px;'
      + 'box-shadow:0 22px 56px rgba(0,0,0,.32);padding:18px 18px 14px;font-family:system-ui,sans-serif;'
      + 'transition:' + (REDUCED ? 'none' : 'top .28s ease,left .28s ease') + '}'
      + '.wvt-pop h3{font-size:1.05rem;color:var(--green-ink,#143C20);margin:0 0 6px}'
      + '.wvt-pop p{font-size:.9rem;color:#42505c;line-height:1.5;margin:0 0 14px}'
      + '.wvt-pop__foot{display:flex;align-items:center;justify-content:space-between;gap:10px}'
      + '.wvt-pop__dots{display:flex;gap:6px}'
      + '.wvt-pop__dot{width:7px;height:7px;border-radius:50%;background:#d8dee4}'
      + '.wvt-pop__dot.on{background:var(--gold,#C9A227)}'
      + '.wvt-pop__btns{display:flex;gap:8px}'
      + '.wvt-pop__skip{position:absolute;top:10px;right:12px;background:none;border:none;color:#9aa;font-size:.78rem;cursor:pointer;text-decoration:underline}'
      + '@media(max-width:560px){.wvt-welcome{padding:18px 46px 18px 18px}.wvt-welcome h2{font-size:1.15rem}}';
    document.head.appendChild(st);
  }

  // ── Spotlight tour engine ───────────────────────────────────
  var active = null; // { steps, i, spot, pop, onScroll }

  function endTour() {
    if (!active) return;
    window.removeEventListener('scroll', active.onScroll, true);
    window.removeEventListener('resize', active.onScroll);
    document.removeEventListener('keydown', active.onKey, true);
    if (active.spot) active.spot.remove();
    if (active.pop) active.pop.remove();
    active = null;
  }

  function firstEl(sel) {
    var parts = sel.split(',');
    for (var i = 0; i < parts.length; i++) {
      var el = document.querySelector(parts[i].trim());
      if (el && el.offsetParent !== null) return el; // visible only
    }
    return null;
  }

  function position() {
    if (!active) return;
    var step = active.steps[active.i];
    var el = firstEl(step.sel);
    if (!el) { next(); return; }                  // target vanished → advance
    var r = el.getBoundingClientRect();
    var pad = 6;
    var spot = active.spot;
    spot.style.top = (r.top - pad) + 'px';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
    // place popover below the target if there's room, else above
    var pop = active.pop;
    pop.style.visibility = 'hidden';
    pop.style.top = '0px'; pop.style.left = '0px';
    var pr = pop.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var top = r.bottom + 12;
    if (top + pr.height > vh - 8 && r.top - 12 - pr.height > 8) top = r.top - 12 - pr.height;
    top = Math.max(8, Math.min(top, vh - pr.height - 8));
    var left = r.left + r.width / 2 - pr.width / 2;
    left = Math.max(8, Math.min(left, vw - pr.width - 8));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.visibility = 'visible';
  }

  function render() {
    if (!active) return;
    var step = active.steps[active.i];
    var last = active.i === active.steps.length - 1;
    var dots = active.steps.map(function (_, k) {
      return '<span class="wvt-pop__dot' + (k === active.i ? ' on' : '') + '"></span>';
    }).join('');
    active.pop.innerHTML =
      '<button class="wvt-pop__skip" type="button" data-skip>Skip tour</button>'
      + '<h3>' + esc(step.title) + '</h3>'
      + '<p>' + esc(step.text) + '</p>'
      + '<div class="wvt-pop__foot">'
      + '<div class="wvt-pop__dots">' + dots + '</div>'
      + '<div class="wvt-pop__btns">'
      + (active.i > 0 ? '<button class="wvt-btn wvt-btn--ghost" type="button" data-back>Back</button>' : '')
      + '<button class="wvt-btn wvt-btn--gold" type="button" data-next>' + (last ? 'Done' : 'Next') + '</button>'
      + '</div></div>';
    active.pop.querySelector('[data-skip]').addEventListener('click', endTour);
    active.pop.querySelector('[data-next]').addEventListener('click', last ? endTour : next);
    var b = active.pop.querySelector('[data-back]');
    if (b) b.addEventListener('click', prev);
    var el = firstEl(step.sel);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
    // measure after any smooth scroll settles
    setTimeout(position, REDUCED ? 0 : 280);
    active.pop.querySelector('[data-next]').focus();
  }

  function next() { if (!active) return; if (active.i < active.steps.length - 1) { active.i++; render(); } else endTour(); }
  function prev() { if (!active) return; if (active.i > 0) { active.i--; render(); } }

  function start(name) {
    var def = TOURS[name];
    if (!def) return;
    endTour();
    injectCss();
    // keep only steps whose target exists right now (best-effort; runtime also skips)
    var steps = def.filter(function (s) { return firstEl(s.sel); });
    if (!steps.length) return;
    var spot = document.createElement('div'); spot.className = 'wvt-spot';
    var pop = document.createElement('div'); pop.className = 'wvt-pop';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'true'); pop.setAttribute('aria-live', 'polite');
    document.body.appendChild(spot); document.body.appendChild(pop);
    var onScroll = function () { position(); };
    var onKey = function (e) {
      if (e.key === 'Escape') { endTour(); }
      else if (e.key === 'ArrowRight') { next(); }
      else if (e.key === 'ArrowLeft') { prev(); }
    };
    active = { steps: steps, i: 0, spot: spot, pop: pop, onScroll: onScroll, onKey: onKey };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey, true);
    render();
  }

  // ── Welcome (homepage card) ─────────────────────────────────
  var KEY_HOME = 'wvwccc_welcome_home';
  var KEY_MEMBER = 'wvwccc_welcome_member';

  function startWelcomeHome(force) {
    if (!force && seen(KEY_HOME)) return;
    if (document.querySelector('.wvt-welcome')) return;
    injectCss();
    var card = document.createElement('aside');
    card.className = 'wvt-welcome';
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'Welcome');
    card.innerHTML =
      '<button class="wvt-welcome__x" type="button" aria-label="Dismiss welcome">×</button>'
      + '<span class="wvt-welcome__kicker">🎉 Welcome</span>'
      + '<h2>Welcome to our brand-new website!</h2>'
      + '<p>We’ve rebuilt the Chamber site from the ground up — easier to find businesses, events, and resources. Take a 30-second tour, or dive right in.</p>'
      + '<div class="wvt-welcome__row">'
      + '<button class="wvt-btn wvt-btn--gold" type="button" data-tour>Take a quick tour</button>'
      + '<a class="wvt-btn wvt-btn--lightghost" href="/members/directory.html">Browse the directory →</a>'
      + '</div>';
    var dismiss = function () { mark(KEY_HOME); card.remove(); };
    card.querySelector('.wvt-welcome__x').addEventListener('click', dismiss);
    card.querySelector('[data-tour]').addEventListener('click', function () { dismiss(); start('home'); });
    var hero = document.querySelector('.hero');
    if (hero) hero.insertAdjacentElement('afterend', card);
    else {
      var hdr = document.querySelector('.site-header');
      if (hdr) hdr.insertAdjacentElement('afterend', card); else document.body.insertAdjacentElement('afterbegin', card);
    }
  }

  // ── Welcome (member portal modal) ───────────────────────────
  function startWelcomeMember(force) {
    if (!force && seen(KEY_MEMBER)) return;
    if (document.querySelector('.wvt-ov[data-welcome-member]')) return;
    injectCss();
    var ov = document.createElement('div');
    ov.className = 'wvt-ov'; ov.setAttribute('data-welcome-member', '');
    ov.innerHTML =
      '<div class="wvt-modal" role="dialog" aria-modal="true" aria-label="Welcome to your member dashboard">'
      + '<button class="wvt-modal__x" type="button" aria-label="Close">×</button>'
      + '<img class="wvt-modal__seal" src="/images/wvwccc-logo.png" alt="">'
      + '<h2>Welcome to your new dashboard</h2>'
      + '<p>This is your member home — update your listing, post offers, and manage your account. Want a quick look around?</p>'
      + '<div class="wvt-modal__row">'
      + '<button class="wvt-btn wvt-btn--gold" type="button" data-show>Show me around</button>'
      + '<button class="wvt-btn wvt-btn--ghost" type="button" data-later>Maybe later</button>'
      + '</div></div>';
    var close = function () { mark(KEY_MEMBER); ov.remove(); };
    ov.querySelector('.wvt-modal__x').addEventListener('click', close);
    ov.querySelector('[data-later]').addEventListener('click', close);
    ov.querySelector('[data-show]').addEventListener('click', function () { close(); start('member'); });
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  }

  // Wait until the member dashboard has rendered actionable content, so the
  // tour has real targets, then show the welcome modal. Times out gracefully.
  function whenReady(sel, cb, tries) {
    tries = tries == null ? 24 : tries; // ~6s at 250ms
    if (document.querySelector(sel) || tries <= 0) { cb(); return; }
    setTimeout(function () { whenReady(sel, cb, tries - 1); }, 250);
  }

  function boot(context) {
    if (context === 'home') {
      // let the page settle so the card lands cleanly under the hero
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { startWelcomeHome(false); });
      else startWelcomeHome(false);
    } else if (context === 'member') {
      whenReady('#memberBody a[href="profile.html"], #memberBody .btn', function () { startWelcomeMember(false); });
    }
  }

  window.__wvTour = { boot: boot, start: start, startWelcome: function (n, f) { n === 'member' ? startWelcomeMember(f !== false) : startWelcomeHome(f !== false); }, end: endTour };
  return window.__wvTour;
})();
