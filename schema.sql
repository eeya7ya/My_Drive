-- Yahya Khaled Drive — Cloudflare D1 schema
-- Small, relational data only. File bytes live in R2; this stores metadata.
--
-- D1 bills on rows read, so this schema is shaped to keep a page load O(rows
-- shown) rather than O(rows stored). Two counters (files.version_count and
-- settings.used_bytes) are maintained on write precisely so no page load ever
-- has to aggregate over file_versions, which is the table that grows without
-- bound as revisions pile up. Recompute them with POST /api/admin/recalc if
-- they ever drift.

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

-- A file is a document identity: a name in a folder. Its bytes live in
-- file_versions, and current_version_id says which revision the drive shows.
-- Restoring an older revision only moves that pointer, so no bytes are copied
-- and the history stays intact.
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
-- One document per name per folder: a re-upload becomes a revision, not a twin.
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder_id, name);

-- Every upload of a file, oldest to newest. r2_key points at that revision's
-- object in the bucket; every uploaded row still occupies R2 storage.
-- Only ever read for the current revision (via a join on current_version_id)
-- or on demand when someone opens one file's history.
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

-- Single-row settings. quota_bytes is the sidebar's denominator; used_bytes is
-- the running storage total, kept current on upload and delete so the sidebar
-- costs one row read instead of a SUM over every revision ever stored.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('used_bytes', '0');
