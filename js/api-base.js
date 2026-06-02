/* API origin resolver — same-origin in production, localhost in dev.
   When the backend is split onto its own Render service, set RENDER_API_BASE. */
window.ChamberAPI = (function () {
  const RENDER_API_BASE = ''; // e.g. 'https://wvwccc-production.onrender.com'
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  const base = RENDER_API_BASE && !isLocal ? RENDER_API_BASE : '';
  return { url: (path) => base + path };
})();
