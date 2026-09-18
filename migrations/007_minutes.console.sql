CREATE TABLE IF NOT EXISTS minutes (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  client       TEXT NOT NULL DEFAULT '',
  project      TEXT NOT NULL DEFAULT '',
  meeting_date TEXT NOT NULL DEFAULT '',
  document     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  modified_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_minutes_modified ON minutes(modified_at DESC);
