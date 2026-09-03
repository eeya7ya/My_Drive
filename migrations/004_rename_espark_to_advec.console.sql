UPDATE folders  SET drive = 'advec' WHERE drive = 'espark';
UPDATE files    SET drive = 'advec' WHERE drive = 'espark';
UPDATE settings SET key = 'advec/quota_bytes' WHERE key = 'espark/quota_bytes';
UPDATE settings SET key = 'advec/used_bytes'  WHERE key = 'espark/used_bytes';
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/quota_bytes', '214748364800');
INSERT OR IGNORE INTO settings (key, value) VALUES ('advec/used_bytes', '0');
