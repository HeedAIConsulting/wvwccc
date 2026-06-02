#!/usr/bin/env node
/* ============================================================
   WVWCCC — ChamberWare → production importer
   Reads a MySQL dump (woodlandhills_db.sql) and produces:
     data/_store/members.json  — directory + profile data (public-safe fields served via /api/members)
     data/_store/users.json    — auth: email/username + legacy password hash (server-only, never web-served)

   Usage:
     node scripts/import-chamberware.js <path-to.sql> [--table accounts] [--discover]

   The dump's exact table/column names are NOT assumed. The importer parses
   CREATE TABLE statements to learn each table's columns, then maps the chosen
   table's columns to our schema by FUZZY NAME MATCH (aliases below). Run with
   --discover first to print tables + columns, then confirm/adjust --table.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, 'data', '_store');

// ── Field aliases: target field → candidate source column names ──
// Aligned with the ChamberWare CSV column map confirmed in the admin:
// category, company, address, address2, city, state, zip, phone, fax,
// firstname, lastname, email, website.
const FIELD_ALIASES = {
  company:       ['company', 'company_name', 'business', 'business_name', 'org', 'organization'],
  category:      ['category', 'cat', 'business_type', 'type_of_business', 'industry'],
  firstName:     ['firstname', 'first_name', 'fname', 'contact_first'],
  lastName:      ['lastname', 'last_name', 'lname', 'contact_last'],
  email:         ['email', 'email_address', 'e_mail', 'login', 'username_email'],
  username:      ['username', 'user_name', 'login', 'user', 'screenname'],
  passwordHash:  ['password', 'passwd', 'pass', 'pwd', 'password_hash', 'pass_hash'],
  phone:         ['phone', 'telephone', 'phone_number', 'tel'],
  fax:           ['fax', 'fax_number'],
  website:       ['website', 'web', 'url', 'web_site', 'homepage'],
  address:       ['address', 'address1', 'street', 'addr', 'street_address'],
  address2:      ['address2', 'addr2', 'suite', 'unit'],
  city:          ['city', 'town'],
  state:         ['state', 'province', 'region'],
  zip:           ['zip', 'zipcode', 'zip_code', 'postal', 'postal_code'],
  neighborhood:  ['neighborhood', 'area', 'community', 'district'],
  tier:          ['tier', 'membership_level', 'level', 'member_type', 'membership_type'],
  status:        ['status', 'active', 'approved', 'account_status', 'state_flag'],
  leaderStatus:  ['leader', 'board', 'role', 'member_role', 'designation', 'ambassador'],
  employees:     ['employees', 'num_employees', 'no_of_employees', 'employee_count', 'staff_count'],
  yearEstablished:['year_established', 'established', 'founded', 'year_founded'],
  tagline:       ['tagline', 'slogan', 'headline', 'short_desc'],
  description:   ['description', 'about', 'profile', 'bio', 'details', 'long_desc'],
  joinDate:      ['join_date', 'date_joined', 'member_since', 'created', 'created_at', 'date_added'],
  expireDate:    ['expire', 'expiration', 'expire_date', 'renewal_date', 'expires', 'paid_through'],
  id:            ['id', 'accounts_id', 'account_id', 'member_id', 'user_id', 'view_id'],
};

// ── tiny SQL-dump parser (no deps) ──────────────────────────
function parseDump(sql) {
  const tables = {};        // name -> { columns: [..] }
  const rows = {};          // name -> [ {col:val} ]

  // CREATE TABLE `t` ( ... ) — body captured with balanced, quote-aware parens
  // (column types like int(11) contain parens, so a non-greedy regex won't do).
  const createHeadRe = /CREATE TABLE\s+`?([A-Za-z0-9_]+)`?\s*\(/gi;
  let m;
  while ((m = createHeadRe.exec(sql))) {
    const name = m[1];
    const body = extractBalanced(sql, createHeadRe.lastIndex - 1);
    const cols = [];
    for (const line of body.split('\n')) {
      const c = line.trim().match(/^`([A-Za-z0-9_]+)`/);
      if (c) cols.push(c[1]);
    }
    if (cols.length) tables[name] = { columns: cols };
  }

  // INSERT INTO `t` (cols)? VALUES (..),(..);
  const insertRe = /INSERT INTO\s+`?([A-Za-z0-9_]+)`?\s*(\(([^)]*)\))?\s*VALUES\s*([\s\S]*?);(?=\s*(?:INSERT|CREATE|DROP|ALTER|UNLOCK|\/\*|--|$))/gi;
  while ((m = insertRe.exec(sql))) {
    const name = m[1];
    const explicitCols = m[3]
      ? m[3].split(',').map((s) => s.trim().replace(/`/g, ''))
      : (tables[name] ? tables[name].columns : null);
    if (!explicitCols) continue;
    for (const tuple of splitTuples(m[4])) {
      const vals = parseTuple(tuple);
      if (vals.length !== explicitCols.length) continue;
      const row = {};
      explicitCols.forEach((c, i) => { row[c] = vals[i]; });
      (rows[name] = rows[name] || []).push(row);
    }
  }
  return { tables, rows };
}

// return the substring inside the parens that begins at index `open` (a '('),
// matching the balanced close paren; quote- and escape-aware.
function extractBalanced(str, open) {
  let depth = 0, q = null, out = '';
  for (let i = open; i < str.length; i++) {
    const ch = str[i];
    if (q) {
      out += ch;
      if (ch === '\\') { out += str[++i]; }
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '`' || ch === '"') { q = ch; out += ch; continue; }
    if (ch === '(') { depth++; if (depth === 1) { out = ''; continue; } }
    if (ch === ')') { depth--; if (depth === 0) return out; }
    out += ch;
  }
  return out;
}

// split the "(..),(..),(..)" body into individual "(..)" tuples (quote-aware)
function splitTuples(body) {
  const out = []; let depth = 0, cur = '', q = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (q) {
      cur += ch;
      if (ch === '\\') { cur += body[++i]; }
      else if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue; } }
    if (ch === ')') { depth--; if (depth === 0) { out.push(cur); continue; } }
    cur += ch;
  }
  return out;
}

// parse one tuple's comma-separated SQL values → JS values
function parseTuple(t) {
  const out = []; let cur = '', q = null, started = false;
  const push = (v) => { out.push(v); cur = ''; started = false; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '\\') { cur += t[++i]; }
      else if (ch === q) { q = null; }
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; started = true; continue; }
    if (ch === ',') { push(coerce(cur, started)); continue; }
    cur += ch;
  }
  push(coerce(cur, started));
  return out;
}
function coerce(raw, wasQuoted) {
  if (wasQuoted) return raw;
  const v = raw.trim();
  if (v === '' ) return '';
  if (/^NULL$/i.test(v)) return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v; // keep as string; consumer casts
  return v;
}

// ── field mapping by fuzzy name ─────────────────────────────
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function buildColumnMap(columns) {
  const normed = columns.map((c) => [c, norm(c)]);
  const used = new Set();
  const map = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const wanted = aliases.map(norm);
    // exact alias match first; then source-column-CONTAINS-alias (never the
    // reverse — that lets 'address' wrongly claim the 'address2' field). One
    // source column maps to at most one field (claim order = alias order).
    let hit = normed.find(([c, n]) => !used.has(c) && wanted.includes(n));
    if (!hit) hit = normed.find(([c, n]) => !used.has(c) && wanted.some((w) => n.includes(w)));
    if (hit) { map[field] = hit[0]; used.add(hit[0]); }
  }
  return map;
}

function detectPasswordAlgo(hash) {
  if (!hash) return null;
  if (/^\$2[aby]\$/.test(hash)) return 'bcrypt';
  if (/^\$argon2/.test(hash)) return 'argon2';
  if (/^[a-f0-9]{32}$/i.test(hash)) return 'md5';
  if (/^[a-f0-9]{40}$/i.test(hash)) return 'sha1';
  if (/^[a-f0-9]{64}$/i.test(hash)) return 'sha256';
  return 'unknown';
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const TIERS = ['platinum', 'gold', 'silver', 'bronze', 'supporter', 'member'];
function normTier(v) {
  const n = norm(v || '');
  return TIERS.find((t) => n.includes(t)) || 'member';
}
function normStatus(v) {
  const n = norm(v || '');
  if (n.includes('pend')) return 'pending';
  if (n.includes('susp')) return 'suspended';
  if (n === 'n' || n.includes('inactive') || n.includes('notactive')) return 'inactive';
  return 'approved';
}

// ── main ────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const discover = args.includes('--discover');
  const tableArg = (args[args.indexOf('--table') + 1] || '').replace(/^--.*/, '');
  if (!file) { console.error('Usage: node scripts/import-chamberware.js <dump.sql> [--table NAME] [--discover]'); process.exit(1); }

  const sql = fs.readFileSync(file, 'utf8');
  const { tables, rows } = parseDump(sql);

  console.log('\nDiscovered tables:');
  for (const [name, t] of Object.entries(tables)) {
    console.log(`  • ${name} (${(rows[name] || []).length} rows) — cols: ${t.columns.join(', ')}`);
  }
  if (discover) { console.log('\n--discover only; no files written.'); return; }

  // choose the members/accounts table: explicit, else best guess
  let table = tableArg && tables[tableArg] ? tableArg : null;
  if (!table) {
    const score = (name) => {
      const map = buildColumnMap(tables[name].columns);
      return ['company', 'email', 'phone'].filter((f) => map[f]).length + (rows[name] || []).length / 1e6;
    };
    table = Object.keys(tables).sort((a, b) => score(b) - score(a))[0];
  }
  if (!table) { console.error('No usable table found. Run with --discover and pass --table NAME.'); process.exit(1); }

  const colMap = buildColumnMap(tables[table].columns);
  console.log(`\nUsing table "${table}". Column map:`);
  console.log(Object.entries(colMap).map(([k, v]) => `  ${k} ← ${v}`).join('\n'));
  const get = (row, field) => (colMap[field] ? row[colMap[field]] : undefined);

  const members = [], users = [];
  let withPw = 0, unknownPw = 0;
  for (const row of rows[table] || []) {
    const rawId = get(row, 'id');
    const company = get(row, 'company') || '';
    if (!company && !get(row, 'email')) continue;
    const id = rawId ? `m${rawId}` : slug(company) || `m${members.length + 1}`;
    const member = {
      id,
      name: company,
      category: get(row, 'category') || 'Member',
      tier: normTier(get(row, 'tier')),
      neighborhood: get(row, 'neighborhood') || get(row, 'city') || '',
      contactName: [get(row, 'firstName'), get(row, 'lastName')].filter(Boolean).join(' '),
      address: [get(row, 'address'), get(row, 'address2')].filter(Boolean).join(', '),
      city: get(row, 'city') || '',
      state: get(row, 'state') || '',
      zip: get(row, 'zip') || '',
      phone: get(row, 'phone') || '',
      fax: get(row, 'fax') || '',
      website: get(row, 'website') || '',
      tagline: get(row, 'tagline') || '',
      description: get(row, 'description') || '',
      leaderStatus: get(row, 'leaderStatus') || '',
      employees: get(row, 'employees') || '',
      yearEstablished: get(row, 'yearEstablished') || '',
      status: normStatus(get(row, 'status')),
      seal: (company[0] || '?').toUpperCase(),
    };
    members.push(member);

    const email = get(row, 'email');
    const hash = get(row, 'passwordHash');
    if (email || get(row, 'username')) {
      const algo = detectPasswordAlgo(hash);
      if (hash) withPw++; if (algo === 'unknown') unknownPw++;
      users.push({
        id, memberId: id,
        email: email || '',
        username: get(row, 'username') || email || '',
        passwordHash: hash || '',
        passwordAlgo: algo,
        role: 'member',
        status: member.status,
        // keep-same-login: verify against legacy hash, rehash to bcrypt on first success.
        needsReset: !hash || algo === 'unknown',
      });
    }
  }

  fs.mkdirSync(STORE, { recursive: true });
  const meta = { importedAt: new Date().toISOString(), sourceTable: table, count: members.length };
  fs.writeFileSync(path.join(STORE, 'members.json'),
    JSON.stringify({ _meta: meta, members }, null, 2));
  fs.writeFileSync(path.join(STORE, 'users.json'),
    JSON.stringify({ _meta: { ...meta, count: users.length, withPassword: withPw, unknownAlgo: unknownPw }, users }, null, 2));

  console.log(`\n✓ Wrote ${members.length} members → data/_store/members.json`);
  console.log(`✓ Wrote ${users.length} users → data/_store/users.json  (${withPw} with password hash, ${unknownPw} unknown algo → reset-on-first-login)`);
  console.log('\nPII stays in data/_store/ (gitignored). users.json is server-only — never web-served.');
}

main();
