/* Old ChamberWare member URLs → the member's page on this site.

   Nicole Cohen, Hawaiian Movers, Sep 30 2026, a month after the member pages
   were fixed: "I still cannot find the Hawaiian Movers Chamber member page in
   Google search results."

   Google still held her listing under its ChamberWare address,
   /profile.php?view_id=15884, and that address sent Google to the HOME PAGE
   with a temporary redirect. So the one record Google already had of her
   listing pointed nowhere, and nothing ever told it the listing had moved to
   /members/hawaiian-movers. Every member Google knew from the old site was in
   the same position; one of those old URLs was already showing in search
   under the Chamber homepage's title.

   ChamberWare's view_id is our member id without its "m" — 15884 is m15884 —
   so the old address can be answered exactly. A public member gets a
   permanent redirect to their page, which is what makes Google carry the old
   entry over to the new URL. Anything that does not resolve to a listed
   member returns null, and the caller keeps today's behaviour for it. */
export function legacyMemberPath(viewId, members) {
  const id = String(viewId == null ? '' : viewId).trim();
  if (!/^\d{1,7}$/.test(id)) return null;
  const m = (members || []).find((x) => x && x.id === 'm' + id);
  if (!m || !m.slug) return null;
  return '/members/' + encodeURIComponent(m.slug);
}
