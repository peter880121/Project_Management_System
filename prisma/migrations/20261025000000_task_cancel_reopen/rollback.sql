-- Manual rollback only before any task lifecycle / strict signature evidence exists.
DROP PROCEDURE IF EXISTS medpm_task_lifecycle_rollback_check;
CREATE PROCEDURE medpm_task_lifecycle_rollback_check()
BEGIN
  IF EXISTS(SELECT 1 FROM Task WHERE status='CANCELLED' OR signatureEvidenceVersion<>1 LIMIT 1)
    OR EXISTS(SELECT 1 FROM AuditLog WHERE action IN ('TASK_CANCELLED','TASK_REOPENED') LIMIT 1) THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='TASK_LIFECYCLE_ROLLBACK_BLOCKED_PRESERVE_EVIDENCE';
  END IF;
END;
CALL medpm_task_lifecycle_rollback_check();
DROP PROCEDURE medpm_task_lifecycle_rollback_check;
DROP TRIGGER IF EXISTS freeze_Task_insert;
CREATE TRIGGER freeze_Task_insert BEFORE INSERT ON Task FOR EACH ROW
BEGIN
  CALL medpm_assert_project_write(NEW.projectId);
END;
DROP TRIGGER IF EXISTS freeze_Task_update;
CREATE TRIGGER freeze_Task_update BEFORE UPDATE ON Task FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  CALL medpm_assert_project_write(OLD.projectId);
  CALL medpm_assert_project_write(NEW.projectId);
END;
DROP TRIGGER IF EXISTS freeze_Task_delete;
CREATE TRIGGER freeze_Task_delete BEFORE DELETE ON Task FOR EACH ROW
BEGIN
  CALL medpm_assert_project_write(OLD.projectId);
END;
ALTER TABLE Task DROP FOREIGN KEY Task_cancelledById_fkey;
ALTER TABLE Task DROP COLUMN cancelReason,DROP COLUMN cancelledAt,DROP COLUMN cancelledById,DROP COLUMN rowVersion,DROP COLUMN signatureEvidenceVersion;
ALTER TABLE Task MODIFY COLUMN status ENUM('TODO','IN_PROGRESS','BLOCKED','DONE') NOT NULL DEFAULT 'TODO';
