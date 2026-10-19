-- Additive and replay-safe. Existing minutes stay finalized; no evidence is rewritten.
ALTER TABLE `AiSuggestion` MODIFY COLUMN `type` ENUM('WBS','ESTIMATE','RISK','AUDIT_SUMMARY','MEETING_SUMMARY') NOT NULL;
SET @meeting_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='MeetingRecord' AND COLUMN_NAME='status')=0, 'ALTER TABLE MeetingRecord ADD COLUMN status ENUM(''DRAFT'',''FINALIZED'') NOT NULL DEFAULT ''FINALIZED''', 'SELECT 1');
PREPARE meeting_stmt FROM @meeting_ddl; EXECUTE meeting_stmt; DEALLOCATE PREPARE meeting_stmt;
SET @meeting_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='MeetingRecord' AND COLUMN_NAME='rowVersion')=0, 'ALTER TABLE MeetingRecord ADD COLUMN rowVersion INTEGER UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE meeting_stmt FROM @meeting_ddl; EXECUTE meeting_stmt; DEALLOCATE PREPARE meeting_stmt;
