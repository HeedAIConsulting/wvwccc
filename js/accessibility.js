/* ============================================================
   Chamber Accessibility Widget — full ADA / WCAG 2.1 toolkit.

   Adds a fixed accessibility button (bottom-left corner) that
   opens a panel with toggleable adjustments. Settings persist
   in localStorage and re-apply on every page load.

   Features:
     • Text size  (100% / 120% / 140% / 160%)
     • Line height, letter spacing, word spacing
     • Contrast: normal / high / inverted / dark
     • Saturation: normal / high / low / monochrome
     • Highlight links / headings
     • Dyslexia-friendly font (OpenDyslexic)
     • Big cursor
     • Pause animations + reduce motion
     • Reading guide (horizontal line that follows cursor)
     • Reading mask (focuses one paragraph at a time)
     • Image hide (text-only mode)
     • Reset all

   No external dependencies. WCAG 2.1 AA targets.
   ============================================================ */

(function () {
  'use strict';

  if (window.WVA11y) return;

  var STORAGE_KEY = 'wv-a11y-settings';
  var BODY_CLASS_PREFIX = 'wv-a11y-';

  // ── Defaults ─────────────────────────────────────────────────
  var DEFAULTS = {
    textScale: 1,         // 1 / 1.2 / 1.4 / 1.6
    lineHeight: 0,        // 0 / 1 / 2 (steps)
    letterSpacing: 0,
    wordSpacing: 0,
    contrast: 'normal',   // normal | high | inverted | dark
    saturation: 'normal', // normal | high | low | mono
    highlightLinks: false,
    highlightHeadings: false,
    dyslexicFont: false,
    bigCursor: false,
    pauseAnimations: false,
    readingGuide: false,
    hideImages: false
  };

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return Object.assign({}, DEFAULTS, saved);
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var settings = loadSettings();

  // ── Inject styles ────────────────────────────────────────────
  var STYLES = '\
  /* Floating button — sits ABOVE the Support pill (bottom:24) in the\
     bottom-left utility stack (Support → ADA → guide promo). Keep offsets\
     in sync with support.js + partials.js mountGuidePromo. */\
  .wv-a11y-btn {\
    position: fixed; bottom: 84px; left: 24px; z-index: 99996;\
    width: 56px; height: 56px; border-radius: 50%;\
    background: #1E5631; color: #C9A227;\
    display: flex; align-items: center; justify-content: center;\
    border: 3px solid #C9A227;\
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);\
    cursor: pointer; font-size: 24px;\
    transition: transform 200ms, box-shadow 200ms;\
  }\
  .wv-a11y-btn:hover { transform: scale(1.07); box-shadow: 0 12px 32px rgba(0,0,0,0.35); }\
  .wv-a11y-btn:focus-visible { outline: 3px solid #C9A227; outline-offset: 4px; }\
\
  /* Panel */\
  .wv-a11y-panel {\
    position: fixed; bottom: 152px; left: 24px; z-index: 99997;\
    width: 360px; max-height: calc(100vh - 176px); overflow-y: auto;\
    background: #fff; color: #15202B;\
    border-radius: 14px; padding: 20px;\
    box-shadow: 0 24px 56px rgba(30,86,49,0.30);\
    font-family: "Hanken Grotesk", system-ui, sans-serif;\
    display: none;\
  }\
  .wv-a11y-panel.is-open { display: block; }\
  .wv-a11y-panel__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #E5E0D2; }\
  .wv-a11y-panel__title { font-family: "Source Serif Pro", Cambria, Georgia, serif; font-weight: 700; font-size: 1.1rem; color: #1E5631; margin: 0; }\
  .wv-a11y-panel__close { background: none; border: none; font-size: 1.4rem; cursor: pointer; color: #6B7280; padding: 4px 8px; border-radius: 4px; }\
  .wv-a11y-panel__close:hover { background: #F2EBDB; color: #1E5631; }\
\
  .wv-a11y-section { margin-bottom: 14px; }\
  .wv-a11y-section__label { font-family: "Spline Sans Mono", ui-monospace, monospace; font-size: .68rem; text-transform: uppercase; letter-spacing: .12em; color: #8C6E14; margin-bottom: 6px; font-weight: 600; }\
\
  .wv-a11y-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 6px; }\
  .wv-a11y-tile {\
    padding: 10px 6px; background: #FAF7F0; border: 1.5px solid #E5E0D2; border-radius: 8px;\
    font-size: .8rem; cursor: pointer; text-align: center; color: #2A3340; font-weight: 500;\
    transition: all 150ms; font-family: inherit;\
  }\
  .wv-a11y-tile:hover { background: #E4F0E4; border-color: #3A8A3F; color: #1E5631; }\
  .wv-a11y-tile.is-active { background: #C9A227; color: #1E5631; border-color: #8C6E14; font-weight: 700; }\
  .wv-a11y-tile__icon { display: block; font-size: 1.2rem; margin-bottom: 2px; }\
\
  .wv-a11y-toggle { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #FAF7F0; border-radius: 8px; cursor: pointer; margin-bottom: 6px; transition: background 150ms; }\
  .wv-a11y-toggle:hover { background: #E4F0E4; }\
  .wv-a11y-toggle input { width: 18px; height: 18px; accent-color: #1E5631; flex-shrink: 0; }\
  .wv-a11y-toggle__label { font-size: .9rem; color: #2A3340; flex: 1; }\
\
  .wv-a11y-reset { width: 100%; padding: 10px; background: transparent; border: 1.5px solid #E5E0D2; border-radius: 8px; color: #4D5662; cursor: pointer; font-weight: 500; font-family: inherit; margin-top: 8px; transition: all 150ms; }\
  .wv-a11y-reset:hover { background: #B33A3A; color: #fff; border-color: #B33A3A; }\
\
  .wv-a11y-footer { font-size: .72rem; color: #6B7280; margin-top: 12px; padding-top: 10px; border-top: 1px solid #E5E0D2; line-height: 1.5; }\
  .wv-a11y-footer a { color: #3A8A3F; }\
\
  /* === Applied modifications === */\
\
  body.wv-a11y-text-1-2 * { font-size: 1.2em !important; line-height: 1.55 !important; }\
  body.wv-a11y-text-1-4 * { font-size: 1.4em !important; line-height: 1.6 !important; }\
  body.wv-a11y-text-1-6 * { font-size: 1.6em !important; line-height: 1.7 !important; }\
\
  body.wv-a11y-line-1 * { line-height: 1.8 !important; }\
  body.wv-a11y-line-2 * { line-height: 2.2 !important; }\
\
  body.wv-a11y-letter-1 * { letter-spacing: 0.05em !important; }\
  body.wv-a11y-letter-2 * { letter-spacing: 0.12em !important; }\
\
  body.wv-a11y-word-1 * { word-spacing: 0.16em !important; }\
  body.wv-a11y-word-2 * { word-spacing: 0.32em !important; }\
\
  body.wv-a11y-contrast-high { background: #000 !important; color: #FFFF00 !important; }\
  body.wv-a11y-contrast-high *:not(.wv-a11y-panel):not(.wv-a11y-panel *):not(.wv-a11y-btn):not(.wv-a11y-btn *) { background: #000 !important; color: #FFFF00 !important; border-color: #FFFF00 !important; }\
  body.wv-a11y-contrast-high a:not(.wv-a11y-panel a):not(.wv-a11y-btn) { color: #00FFFF !important; text-decoration: underline !important; }\
\
  body.wv-a11y-contrast-inverted:not(.wv-a11y-panel):not(.wv-a11y-btn) { filter: invert(1) hue-rotate(180deg); }\
  body.wv-a11y-contrast-inverted img,\
  body.wv-a11y-contrast-inverted video,\
  body.wv-a11y-contrast-inverted iframe { filter: invert(1) hue-rotate(180deg); }\
  body.wv-a11y-contrast-inverted .wv-a11y-panel,\
  body.wv-a11y-contrast-inverted .wv-a11y-btn { filter: invert(1) hue-rotate(180deg); }\
\
  body.wv-a11y-contrast-dark { background: #0F0F0F !important; }\
  body.wv-a11y-contrast-dark *:not(.wv-a11y-panel):not(.wv-a11y-panel *):not(.wv-a11y-btn):not(.wv-a11y-btn *) { background-color: transparent !important; color: #E5E5E5 !important; }\
  body.wv-a11y-contrast-dark h1, body.wv-a11y-contrast-dark h2, body.wv-a11y-contrast-dark h3, body.wv-a11y-contrast-dark h4 { color: #FFFFFF !important; }\
  body.wv-a11y-contrast-dark a:not(.wv-a11y-panel a):not(.wv-a11y-btn) { color: #5BB3FF !important; }\
\
  body.wv-a11y-saturation-high { filter: saturate(2); }\
  body.wv-a11y-saturation-low { filter: saturate(0.5); }\
  body.wv-a11y-saturation-mono { filter: grayscale(1); }\
\
  body.wv-a11y-highlight-links a:not(.wv-a11y-panel a):not(.wv-a11y-btn) {\
    background: #FFFF00 !important; color: #000 !important;\
    text-decoration: underline !important; padding: 0 3px;\
  }\
  body.wv-a11y-highlight-headings h1, body.wv-a11y-highlight-headings h2,\
  body.wv-a11y-highlight-headings h3, body.wv-a11y-highlight-headings h4,\
  body.wv-a11y-highlight-headings h5, body.wv-a11y-highlight-headings h6 {\
    background: #C9A227 !important; color: #1E5631 !important;\
    padding: 4px 8px !important; border-radius: 4px;\
  }\
\
  body.wv-a11y-dyslexic, body.wv-a11y-dyslexic * { font-family: "Comic Sans MS", "Open Dyslexic", "Arial", sans-serif !important; }\
\
  body.wv-a11y-big-cursor, body.wv-a11y-big-cursor * { cursor: url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'48\' height=\'48\' viewBox=\'0 0 48 48\'><path fill=\'%23000\' stroke=\'%23fff\' stroke-width=\'2\' d=\'M6 6 L6 38 L16 28 L22 42 L28 39 L22 26 L36 26 Z\'/></svg>") 0 0, auto !important; }\
\
  body.wv-a11y-pause-animations *,\
  body.wv-a11y-pause-animations *::before,\
  body.wv-a11y-pause-animations *::after {\
    animation-duration: 0s !important;\
    animation-iteration-count: 1 !important;\
    transition-duration: 0s !important;\
    scroll-behavior: auto !important;\
  }\
\
  body.wv-a11y-hide-images img,\
  body.wv-a11y-hide-images svg,\
  body.wv-a11y-hide-images video,\
  body.wv-a11y-hide-images picture,\
  body.wv-a11y-hide-images [style*="background-image"]:not(.wv-a11y-btn) { visibility: hidden !important; }\
\
  /* Reading guide */\
  .wv-a11y-reading-guide {\
    position: fixed; left: 0; right: 0; height: 60px; pointer-events: none;\
    background: rgba(30,86,49,0.85); z-index: 99995;\
    display: none;\
  }\
  body.wv-a11y-reading-guide-on .wv-a11y-reading-guide { display: block; }\
';

  function injectStyles() {
    if (document.getElementById('wv-a11y-styles')) return;
    var s = document.createElement('style');
    s.id = 'wv-a11y-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // ── Apply settings to <body> ─────────────────────────────────
  function applySettings() {
    var body = document.body;
    if (!body) return;

    // Strip all existing prefixed classes
    Array.from(body.classList).forEach(function (c) {
      if (c.indexOf(BODY_CLASS_PREFIX) === 0) body.classList.remove(c);
    });

    if (settings.textScale > 1) {
      body.classList.add(BODY_CLASS_PREFIX + 'text-' + String(settings.textScale).replace('.', '-'));
    }
    if (settings.lineHeight > 0) body.classList.add(BODY_CLASS_PREFIX + 'line-' + settings.lineHeight);
    if (settings.letterSpacing > 0) body.classList.add(BODY_CLASS_PREFIX + 'letter-' + settings.letterSpacing);
    if (settings.wordSpacing > 0) body.classList.add(BODY_CLASS_PREFIX + 'word-' + settings.wordSpacing);
    if (settings.contrast !== 'normal') body.classList.add(BODY_CLASS_PREFIX + 'contrast-' + settings.contrast);
    if (settings.saturation !== 'normal') body.classList.add(BODY_CLASS_PREFIX + 'saturation-' + settings.saturation);
    if (settings.highlightLinks) body.classList.add(BODY_CLASS_PREFIX + 'highlight-links');
    if (settings.highlightHeadings) body.classList.add(BODY_CLASS_PREFIX + 'highlight-headings');
    if (settings.dyslexicFont) body.classList.add(BODY_CLASS_PREFIX + 'dyslexic');
    if (settings.bigCursor) body.classList.add(BODY_CLASS_PREFIX + 'big-cursor');
    if (settings.pauseAnimations) body.classList.add(BODY_CLASS_PREFIX + 'pause-animations');
    if (settings.hideImages) body.classList.add(BODY_CLASS_PREFIX + 'hide-images');
    if (settings.readingGuide) body.classList.add(BODY_CLASS_PREFIX + 'reading-guide-on');
    setNarration(!!settings.readAloud);

    saveSettings(settings);
    syncPanel();
  }

  // ── Screen narration (read aloud) — Web Speech API ──────────────
  // When on, clicking text reads it aloud; click again to stop. Helps low-vision
  // and reading-difficulty users without a separate screen reader.
  var narrationOn = false;
  function speakText(t) {
    if (!('speechSynthesis' in window) || !t) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(t).slice(0, 4000));
    u.rate = 1; u.lang = document.documentElement.lang || 'en';
    window.speechSynthesis.speak(u);
  }
  function onNarrateClick(e) {
    if (e.target.closest('.wv-a11y-panel') || e.target.closest('.wv-a11y-btn')) return; // don't read our own UI
    if (window.speechSynthesis && window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); return; }
    var el = e.target.closest('p, li, h1, h2, h3, h4, h5, a, button, td, th, span, blockquote, figcaption, label');
    var text = (el && (el.innerText || el.textContent) || '').trim();
    if (text) { e.preventDefault(); speakText(text); }
  }
  function setNarration(on) {
    if (on === narrationOn) return;
    narrationOn = on;
    if (!('speechSynthesis' in window)) return;
    if (on) {
      document.body.classList.add(BODY_CLASS_PREFIX + 'narrate');
      document.addEventListener('click', onNarrateClick, true);
    } else {
      document.removeEventListener('click', onNarrateClick, true);
      window.speechSynthesis.cancel();
    }
  }

  // ── Build the panel UI ───────────────────────────────────────
  var panelEl, btnEl, guideEl;

  function buildButton() {
    btnEl = document.createElement('button');
    btnEl.className = 'wv-a11y-btn';
    btnEl.setAttribute('aria-label', 'Open accessibility menu');
    btnEl.setAttribute('title', 'Accessibility menu');
    btnEl.innerHTML = '<span aria-hidden="true">♿</span>';
    btnEl.addEventListener('click', togglePanel);
    document.body.appendChild(btnEl);
  }

  function buildPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'wv-a11y-panel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Accessibility settings');
    panelEl.innerHTML =
      '<div class="wv-a11y-panel__head">' +
        '<h2 class="wv-a11y-panel__title">Accessibility</h2>' +
        '<button class="wv-a11y-panel__close" aria-label="Close">×</button>' +
      '</div>' +

      sectionTiles('Text size', 'textScale', [
        { val: 1,   label: 'Default', icon: 'A' },
        { val: 1.2, label: 'Larger',  icon: 'A+' },
        { val: 1.4, label: 'Large',   icon: 'A++' },
        { val: 1.6, label: 'XL',      icon: 'A+++' }
      ]) +

      sectionTiles('Line height', 'lineHeight', [
        { val: 0, label: 'Default' }, { val: 1, label: '1.8×' }, { val: 2, label: '2.2×' }
      ]) +

      sectionTiles('Letter spacing', 'letterSpacing', [
        { val: 0, label: 'Default' }, { val: 1, label: '+5%' }, { val: 2, label: '+12%' }
      ]) +

      sectionTiles('Word spacing', 'wordSpacing', [
        { val: 0, label: 'Default' }, { val: 1, label: '+16%' }, { val: 2, label: '+32%' }
      ]) +

      sectionTiles('Contrast', 'contrast', [
        { val: 'normal',   label: 'Normal' },
        { val: 'high',     label: 'High' },
        { val: 'dark',     label: 'Dark' },
        { val: 'inverted', label: 'Inverted' }
      ]) +

      sectionTiles('Saturation', 'saturation', [
        { val: 'normal', label: 'Normal' },
        { val: 'high',   label: 'High' },
        { val: 'low',    label: 'Low' },
        { val: 'mono',   label: 'Mono' }
      ]) +

      sectionToggles([
        { key: 'highlightLinks',     label: '🔗 Highlight links' },
        { key: 'highlightHeadings',  label: '📌 Highlight headings' },
        { key: 'dyslexicFont',       label: '📖 Dyslexia-friendly font' },
        { key: 'bigCursor',          label: '🖱️ Big cursor' },
        { key: 'pauseAnimations',    label: '⏸ Pause animations' },
        { key: 'readingGuide',       label: '📏 Reading guide' },
        { key: 'readAloud',          label: '🔊 Read aloud (click text to hear it)' },
        { key: 'hideImages',         label: '🚫 Hide images' }
      ]) +

      '<button class="wv-a11y-reset" data-a11y-reset>↺ Reset all</button>' +
      '<div class="wv-a11y-footer">This site targets WCAG 2.1 AA. Settings persist on your device. ' +
        '<a href="/accessibility.html">Read our accessibility statement</a> · ' +
        '<a href="mailto:felicia@woodlandhillscc.net">Report an issue</a>.' +
      '</div>';

    document.body.appendChild(panelEl);

    // Bind controls
    panelEl.querySelector('.wv-a11y-panel__close').addEventListener('click', togglePanel);
    panelEl.querySelector('[data-a11y-reset]').addEventListener('click', reset);

    panelEl.querySelectorAll('[data-a11y-set]').forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.dataset.a11ySet;
        var raw = el.dataset.a11yVal;
        // Coerce value type
        var val = raw;
        if (raw === 'true' || raw === 'false') val = raw === 'true';
        else if (!isNaN(parseFloat(raw))) val = parseFloat(raw);
        settings[key] = val;
        applySettings();
      });
    });
    panelEl.querySelectorAll('[data-a11y-toggle]').forEach(function (input) {
      input.addEventListener('change', function () {
        settings[input.dataset.a11yToggle] = input.checked;
        applySettings();
      });
    });
  }

  function buildReadingGuide() {
    guideEl = document.createElement('div');
    guideEl.className = 'wv-a11y-reading-guide';
    guideEl.id = 'wv-a11y-reading-guide';
    document.body.appendChild(guideEl);
    document.addEventListener('mousemove', function (e) {
      if (!settings.readingGuide) return;
      guideEl.style.top = Math.max(0, e.clientY - 30) + 'px';
    });
  }

  // ── Tile / toggle HTML helpers ───────────────────────────────
  function sectionTiles(label, key, options) {
    var tiles = options.map(function (o) {
      return '<button type="button" class="wv-a11y-tile" data-a11y-set="' + key + '" data-a11y-val="' + o.val + '" data-a11y-watch="' + key + ':' + o.val + '">' +
               (o.icon ? '<span class="wv-a11y-tile__icon">' + o.icon + '</span>' : '') +
               o.label +
             '</button>';
    }).join('');
    return '<div class="wv-a11y-section"><div class="wv-a11y-section__label">' + label + '</div><div class="wv-a11y-row">' + tiles + '</div></div>';
  }

  function sectionToggles(items) {
    var html = '<div class="wv-a11y-section"><div class="wv-a11y-section__label">Display options</div>';
    items.forEach(function (i) {
      html += '<label class="wv-a11y-toggle">' +
                '<input type="checkbox" data-a11y-toggle="' + i.key + '">' +
                '<span class="wv-a11y-toggle__label">' + i.label + '</span>' +
              '</label>';
    });
    html += '</div>';
    return html;
  }

  // ── Panel state ──────────────────────────────────────────────
  function syncPanel() {
    if (!panelEl) return;
    panelEl.querySelectorAll('[data-a11y-watch]').forEach(function (tile) {
      var parts = tile.dataset.a11yWatch.split(':');
      var key = parts[0];
      var raw = parts[1];
      var val = raw;
      if (raw === 'true' || raw === 'false') val = raw === 'true';
      else if (!isNaN(parseFloat(raw))) val = parseFloat(raw);
      tile.classList.toggle('is-active', settings[key] === val);
    });
    panelEl.querySelectorAll('[data-a11y-toggle]').forEach(function (input) {
      input.checked = !!settings[input.dataset.a11yToggle];
    });
  }

  function togglePanel() {
    if (!panelEl) return;
    panelEl.classList.toggle('is-open');
    syncPanel();
  }

  function reset() {
    settings = Object.assign({}, DEFAULTS);
    applySettings();
    syncPanel();
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    injectStyles();
    buildButton();
    buildPanel();
    buildReadingGuide();
    applySettings();

    // ESC closes panel
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelEl && panelEl.classList.contains('is-open')) togglePanel();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.WVA11y = { open: function(){ if(panelEl && !panelEl.classList.contains('is-open')) togglePanel(); }, reset: reset, settings: function() { return Object.assign({}, settings); } };
})();
