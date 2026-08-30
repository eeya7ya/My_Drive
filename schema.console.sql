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
CREATE TABLE IF NOT EXISTS files (
  id                 TEXT PRIMARY KEY,
  folder_id          TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  ext                TEXT NOT NULL DEFAULT 'file',
  current_version_id TEXT,
  version_count      INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  modified_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder_id, name);
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
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('used_bytes', '0');
