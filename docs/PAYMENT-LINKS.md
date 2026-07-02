# WVWCCC payment links (for the Chamber office)

Card payments are live on the website as of Jul 2 2026 (AGMS gateway, merchant
`woodlandhillscc`). The office can paste these links into any email. Card entry
happens on our secure checkout page; card numbers never touch our server (Collect.js
tokenization, PCI SAQ-A). Every payment emails a receipt to the payer and to the
office, and appears in Admin, then in the AGMS gateway portal.

Base URL: `https://woodlandhillscc.net`

## Ask for any amount (renewals, invoices, event balances)

```
https://woodlandhillscc.net/checkout.html?type=payment&for=DESCRIPTION&amount=AMOUNT
```

- `for` = what the payment is for (shows on the page and the receipt). Use `%20` for spaces.
- `amount` = optional preset in dollars; the payer can still edit it. Omit to let them type it.

Examples:
- 2026 dues renewal, 1 to 5 employees ($450):
  `https://woodlandhillscc.net/checkout.html?type=payment&for=2026%20Dues%20Renewal&amount=450`
- Invoice balance: `https://woodlandhillscc.net/checkout.html?type=payment&for=Invoice%201234&amount=125`
- Partial payment, payer types the amount (omit `amount`):
  `https://woodlandhillscc.net/checkout.html?type=payment&for=Partial%20Payment%20Invoice%201234`
- Payment on an agreement or sponsorship plan:
  `https://woodlandhillscc.net/checkout.html?type=payment&for=Sponsorship%20Agreement%20Installment%201%20of%203&amount=500`

Note: a preset `amount` is a convenience, not a lock. The payer can always edit the
amount box before paying (only event ticket totals are locked). The description in
`for` appears on the checkout page, the emailed receipts, the admin Pay Log, and in
the AGMS gateway, so make it specific.

Official dues by employee count (since Jan 1 2025): 1-5 $450 · 6-10 $500 · 11-25 $575 ·
26-50 $725 · 51-75 $850 · 76-124 $950 · 125-299 $1,250 · 300-749 $1,600 · 750+ $2,550.
(These are also loaded as products `mem-emp-*` in the AGMS gateway catalog.)

## Donations

- Any amount: `https://woodlandhillscc.net/checkout.html?type=donation`
- Preset: add `&sku=don-25` / `don-50` / `don-100` / `don-150` / `don-300`
- Named project: add `&project=Scholarship%20Fund` (labels the receipt)

## Event tickets

Each ticketed event's page links to
`https://woodlandhillscc.net/checkout.html?type=ticket&event=<eventId>` —
buyers pick the ticket type and quantity there (prices come from Admin → Events).

## Memberships (new joins)

New memberships stay office-processed: `checkout.html?type=membership` redirects to
the membership application (`join.html#apply`). To take dues by card, send a
`type=payment` link with the right bracket amount (see above).

## Not yet available

- AGMS-hosted invoices (emailed pay links from the gateway): Invoicing is not enabled
  on the account yet; Eduardo has been asked to turn it on.
- QuickClick hosted cart links: enabled on the account but they require signed hashes
  generated from the gateway portal (Settings, QuickClick). Our own links above cover
  the same use cases.
