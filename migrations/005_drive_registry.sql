-- 005: drives become rows, not code.
--
-- Until now the drives this deployment serves were a hardcoded record in
-- lib/brand.ts, and each one needed its own route file. This moves them into
-- the database so the admin panel can add one, and gives every drive its own
-- address: the main drive at /yahya, the eSpark drive at /advec, and "/"
-- freed up for the dashboard.
--
-- `key` is what folders.drive and files.drive already store, so it never
-- changes; `slug` is the address, and may be edited. Old slugs are kept in
-- drive_slugs so a renamed drive's links keep resolving.
--
-- Run in the D1 console (use the .console.sql copy) before deploying the code
-- that reads these tables. Safe to run twice.

CREATE TABLE IF NOT EXISTS drives (
  key           TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL,
  short_name    TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  numbered      INTEGER NOT NULL DEFAULT 0,
  powered_by    TEXT,
  -- 'public' opens to anyone with the link; 'private' asks for the passcode.
  visibility    TEXT NOT NULL DEFAULT 'public',
  -- Whether the dashboard names it at all. A private drive may still be
  -- listed, so visitors can see it exists and ask for access.
  listed        INTEGER NOT NULL DEFAULT 1,
  -- HMAC of the passcode under SESSION_SECRET; NULL on a public drive.
  passcode_hash TEXT,
  -- Exactly one drive may carry this: the drive whose folders used to sit at
  -- the site root, so /literature/papers still redirects to its new address.
  legacy_root   INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL
);

-- Every address a drive has ever answered to, so renaming its slug costs no
-- broken links. The current slug lives in drives.slug; this holds the rest.
CREATE TABLE IF NOT EXISTS drive_slugs (
  slug       TEXT PRIMARY KEY,
  drive_key  TEXT NOT NULL REFERENCES drives(key) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drive_slugs_drive ON drive_slugs(drive_key);

-- Access requests raised from the dashboard. Kept in the database rather than
-- mailed anywhere, so the admin panel is the one place they are answered.
CREATE TABLE IF NOT EXISTS drive_requests (
  id         TEXT PRIMARY KEY,
  -- The drive asked for, or NULL when someone is asking for a drive of their own.
  drive_key  TEXT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  -- 'new' until the admin acts on it, then 'approved' or 'dismissed'.
  status     TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  handled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_drive_requests_status ON drive_requests(status, created_at DESC);

-- The two drives that already exist, with the identities lib/brand.ts held.
-- The main drive moves off "/" to /yahya and keeps legacy_root = 1, which is
-- what lets its old root-level links redirect instead of 404.
INSERT OR IGNORE INTO drives
  (key, slug, name, tagline, title, short_name, description, numbered, powered_by,
   visibility, listed, passcode_hash, legacy_root, position, created_at, modified_at)
VALUES
  ('main', 'yahya', 'YAHYA KHALED', 'Power Systems Drive',
   'Yahya Khaled — Power Systems Drive', 'PS Drive',
   'Power systems study drive: folders, files, and admin management.',
   0, NULL, 'public', 1, NULL, 1, 0, 1756000000000, 1756000000000),
  ('advec', 'advec', 'eSpark', 'Drive', 'eSpark Drive', 'eSpark',
   'eSpark drive: numbered folders, files, and revisions.',
   1, 'eSpark', 'public', 1, NULL, 0, 1, 1756000000000, 1756000000000);

-- /espark redirected to /advec in next.config.mjs; record it here too so the
-- redirect can be retired without stranding those links.
INSERT OR IGNORE INTO drive_slugs (slug, drive_key, created_at)
VALUES ('espark', 'advec', 1756000000000);
