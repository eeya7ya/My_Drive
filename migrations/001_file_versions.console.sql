CREATE TABLE IF NOT EXISTS file_versions (
  id           TEXT PRIMARY KEY,
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  r2_key       TEXT NOT NULL UNIQUE,
  uploaded     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  uploaded_at  INTEGER,
  UNIQUE (file_id, version)
);
CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id, version DESC);
ALTER TABLE files ADD COLUMN current_version_id TEXT;
ALTER TABLE files ADD COLUMN version_count INTEGER NOT NULL DEFAULT 0;
INSERT INTO file_versions (id, file_id, version, size_bytes, content_type, r2_key, uploaded, created_at, uploaded_at)
SELECT 'v1-' || id, id, 1, size_bytes, content_type, r2_key, uploaded, created_at, modified_at
FROM files;
UPDATE files SET current_version_id = 'v1-' || id, version_count = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder_id, name);
INSERT OR IGNORE INTO settings (key, value) VALUES ('used_bytes', '0');
UPDATE settings
   SET value = (SELECT COALESCE(SUM(size_bytes), 0) FROM file_versions WHERE uploaded = 1)
 WHERE key = 'used_bytes';
