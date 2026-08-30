-- Yahya Khaled Drive — Cloudflare D1 schema
-- Small, relational data only. File bytes live in R2; this stores metadata.

-- Folder tree. parent_id NULL = a root-level folder ("My Drive" is virtual).
CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT 'folder',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  modified_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_name   ON folders(name);

-- Files. r2_key points at the object in the R2 bucket.
-- folder_id NULL = a file sitting at the drive root.
CREATE TABLE IF NOT EXISTS files (
  id           TEXT PRIMARY KEY,
  folder_id    TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  ext          TEXT NOT NULL DEFAULT 'file',
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  r2_key       TEXT NOT NULL UNIQUE,
  uploaded     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  modified_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_key    ON files(r2_key);

-- Single-row settings, e.g. the storage quota shown in the sidebar.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('quota_bytes', '214748364800');
