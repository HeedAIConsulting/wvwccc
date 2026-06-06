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
  const m = /^data:(image\/(png|jpe?g|gif|webp));base64,(.+)$/s.exec(imageDataUrl || '');
  if (!m) throw new Error('Provide a PNG, JPG, GIF, or WebP image.');
  const mediaType = m[1], data = m[3];
  const sys = (system ? system + '\n' : '') + 'Respond with valid JSON only — no markdown fences, no prose.';
  if (ANTHROPIC_KEY()) {
    for (const mod of ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest']) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: mod, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: instruction }] }] }),
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
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-3-5-haiku-latest', max_tokens: 8, messages: [{ role: 'user', content: 'ping' }] }),
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
export async function chat({ system = '', messages = [], model, maxTokens = 1500 } = {}) {
  if (ANTHROPIC_KEY()) {
    // Prefer Sonnet (best for content); fall back to Haiku (known-good) on any error.
    const candidates = [model, 'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'].filter(Boolean);
    let lastErr;
    for (const m of candidates) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: m, max_tokens: maxTokens, system, messages }),
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
    const prompt = messages.map((m) => (m.role === 'user' ? 'Admin: ' : 'Assistant: ') + m.content).join('\n\n');
    return { text: await gemini(system, prompt, false, maxTokens), provider: 'gemini', model: 'gemini-flash-latest' };
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
      model: 'claude-3-5-haiku-latest',
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
