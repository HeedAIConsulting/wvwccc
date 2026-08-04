# HubSpot Email Campaign Setup · AI in Action Live

## The plan restriction that decides everything

The portal's dynamic list "Contacts Eligible for Marketing Email" (list 59) currently holds **2 contacts**. Nearly the whole database sits in non marketing status, so a send scheduled today would reach almost nobody. Before Email 1:

1. Open Contacts, filter by list membership for each target list below
2. Select all, then Actions, then **Set as marketing contacts**
3. Watch the marketing contacts usage meter in Account Settings. Stay inside the paid tier. If the tier is 1,000 marketing contacts, prioritize the lists in the order given below until the cap is reached, top priority first
4. Status changes take effect immediately for sends

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

* List 48 · Unengaged contacts · 187 · protects sender reputation
* List 35 · HubSpot Partner Invalid Data · 2,603 · never send here
* All unsubscribes and bounces, HubSpot enforces automatically

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
