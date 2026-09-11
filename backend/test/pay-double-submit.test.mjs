/* One click, one charge.

   Sep 10 2026, from the live Pay Log: a member's $70 ticket appears twice,
   two seconds apart — 22:50:28 paid, 22:50:30 declined. Two orders means two
   /api/pay calls, which means two clicks on Pay. He was saved by the gateway
   declining the duplicate, which is luck rather than design; a different
   amount or a slightly longer gap and he is charged twice.

   The free-RSVP branch of the same submit handler had always disabled the
   button while it worked. The paid branch called CollectJS.startPaymentRequest()
   with no guard at all. That asymmetry is the bug.

   Unlocking is the delicate half, and the reason this is not a one-liner:
   Collect.js refuses to tokenize an invalid card field and then never calls
   its callback, so a naive lock strands the payer on a dead button — worse
   than the double charge. There are three ways back out, and all three are
   asserted in the browser (see below).

   This file is a source guard, because the logic lives in js/chamber.js and
   runs in a browser rather than in node. The behaviour itself is verified
   against a stubbed gateway with Playwright: three clicks produce three
   gateway calls without the lock and exactly one with it; a decline is
   retryable; an invalid field gives the button back; a silent gateway
   releases it on a timer; a successful charge still completes.

   Run: npm test */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../js/chamber.js', import.meta.url), 'utf8');
const checkout = src.slice(src.indexOf('async function initCheckout'));

test('the paid path is locked before it reaches the gateway', () => {
  const submit = checkout.slice(checkout.indexOf("form.addEventListener('submit'"));
  const start = submit.indexOf('startPaymentRequest');
  assert.ok(start > -1, 'the paid submit path should still hand off to Collect.js');
  const before = submit.slice(0, start);
  assert.ok(/payLocked\)\s*return/.test(before),
    'a second click while a charge is in flight must return early');
  assert.ok(before.includes('lockPay()'),
    'the button must be locked BEFORE startPaymentRequest, not after');
});

test('every way out of a failed charge gives the button back', () => {
  // showErr is the single funnel every error path already calls.
  assert.match(checkout, /const showErr =[\s\S]{0,200}?unlockPay\(\)/,
    'showErr must unlock, so declines and exceptions are retryable');
  // Collect.js never fires `callback` for an invalid field.
  assert.match(checkout, /validationCallback:[\s\S]{0,120}?unlockPay\(\)/,
    'an invalid card field must unlock, or the payer is stranded');
  // And a gateway that says nothing at all must not leave a dead button.
  assert.match(checkout, /payTimer = setTimeout\(unlockPay/,
    'a silent gateway must release the button on a timer');
});

test('a charge that went through does not re-arm the button', () => {
  const ok = checkout.slice(checkout.indexOf('paySuccess'));
  assert.ok(checkout.includes('clearPayTimer()'),
    'the safety timer must be cleared once the card is charged');
  assert.ok(/form\.hidden = true/.test(ok) || checkout.includes('form.hidden = true'),
    'the form is hidden on success');
});
