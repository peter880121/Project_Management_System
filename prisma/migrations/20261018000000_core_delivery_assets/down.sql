-- Optional structural rollback for EMPTY assets only. MySQL DDL is not transactional.
-- Prefer rolling the application back while retaining these additive tables/columns.
-- Stop workers and back up the database first. Never remove audit records.
SET @asset_rollback_guard = IF(
  (SELECT COUNT(*) FROM Deliverable) + (SELECT COUNT(*) FROM MeetingRecord) +
  (SELECT COUNT(*) FROM AssetSourceJob) + (SELECT COUNT(*) FROM Task WHERE requiresDeliverable = true) = 0,
  'SELECT 1', 'SELECT * FROM ASSET_ROLLBACK_REFUSED_BACKUP_AND_KEEP_ASSET_RECORDS');
PREPARE asset_guard FROM @asset_rollback_guard;
EXECUTE asset_guard;
DEALLOCATE PREPARE asset_guard;
DROP TABLE AssetSourceJob;
DROP TABLE MeetingRecord;
DROP TABLE Deliverable;
ALTER TABLE Task DROP COLUMN requiresDeliverable;
ALTER TABLE Document DROP COLUMN documentType, DROP COLUMN visibleRoles;
