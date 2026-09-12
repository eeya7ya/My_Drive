-- 006: a drive has an owner, and the admin sits above them.
--
-- Until now one admin password did everything: it created the drives, and it
-- also added every folder and renamed every file inside them. Those are two
-- different jobs held by two different people, so they are two roles now.
--
--   - The drive's OWNER runs the drive: its folders, its files and revisions,
--     and the identity it wears (name, tagline, address, numbering, and the
--     passcode readers are given). One owner per drive, signing in with the
--     passcode stored below as owner_hash.
--   - The ADMIN sits above the drives: which of them exist, who owns each one,
--     and how much each may store. The admin does not add folders.
--
-- owner_name / owner_email are bookkeeping — who the admin handed the drive
-- to, so a registry of drives is also a registry of the people running them.
-- owner_hash is the credential: an HMAC of the owner's passcode under
-- SESSION_SECRET, exactly as passcode_hash already is, so the database never
-- holds either passcode itself. The two hashes are keyed differently, so the
-- same word used for both does not produce the same row.
--
-- Quotas need no column: they already live in `settings` as quota_bytes and
-- <drive>/quota_bytes, and the admin panel writes them there.
--
-- Run in the D1 console (use the .console.sql copy) before deploying the code
-- that reads these columns — though the registry tolerates their absence and
-- reads a drive as "no owner yet" until the migration lands, so a deploy that
-- arrives first serves the site rather than an error page. Safe to run once; a
-- second run fails on the ALTER TABLE, which is harmless.

ALTER TABLE drives ADD COLUMN owner_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE drives ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';
ALTER TABLE drives ADD COLUMN owner_hash  TEXT;

-- Every drive that already exists gets its quota row, so the admin panel has
-- a number to show and edit rather than an implicit default it cannot see.
INSERT OR IGNORE INTO settings (key, value)
SELECT
  CASE WHEN key = 'main' THEN 'quota_bytes' ELSE key || '/quota_bytes' END,
  '214748364800'
FROM drives;

INSERT OR IGNORE INTO settings (key, value)
SELECT
  CASE WHEN key = 'main' THEN 'used_bytes' ELSE key || '/used_bytes' END,
  '0'
FROM drives;
