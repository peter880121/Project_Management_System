-- Additive and replay-safe. Prior acceptance snapshots remain unchanged.
ALTER TABLE AiSuggestion MODIFY COLUMN type ENUM('WBS','ESTIMATE','RISK','AUDIT_SUMMARY','MEETING_SUMMARY','ACCEPTANCE_DIAGNOSIS') NOT NULL;
SET @precheck_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ProjectMember' AND COLUMN_NAME='canOverrideAcceptance')=0, 'ALTER TABLE ProjectMember ADD COLUMN canOverrideAcceptance BOOLEAN NOT NULL DEFAULT false', 'SELECT 1');
PREPARE precheck_stmt FROM @precheck_ddl; EXECUTE precheck_stmt; DEALLOCATE PREPARE precheck_stmt;
SET @precheck_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ProjectAcceptance' AND COLUMN_NAME='overrideReason')=0, 'ALTER TABLE ProjectAcceptance ADD COLUMN overrideReason TEXT NULL', 'SELECT 1');
PREPARE precheck_stmt FROM @precheck_ddl; EXECUTE precheck_stmt; DEALLOCATE PREPARE precheck_stmt;
SET @precheck_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ProjectAcceptance' AND COLUMN_NAME='overrideGapCount')=0, 'ALTER TABLE ProjectAcceptance ADD COLUMN overrideGapCount INTEGER UNSIGNED NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE precheck_stmt FROM @precheck_ddl; EXECUTE precheck_stmt; DEALLOCATE PREPARE precheck_stmt;
SET @precheck_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ProjectAcceptance' AND COLUMN_NAME='overrideCheckId')=0, 'ALTER TABLE ProjectAcceptance ADD COLUMN overrideCheckId CHAR(36) NULL', 'SELECT 1');
PREPARE precheck_stmt FROM @precheck_ddl; EXECUTE precheck_stmt; DEALLOCATE PREPARE precheck_stmt;
CREATE TABLE IF NOT EXISTS ProjectComplianceCheck (
 id CHAR(36) NOT NULL PRIMARY KEY, projectId CHAR(36) NOT NULL, actorId CHAR(36) NOT NULL,
 ruleVersion INTEGER UNSIGNED NOT NULL DEFAULT 1, projectVersion INTEGER UNSIGNED NOT NULL,
 passed BOOLEAN NOT NULL, counts JSON NOT NULL, fingerprint CHAR(64) NOT NULL,
 createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 INDEX ProjectComplianceCheck_projectId_actorId_createdAt_idx (projectId,actorId,createdAt),
 CONSTRAINT ProjectComplianceCheck_projectId_fkey FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ProjectComplianceCheck_actorId_fkey FOREIGN KEY (actorId) REFERENCES User(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
DROP TRIGGER IF EXISTS compliance_check_immutable_update;
CREATE TRIGGER compliance_check_immutable_update BEFORE UPDATE ON ProjectComplianceCheck FOR EACH ROW SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_COMPLIANCE_CHECK_IMMUTABLE';
DROP TRIGGER IF EXISTS compliance_check_immutable_delete;
CREATE TRIGGER compliance_check_immutable_delete BEFORE DELETE ON ProjectComplianceCheck FOR EACH ROW SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_COMPLIANCE_CHECK_IMMUTABLE';
DROP TRIGGER IF EXISTS compliance_override_immutable_update;
CREATE TRIGGER compliance_override_immutable_update BEFORE UPDATE ON ProjectAcceptance FOR EACH ROW BEGIN
 IF NOT (NEW.overrideReason <=> OLD.overrideReason) OR NOT (NEW.overrideGapCount <=> OLD.overrideGapCount) OR NOT (NEW.overrideCheckId <=> OLD.overrideCheckId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ACCEPTANCE_IMMUTABLE'; END IF;
END;

SET @precheck_ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='AuditLog' AND INDEX_NAME='AuditLog_projectId_entityType_action_entityId_idx')=0, 'CREATE INDEX AuditLog_projectId_entityType_action_entityId_idx ON AuditLog(projectId,entityType,action,entityId)', 'SELECT 1');
PREPARE precheck_stmt FROM @precheck_ddl; EXECUTE precheck_stmt; DEALLOCATE PREPARE precheck_stmt;
