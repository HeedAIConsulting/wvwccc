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
  member_id       text,                        -- linked listing; no FK (members live in JSON/seed, not PG yet)
  email           text UNIQUE NOT NULL,
  username        text,
  password_hash   text,                        -- legacy hash on import; bcrypt after first login
  password_algo   text,                        -- bcrypt|md5|sha1|sha256|unknown
  needs_reset     boolean DEFAULT false,       -- true → force set-a-password on first login
  must_change     boolean DEFAULT false,       -- true → logged in w/ legacy pw, force change now
  role            text DEFAULT 'member',       -- member|staff|admin
  status          text DEFAULT 'approved',
  last_login      timestamptz,
  created_at      timestamptz DEFAULT now()
);
-- Drop the old FK if a previous migration created it (members aren't in PG).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_member_id_fkey;
-- Add columns that may be missing on a users table created by an earlier schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_reset boolean DEFAULT false;

-- ── Orders (payments via AGMS) ─────────────────────────────
-- One-time, idempotent rebuild: the very first deploy created `orders` with a
-- bigint id + FK. Drop it only if that old shape is present (it's empty pre-launch).
-- After the rebuild id is text, so this never fires again → no data loss.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'orders' AND column_name = 'id'
               AND data_type IN ('bigint', 'integer')) THEN
    DROP TABLE orders;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS orders (
  id              text PRIMARY KEY,            -- app-generated 'ord-...'
  kind            text,                        -- ticket|donation|membership
  sku             text,
  member_id       text,                        -- no FK yet (members not loaded to PG until import)
  name            text,
  email           text,
  amount          numeric(10,2),
  transaction_id  text,                        -- AGMS/NMI transaction id
  heed_share      numeric(10,2),               -- 15% remittance
  status          text DEFAULT 'paid',
  created         timestamptz DEFAULT now()
);

-- ── Leads / inquiries (contact + membership forms) ─────────
CREATE TABLE IF NOT EXISTS leads (
  id          text PRIMARY KEY,                -- 'lead-...'
  kind        text,
  name        text,
  email       text,
  phone       text,
  company     text,
  reason      text,
  event       text,
  message     text,
  status      text DEFAULT 'new',              -- new|read|done
  received    timestamptz DEFAULT now()
);

-- ── Content posts: member offers/discounts, member-to-member board,
--    and staff-created news/announcements/messaging. Approval-gated. ──
CREATE TABLE IF NOT EXISTS posts (
  id            text PRIMARY KEY,              -- 'post-...'
  type          text NOT NULL,                 -- discount | member_post | news | announcement | event
  author_id     text,                          -- user email or staff id
  author_name   text,
  member_id     text,                          -- linked listing (for member posts/discounts)
  title         text,
  body          text,
  image_url     text,
  link_url      text,
  cta_label     text,
  cta_url       text,
  code          text,                          -- discount code / terms
  status        text DEFAULT 'pending',        -- pending | approved | rejected
  featured_home boolean DEFAULT false,
  expires_at    timestamptz,
  created       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_type_status_idx ON posts (type, status);

-- ── Events (admin-managed; full record kept as a jsonb blob so the
--    flexible fields — images[], links[] — need no schema churn). ──
CREATE TABLE IF NOT EXISTS events (
  id       text PRIMARY KEY,                     -- 'ev-...' or seed id
  data     jsonb NOT NULL,                       -- the full event object
  created  timestamptz DEFAULT now(),
  updated  timestamptz DEFAULT now()
);

-- ── Image assets (logos, photos) stored in Postgres so they survive
--    Render's ephemeral disk. Served via /api/assets/:id. ──
CREATE TABLE IF NOT EXISTS assets (
  id          text PRIMARY KEY,                -- 'asset-...'
  member_id   text,
  kind        text,                            -- logo | photo
  mime        text,
  bytes       bytea,
  created     timestamptz DEFAULT now()
);

-- ── Member self-service profile edits (member portal) ─────
-- Stores only the fields a member changed; merged onto the base directory record.
CREATE TABLE IF NOT EXISTS member_profiles (
  id          text PRIMARY KEY,                -- member id
  data        jsonb NOT NULL DEFAULT '{}',     -- { tagline, description, phone, website, hours, ... }
  updated_at  timestamptz DEFAULT now()
);

-- ── Admin overrides on directory members (status radios, featured, tier) ──
CREATE TABLE IF NOT EXISTS member_overrides (
  id            text PRIMARY KEY,              -- member id from directory/import
  status        text,
  tier          text,
  leader_status text,
  featured      boolean,
  expire_date   text,                          -- manual renewal/expiration date (YYYY-MM-DD)
  term_months   int,                           -- membership length in months (12=annual)
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE member_overrides ADD COLUMN IF NOT EXISTS expire_date text;
ALTER TABLE member_overrides ADD COLUMN IF NOT EXISTS term_months int;

-- ── Manually-added members (offline signups; merged into the directory) ──
CREATE TABLE IF NOT EXISTS added_members (
  id       text PRIMARY KEY,                   -- 'm-...' app-generated
  data     jsonb NOT NULL,                     -- full member object
  created  timestamptz DEFAULT now()
);

-- Member groups / networks (YPN, Home Improvement, etc.) — jsonb like events
CREATE TABLE IF NOT EXISTS groups (
  id      TEXT PRIMARY KEY,
  data    JSONB NOT NULL,
  created TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated TIMESTAMPTZ NOT NULL DEFAULT now()
);
