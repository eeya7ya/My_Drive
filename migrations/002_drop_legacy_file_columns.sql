-- Migration 002 — remove the legacy per-file storage columns.
--
-- Migration 001 added current_version_id and version_count but left files
-- carrying r2_key / size_bytes / content_type / uploaded from the original
-- schema. r2_key is NOT NULL, and the revisions code no longer writes it there
-- (it belongs to file_versions now), so every new upload failed with
-- "NOT NULL constraint failed: files.r2_key" and /api/files returned 500.
--
-- r2_key is UNIQUE, so ALTER TABLE ... DROP COLUMN cannot remove it — SQLite
-- refuses to drop an indexed column. The table must be rebuilt.
--
-- The order below matters. file_versions references files with ON DELETE
-- CASCADE, and DROP TABLE performs an implicit DELETE of every row: dropping
-- files while file_versions still points at it deletes the entire revision
-- history. So the history is parked in a constraint-free copy and the child
-- table is dropped FIRST, leaving nothing to cascade into, then both are
-- rebuilt and the rows restored.
--
-- Run after 001. Safe on a drive with files.

CREATE TABLE fv_backup AS SELECT * FROM file_versions;

DROP TABLE file_versions;

CREATE TABLE files_new (
  id                 TEXT PRIMARY KEY,
  folder_id          TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  ext                TEXT NOT NULL DEFAULT 'file',
  current_version_id TEXT,
  version_count      INTEGER NOT NULL DEFAULT 0,
  created_at         INTEGER NOT NULL,
  modified_at        INTEGER NOT NULL
);

INSERT INTO files_new (id, folder_id, name, ext, current_version_id, version_count, created_at, modified_at)
SELECT id, folder_id, name, ext, current_version_id, version_count, created_at, modified_at
FROM files;

DROP TABLE files;

ALTER TABLE files_new RENAME TO files;

CREATE TABLE file_versions (
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

INSERT INTO file_versions (id, file_id, version, size_bytes, content_type, r2_key, uploaded, created_at, uploaded_at)
SELECT id, file_id, version, size_bytes, content_type, r2_key, uploaded, created_at, uploaded_at
FROM fv_backup;

DROP TABLE fv_backup;

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_files_folder_name ON files(folder_id, name);
CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id, version DESC);
