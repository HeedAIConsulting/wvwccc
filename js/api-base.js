/* API origin resolver — same-origin in production, localhost in dev.
   When the backend is split onto its own Render service, set RENDER_API_BASE. */
window.ChamberAPI = (function () {
  const RENDER_API_BASE = ''; // e.g. 'https://wvwccc-web.onrender.com'

  /* ── Cloudflare Turnstile ──────────────────────────────────────────────
     SITE key only (public — safe in client code). The matching SECRET lives
     in TURNSTILE_SECRET on the Render service; the server skips verification
     entirely while that secret is unset, so BOTH halves must be set for the
     captcha to actually enforce.

     Paste the site key from the Cloudflare dashboard (Turnstile → the
     woodlandhillscc.net widget) between the quotes. Every form that calls
     ChamberAPI.mountTurnstile() picks it up automatically — no other edit.

     Cloudflare's test keys, for local checks (never deploy these):
       always passes  1x00000000000000000000AA
       always blocks  2x00000000000000000000AB                                */
  const TURNSTILE_SITE_KEY = '';

  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const base = RENDER_API_BASE && !isLocal ? RENDER_API_BASE : '';

  function loadTurnstileScript() {
    if (document.getElementById('cf-turnstile-script')) return;
    const s = document.createElement('script');
    s.id = 'cf-turnstile-script';
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  /* Add the captcha to a form. No-op until the site key above is set, so this
     is safe to call unconditionally from every form.

     `anchor` — insert the widget immediately before this element. Pass it when
     the form is multi-step: the default (the first submit button) can land the
     widget inside a step that is still hidden, and a widget in a display:none
     container never renders, so the visitor can never produce a token. */
  function mountTurnstile(form, anchor) {
    if (!TURNSTILE_SITE_KEY || !form || form.querySelector('[data-turnstile]')) return null;
    const div = document.createElement('div');
    div.setAttribute('data-turnstile', '');
    div.style.margin = '16px 0';

    const target = anchor || form.querySelector('button[type="submit"]');
    // insertAdjacentElement works at any depth; form.insertBefore() throws when
    // the button is nested inside a wrapper div rather than a direct child.
    if (target && form.contains(target)) target.insertAdjacentElement('beforebegin', div);
    else form.appendChild(div);

    if (window.turnstile && window.turnstile.render) {
      // Script already executed — implicit rendering has been and gone, so this
      // widget only appears if we render it ourselves.
      try { window.turnstile.render(div, { sitekey: TURNSTILE_SITE_KEY }); } catch (e) { /* noop */ }
    } else {
      // Script not loaded yet — tag it and let implicit rendering pick it up.
      div.className = 'cf-turnstile';
      div.setAttribute('data-sitekey', TURNSTILE_SITE_KEY);
      loadTurnstileScript();
    }
    return div;
  }

  // Current token, for handlers that build a JSON payload by hand rather than
  // posting FormData. Empty string when the captcha is off or unsolved.
  function turnstileToken(form) {
    const el = form && form.querySelector('[name="cf-turnstile-response"]');
    return (el && el.value) || '';
  }

  /* Turnstile tokens are SINGLE USE. Any rejected submit — including a plain
     server-side field error — burns the token, and resubmitting with the spent
     one fails as timeout-or-duplicate. Call this on every failure path or the
     visitor gets stuck on "complete the human-verification check" forever. */
  function resetTurnstile(form) {
    const div = form && form.querySelector('[data-turnstile]');
    if (!div || !window.turnstile || !window.turnstile.reset) return;
    try { window.turnstile.reset(div); } catch (e) { /* noop */ }
  }

  return {
    url: (path) => base + path,
    turnstileSiteKey: TURNSTILE_SITE_KEY,
    mountTurnstile, turnstileToken, resetTurnstile,
  };
})();
