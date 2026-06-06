/* ============================================================
   WVWCCC — Inquiry forms (Formspree + admin dual-delivery)
   Each inquiry type submits to its own Formspree form AND logs to
   /api/contact (admin Inquiries panel).
   ============================================================ */
window.ChamberForms = (function () {
  // Separate Formspree forms per inquiry type, deployed via the Formspree CLI
  // (project forms). They submit to the project endpoint /p/{project}/f/{key}.
  // 'general' uses the standalone form. (Public IDs — not secrets.)
  var FORMSPREE_PROJECT = '3015387617890926306';
  var FORM_KEY = { membership: 'membership', sponsorship: 'sponsorship', events: 'events', press: 'press' };
  var GENERAL_FORM = 'mojbggnq';

  var TYPES = {
    membership:  { title: 'Membership Inquiry',        blurb: 'Tell us about your business and we’ll be in touch about joining.' },
    sponsorship: { title: 'Sponsorship & Advertising', blurb: 'Sponsor an event or advertise to the West Valley — let’s talk options.' },
    events:      { title: 'Events & Venue',            blurb: 'Questions about an event, tickets, hosting a mixer, or a ribbon cutting.' },
    press:       { title: 'Press & Partnerships',      blurb: 'Media, community partners, and business-development inquiries.' },
    general:     { title: 'General Inquiry',           blurb: 'How can the Chamber help?' },
  };

  function fsEndpoint(type) {
    return FORM_KEY[type]
      ? 'https://formspree.io/p/' + FORMSPREE_PROJECT + '/f/' + FORM_KEY[type]
      : 'https://formspree.io/f/' + GENERAL_FORM;
  }

  async function submitDual(type, data) {
    var meta = TYPES[type] || TYPES.general;
    // 1) Formspree (browser-origin AJAX → emails the Chamber)
    var fs = fetch(fsEndpoint(type), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(Object.assign({ _subject: meta.title + ' — WVWCCC' }, data)),
    });
    // 2) our admin Inquiries log (durable, Postgres)
    var api = fetch((window.ChamberAPI ? ChamberAPI.url('') : '') + '/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ kind: 'inquiry', reason: meta.title }, data)),
    });
    var results = await Promise.allSettled([fs, api]);
    var fsOk = results[0].status === 'fulfilled' && results[0].value.ok;
    var apiOk = results[1].status === 'fulfilled' && results[1].value.ok;
    // success if EITHER channel accepted — the inquiry is captured (email and/or admin log)
    return fsOk || apiOk;
  }

  // Cloudflare Turnstile — auto-added to a form when a site key is configured.
  // The widget injects a hidden `cf-turnstile-response` input that FormData picks
  // up automatically, so no submit-handler change is needed.
  function mountTurnstile(form) {
    var key = window.ChamberAPI && ChamberAPI.turnstileSiteKey;
    if (!key || !form || form.querySelector('.cf-turnstile')) return;
    if (!document.getElementById('cf-turnstile-script')) {
      var s = document.createElement('script');
      s.id = 'cf-turnstile-script';
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    var div = document.createElement('div');
    div.className = 'cf-turnstile';
    div.setAttribute('data-sitekey', key);
    div.style.margin = '16px 0';
    var btn = form.querySelector('button[type="submit"]');
    if (btn) form.insertBefore(div, btn); else form.appendChild(div);
  }

  function initInquiry() {
    var params = new URLSearchParams(location.search);
    var type = TYPES[params.get('type')] ? params.get('type') : 'general';
    var form = document.getElementById('inquiryForm');
    mountTurnstile(form);
    var msg = document.getElementById('inquiryMsg');
    var sel = form.querySelector('[name="type"]');
    if (sel) sel.value = type;
    var titleEl = document.getElementById('inquiryTitle');
    var blurbEl = document.getElementById('inquiryBlurb');
    function syncMeta() {
      var t = sel ? sel.value : type;
      if (titleEl) titleEl.textContent = TYPES[t].title;
      if (blurbEl) blurbEl.textContent = TYPES[t].blurb;
    }
    if (sel) sel.addEventListener('change', syncMeta);
    syncMeta();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (form.querySelector('[name="_gotcha"]') && form.querySelector('[name="_gotcha"]').value) return; // honeypot
      if (!form.reportValidity()) return;
      var fd = new FormData(form);
      var data = {};
      fd.forEach(function (v, k) { if (k !== '_gotcha') data[k] = v; });
      var t = data.type || type;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sending…';
      var ok = await submitDual(t, data);
      msg.hidden = false;
      if (ok) {
        form.hidden = true;
        msg.style.borderColor = 'var(--green)';
        msg.innerHTML = '<strong>Thank you!</strong> Your ' + (TYPES[t].title.toLowerCase()) + ' has been sent — the Chamber will be in touch.';
      } else {
        msg.style.borderColor = 'var(--red)';
        msg.textContent = 'Sorry, that didn’t go through. Please call the Chamber at (818) 347-4737.';
        btn.disabled = false; btn.textContent = 'Send inquiry';
      }
    });
  }

  return { initInquiry, fsEndpoint, TYPES, mountTurnstile };
})();
