import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete } from '../llm.js';

// With no GEMINI_API_KEY/ANTHROPIC_API_KEY in the env, complete() returns the
// deterministic mock string. We only assert the signature accepts `model`
// without throwing — i.e. the param is threaded through, not rejected.
test('complete accepts a model param and still resolves to a string', async () => {
  const out = await complete({ prompt: 'hi', json: true, model: 'gemini-2.5-flash' });
  assert.equal(typeof out, 'string');
});
