/* The Valley Biz Buzz page (Community → Biz Buzz), office-editable.

   Diana, Oct 13 2026, through the support form: "As Admin I need to either
   take down or update Biz Buzz under community. I cannot find on Dashboard or
   on backend." She could not: the stories were unlabelled "news" rows in
   Admin → Content, and everything else on the page — the tagline, the podcast
   blurb, a newsletter box still titled "The Valley Biz Buzz Newsletter" with a
   hardcoded June list — lived in the HTML, where only a developer could reach
   it. Valley Biz Buzz is the podcast; the newsletter is Valley Biz Connect.

   One settings record now drives the page, edited in Admin → Content → Biz
   Buzz page. The defaults are the page's existing copy, so nothing changes
   until the office edits it. `hidden` takes the page down: its address sends
   visitors to the podcast page instead (server.js).

   Pure helpers, so they can be tested without a server. */

export const BIZBUZZ_KEY = 'bizBuzzPage';

export const BIZBUZZ_DEFAULT = Object.freeze({
  hidden: false,
  tagline: 'News & happenings from the heart of the Valley',
  showStories: true,
  storyMonths: 0,                 // 0 = every story; otherwise only the last N months
  showPodcast: true,
  podcastBlurb: '34 episodes — member stories, expert tips & community conversations, hosted by Danielle Roy.',
  showNewsletter: true,
  newsletterBlurb: 'Our monthly newsletter rounds up Chamber happenings, member news, ribbon cuttings, events, and local deals.',
});

export const STORY_MONTH_CHOICES = [0, 3, 6, 12];

const text = (v, max, fallback) => {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
};

export function cleanBizBuzz(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const d = BIZBUZZ_DEFAULT;
  const bool = (k) => (b[k] === undefined ? d[k] : b[k] === true || b[k] === 'true' || b[k] === 'on');
  const months = Number(b.storyMonths);
  return {
    hidden: bool('hidden'),
    tagline: text(b.tagline, 160, d.tagline),
    showStories: bool('showStories'),
    storyMonths: STORY_MONTH_CHOICES.includes(months) ? months : d.storyMonths,
    showPodcast: bool('showPodcast'),
    podcastBlurb: text(b.podcastBlurb, 300, d.podcastBlurb),
    showNewsletter: bool('showNewsletter'),
    newsletterBlurb: text(b.newsletterBlurb, 400, d.newsletterBlurb),
  };
}

/* Reads the saved record through the repo's settings store. A missing or
   unreadable record is the defaults, never an error page. */
export async function loadBizBuzz(repo) {
  try {
    const raw = await repo.getSetting(BIZBUZZ_KEY);
    return cleanBizBuzz(raw ? JSON.parse(raw) : {});
  } catch { return cleanBizBuzz({}); }
}
