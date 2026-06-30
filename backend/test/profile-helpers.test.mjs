import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_KEYS, clampUrl, sanitizePrimaryImage, sanitizeTeam,
  buildRewritePrompt, parseRewriteResponse,
} from '../profile-helpers.js';

test('SOCIAL_KEYS includes the new platforms', () => {
  for (const k of ['facebook', 'instagram', 'linkedin', 'linkedinPersonal', 'x', 'youtube', 'tiktok', 'nextdoor']) {
    assert.ok(SOCIAL_KEYS.includes(k), `missing ${k}`);
  }
});

test('clampUrl trims and caps length', () => {
  assert.equal(clampUrl('  https://x.com  '), 'https://x.com');
  assert.equal(clampUrl('a'.repeat(700)).length, 600);
  assert.equal(clampUrl(null), '');
});

test('sanitizePrimaryImage allows only logo|person', () => {
  assert.equal(sanitizePrimaryImage('logo'), 'logo');
  assert.equal(sanitizePrimaryImage('person'), 'person');
  assert.equal(sanitizePrimaryImage('banana'), undefined);
  assert.equal(sanitizePrimaryImage(''), undefined);
});

test('sanitizeTeam drops nameless rows, caps 8, validates photo', () => {
  const out = sanitizeTeam([
    { name: 'Ann', title: 'CEO', bio: 'Leads.', photo: '/api/assets/asset-1' },
    { title: 'no name' },
    { name: 'Bob', photo: 'javascript:alert(1)' },
    { name: 'Cal', photo: 'https://cdn.example.com/c.jpg' },
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { name: 'Ann', title: 'CEO', bio: 'Leads.', photo: '/api/assets/asset-1' });
  assert.equal(out[1].name, 'Bob');
  assert.equal(out[1].photo, undefined, 'bad scheme rejected');
  assert.equal(out[2].photo, 'https://cdn.example.com/c.jpg');
  assert.equal(sanitizeTeam(new Array(20).fill({ name: 'x' })).length, 8);
  assert.deepEqual(sanitizeTeam('nope'), []);
});

test('buildRewritePrompt returns system+prompt and honors field + current overrides', () => {
  const r = buildRewritePrompt(
    { name: 'Acme', category: 'Bakery', neighborhood: 'Tarzana', description: 'old' },
    { field: 'tagline', current: { description: 'fresh bread daily' } });
  assert.match(r.system, /JSON/);
  assert.match(r.prompt, /Acme/);
  assert.match(r.prompt, /fresh bread daily/, 'uses current override over stored');
  assert.match(r.prompt, /tagline/i);
});

test('parseRewriteResponse handles fenced JSON, rejects mock/garbage, clamps', () => {
  const ok = parseRewriteResponse('```json\n{"tagline":"Hi","description":"There."}\n```');
  assert.deepEqual(ok, { tagline: 'Hi', description: 'There.' });
  assert.equal(parseRewriteResponse('{"_mock":true,"answer":"x"}'), null);
  assert.equal(parseRewriteResponse('not json at all'), null);
  const long = parseRewriteResponse(JSON.stringify({ tagline: 't'.repeat(300), description: 'd'.repeat(900) }));
  assert.equal(long.tagline.length, 160);
  assert.equal(long.description.length, 600);
});
