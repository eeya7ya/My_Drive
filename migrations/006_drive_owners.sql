-- 006: a drive is somebody's to run, and the admin sits above them.
--
-- Until now one admin password did everything: it created the drives, and it
-- also added every folder and renamed every file inside them. Those are two
-- different jobs held by two different people, so the line is drawn
-- differently now.
--
--   - Whoever is IN a drive runs it: its folders, its files and revisions, and
--     the identity it wears (name, tagline, address, numbering). No second
--     credential — being in the drive is what makes it theirs, so the person
--     the drive is for adds their own folders the moment they can open it.
--   - The ADMIN sits above the drives: which of them exist, WHO IS IN each one
--     (its visibility and its passcode — that is the membership), and how much
--     each may store. The admin does not add folders.
--
-- So this migration adds no credential. What it adds is the admin's record of
-- who each drive was given to, so a registry of drives is also a registry of
-- the people using them. The credential that lets that person in is the
-- passcode_hash the drives table already had, and the admin panel sets it.
--
-- Quotas need no column either: they already live in `settings` as quota_bytes
-- and <drive>/quota_bytes, and the admin panel writes them there.
--
-- Run in the D1 console (use the .console.sql copy) before deploying the code
-- that reads these columns — though the registry tolerates their absence and
-- reads a drive as one with nobody recorded against it until the migration
-- lands, so a deploy that arrives first serves the site rather than an error
-- page. Safe to run once; a second run fails on the ALTER TABLE, which is
-- harmless.

ALTER TABLE drives ADD COLUMN owner_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE drives ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';

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
