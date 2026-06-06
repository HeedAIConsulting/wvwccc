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

/* Multi-turn chat for the internal admin assistant. Prefers Anthropic (Claude)
   for content quality; falls back to Gemini (flattened) if no Anthropic key. */
export async function chat({ system = '', messages = [], model = 'claude-3-5-sonnet-latest', maxTokens = 1500 } = {}) {
  if (ANTHROPIC_KEY()) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY(), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    return { text: (data.content || []).map((c) => c.text).join(''), provider: 'anthropic', model };
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
