ALTER TABLE Task MODIFY COLUMN status ENUM('TODO','IN_PROGRESS','BLOCKED','DONE','CANCELLED') NOT NULL DEFAULT 'TODO';
SET @task_lifecycle_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND COLUMN_NAME='rowVersion')=0,'ALTER TABLE Task ADD COLUMN rowVersion INTEGER UNSIGNED NOT NULL DEFAULT 1','SELECT 1');
PREPARE task_lifecycle_stmt FROM @task_lifecycle_ddl; EXECUTE task_lifecycle_stmt; DEALLOCATE PREPARE task_lifecycle_stmt;
SET @task_lifecycle_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND COLUMN_NAME='signatureEvidenceVersion')=0,'ALTER TABLE Task ADD COLUMN signatureEvidenceVersion TINYINT UNSIGNED NOT NULL DEFAULT 1','SELECT 1');
PREPARE task_lifecycle_stmt FROM @task_lifecycle_ddl; EXECUTE task_lifecycle_stmt; DEALLOCATE PREPARE task_lifecycle_stmt;
SET @task_lifecycle_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND COLUMN_NAME='cancelReason')=0,'ALTER TABLE Task ADD COLUMN cancelReason VARCHAR(1000) NULL, ADD COLUMN cancelledAt DATETIME(3) NULL, ADD COLUMN cancelledById CHAR(36) NULL','SELECT 1');
PREPARE task_lifecycle_stmt FROM @task_lifecycle_ddl; EXECUTE task_lifecycle_stmt; DEALLOCATE PREPARE task_lifecycle_stmt;
SET @task_lifecycle_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND CONSTRAINT_NAME='Task_cancelledById_fkey')=0,'ALTER TABLE Task ADD CONSTRAINT Task_cancelledById_fkey FOREIGN KEY(cancelledById) REFERENCES User(id) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE task_lifecycle_stmt FROM @task_lifecycle_ddl; EXECUTE task_lifecycle_stmt; DEALLOCATE PREPARE task_lifecycle_stmt;

-- Extend existing Task guards, preserving shared Project freeze checks.
DROP TRIGGER IF EXISTS freeze_Task_insert;
CREATE TRIGGER freeze_Task_insert BEFORE INSERT ON Task FOR EACH ROW
BEGIN
  CALL medpm_assert_project_write(NEW.projectId);
  IF NEW.status='CANCELLED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_TASK_CANCEL_REASON'; END IF;
END;
DROP TRIGGER IF EXISTS freeze_Task_update;
CREATE TRIGGER freeze_Task_update BEFORE UPDATE ON Task FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  CALL medpm_assert_project_write(OLD.projectId);
  CALL medpm_assert_project_write(NEW.projectId);
  IF OLD.status='CANCELLED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_TASK_CANCELLED'; END IF;
  IF NEW.status='CANCELLED' AND (OLD.status='DONE' OR NEW.cancelReason IS NULL OR CHAR_LENGTH(TRIM(NEW.cancelReason)) NOT BETWEEN 10 AND 1000 OR NEW.cancelledAt IS NULL OR NEW.cancelledById IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_TASK_CANCEL_REASON';
  END IF;
  IF OLD.status='DONE' AND NEW.status IN ('TODO','IN_PROGRESS') AND (NEW.completedAt IS NOT NULL OR NEW.actualHours IS NOT NULL OR NEW.completionRoundId IS NOT NULL OR NEW.signatureEvidenceVersion<>2) THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_TASK_REOPEN_CLEANUP';
  END IF;
  IF NEW.signatureEvidenceVersion<OLD.signatureEvidenceVersion THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_TASK_REOPEN_CLEANUP'; END IF;
  SET NEW.rowVersion=OLD.rowVersion+1;
END;
DROP TRIGGER IF EXISTS freeze_Task_delete;
CREATE TRIGGER freeze_Task_delete BEFORE DELETE ON Task FOR EACH ROW
BEGIN
  CALL medpm_assert_project_write(OLD.projectId);
  IF OLD.status='CANCELLED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_TASK_CANCELLED'; END IF;
END;
