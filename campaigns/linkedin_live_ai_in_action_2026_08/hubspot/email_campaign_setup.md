# HubSpot Email Campaign Setup · AI in Action Live

## The plan restriction that decides everything

The portal's "Contacts Eligible for Marketing Email" list currently holds **2 contacts**. Nearly the whole database sits in non marketing status, so a send scheduled today would reach almost nobody.

**The selection is already done.** A ranked tranche of the top 1,000 contacts (by marketing email opens, across all target lists, unengaged excluded, 982 with email addresses) was pulled on August 4 and delivered to Michael as `marketing_flip_tranche_1.csv` in chat. It is deliberately NOT in this repo because it contains contact PII. An empty static list **123 · AI in Action Live Marketing Flip Tranche 1** is waiting in the portal.

To execute the flip in one pass, about 3 minutes:

1. Contacts, then Import, then **File from computer**, upload the CSV
2. Choose **Update existing contacts only**, match by Email (Record ID column is included as backup)
3. On the final import screen check **Set these contacts as marketing contacts**
4. Also choose **Add to static list** and pick list 123, so the tranche stays auditable
5. Status changes apply immediately, then confirm the eligible count moved from 2 to roughly 1,000

Note: setting contacts to marketing is not freely reversible, a downgrade only takes effect at the next contract renewal, and exceeding the paid marketing contact tier bumps billing automatically. The 1,000 cap was chosen to stay at the first tier. Raise it only deliberately.

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

* **Email 1, Thu Aug 6, 9:00 AM PT.** All target lists minus suppressions.
* **Email 2, Mon Aug 10, 9:00 AM PT.** Same audience.
* **Email 3, Tue Aug 11, 3:00 PM PT.** Same audience plus registrants. Frequency guard: if HubSpot flags fatigue, cut to Email 1 non openers plus registrants.
* **Email 4, Wed Aug 12, 10:00 AM PT.** Registrants only.
* **Email 5, Thu Aug 13, 9:00 AM PT.** Registrants only. Optional split: attendees (list 122) get "great seeing you," no shows get "here is what you missed," same body otherwise.

## Registrant tracking wiring

Lists created by this session, both static Contacts lists:

* **List 121 · AI in Action Live Registrants**
* **List 122 · AI in Action Live Attended**

Once the registration form exists (see the landing page build guide), auto populate registrations one of two ways:

* If Workflows are available: form submitted, then add to list 121
* Otherwise: create an active list filtered on "has filled out form: AI in Action Live Registration" and use that active list for Emails 4 and 5, keeping 121 as the manual backstop

After the event, export the viewer list from the streaming tool, match by email, and add attendees to list 122.

## Compliance

Business contacts from events, imports, and prior campaigns: send under legitimate interest with a clear unsubscribe, which the templates include. The copy makes no earnings guarantees and no autonomous AI claims. Real client metrics only in the bracketed placeholders, never invented figures.
