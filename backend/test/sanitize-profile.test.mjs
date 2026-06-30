import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeProfile } from '../chamber-routes.js';

test('sanitizeProfile accepts new social keys', () => {
  const p = sanitizeProfile({ social: { linkedin: 'https://lnkd.in/co', linkedinPersonal: 'https://lnkd.in/me', nextdoor: 'https://nextdoor.com/x', bogus: 'https://no' } });
  assert.equal(p.social.linkedin, 'https://lnkd.in/co');
  assert.equal(p.social.linkedinPersonal, 'https://lnkd.in/me');
  assert.equal(p.social.nextdoor, 'https://nextdoor.com/x');
  assert.equal(p.social.bogus, undefined);
});

test('sanitizeProfile validates primaryImage and team', () => {
  const p = sanitizeProfile({
    primaryImage: 'person',
    team: [{ name: 'Ann', title: 'Owner' }, { title: 'skip' }],
  });
  assert.equal(p.primaryImage, 'person');
  assert.equal(p.team.length, 1);
  assert.equal(p.team[0].name, 'Ann');
  assert.equal(sanitizeProfile({ primaryImage: 'nope' }).primaryImage, undefined);
});
