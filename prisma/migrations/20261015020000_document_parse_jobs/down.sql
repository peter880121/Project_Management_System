-- Removes parse jobs and version metadata; keeps source Document/MinIO objects and AuditLog.
-- Raw result archives remain in MinIO; parsedText remains on Document for manual recovery.
DROP TABLE `DocumentParseJob`;
ALTER TABLE `Document` DROP COLUMN `parseStatus`, DROP COLUMN `parseVersion`, DROP COLUMN `parsedVersion`, DROP COLUMN `parsedAt`;
