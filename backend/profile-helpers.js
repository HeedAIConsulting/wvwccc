/* ============================================================
   Pure, dependency-light helpers for member profile editing.
   Kept separate from chamber-routes.js so they can be unit-tested
   without pulling in Express / pg / the LLM client.
   ============================================================ */

// Social platforms a member may set. `linkedin` = business/company page;
// `linkedinPersonal` = the owner's personal profile. Yelp/Google live in
// `reviewLinks` (handled in chamber-routes), not here.
export const SOCIAL_KEYS = ['facebook', 'instagram', 'linkedin', 'linkedinPersonal', 'x', 'youtube', 'tiktok', 'nextdoor'];

export const clampUrl = (s) => String(s == null ? '' : s).trim().slice(0, 600);

export function sanitizePrimaryImage(v) {
  return (v === 'logo' || v === 'person') ? v : undefined;
}

// Team list (max 8). Each entry: { name, title?, bio?, photo? }.
// Rows without a name are dropped. Photos must be an http(s) URL or an
// /api/assets/ path (blocks javascript: and other schemes).
export function sanitizeTeam(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const name = String(t.name || '').trim().slice(0, 80);
    if (!name) continue;
    const entry = { name };
    const title = String(t.title || '').trim().slice(0, 80);
    const bio = String(t.bio || '').trim().slice(0, 600);
    const photo = clampUrl(t.photo);
    if (title) entry.title = title;
    if (bio) entry.bio = bio;
    if (photo && /^(https?:\/\/|\/api\/assets\/)/.test(photo)) entry.photo = photo;
    out.push(entry);
    if (out.length >= 8) break;
  }
  return out;
}

// Build the Gemini prompt for rewriting a member's tagline/description.
// opts.field: 'tagline' | 'description' | 'both' (default 'both').
// opts.current: { tagline?, description? } — unsaved edits from the form,
// which take precedence over the stored record.
export function buildRewritePrompt(member = {}, opts = {}) {
  const field = ['tagline', 'description', 'both'].includes(opts.field) ? opts.field : 'both';
  const cur = (opts.current && typeof opts.current === 'object') ? opts.current : {};
  const name = String(member.name || 'This business');
  const category = String(member.category || '');
  const area = String(member.neighborhood || member.city || '');
  const tagline = String(cur.tagline != null ? cur.tagline : (member.tagline || '')).slice(0, 200);
  const description = String(cur.description != null ? cur.description : (member.description || '')).slice(0, 1200);
  const tone = String(opts.tone || '').slice(0, 120);

  const system = [
    'You write warm, concrete copy for a local Chamber of Commerce member directory.',
    'Voice: friendly, community-minded, specific. No hype, no buzzwords, no superlatives like "best" or "leading".',
    'Do not use em dashes. Stay factual to what the business tells you; never invent awards, years, or claims.',
    'Return ONLY valid JSON: {"tagline": string, "description": string}.',
    'tagline: one sentence, max 160 characters. description: 2 to 4 sentences, max 600 characters.',
  ].join(' ');

  const prompt = [
    `Business name: ${name}`,
    category ? `Category: ${category}` : '',
    area ? `Area: ${area}` : '',
    `Current tagline: ${tagline || '(none yet)'}`,
    `Current description: ${description || '(none yet)'}`,
    tone ? `Extra guidance: ${tone}` : '',
    field === 'tagline' ? 'Rewrite the tagline; keep the description close to the current one.'
      : field === 'description' ? 'Rewrite the description; keep the tagline close to the current one.'
      : 'Improve both the tagline and the description.',
  ].filter(Boolean).join('\n');

  return { system, prompt };
}

// Parse the model's reply into { tagline?, description? } or null if unusable.
export function parseRewriteResponse(text) {
  if (!text || typeof text !== 'string') return null;
  let raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let obj;
  try { obj = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { obj = JSON.parse(m[0]); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || obj._mock) return null;
  const out = {};
  if (typeof obj.tagline === 'string' && obj.tagline.trim()) out.tagline = obj.tagline.trim().slice(0, 160);
  if (typeof obj.description === 'string' && obj.description.trim()) out.description = obj.description.trim().slice(0, 600);
  return (out.tagline || out.description) ? out : null;
}
