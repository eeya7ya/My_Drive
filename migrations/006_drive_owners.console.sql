ALTER TABLE drives ADD COLUMN owner_name  TEXT NOT NULL DEFAULT '';
ALTER TABLE drives ADD COLUMN owner_email TEXT NOT NULL DEFAULT '';
ALTER TABLE drives ADD COLUMN owner_hash  TEXT;
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
