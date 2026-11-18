/* Shared by Admin → Groups, Admin → Events and the leader's own pages
   (Michael, Nov 17 2026). Two things the office and group leaders both need:

   WVRecur  — "If it's the first Wednesday of the month, they need to be able
              to select that as an option with a popup calendar and visible
              options." Big plain buttons for how often, which week and which
              day, and a month calendar that shows every date it will create.
              A date can be clicked off (a holiday) and back on.
   WVPeople — "We need to be able to add people to the groups by name, not
              just company." Every directory listing is split into the people
              on it: the contact, and each person under "Meet the team".

   No dependencies. Both pages load this before their own script. */
(function () {
  const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const NTH = ['first', 'second', 'third', 'fourth', 'last'];
  const NTH_BTN = ['1st', '2nd', '3rd', '4th', 'Last'];
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MAX_DATES = 24; // what one save creates; the leader route caps here too

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const d = /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? new Date(s + 'T12:00:00') : null; return d && !isNaN(d) ? d : null; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => { const t = new Date(); t.setHours(12, 0, 0, 0); return t; };

  // The nth weekday of a month; nth 5 means the last one. null when a month
  // has no such day (never for 1-4 or last).
  function nthWeekdayOf(year, month, weekday, nth) {
    if (nth >= 5) {
      const last = new Date(year, month + 1, 0, 12);
      return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7), 12);
    }
    const first = new Date(year, month, 1, 12);
    const day = 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7;
    return day > new Date(year, month + 1, 0).getDate() ? null : new Date(year, month, day, 12);
  }
  // The pattern a date sits on: its weekday, and which week. The 4th of a
  // month that has no 5th is offered as "Last", because that is how people
  // say it ("the last Thursday"); a 5th always is.
  function patternOf(dstr) {
    const d = parse(dstr); if (!d) return null;
    let nth = Math.ceil(d.getDate() / 7);
    const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (nth >= 5 || (nth === 4 && d.getDate() + 7 > dim)) nth = 5;
    return { weekday: d.getDay(), nth };
  }
  /* The dates a choice creates, from the start date on (the start itself only
     when it fits the pattern). how: once | weekly | biweekly | monthly. */
  function datesFor({ start, how, weekday, nth, months }) {
    const s = parse(start) || today();
    if (how === 'once') return parse(start) ? [iso(s)] : [];
    const n = months || 6;
    const out = [];
    if (how === 'weekly' || how === 'biweekly') {
      // Every week (or other week) for n months; the day n months on is not included.
      const end = new Date(s); end.setMonth(end.getMonth() + n);
      const d = new Date(s); d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
      while (d < end && out.length < MAX_DATES) { out.push(iso(d)); d.setDate(d.getDate() + (how === 'biweekly' ? 14 : 7)); }
      return out;
    }
    // Once a month for "6 months" is six meetings, from the first one on or
    // after the start — so starting on the 3rd does not lose a month.
    for (let i = 0; out.length < Math.min(n, MAX_DATES) && i < n + 2; i++) {
      const d = nthWeekdayOf(s.getFullYear(), s.getMonth() + i, weekday, nth);
      if (d && d >= s) out.push(iso(d));
    }
    return out;
  }
  function describe({ how, weekday, nth }) {
    if (how === 'weekly') return `every ${WD[weekday]}`;
    if (how === 'biweekly') return `every other ${WD[weekday]}`;
    if (how === 'monthly') return `the ${NTH[nth - 1]} ${WD[weekday]} of every month`;
    return 'one date';
  }
  const longDate = (s) => { const d = parse(s); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : s; };

  let styled = false;
  function addStyles() {
    if (styled) return; styled = true;
    const st = document.createElement('style');
    st.textContent = `
      .wvr{margin-top:6px}
      .wvr-q{font-weight:700;margin:14px 0 6px;font-size:1rem}
      .wvr-opts{display:flex;flex-wrap:wrap;gap:8px}
      .wvr-opt{font:inherit;font-size:1rem;padding:10px 16px;border-radius:10px;border:2px solid #cfc6ad;background:#fff;color:#1d2a20;cursor:pointer;min-width:64px}
      .wvr-opt:hover{border-color:#1E5631}
      .wvr-opt[aria-pressed="true"]{background:#1E5631;border-color:#1E5631;color:#fff}
      .wvr-say{margin:14px 0 8px;padding:10px 12px;border-radius:10px;background:#eef5ee;color:#143C20;font-size:1rem}
      .wvr-cal{display:flex;flex-wrap:wrap;gap:14px}
      .wvr-month{border:1px solid #e3dcc6;border-radius:10px;padding:8px;background:#fff;min-width:208px}
      .wvr-month h5{margin:0 0 6px;font-size:.95rem;text-align:center}
      .wvr-grid{display:grid;grid-template-columns:repeat(7,28px);gap:2px;justify-content:center}
      .wvr-grid span,.wvr-grid button{width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:.8rem;border-radius:50%;border:0;background:none;padding:0;color:#555;font:inherit;font-size:.8rem}
      .wvr-grid .h{font-weight:700;color:#888;font-size:.7rem}
      .wvr-grid button{cursor:pointer;background:#1E5631;color:#fff;font-weight:700}
      .wvr-grid button.off{background:#fff;color:#999;text-decoration:line-through;border:1px dashed #bbb}
      .wvr-note{font-size:.88rem;color:#5b6157;margin:8px 0 0}
      .wv-tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:10px;margin:18px 0 6px}
      .wv-tabs button{font:inherit;font-size:1rem;font-weight:700;display:flex;flex-direction:column;align-items:center;gap:4px;padding:14px 8px;border-radius:12px;border:2px solid #e6dcc0;background:#fff;color:#143C20;cursor:pointer;position:relative}
      .wv-tabs button span.i{font-size:1.7rem;line-height:1}
      .wv-tabs button:hover{border-color:#1E5631}
      .wv-tabs button[aria-pressed="true"]{background:#1E5631;border-color:#1E5631;color:#fff}
      .wv-tabs .dot{position:absolute;top:6px;right:8px;background:#b8893c;color:#fff;border-radius:999px;font-size:.72rem;padding:1px 7px}
      .wv-mail{border:1px solid #ddd;border-radius:12px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.05)}
      .wv-mail__row{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid #eee;flex-wrap:wrap}
      .wv-mail__row>label{width:70px;flex:none;color:#666;font-weight:600;margin:0}
      .wv-mail__row input,.wv-mail__row select{flex:1;min-width:180px;border:0;font:inherit;font-size:1rem;padding:6px 0;background:transparent;outline:none;box-shadow:none}
      .wv-mail__body{width:100%;min-height:240px;border:0;padding:14px;font:inherit;font-size:1rem;line-height:1.55;resize:vertical;outline:none;box-sizing:border-box;border-radius:0}
      .wv-mail__foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;border-top:1px solid #eee;background:#fffdf8;border-radius:0 0 12px 12px}`;
    document.head.appendChild(st);
  }

  /* Mount the picker in `host`. `dateInput` is the form's own first-date box
     (an <input type="date">, which opens the browser's pop-up calendar). */
  function mount(host, opts = {}) {
    addStyles();
    const dateInput = opts.dateInput || null;
    const st = { how: opts.how || 'once', weekday: null, nth: null, months: 6, off: new Set() };
    const syncFromDate = () => {
      const p = patternOf(dateInput && dateInput.value);
      if (p) { st.weekday = p.weekday; st.nth = p.nth; }
      if (st.weekday == null) { const t = today(); st.weekday = t.getDay(); st.nth = patternOf(iso(t)).nth; }
    };
    syncFromDate();
    const btn = (attr, val, label, on) => `<button type="button" class="wvr-opt" ${attr}="${val}" aria-pressed="${on ? 'true' : 'false'}">${label}</button>`;
    function all() { return datesFor({ start: dateInput && dateInput.value, how: st.how, weekday: st.weekday, nth: st.nth, months: st.months }); }
    function render() {
      const repeating = st.how !== 'once';
      const dates = repeating ? all() : [];
      const kept = dates.filter((d) => !st.off.has(d));
      // Month grids for every month the dates touch.
      let cal = '';
      if (repeating && dates.length) {
        const first = parse(dates[0]); const last = parse(dates[dates.length - 1]);
        const set = new Set(dates);
        for (let y = first.getFullYear(), m = first.getMonth(); y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth()); m === 11 ? (y++, m = 0) : m++) {
          const lead = new Date(y, m, 1).getDay(); const dim = new Date(y, m + 1, 0).getDate();
          let cells = WD3.map((w) => `<span class="h">${w.slice(0, 2)}</span>`).join('') + '<span></span>'.repeat(lead);
          for (let d = 1; d <= dim; d++) {
            const s = `${y}-${pad(m + 1)}-${pad(d)}`;
            cells += set.has(s)
              ? `<button type="button" data-day="${s}" class="${st.off.has(s) ? 'off' : ''}" title="${st.off.has(s) ? 'Skipped — click to put it back' : 'Click to skip this date'}">${d}</button>`
              : `<span>${d}</span>`;
          }
          cal += `<div class="wvr-month"><h5>${MON[m]} ${y}</h5><div class="wvr-grid">${cells}</div></div>`;
        }
      }
      host.innerHTML = `<div class="wvr">
        <div class="wvr-q">How often?</div>
        <div class="wvr-opts" data-g="how">
          ${btn('data-how', 'once', 'Just once', st.how === 'once')}
          ${btn('data-how', 'weekly', 'Every week', st.how === 'weekly')}
          ${btn('data-how', 'biweekly', 'Every other week', st.how === 'biweekly')}
          ${btn('data-how', 'monthly', 'Once a month', st.how === 'monthly')}
        </div>
        ${st.how === 'monthly' ? `<div class="wvr-q">Which week of the month?</div>
        <div class="wvr-opts">${NTH_BTN.map((l, i) => btn('data-nth', i + 1, l, st.nth === i + 1)).join('')}</div>` : ''}
        ${repeating ? `<div class="wvr-q">Which day?</div>
        <div class="wvr-opts">${WD3.map((l, i) => btn('data-wd', i, l, st.weekday === i)).join('')}</div>
        <div class="wvr-q">For how long?</div>
        <div class="wvr-opts">${[3, 6, 12].map((n) => btn('data-months', n, `${n} months`, st.months === n)).join('')}</div>
        <div class="wvr-say" aria-live="polite">${kept.length
          ? `Meets <strong>${esc(describe(st))}</strong>. <strong>${kept.length} date${kept.length === 1 ? '' : 's'}</strong>, ${esc(longDate(kept[0]))} to ${esc(longDate(kept[kept.length - 1]))}.`
          : 'No dates yet. Pick the first date above, or change the choices.'}</div>
        <div class="wvr-cal">${cal}</div>
        <p class="wvr-note">Each green date is added to the calendar. Click a date to skip it (a holiday), and click again to put it back.${dates.length >= MAX_DATES ? ` Up to ${MAX_DATES} dates are added at a time.` : ''}</p>` : ''}
      </div>`;
      host.querySelectorAll('[data-how]').forEach((b) => b.addEventListener('click', () => { st.how = b.dataset.how; st.off.clear(); render(); fire(); }));
      host.querySelectorAll('[data-nth]').forEach((b) => b.addEventListener('click', () => { st.nth = +b.dataset.nth; st.off.clear(); render(); fire(); }));
      host.querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => { st.weekday = +b.dataset.wd; st.off.clear(); render(); fire(); }));
      host.querySelectorAll('[data-months]').forEach((b) => b.addEventListener('click', () => { st.months = +b.dataset.months; render(); fire(); }));
      host.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
        const s = b.dataset.day; st.off.has(s) ? st.off.delete(s) : st.off.add(s); render(); fire();
      }));
    }
    const fire = () => { if (typeof opts.onChange === 'function') opts.onChange(); };
    if (dateInput) dateInput.addEventListener('change', () => { syncFromDate(); st.off.clear(); render(); });
    render();
    return {
      // Every date to create, oldest first. Just once → the date box alone.
      getDates() {
        if (st.how === 'once') { const d = parse(dateInput && dateInput.value); return d ? [iso(d)] : []; }
        return all().filter((d) => !st.off.has(d));
      },
      repeating: () => st.how !== 'once',
      describe: () => describe(st),
      set(o) { Object.assign(st, o || {}); st.off.clear(); render(); },
      reset() { st.how = 'once'; st.off.clear(); syncFromDate(); render(); },
    };
  }

  /* ── People in the directory ─────────────────────────────────────────── */
  // One entry per person a listing names, then the business itself, so a
  // group can hold "Jane Doe · Acme" rather than just "Acme".
  function peopleOf(dir) {
    const out = [];
    for (const m of dir || []) {
      const seen = new Set();
      const add = (person, title) => {
        const k = String(person || '').trim().toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        out.push({ memberId: m.id, person: String(person).trim(), title: title || '', business: m.name || '', category: m.category || '', neighborhood: m.neighborhood || '' });
      };
      add(m.contactName, '');
      for (const t of (Array.isArray(m.team) ? m.team : [])) add(t && t.name, t && t.title);
      out.push({ memberId: m.id, person: '', title: '', business: m.name || '', category: m.category || '', neighborhood: m.neighborhood || '' });
    }
    return out;
  }
  // Best first: a person whose first or last name starts with what was typed,
  // then any person containing it, then businesses, then category or area.
  function searchPeople(dir, q, limit = 10) {
    const s = String(q || '').trim().toLowerCase();
    if (s.length < 2) return [];
    const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
    const score = (p) => {
      const person = p.person.toLowerCase();
      if (person && (person.startsWith(s) || words(person).some((w) => w.startsWith(s)))) return 5;
      if (person && person.includes(s)) return 4;
      if (!p.person && p.business.toLowerCase().includes(s)) return 3;
      if (p.person && p.business.toLowerCase().includes(s)) return 2;
      if (!p.person && `${p.category} ${p.neighborhood}`.toLowerCase().includes(s)) return 1;
      return 0;
    };
    return peopleOf(dir).map((p) => [p, score(p)]).filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || (a[0].person || a[0].business).localeCompare(b[0].person || b[0].business))
      .slice(0, limit).map(([p]) => p);
  }
  // The roster row a pick becomes.
  const rowFor = (p) => ({ memberId: p.memberId, name: p.person || p.business, business: p.person ? p.business : (p.category || '') });
  // Already on the roster: the same listing under the same name.
  const onRoster = (members, p) => (members || []).some((m) => m.memberId === p.memberId
    && String(m.name || '').trim().toLowerCase() === String(p.person || p.business).trim().toLowerCase());
  const suggestionHtml = (p) => p.person
    ? `<b>${esc(p.person)}</b><span>${p.title ? esc(p.title) + ' · ' : ''}${esc(p.business)}</span>`
    : `<b>${esc(p.business)}</b><span>The business${p.category ? ' · ' + esc(p.category) : ''}</span>`;

  if (document.head) addStyles();
  window.WVRecur = { mount, datesFor, patternOf, nthWeekdayOf, describe, MAX_DATES };
  window.WVPeople = { peopleOf, searchPeople, rowFor, onRoster, suggestionHtml };
})();
