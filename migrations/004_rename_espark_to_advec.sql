-- 004: the eSpark drive's key becomes 'advec', matching its address /advec.
--
-- Only for a database that already ran 003 with the old key. Moves every
-- eSpark folder and file row and the drive's two counters. Nothing is
-- deleted. A database created from the current schema.sql needs nothing.

UPDATE folders  SET drive = 'advec' WHERE drive = 'espark';
UPDATE files    SET drive = 'advec' WHERE drive = 'espark';
UPDATE settings SET key = 'advec/quota_bytes' WHERE key = 'espark/quota_bytes';
UPDATE settings SET key = 'advec/used_bytes'  WHERE key = 'espark/used_bytes';
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/used_bytes', '0');
