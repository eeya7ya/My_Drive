CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  drive_key     TEXT NOT NULL REFERENCES drives(key) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_drive ON users(drive_key);
CREATE INDEX IF NOT EXISTS idx_users_signin ON users(drive_key, password_hash);
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
