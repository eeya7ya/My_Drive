CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT REFERENCES folders(id) ON DELETE CASCADE,
  drive       TEXT NOT NULL DEFAULT 'main',
  name        TEXT NOT NULL,
  code        TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT 'folder',
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  modified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_drive ON folders(drive, parent_id);
CREATE TABLE IF NOT EXISTS files (
  id                 TEXT PRIMARY KEY,
  folder_id          TEXT REFERENCES folders(id) ON DELETE CASCADE,
  drive              TEXT NOT NULL DEFAULT 'main',
  name               TEXT NOT NULL,
  ext                TEXT NOT NULL DEFAULT 'file',
  current_version_id TEXT,
  version_count      INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  modified_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_drive ON files(drive, folder_id);
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
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/used_bytes', '0');
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
  visibility    TEXT NOT NULL DEFAULT 'public',
  listed        INTEGER NOT NULL DEFAULT 1,
  passcode_hash TEXT,
  legacy_root   INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drive_slugs (
  slug       TEXT PRIMARY KEY,
  drive_key  TEXT NOT NULL REFERENCES drives(key) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drive_slugs_drive ON drive_slugs(drive_key);
CREATE TABLE IF NOT EXISTS drive_requests (
  id         TEXT PRIMARY KEY,
  drive_key  TEXT,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL,
  handled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_drive_requests_status ON drive_requests(status, created_at DESC);
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
INSERT OR IGNORE INTO drive_slugs (slug, drive_key, created_at)
VALUES ('espark', 'advec', 1756000000000);
