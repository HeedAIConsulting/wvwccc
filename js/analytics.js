/* ============================================================
   Analytics — Google Analytics 4 + Microsoft Clarity
   West Valley · Warner Center Chamber of Commerce

   Loaded two ways, deliberately:
     • partials.js injects it on every page that mounts the shared
       header/footer (the bulk of the public site), and
     • the standalone pages that render their own chrome — the gala
       program, newsletter issues — load it with a plain <script> tag.
   Keeping it in one file means the measurement IDs live in exactly one
   place instead of being pasted into every standalone page.
   ============================================================ */
(function () {
  // Staff traffic would skew the chamber's numbers, so the console and the
  // login screens are never measured.
  if (/\/(admin|auth)\//.test(window.location.pathname)) return;
  // Belt and braces: a page that both mounts partials AND hard-codes the tag
  // must still only fire once.
  if (window.__wvAnalytics) return;
  window.__wvAnalytics = true;

  var GA4_ID = 'G-C1Z35QB9J5';      // account 403015071 → property 547909106
  var CLARITY_ID = 'xuqbfchhh2';    // Clarity project "West Valley Warner Center Chamber"

  // GA4. Queue 'js' + 'config' BEFORE gtag.js lands so the first page_view of
  // the session isn't dropped while the library is still in flight.
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID);
  var g = document.createElement('script');
  g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  g.async = true;
  document.head.appendChild(g);

  // Microsoft Clarity — heatmaps + session replay. Vendor snippet kept verbatim
  // so it stays trivial to diff against the one in the Clarity dashboard.
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_ID);
})();
