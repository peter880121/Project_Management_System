-- Stop writers and back up. Never remove checks, exceptions or audit evidence.
SET @precheck_guard = IF((SELECT COUNT(*) FROM ProjectComplianceCheck) + (SELECT COUNT(*) FROM ProjectAcceptance WHERE overrideGapCount>0) + (SELECT COUNT(*) FROM ProjectMember WHERE canOverrideAcceptance=true) + (SELECT COUNT(*) FROM AiSuggestion WHERE type='ACCEPTANCE_DIAGNOSIS') = 0, 'SELECT 1', 'SELECT * FROM PRECHECK_ROLLBACK_REFUSED_KEEP_EVIDENCE');
PREPARE guard_stmt FROM @precheck_guard; EXECUTE guard_stmt; DEALLOCATE PREPARE guard_stmt;
DROP TRIGGER IF EXISTS compliance_override_immutable_update;
DROP TRIGGER IF EXISTS compliance_check_immutable_delete;
DROP TRIGGER IF EXISTS compliance_check_immutable_update;
DROP TABLE ProjectComplianceCheck;
DROP INDEX AuditLog_projectId_entityType_action_entityId_idx ON AuditLog;
ALTER TABLE ProjectAcceptance DROP COLUMN overrideReason, DROP COLUMN overrideGapCount, DROP COLUMN overrideCheckId;
ALTER TABLE ProjectMember DROP COLUMN canOverrideAcceptance;
ALTER TABLE AiSuggestion MODIFY COLUMN type ENUM('WBS','ESTIMATE','RISK','AUDIT_SUMMARY','MEETING_SUMMARY') NOT NULL;
