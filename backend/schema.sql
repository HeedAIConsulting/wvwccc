-- WVWCCC production schema (Postgres) — system of record after the JSON-store phase.
-- Load data/_store/{members,users}.json into these tables during hardening.

-- ── Members / directory profiles ───────────────────────────
CREATE TABLE IF NOT EXISTS members (
  id              text PRIMARY KEY,            -- e.g. "m16223" (from ChamberWare accounts_id)
  name            text NOT NULL,               -- company / business name
  category        text,
  tier            text DEFAULT 'member',       -- platinum|gold|silver|bronze|supporter|member
  neighborhood    text,
  contact_name    text,
  address         text,
  city            text,
  state           text,
  zip             text,
  phone           text,
  fax             text,
  email           text,                        -- private; not exposed by /api/members
  website         text,
  tagline         text,
  description      text,
  employees       int,
  year_established int,
  leader_status   text,                        -- Leader|Board Member|New Member|Past President|Ambassador
  committee_interests text[],                  -- Special Events, Winetasting, Government, ...
  status          text DEFAULT 'approved',     -- approved|pending|suspended|inactive
  featured        boolean DEFAULT false,
  join_date       date,
  expire_date     date,                        -- membership renewal
  seal            text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS members_category_idx     ON members (category);
CREATE INDEX IF NOT EXISTS members_neighborhood_idx ON members (neighborhood);
CREATE INDEX IF NOT EXISTS members_status_idx       ON members (status);

-- ── Auth users (logins migrated from ChamberWare) ──────────
CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  member_id       text REFERENCES members(id) ON DELETE SET NULL,
  email           text UNIQUE NOT NULL,
  username        text,
  password_hash   text,                        -- legacy hash on import; bcrypt after first login
  password_algo   text,                        -- bcrypt|md5|sha1|sha256|unknown
  needs_reset     boolean DEFAULT false,       -- true → force set-a-password on first login
  role            text DEFAULT 'member',       -- member|staff|admin
  status          text DEFAULT 'approved',
  last_login      timestamptz,
  created_at      timestamptz DEFAULT now()
);

-- ── Orders (payments via AGMS) ─────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              bigserial PRIMARY KEY,
  kind            text,                        -- ticket|donation|membership
  sku             text,
  member_id       text REFERENCES members(id),
  email           text,
  amount          numeric(10,2),
  transaction_id  text,                        -- AGMS/NMI transaction id
  heed_share      numeric(10,2),               -- 15% remittance
  status          text DEFAULT 'paid',
  created_at      timestamptz DEFAULT now()
);
