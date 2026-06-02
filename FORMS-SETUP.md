# Inquiry forms — Formspree setup

Four inquiry types (Membership, Sponsorship & advertising, Events & venue,
Press & partnerships) on `inquire.html`. Each submission goes **two places**:
1. **Formspree** → emails the Chamber (per-type form).
2. **`/api/contact`** → the admin **Inquiries** panel (durable, Postgres).

The site already works today: every type falls back to the existing form
`mojbggnq`, tagged with its inquiry type in the email subject. To get a
**separate Formspree form per type**, do ONE of the two below, then send the 4
form IDs back and they get dropped into `js/forms.js` → `FORMSPREE`.

Project ID: `3015387617890926306`

## Option A — Formspree CLI (forms-as-code, uses the Deploy Key)
The Deploy Key is a **secret** — never commit it or paste it in chat.
```bash
cd websites/wvwccc
# set the key as an env var (locally or in CI); do NOT hardcode it
export FORMSPREE_DEPLOY_KEY=<your deploy key>
npx @formspree/cli@latest deploy --key "$FORMSPREE_DEPLOY_KEY"
```
This reads `formspree.json` and provisions the four named forms in your project.
After it runs, copy each form's hashid from the Formspree dashboard.

## Option B — Formspree dashboard (no key needed)
In the Formspree dashboard, create 4 forms:
`Membership`, `Sponsorship & Advertising`, `Events & Venue`, `Press & Partnerships`.
Copy each form's endpoint id (the `xxxxxxx` in `formspree.io/f/xxxxxxx`).

## Final step (either option)
Edit `js/forms.js` → `FORMSPREE` and replace the ids:
```js
var FORMSPREE = {
  general:     'mojbggnq',
  membership:  '<membership id>',
  sponsorship: '<sponsorship id>',
  events:      '<events id>',
  press:       '<press id>',
};
```
Commit + deploy. Done — each inquiry type now lands in its own Formspree form.

## Notes
- Verify your site domain is allowed in each Formspree form's settings (Formspree
  restricts submissions to verified domains in production).
- The honeypot field (`_gotcha`) is already wired for basic spam protection.
