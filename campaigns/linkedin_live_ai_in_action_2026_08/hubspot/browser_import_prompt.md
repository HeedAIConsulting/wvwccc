# Browser Control Prompt · Marketing Contact Flip Import

Paste the prompt below into a Claude session with browser control while logged into HubSpot. The file `marketing_flip_tranche_1.csv` must already be downloaded from the chat (usually in the Downloads folder). The prompt contains no contact data.

## The prompt

You are operating my browser. I am logged into HubSpot (portal 23411980). Execute one CSV import, exactly as specified, and nothing else.

Goal: flip my selected 1,000 contacts to marketing contact status and add them to one static list, using the import flow.

File: `marketing_flip_tranche_1.csv` in my Downloads folder. Columns: Record ID, Email, First Name, Last Name.

Steps:

1. Go to app.hubspot.com, open Contacts, then Contacts, then click Import.
2. Choose Start an import, then File from computer, one file, one object, object type Contacts.
3. Upload `marketing_flip_tranche_1.csv` from Downloads.
4. When asked how to import, choose the option that UPDATES EXISTING CONTACTS ONLY. Do not create new contacts.
5. On column mapping: map Email to the contact Email property, First Name to First name, Last Name to Last name. If Record ID maps automatically to the record id, keep it; if it causes any mapping error, set that column to "Don't import column."
6. On the final details screen: name the import "AI in Action Live marketing flip tranche 1". CHECK the box that says "Set the contacts you're importing as marketing contacts." This checkbox is the entire purpose of the import; if you cannot find it, STOP and ask me before finishing.
7. If the flow offers to add imported contacts to a list, choose the existing static list named "AI in Action Live Marketing Flip Tranche 1". If that option is not offered, proceed anyway and tell me at the end.
8. Do not check any consent, subscription, or legal basis boxes, and do not change any other setting.
9. Finish the import.
10. Verify: open Contacts, then Lists, find "Contacts Eligible for Marketing Email" and report its size, and open the import record and report how many contacts were updated and how many errored.

Stop and ask me before proceeding if any of these happen: HubSpot warns about a marketing contacts limit, tier upgrade, or additional billing; the marketing contacts checkbox is missing; the import wants to create new contacts; or any screen asks about purchasing anything. Never confirm a purchase or tier change.

Report back: contacts updated, errors, the eligible list size, and whether the list add worked.
