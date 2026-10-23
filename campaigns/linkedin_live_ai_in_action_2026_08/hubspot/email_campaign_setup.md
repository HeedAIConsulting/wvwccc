# HubSpot Email Campaign Setup · AI in Action Live

## Resolved August 5: no marketing contact flip is needed

Investigation across the API and an in browser check settled it: **this portal is not on HubSpot's marketing contacts pricing model.** There is no marketing status field on contact records and no marketing contacts checkbox in the import flow. The "Contacts Eligible for Marketing Email" list that shows 2 contacts filters on `hs_marketable_status`, a template filter for the other pricing model, so its count was a red herring. On this portal, sendability is governed only by opt outs, hard bounces, and quarantine, all of which HubSpot enforces automatically at send time.

## The send audience

**List 125 · "AI in Action Live marketing flip tranche 1"** (created by the August 5 import) holds the selected top 1,000 contacts, ranked by marketing email opens across all target lists with the unengaged excluded. Verified composition:

* 1,000 members, 982 with email addresses
* 190 are blocked from marketing email (opt out, hard bounce, or quarantine union), auto suppressed at send
* Roughly **792 genuinely deliverable** contacts

Use list 125 for Emails 1 through 3. Sends to the broader raw lists are also possible, the same suppression applies, but list 125 is the engagement ranked core.

Cleanup: **list 123** ("AI in Action Live Marketing Flip Tranche 1", capital letters, 0 members) is now redundant, delete it in the UI to avoid confusion. The import's consent attestation was recorded on import 78676227.

Growth path: the eligible pool beyond list 125 holds roughly 855 more contacts. If Email 1 performs, a tranche 2 pull using the same ranking is a five minute job.

## Target lists, in priority order

* List 58 · WVWCCurrent · 797 contacts · warm regional business audience
* List 38 · ChatGPT Mastery 001 · 621 · already raised a hand for AI education
* List 9 · LinkedIn Ads Contact Match · 432 · built for exactly this channel
* List 57 · WVWCCOC · 392 · chamber network
* List 20 · Cleaned · 240 · verified deliverable
* List 47 · California Business Brokers · 83
* List 45 · additional contacts corrected · 75
* List 46 · filtered contacts list v2 · 48
* List 44 · SoCal Business Brokers · 46
* List 43 · MyCity Contacts · 35
* List 22 · List of 20 Chambers · 20
* List 60 · Wix Rebuild Campaign March 2026 · 8
* List 55 · Food Consultants Group · 7
* List 7 · AI Decision Maker · 3

Raw rows around 2,800. Expect meaningful overlap, the true unique audience is likely 2,000 to 2,400.

## Always suppress

* Unengaged contacts (v3 list id 72, 187 contacts) · protects sender reputation
* All unsubscribes and bounces, HubSpot enforces automatically

Correction from the first draft: "HubSpot Partner Invalid Data" (2,604 contacts) is partner program registration metadata, not email validity. It overlaps most of the database and must NOT be used as a suppression list.

## List id reference (v3 ids, used by API and list URLs)

Target lists: WVWCCurrent 86 · ChatGPT Mastery 56 · LinkedIn Ads Match 18 · WVWCCOC 84 · Cleaned 30 · CA Business Brokers 71 · additional contacts 68 · filtered contacts 70 · SoCal Brokers 66 · MyCity 64 · 20 Chambers 33 · Wix Rebuild 88 · Food Consultants 81 · AI Decision Maker 14. Campaign lists: Registrants 121 · Attended 122 · Marketing Flip Tranche 1 123.

## Send plan

* **Email 1, Thu Aug 6, 9:00 AM PT.** List 125.
* **Email 2, Mon Aug 10, 9:00 AM PT.** List 125.
* **Email 3, Tue Aug 11, 3:00 PM PT.** List 125 plus imported registrants (121). Frequency guard: if HubSpot flags fatigue, cut to Email 1 non openers plus registrants.
* **Email 4, Wed Aug 12, 10:00 AM PT.** List 125 plus imported registrants (list 121), everyone gets the direct event link.
* **Email 5, Thu Aug 13, 9:00 AM PT.** List 125 plus list 121. Optional split: attendees (list 122) get "great seeing you," no shows get "here is what you missed," same body otherwise.

## Registrant tracking wiring

Lists created by this session, both static Contacts lists:

* **List 121 · AI in Action Live Registrants**
* **List 122 · AI in Action Live Attended**

Registration lives on LinkedIn now. Populate list 121 by downloading the event registrant export and importing it, steps in `../linkedin/event_setup.md`. After the event, export the viewer list from the streaming tool, match by email, and add attendees to list 122.

## Compliance

Business contacts from events, imports, and prior campaigns: send under legitimate interest with a clear unsubscribe, which the templates include. The copy makes no earnings guarantees and no autonomous AI claims. Real client metrics only in the bracketed placeholders, never invented figures.
