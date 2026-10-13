/* Link-preview tags for community guides.

   Guide pages render client-side, but Facebook, LinkedIn, iMessage and the
   newsletter's link cards never run our JavaScript, so a shared guide used to
   preview as a blank page titled "Community Guide". Diana and Felicia share
   these to the chamber's social pages (Oct 2026), so the server stamps each
   guide's own title, description and Canva cover into the HTML it sends —
   the same approach as the album pages in server.js.

   Pure functions, no I/O, so they can be tested without starting a server. */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SUFFIX = { en: 'West Valley · Warner Center Chamber of Commerce', es: 'Cámara de Comercio West Valley · Warner Center' };

/* The share fields for one guide in one language. */
export function guideShareFields(g, lang, origin) {
  const es = lang === 'es';
  const pick = (k) => (es && g[k + '_es']) || g[k] || '';
  const name = pick('title');
  return {
    title: `${name} — ${SUFFIX[es ? 'es' : 'en']}`,
    description: pick('lede') || pick('intro'),
    image: origin + (g.image || '/images/wvwccc-logo.png'),
    imageAlt: name,
    hasCover: !!g.image,
    url: `${origin}${es ? '/es' : ''}/guides/${g.slug}`,
  };
}

/* Returns the page HTML with its <title> replaced and the description,
   canonical, Open Graph and Twitter tags added before </head>. */
export function stampGuideHtml(html, g, lang, origin) {
  const f = guideShareFields(g, lang, origin);
  const tags = [
    `<meta name="description" content="${esc(f.description)}" />`,
    `<link rel="canonical" href="${esc(f.url)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(SUFFIX[lang === 'es' ? 'es' : 'en'])}" />`,
    `<meta property="og:title" content="${esc(f.title)}" />`,
    `<meta property="og:description" content="${esc(f.description)}" />`,
    `<meta property="og:url" content="${esc(f.url)}" />`,
    `<meta property="og:image" content="${esc(f.image)}" />`,
    `<meta property="og:image:alt" content="${esc(f.imageAlt)}" />`,
    ...(f.hasCover ? ['<meta property="og:image:width" content="1200" />', '<meta property="og:image:height" content="630" />'] : []),
    `<meta name="twitter:card" content="${f.hasCover ? 'summary_large_image' : 'summary'}" />`,
  ].map((t) => '  ' + t).join('\n');
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(f.title)}</title>`)
    .replace('</head>', tags + '\n</head>');
}
