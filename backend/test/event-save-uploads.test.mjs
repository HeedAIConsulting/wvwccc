/* Felicia, Sep 15 2026: "In regards to the save button for the October 21st
   event, I have gone a couple times to add sponsors and I have to hit the save
   button twice for it to save. (FYI)"

   Not the same bug as the homeOrder cap. That one sent nothing; this one saves
   both times. The server log shows two successful PATCHes to that event 34
   seconds apart, and with her exact event data loaded the form reports
   checkValidity() === true with no invalid control, so nothing is refusing the
   first press.

   What was actually wrong: every picture and PDF on that form uploads in the
   background and only joins the payload when it resolves. Press Save inside
   that window and the row still has no src, `.filter((s) => s.src)` drops it,
   the save succeeds, "Saved ✓" appears — and the logo she just picked is not on
   the event. Press again a few seconds later and it sticks. Two saves, one
   result, exactly as reported.

   Save now waits: the button goes quiet while an upload runs and comes back on
   its own, and a submit that arrives anyway (Enter in a text box) is refused
   with a reason instead of quietly dropping the file.

   The member event form is the same form from the other side, so it gets the
   same treatment.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), 'utf8');
const admin = read('admin/admin.js');
const member = read('member/member.js');

// The event form only — other admin pages own their own upload buttons.
const eventsForm = admin.slice(admin.indexOf('async function initEvents'), admin.indexOf('async function initBoardManager'));

test('every upload on the event form is tracked', () => {
  const calls = eventsForm.match(/api\('\/api\/me\/asset'/g) || [];
  assert.ok(calls.length >= 7, `expected the form's uploads, found ${calls.length}`);
  const untracked = [...eventsForm.matchAll(/(.{16})api\('\/api\/me\/asset'/g)]
    .filter((m) => !m[1].includes('tracked('))
    .map((m) => m[1].trim());
  assert.deepEqual(untracked, [],
    'an upload nobody is tracking is one the Save button will happily race — that is the bug');
});

test('the button reflects what is happening, and is never left stuck', () => {
  assert.match(eventsForm, /let uploading = 0;/);
  assert.match(eventsForm, /saveBtn\.disabled = uploading > 0 \|\| saving;/,
    'uploading and saving both own the button, so neither can strand it enabled');
  const at = eventsForm.indexOf('async function tracked');
  const fn = eventsForm.slice(at, at + 260);
  assert.match(fn, /finally \{ uploading -= 1; syncSaveBtn\(\); \}/,
    'a FAILED upload must release the button too, or one bad file locks the form');
  assert.match(eventsForm, /Uploading…/);
});

test('a save that arrives mid-upload is refused, not silently emptied', () => {
  // The button is disabled, but Enter in any text box still submits a form.
  const at = eventsForm.indexOf("form.addEventListener('submit'");
  const head = eventsForm.slice(at, at + 900);
  assert.match(head, /if \(uploading > 0\)/, 'the guard has to be inside the submit handler too');
  assert.match(head, /Not saved yet/, 'and say so — "Saved ✓" on a save that dropped her file is the whole complaint');
  assert.ok(head.indexOf('if (uploading > 0)') < head.indexOf('const body = {'),
    'refuse before building the payload, not after');
});

test('the save path no longer touches the button behind syncSaveBtn\'s back', () => {
  const at = eventsForm.indexOf("form.addEventListener('submit'");
  const body = eventsForm.slice(at, eventsForm.indexOf('function showShareLinks'));
  assert.ok(!/btn\.disabled/.test(body),
    'two owners of one button is how it ends up stuck disabled after an error');
  assert.match(body, /saving = true; syncSaveBtn\(\);/);
  assert.match(body, /finally \{ saving = false; syncSaveBtn\(\); \}/);
});

test('the member event form got the same guard', () => {
  const form = member.slice(member.indexOf('async function initEventForm') >= 0 ? member.indexOf('async function initEventForm') : member.indexOf('const flyerInput'), member.indexOf('/* ── Group management'));
  assert.match(form, /let uploading = 0;/);
  assert.match(form, /submitBtn\.disabled = uploading > 0 \|\| submitting;/);
  assert.match(form, /flyerUrl = await tracked\(uploadImage\(f, 'photo'\)\);/,
    'the flyer is the one a member actually loses');
  assert.match(form, /uploadImage: async \(dataUrl\) => \(await tracked\(/,
    'and a picture dropped into the description');
  assert.match(form, /Not saved yet — your picture is still uploading/);
});
