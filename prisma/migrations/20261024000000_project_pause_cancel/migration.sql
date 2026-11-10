-- Additive, repeatable DDL. Existing status/history/audit rows are retained.
ALTER TABLE Project MODIFY COLUMN status ENUM('PLANNING','ACTIVE','ON_HOLD','COMPLETED','PENDING_ACCEPTANCE','ARCHIVED','CANCELLED') NOT NULL DEFAULT 'PLANNING';
SET @lifecycle_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND COLUMN_NAME='pausedFromStatus')=0, 'ALTER TABLE Project ADD COLUMN pausedFromStatus VARCHAR(32) NULL', 'SELECT 1');
PREPARE lifecycle_stmt FROM @lifecycle_ddl; EXECUTE lifecycle_stmt; DEALLOCATE PREPARE lifecycle_stmt;
SET @lifecycle_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND COLUMN_NAME='currentStatusChangeId')=0, 'ALTER TABLE Project ADD COLUMN currentStatusChangeId CHAR(36) NULL', 'SELECT 1');
PREPARE lifecycle_stmt FROM @lifecycle_ddl; EXECUTE lifecycle_stmt; DEALLOCATE PREPARE lifecycle_stmt;
CREATE TABLE IF NOT EXISTS ProjectStatusChange (
  id CHAR(36) NOT NULL PRIMARY KEY,
  projectId CHAR(36) NOT NULL,
  action VARCHAR(32) NOT NULL,
  fromStatus VARCHAR(32) NOT NULL,
  toStatus VARCHAR(32) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  actorId CHAR(36) NOT NULL,
  requestKey CHAR(36) NOT NULL,
  expectedRowVersion INTEGER UNSIGNED NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX ProjectStatusChange_projectId_requestKey_key(projectId, requestKey),
  INDEX ProjectStatusChange_projectId_createdAt_idx(projectId, createdAt),
  CONSTRAINT ProjectStatusChange_projectId_fkey FOREIGN KEY(projectId) REFERENCES Project(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT ProjectStatusChange_actorId_fkey FOREIGN KEY(actorId) REFERENCES User(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @lifecycle_ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND INDEX_NAME='Project_currentStatusChangeId_key')=0, 'CREATE UNIQUE INDEX Project_currentStatusChangeId_key ON Project(currentStatusChangeId)', 'SELECT 1');
PREPARE lifecycle_stmt FROM @lifecycle_ddl; EXECUTE lifecycle_stmt; DEALLOCATE PREPARE lifecycle_stmt;
SET @lifecycle_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND CONSTRAINT_NAME='Project_currentStatusChangeId_fkey')=0, 'ALTER TABLE Project ADD CONSTRAINT Project_currentStatusChangeId_fkey FOREIGN KEY(currentStatusChangeId) REFERENCES ProjectStatusChange(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE lifecycle_stmt FROM @lifecycle_ddl; EXECUTE lifecycle_stmt; DEALLOCATE PREPARE lifecycle_stmt;

-- Extend the ONE existing guard used by all 60 existing freeze triggers.
-- Project.id remains a primary-key locking lookup; no duplicate business triggers.
DROP PROCEDURE IF EXISTS medpm_assert_project_write;
CREATE PROCEDURE medpm_assert_project_write(IN target_id CHAR(36))
BEGIN
  DECLARE current_status VARCHAR(32) DEFAULT NULL;
  SELECT status INTO current_status FROM Project WHERE id=target_id FOR UPDATE;
  IF current_status='ARCHIVED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT';
  ELSEIF current_status='ON_HOLD' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_PROJECT_FROZEN:ON_HOLD';
  ELSEIF current_status='CANCELLED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_PROJECT_FROZEN:CANCELLED';
  END IF;
END;

DROP TRIGGER IF EXISTS freeze_Project_update;
CREATE TRIGGER freeze_Project_update BEFORE UPDATE ON Project FOR EACH ROW
BEGIN
  DECLARE evidence_count INT DEFAULT 0;
  -- Use OLD.status in Project's own trigger: a locking reread of the mutating
  -- Project table would raise MySQL 1442 instead of the intended freeze error.
  IF OLD.status='ARCHIVED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT';
  ELSEIF OLD.status='CANCELLED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_PROJECT_FROZEN:CANCELLED';
  END IF;
  IF OLD.status='ON_HOLD' OR NEW.status IN ('ON_HOLD','CANCELLED') THEN
    SELECT COUNT(*) INTO evidence_count FROM ProjectStatusChange e
    WHERE e.id=NEW.currentStatusChangeId AND e.projectId=OLD.id
      AND e.fromStatus=OLD.status AND e.toStatus=NEW.status AND e.expectedRowVersion=OLD.rowVersion
      AND CHAR_LENGTH(TRIM(e.reason)) BETWEEN 10 AND 1000
      AND (e.action='pause' AND OLD.status IN ('PLANNING','ACTIVE') AND NEW.status='ON_HOLD' AND NEW.pausedFromStatus=OLD.status
        OR e.action='resume' AND OLD.status='ON_HOLD' AND NEW.status=IF(BINARY OLD.pausedFromStatus=BINARY 'PLANNING','PLANNING','ACTIVE') AND NEW.pausedFromStatus IS NULL
        OR e.action='cancel' AND OLD.status IN ('PLANNING','ACTIVE','ON_HOLD') AND NEW.status='CANCELLED' AND NEW.pausedFromStatus IS NULL);
    IF evidence_count<>1 OR (NEW.currentStatusChangeId <=> OLD.currentStatusChangeId) OR NEW.rowVersion<>OLD.rowVersion+1
      OR NOT (NEW.id <=> OLD.id) OR NOT (NEW.name <=> OLD.name) OR NOT (NEW.description <=> OLD.description)
      OR NOT (NEW.ownerId <=> OLD.ownerId) OR NOT (NEW.createdAt <=> OLD.createdAt)
      OR NOT (NEW.currentAcceptanceId <=> OLD.currentAcceptanceId) OR NOT (NEW.archivedAt <=> OLD.archivedAt) OR NOT (NEW.archivedById <=> OLD.archivedById) THEN
      IF OLD.status='ON_HOLD' THEN
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_PROJECT_FROZEN:ON_HOLD';
      ELSE
        SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_STATUS_CHANGE_REQUIRED';
      END IF;
    END IF;
  END IF;
END;
DROP TRIGGER IF EXISTS freeze_Project_delete;
CREATE TRIGGER freeze_Project_delete BEFORE DELETE ON Project FOR EACH ROW
BEGIN
  IF OLD.status='ARCHIVED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT';
  ELSEIF OLD.status='ON_HOLD' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_PROJECT_FROZEN:ON_HOLD';
  ELSEIF OLD.status='CANCELLED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_PROJECT_FROZEN:CANCELLED';
  END IF;
END;

-- New lifecycle evidence is append-only, like acceptance evidence and audit logs.
DROP TRIGGER IF EXISTS lifecycle_evidence_insert;
CREATE TRIGGER lifecycle_evidence_insert BEFORE INSERT ON ProjectStatusChange FOR EACH ROW
BEGIN
  DECLARE current_status VARCHAR(32);
  DECLARE current_version INT;
  DECLARE origin_status VARCHAR(32);
  SELECT status,rowVersion,pausedFromStatus INTO current_status,current_version,origin_status FROM Project WHERE id=NEW.projectId FOR UPDATE;
  IF current_status IN ('ARCHIVED','CANCELLED') THEN CALL medpm_assert_project_write(NEW.projectId); END IF;
  IF NOT (NEW.fromStatus <=> current_status) OR NEW.expectedRowVersion<>current_version
    OR CHAR_LENGTH(TRIM(NEW.reason)) NOT BETWEEN 10 AND 1000
    OR NOT (NEW.action='pause' AND current_status IN ('PLANNING','ACTIVE') AND NEW.toStatus='ON_HOLD'
      OR NEW.action='resume' AND current_status='ON_HOLD' AND NEW.toStatus=IF(BINARY origin_status=BINARY 'PLANNING','PLANNING','ACTIVE')
      OR NEW.action='cancel' AND current_status IN ('PLANNING','ACTIVE','ON_HOLD') AND NEW.toStatus='CANCELLED') THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_STATUS_CHANGE_REQUIRED';
  END IF;
END;
DROP TRIGGER IF EXISTS lifecycle_evidence_update;
CREATE TRIGGER lifecycle_evidence_update BEFORE UPDATE ON ProjectStatusChange FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_STATUS_CHANGE_IMMUTABLE';
END;
DROP TRIGGER IF EXISTS lifecycle_evidence_delete;
CREATE TRIGGER lifecycle_evidence_delete BEFORE DELETE ON ProjectStatusChange FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_STATUS_CHANGE_IMMUTABLE';
END;
