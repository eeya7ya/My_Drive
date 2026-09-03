ALTER TABLE folders ADD COLUMN drive TEXT NOT NULL DEFAULT 'main';
ALTER TABLE files   ADD COLUMN drive TEXT NOT NULL DEFAULT 'main';
CREATE INDEX IF NOT EXISTS idx_folders_drive ON folders(drive, parent_id);
CREATE INDEX IF NOT EXISTS idx_files_drive   ON files(drive, folder_id);
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/used_bytes', '0');
