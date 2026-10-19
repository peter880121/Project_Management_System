-- Maintenance only. Stop writers and back up first; never remove audit evidence.
-- Refuse structural downgrade if it would erase a draft or meeting-AI provenance.
SET @meeting_rollback_guard = IF(
  (SELECT COUNT(*) FROM MeetingRecord WHERE status='DRAFT') +
  (SELECT COUNT(*) FROM AiSuggestion WHERE type='MEETING_SUMMARY') = 0,
  'SELECT 1', 'SELECT * FROM MEETING_AI_ROLLBACK_REFUSED_KEEP_DRAFTS_AND_EVIDENCE');
PREPARE meeting_guard FROM @meeting_rollback_guard; EXECUTE meeting_guard; DEALLOCATE PREPARE meeting_guard;
ALTER TABLE MeetingRecord DROP COLUMN status, DROP COLUMN rowVersion;
ALTER TABLE AiSuggestion MODIFY COLUMN type ENUM('WBS','ESTIMATE','RISK','AUDIT_SUMMARY') NOT NULL;
