-- 006: storage rows for the drives, so the admin panel has a quota to show.
--
-- The access model needs no migration: a drive's password lives in the
-- `drives.passcode_hash` column the schema has always had. The admin panel
-- sets it, whoever is given it opens the drive with it, and once they are in,
-- everything in the drive is theirs.
--
-- What this does add is the quota row for every drive that already exists, so
-- the panel shows and edits a real number rather than an implicit default it
-- cannot see.
--
-- Safe to run twice, and safe to run late — nothing about who can do what
-- changes when it runs.
--
-- (An earlier draft of this migration created a `users` table. Nothing reads
-- it: the drive's own password replaced it. If you ran that draft, the empty
-- table is harmless and can be dropped with DROP TABLE IF EXISTS users;)

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
