# HubSpot Landing Page Build Guide · about 15 minutes

Why manual: this session's official HubSpot connector failed OAuth and the Zapier connection holds CRM scopes only, so page writes were blocked. Everything below is paste ready. A future session with a restored connector can instead apply `../hubspot/layout_sections_payload.json` directly.

## Step 1 · Clone

Marketing → Website → Landing Pages → find **AI Adoption Consultation Sign Up** → Clone → name it **AI in Action Live · LinkedIn LIVE Aug 12 2026**.

## Step 2 · Page settings

* Page title: `AI in Action: Three Real Client Builds, Shown Live | Heed AI Consulting`
* URL slug: `ai_in_action_live`
* Meta description: `Watch three working AI systems real businesses run every day, demonstrated live with scrubbed data. LinkedIn LIVE, Wednesday August 12 at 11:00 AM Pacific.`
* Featured image for social sharing: upload `../images/hero_16x9.png`

## Step 3 · Banner section (currently dark blue, make it bright)

* Section background: replace the blue with a gradient from `#F59E0B` to `#C2410C` (warm amber into deep orange), white text stays legible
* Replace the banner rich text with:

Heading 1: `AI in Action: Three Real Client Builds, Shown Live`

Heading 3: `LinkedIn LIVE · Wednesday, August 12 · 11:00 AM Pacific · 45 minutes`

Paragraph: `Skip the theory. Watch three working AI systems that real businesses run every day, demonstrated live with scrubbed data, and see exactly what each one changed in hours saved, revenue captured, and risk retired.`

* Remove the flyer image inside the old banner text
* Banner button: text `Save My Seat`, link to `#register`

## Step 4 · Description section (the three columns)

Top button: text `Add to Calendar`, link to the calendar invite URL (create a Google Calendar template link for Aug 12, 11:00 AM PT). Delete the old CTA embed below it.

Column 1: upload `../images/dtc_dashboard_4x3.png`, then:

Heading 3: `The Owner Dashboard`

Body: `A direct to consumer command center that pulls orders, ad spend, and fulfillment into one live view an owner actually reads. It replaced the Monday spreadsheet scramble and roughly [X hours per week] of manual reporting.`

Column 2: upload `../images/sj_doors_4x3.png`, then:

Heading 3: `The Doors Project`

Body: `Intake, quoting, and job tracking for a custom door builder, rebuilt around AI so a quote request reaches the shop floor without the paper trail. Quote turnaround moved from [X days] to [X hours].`

Column 3: upload `../images/alpha_structure_4x3.png`, then:

Heading 3: `Site Intelligence and Risk`

Body: `A construction team's tool that turns scattered site information into a structured risk assessment the whole crew can act on before mobilizing. Assessment prep moved from [X] to [X].`

Bottom button: text `Save My Seat`, link `#register`.

## Step 5 · Registration section (no form, LinkedIn handles registration)

* Set the section's CSS id to `register` so the buttons anchor to it
* Delete the form module from the cloned page entirely
* Rich text:

Heading 2: `Save your seat`

Paragraph: `Wednesday, August 12, 2026 · 11:00 AM Pacific · Streaming on LinkedIn LIVE. Registration is handled on LinkedIn. Click through, hit Attend, and LinkedIn will remind you the moment we go live.`

* Add a button: text `Register on LinkedIn`, link to the LinkedIn event URL, open in new tab
* Every other button on the page (banner and description bottom) also links to the LinkedIn event URL
* Lead capture happens via the LinkedIn registrant export, see `../linkedin/event_setup.md`

## Step 6 · Footer

Keep the existing footer. Update the phone format if desired: `(818) 626 5766`.

## Step 7 · Publish, then test

Publish, open on mobile and desktop, submit a test registration, confirm the contact appears and lands in the registrant tracking, then plug the live URL into the emails, the posts, and the boost playbook.
