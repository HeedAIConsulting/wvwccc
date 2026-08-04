# AI in Action Live · LinkedIn LIVE Campaign · August 12, 2026

Campaign to fill and convert a LinkedIn LIVE session where Michael Bowers demonstrates three real, scrubbed client AI builds: the DTC dashboard, the SJ doors project, and the Alpha Structure site information and risk assessment tool.

**Event (working assumption, confirm):** Wednesday, August 12, 2026 at 11:00 AM Pacific, 45 minutes, streamed to LinkedIn LIVE from Michael's profile and the Heed AI Consulting company page.

**Objective:** attendance plus lead capture. Every registration lands in HubSpot with UTM attribution, joins list 121 "AI in Action Live Registrants", and enters the reminder sequence. Post event, attendees split to list 122 "AI in Action Live Attended" for the booking push.

**Campaign slug for all tracking:** `ai_in_action_live_2026_08`

## What is in this folder

* `brief/creative_brief.md`: positioning, angles, audience, and messaging rules
* `schedule/campaign_schedule.md`: day by day run plan from today through August 13
* `landing_page/ai_in_action_live.html`: complete bright landing page, ready to host or to rebuild in HubSpot
* `landing_page/hubspot_build_guide.md`: exact click path to recreate the page in HubSpot in about 15 minutes
* `hubspot/email_campaign_setup.md`: list targeting within plan restrictions, marketing contact caps, send schedule
* `hubspot/layout_sections_payload.json`: API ready page content for when the HubSpot MCP connection is restored
* `emails/`: five send ready emails, HTML plus paste ready copy
* `social/linkedin_posts.md`: six organic posts including the designated boost post
* `boost/boost_playbook.md`: the boost post, the exact audience spec, budget math, and the step list for the browser connect session
* `images/`: five bright campaign images, generated with the no text rule, warm palette, zero blue backgrounds

## What already exists in HubSpot (created by this session)

* List 121: AI in Action Live Registrants (static)
* List 122: AI in Action Live Attended (static)

## What still needs a human or a restored connection

1. **HubSpot page and email creation could not be completed by API this session.** The official HubSpot MCP connector returned an OAuth configuration error, and the Zapier HubSpot connection only holds CRM scopes, so content writes were rejected. Fix: reauthorize the HubSpot connector in claude.ai connector settings, then a follow up session can push `hubspot/layout_sections_payload.json` in one call. Or follow `landing_page/hubspot_build_guide.md` manually, it is about 15 minutes.
2. **Marketing contact eligibility.** The dynamic list "Contacts Eligible for Marketing Email" shows only 2 contacts. Most of the database is set to non marketing. Before Email 1 sends, the target lists must be flipped to marketing contacts within the plan tier. Steps are in `hubspot/email_campaign_setup.md`.
3. **LinkedIn Event plus boost.** Create the LinkedIn Event and boost the designated post from the company page. The full spec is in `boost/boost_playbook.md`, ready for the browser connect session.
4. **Real numbers.** Public copy uses bracketed placeholders like [X hours per week] where a true client metric belongs. Drop in the real figures before launch, never invented ones.

## Success targets

* 8,000 to 15,000 boosted impressions at a $300 to $500 boost budget
* 60 to 120 registrations across boost, organic, and email
* 35 to 45 percent live show rate, replay roughly doubles total viewership
* 10 to 20 consult bookings or replies within 7 days of the replay email
