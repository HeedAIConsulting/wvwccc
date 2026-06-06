#!/usr/bin/env node
/* Index the directory: map the 653 raw ChamberWare categories into ~20 browsable
   parent groups (keyword match on category + typeOfBusiness), add `group` to each
   member, and add searchable `tags`. Keeps the specific category as the subtitle. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', '_store');
const file = path.join(STORE, 'members.json');

// group → keyword fragments (checked against lowercased category + typeOfBusiness)
const GROUPS = [
  ['Restaurants & Food', ['restaurant','food','cafe','coffee','bakery','catering','grocery','deli','dining','pizza','bar &','brewery','winery','ice cream','juice','meal']],
  ['Health & Medical', ['hospital','medical','health','clinic','doctor','physician','dental','dentist','chiropractor','pharmacy','therapy','therapist','urgent care','optometr','vision','mental','nurs','hospice','home care','caregiver','wellness','cryo']],
  ['Beauty & Personal Care', ['salon','spa','beauty','barber','hair','nail','skin','massage','cosmetic','makeup','lash','esthetic']],
  ['Professional Services', ['consult','marketing','advertising','public relations','design','print','media','photograph','video','staffing','translation','notary','business serv','employer serv','payroll','hr ']],
  ['Financial & Insurance', ['insurance','financial','bank','credit union','accountant','accounting','cpa','tax','mortgage','loan','invest','wealth','escrow','bookkeep']],
  ['Legal', ['attorney','law','legal','lawyer','mediation']],
  ['Real Estate', ['real estate','realtor','property','apartment','leasing','realty']],
  ['Automotive', ['auto','car ','vehicle','tire','mechanic','body works','dealership','motors','ford','collision','smog']],
  ['Home & Trades', ['plumb','electric','hvac','roofing','construct','contractor','handyman','landscap','garden','pest','cleaning','painting','remodel','flooring','solar','locksmith','pool','moving','storage','appliance','furniture','interior']],
  ['Retail & Shopping', ['retail','store','shop','boutique','jewelry','clothing','apparel','gift','florist','flower','book','hardware','pharmac','specialty','antique','camera']],
  ['Education', ['school','education','tutor','academy','college','university','learning','childcare','preschool','daycare','montessori','training']],
  ['Nonprofit & Community', ['non-profit','nonprofit','non profit','foundation','charity','community','association','organization','church','temple','synagogue','religious','club','rotary','volunteer']],
  ['Hospitality & Events', ['hotel','motel','event','venue','wedding','banquet','catering hall','lodging','travel','tourism']],
  ['Technology', ['technolog','software','it ','computer','web ','app ','tech ','data','cyber','telecom','internet']],
  ['Arts & Entertainment', ['art','entertainment','music','theater','theatre','gallery','museum','photography studio','production','film','dance','studio']],
  ['Fitness & Recreation', ['fitness','gym','yoga','pilates','sport','recreation','golf','bowling','martial','crossfit','athletic','country club']],
  ['Government & Public', ['government','city ','county','public','council','district','utility','transportation','library','police','fire']],
  ['Pets & Animals', ['pet','animal','veterinar','vet ','grooming','dog ','cat ']],
  ['Senior Services', ['senior','retirement','assisted living','elder']],
];

const clean = (v) => (v == null ? '' : String(v).toLowerCase());
function groupOf(m) {
  const hay = (clean(m.category) + ' ' + clean(m.typeOfBusiness)).trim();
  if (!hay) return 'Other';
  for (const [name, kws] of GROUPS) if (kws.some((k) => hay.includes(k))) return name;
  return 'Other';
}

const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const counts = {};
for (const m of doc.members) {
  m.group = groupOf(m);
  counts[m.group] = (counts[m.group] || 0) + 1;
  // build a small tags array for search if missing (category words)
  if (!m.tags) {
    const words = (clean(m.category) + ' ' + clean(m.typeOfBusiness)).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    m.tags = [...new Set(words)].slice(0, 8);
  }
}
doc._meta = { ...doc._meta, categorizedAt: new Date().toISOString(), groups: Object.keys(counts).length };
fs.writeFileSync(file, JSON.stringify(doc, null, 2));

console.log('group distribution (', Object.keys(counts).length, 'groups ):');
for (const [g, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${g}`);
