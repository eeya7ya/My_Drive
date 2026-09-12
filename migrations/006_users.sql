-- 006: users, each with a password, each belonging to one drive.
--
-- Until now one admin password did everything: it created the drives, and it
-- also added every folder and renamed every file inside them. Those are two
-- different jobs held by two different people.
--
--   - The ADMIN creates users and gives them passwords, and decides how much
--     each drive may store. That is the whole of the admin panel.
--   - A USER signs in to their own drive with their own password and does
--     everything in it: adds folders, renames and deletes them, uploads,
--     manages revisions, and edits the drive's name, address and numbering.
--     They never have to ask the admin for anything again.
--
-- One row per person. `drive_key` is the drive that person runs — several
-- users may share one drive, and deleting a drive deletes its users with it.
-- `password_hash` is an HMAC under SESSION_SECRET, exactly as a drive's
-- passcode already is, so the database never holds a password itself and a
-- leaked row does not open anything.
--
-- Signing in happens on the drive: the password is hashed and looked up
-- against the users of that drive, which is one indexed read. The session
-- signs the password hash alongside the user id, so changing somebody's
-- password — or deleting them — signs them out at once.
--
-- Quotas need no column: they already live in `settings` as quota_bytes and
-- <drive>/quota_bytes, and the admin panel writes them there. The rows are
-- seeded below so the panel has a number to show rather than an implicit
-- default it cannot see.
--
-- Run in the D1 console (use the .console.sql copy) before deploying the code
-- that reads this table — though the app tolerates its absence and reads every
-- drive as one with no users yet, so a deploy that arrives first serves the
-- site rather than an error page. Safe to run twice.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  -- What the admin panel lists them as, and what they are told they are.
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  -- The drive this person runs. Their password does nothing on any other.
  drive_key     TEXT NOT NULL REFERENCES drives(key) ON DELETE CASCADE,
  -- HMAC of their password under SESSION_SECRET. Never the password itself.
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL
);

-- Sign-in is "this password, on this drive", so that pair is the index.
CREATE INDEX IF NOT EXISTS idx_users_drive ON users(drive_key);
CREATE INDEX IF NOT EXISTS idx_users_signin ON users(drive_key, password_hash);

-- Every drive that already exists gets its storage rows, so the admin panel
-- has a quota to show and edit.
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
