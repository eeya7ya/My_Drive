-- 003: more than one drive in one database.
--
-- Every folder and file belongs to a drive. Existing rows are the main drive;
-- the eSpark drive lives beside them under drive = 'advec' and is never read
-- by the main drive's queries. Each drive keeps its own storage counter.
--
-- Run in the D1 console (use the .console.sql copy) before deploying code
-- that reads the drive column. Safe to run once; a second run fails on the
-- ALTER TABLE, which is harmless.

ALTER TABLE folders ADD COLUMN drive TEXT NOT NULL DEFAULT 'main';
ALTER TABLE files   ADD COLUMN drive TEXT NOT NULL DEFAULT 'main';

CREATE INDEX IF NOT EXISTS idx_folders_drive ON folders(drive, parent_id);
CREATE INDEX IF NOT EXISTS idx_files_drive   ON files(drive, folder_id);

-- The main drive keeps its original keys. Other drives prefix theirs.
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/used_bytes', '0');
