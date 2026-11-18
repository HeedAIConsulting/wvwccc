/* Add-to-calendar links for an event, for emails (Michael, Nov 17 2026:
   "When an event is created, there needs to be an add to calendar button on
   the events and in the email when it goes out").

   Same three choices the event page offers: Google, Outlook, and Apple / the
   .ics file the site already serves at /api/events/<id>.ics. Event times are
   typed by the office in Chamber (Los Angeles) time, so the Google link names
   that zone and the Outlook link carries the matching offset — a member in
   another time zone gets the right hour either way. */

const TZ = 'America/Los_Angeles';
const pad = (n) => String(n).padStart(2, '0');

// Same reading of "6:30 PM" / "18:30" / "noon-ish" as the .ics route and the
// site's own chips (js/chamber.js _parseTime): anything unreadable → null.
export function parseTime(t) {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i.exec(String(t || ''));
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2] || '0', 10);
  const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}

// "-08:00" or "-07:00": Los Angeles' offset from UTC on that day and time.
export function laOffset(dateStr, h = 12, min = 0) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, min);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]));
  const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  const mins = Math.round((shown - asUtc) / 60000);
  const sign = mins < 0 ? '-' : '+';
  return `${sign}${pad(Math.floor(Math.abs(mins) / 60))}:${pad(Math.abs(mins) % 60)}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* { google, outlook, ics, page } for an approved event with a date, else null.
   base is siteBase(req) — never the request's own host. */
export function calendarLinks(ev, base) {
  if (!ev || !/^\d{4}-\d{2}-\d{2}$/.test(String(ev.date || ''))) return null;
  const site = String(base || 'https://woodlandhillscc.net').replace(/\/$/, '');
  const page = `${site}/events/view.html?id=${encodeURIComponent(ev.id)}`;
  const ics = `${site}/api/events/${encodeURIComponent(ev.id)}.ics`;
  const title = ev.title || 'Chamber event';
  const loc = [ev.venue, ev.address].filter(Boolean).join(', ');
  const details = [ev.summary || '', page].filter(Boolean).join('\n\n');
  const d8 = ev.date.replace(/-/g, '');
  const t = parseTime(ev.time);
  let gDates; let oStart; let oEnd; let allDay = '';
  if (t) {
    let e = parseTime(ev.endTime);
    const startMin = t.h * 60 + t.min;
    let endMin = e ? e.h * 60 + e.min : startMin + 120;
    if (endMin <= startMin) endMin = startMin + 120;     // a typo'd end time → two hours
    const endDate = endMin >= 1440 ? addDays(ev.date, 1) : ev.date;
    endMin %= 1440;
    e = { h: Math.floor(endMin / 60), min: endMin % 60 };
    gDates = `${d8}T${pad(t.h)}${pad(t.min)}00/${endDate.replace(/-/g, '')}T${pad(e.h)}${pad(e.min)}00`;
    oStart = `${ev.date}T${pad(t.h)}:${pad(t.min)}:00${laOffset(ev.date, t.h, t.min)}`;
    oEnd = `${endDate}T${pad(e.h)}:${pad(e.min)}:00${laOffset(endDate, e.h, e.min)}`;
  } else {
    // No time on file → an all-day entry, as the .ics does.
    gDates = `${d8}/${addDays(ev.date, 1).replace(/-/g, '')}`;
    oStart = ev.date; oEnd = addDays(ev.date, 1); allDay = '&allday=true';
  }
  const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(title)}&dates=${gDates}&ctz=${encodeURIComponent(TZ)}`
    + `&details=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;
  const outlook = 'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent'
    + `&subject=${encodeURIComponent(title)}&startdt=${encodeURIComponent(oStart)}&enddt=${encodeURIComponent(oEnd)}${allDay}`
    + `&body=${encodeURIComponent(details)}&location=${encodeURIComponent(loc)}`;
  return { google, outlook, ics, page };
}

const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (ev) => {
  const d = new Date(ev.date + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return day + (ev.time ? ` · ${ev.time}${ev.endTime ? ` – ${ev.endTime}` : ''}` : '');
};

/* The event box for an email: what, when, where, then the calendar buttons.
   Returns { html, text }; empty strings when the event has no date. */
export function eventEmailBlock(ev, base, { heading = '' } = {}) {
  const l = calendarLinks(ev, base);
  if (!l) return { html: '', text: '' };
  const where = [ev.venue, ev.address].filter(Boolean).join(', ');
  const btn = (href, label) => `<a href="${escHtml(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:9px 14px;border-radius:8px;background:#1E5631;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px">${label}</a>`;
  const html = `<div style="margin:18px 0;padding:14px 16px;border:1px solid #d9cfae;border-radius:10px;background:#fbf8ef;font-family:Arial,Helvetica,sans-serif">
    ${heading ? `<div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#7a6a3a;margin:0 0 4px">${escHtml(heading)}</div>` : ''}
    <div style="font-size:17px;font-weight:bold;color:#143C20">${escHtml(ev.title || 'Chamber event')}</div>
    <div style="font-size:14px;color:#333;margin:4px 0 0">${escHtml(when(ev))}</div>
    ${where ? `<div style="font-size:14px;color:#333;margin:2px 0 0">${escHtml(where)}</div>` : ''}
    <div style="font-size:14px;font-weight:bold;color:#143C20;margin:12px 0 4px">📅 Add to your calendar</div>
    <div>${btn(l.google, 'Google')}${btn(l.outlook, 'Outlook')}${btn(l.ics, 'Apple / iPhone')}</div>
    <div style="font-size:13px;margin:10px 0 0"><a href="${escHtml(l.page)}" style="color:#1E5631">Event details${ev.hideCta ? '' : ' &amp; RSVP'} →</a></div>
  </div>`;
  const text = [heading ? heading.toUpperCase() : '', ev.title || 'Chamber event', when(ev), where,
    '', 'Add to your calendar:', `Google: ${l.google}`, `Outlook: ${l.outlook}`, `Apple / iPhone: ${l.ics}`,
    '', `Event details${ev.hideCta ? '' : ' & RSVP'}: ${l.page}`].filter((x, i) => x !== '' || i > 0).join('\n');
  return { html, text };
}
