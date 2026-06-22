/* ============================================================
   Provider-agnostic LLM wrapper for the AI Concierge.
   Order: Google Gemini (gemini-flash-latest) → Anthropic Claude → mock.
   Keys come from env (GEMINI_API_KEY / ANTHROPIC_API_KEY). Never hardcode.
   ============================================================ */
const GEMINI_KEY = () => process.env.GEMINI_API_KEY;
const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY;

export function provider() {
  if (GEMINI_KEY()) return 'gemini';
  if (ANTHROPIC_KEY()) return 'anthropic';
  return 'mock';
}
export const enabled = () => provider() !== 'mock';
export const anthropicEnabled = () => !!ANTHROPIC_KEY();
export const geminiEnabled = () => !!GEMINI_KEY();

/* Extract structured JSON from an image (flyer/poster). Anthropic vision first,
   Gemini vision fallback. Returns { text, provider, model }. */
export async function visionJSON({ instruction, imageDataUrl, system = '', maxTokens = 1400 } = {}) {
  // Accepts an image (PNG/JPG/GIF/WebP) or a PDF flyer. PDF goes to Claude as a
  // `document` block (GA — no beta header) and to Gemini as inline PDF data.
  const m = /^data:(image\/(?:png|jpe?g|gif|webp)|application\/pdf);base64,(.+)$/s.exec(imageDataUrl || '');
  if (!m) throw new Error('Provide a PNG, JPG, GIF, or WebP image, or a PDF.');
  const mediaType = m[1], data = m[2];
  const isPdf = mediaType === 'application/pdf';
  const mediaBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  const sys = (system ? system + '\n' : '') + 'Respond with valid JSON only — no markdown fences, no prose.';
  if (ANTHROPIC_KEY()) {
    for (const mod of ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001']) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: mod, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: [
            mediaBlock, { type: 'text', text: instruction }] }] }),
        });
        if (!res.ok) { console.error('[vision:anthropic]', mod, res.status, (await res.text()).slice(0, 160)); continue; }
        const d = await res.json();
        return { text: (d.content || []).map((c) => c.text).join(''), provider: 'anthropic', model: mod };
      } catch (e) { console.error('[vision:anthropic]', mod, e.message); }
    }
  }
  if (GEMINI_KEY()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_KEY()}`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mediaType, data } }, { text: instruction }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, responseMimeType: 'application/json' },
    }) });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const d = await res.json();
    return { text: d?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '', provider: 'gemini', model: 'gemini-flash-latest' };
  }
  throw new Error('No vision-capable provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY).');
}

/* Admin diagnostic: pings each configured provider, returns raw pass/fail. */
export async function diagnose() {
  const out = { provider: provider(), anthropicKey: anthropicEnabled(), geminiKey: geminiEnabled() };
  if (ANTHROPIC_KEY()) {
    // List the models this key can actually use.
    try {
      const lm = await fetch('https://api.anthropic.com/v1/models?limit=100', {
        headers: { 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
      });
      if (lm.ok) { const j = await lm.json(); out.anthropicModels = (j.data || []).map((m) => m.id); }
      else out.anthropicModels = `FAIL ${lm.status}: ${(await lm.text()).slice(0, 160)}`;
    } catch (e) { out.anthropicModels = 'FAIL: ' + e.message; }
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
      });
      out.anthropicTest = res.ok ? 'ok' : `FAIL ${res.status}: ${(await res.text()).slice(0, 220)}`;
    } catch (e) { out.anthropicTest = 'FAIL: ' + e.message; }
  }
  if (GEMINI_KEY()) {
    try { const t = await gemini('', 'ping', false, 8); out.geminiTest = (t != null) ? 'ok' : 'empty'; }
    catch (e) { out.geminiTest = 'FAIL: ' + e.message; }
  }
  return out;
}

/* Multi-turn chat for the internal admin assistant. Prefers Anthropic (Claude)
   for content quality; falls back to Gemini (flattened) if no Anthropic key. */
export async function chat({ system = '', messages = [], model, maxTokens = 1500, attachments = [] } = {}) {
  // Attachments (images / PDFs) ride along with the LAST user turn so the admin
  // can "chat with" an uploaded flyer, contract, or screenshot.
  const atts = (attachments || []).filter((a) => a && a.data && a.mediaType
    && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(a.mediaType));
  const lastUserIdx = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return i; return -1; })();

  if (ANTHROPIC_KEY()) {
    // Prefer Sonnet (best for content); fall back to Haiku (known-good) on any error.
    const candidates = [...new Set([model, 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'].filter(Boolean))];
    const amsgs = messages.map((m, i) => {
      if (i === lastUserIdx && atts.length) {
        const blocks = atts.map((a) => a.mediaType === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: a.mediaType, data: a.data } }
          : { type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
        blocks.push({ type: 'text', text: m.content || 'Please review the attached file(s).' });
        return { role: 'user', content: blocks };
      }
      return { role: m.role, content: m.content };
    });
    let lastErr;
    for (const m of candidates) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: m, max_tokens: maxTokens, system, messages: amsgs }),
        });
        if (!res.ok) { lastErr = new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`); console.error('[llm.chat]', m, lastErr.message); continue; }
        const data = await res.json();
        return { text: (data.content || []).map((c) => c.text).join(''), provider: 'anthropic', model: m };
      } catch (e) { lastErr = e; console.error('[llm.chat]', m, e.message); }
    }
    // Anthropic failed entirely → try Gemini before giving up.
    if (!GEMINI_KEY()) throw lastErr || new Error('anthropic failed');
  }
  if (GEMINI_KEY()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_KEY()}`;
    const contents = messages.map((m, i) => {
      const parts = [];
      if (i === lastUserIdx && atts.length) atts.forEach((a) => parts.push({ inlineData: { mimeType: a.mediaType, data: a.data } }));
      parts.push({ text: m.content || 'Please review the attached file(s).' });
      return { role: m.role === 'assistant' ? 'model' : 'user', parts };
    });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    }) });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return { text: data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '', provider: 'gemini', model: 'gemini-flash-latest' };
  }
  return { text: "The assistant isn't configured yet — add an ANTHROPIC_API_KEY (preferred) or GEMINI_API_KEY to enable it.", provider: 'mock', model: null };
}

// Ask the model. Returns a string. `json` hints we want strict JSON back.
export async function complete({ system = '', prompt, json = false, maxTokens = 700 } = {}) {
  const which = provider();
  try {
    if (which === 'gemini') return await gemini(system, prompt, json, maxTokens);
    if (which === 'anthropic') return await anthropic(system, prompt, json, maxTokens);
  } catch (e) {
    console.error(`[llm:${which}]`, e.message);
    // fall through to mock on provider error
  }
  return mock(prompt);
}

async function gemini(system, prompt, json, maxTokens) {
  // gemini-flash-latest ONLY — the -pro models have zero free-tier quota.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${GEMINI_KEY()}`;
  const body = {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.3,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  clearTimeout(to);
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}

async function anthropic(system, prompt, json, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system: system + (json ? '\nRespond with valid JSON only.' : ''),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.content || []).map((c) => c.text).join('');
}

// Deterministic fallback when no key is configured — keeps the feature usable.
function mock(prompt) {
  return JSON.stringify({
    answer: "Here are the closest matches from the member directory. (The AI concierge isn't fully configured yet — add a GEMINI_API_KEY to enable conversational answers.)",
    memberIds: [],
    _mock: true,
  });
}
