# Heed Consulting Group — landing page

A self-contained landing page for **heedconsulting.ai** — the parent-brand hub that
lists Michael Bowers' businesses and tells his story.

- **`index.html`** — the entire page. All CSS/JS is inline; the only external
  dependency is Google Fonts. Nothing here depends on the WVWCCC chamber site, so it
  can be deployed on its own at the domain root.

## What's on the page
1. **Hero** — the "one partner, three practices" positioning.
2. **Our Businesses** — three cards: Heed AI Solutions, Heed Business Solutions, and
   Heed CFO Solutions (with a *Coming Soon* badge). Each links to a pre-filled email.
3. **About Michael** — the "why I do all three" bio.
4. **Why Heed** — six reasons to engage the group.
5. **Contact CTA + footer** — everything points to `mbowers@heedconsulting.ai`.

## Things to personalize (search `index.html` for these)
- `data-draft="bio"` — the bio + "why I do both" copy is a professional **first draft**.
  Replace with your real background, years, and client highlights.
- `.portrait` — swap the "MB" placeholder for a real photo (drop in an `<img>`).
- **Business links** — currently every card opens a pre-filled email. When the
  individual sites go live, point the `href`s at their real URLs.
- **Experience** — copy is intentionally qualitative ("years of service"); add hard
  numbers/stats whenever you want them featured.

## Deploying to heedconsulting.ai
It's a static page — host the `heed/` folder (or just `index.html` at the root) on any
static host (Render static site, Netlify, Cloudflare Pages, GitHub Pages, etc.) and
point the `heedconsulting.ai` DNS at it.
