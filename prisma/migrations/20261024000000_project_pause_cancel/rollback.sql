-- Manual structural rollback only BEFORE this feature has produced any evidence.
-- Never remove a cancellation or rewrite/delete an audit/history record to downgrade.
DROP PROCEDURE IF EXISTS medpm_check_lifecycle_rollback;
CREATE PROCEDURE medpm_check_lifecycle_rollback()
BEGIN
  IF EXISTS(SELECT 1 FROM ProjectStatusChange LIMIT 1) OR EXISTS(SELECT 1 FROM Project WHERE status='CANCELLED' LIMIT 1) THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='LIFECYCLE_ROLLBACK_BLOCKED_PRESERVE_EVIDENCE';
  END IF;
END;
CALL medpm_check_lifecycle_rollback();
DROP PROCEDURE medpm_check_lifecycle_rollback;
DROP TRIGGER IF EXISTS lifecycle_evidence_insert;
DROP TRIGGER IF EXISTS lifecycle_evidence_update;
DROP TRIGGER IF EXISTS lifecycle_evidence_delete;
ALTER TABLE Project DROP FOREIGN KEY Project_currentStatusChangeId_fkey;
ALTER TABLE Project DROP INDEX Project_currentStatusChangeId_key, DROP COLUMN currentStatusChangeId, DROP COLUMN pausedFromStatus;
DROP TABLE ProjectStatusChange;
DROP PROCEDURE IF EXISTS medpm_assert_project_write;
CREATE PROCEDURE medpm_assert_project_write(IN target_id CHAR(36))
BEGIN
  DECLARE current_status VARCHAR(32) DEFAULT NULL;
  SELECT status INTO current_status FROM Project WHERE id=target_id FOR UPDATE;
  IF current_status='ARCHIVED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT'; END IF;
END;
DROP TRIGGER IF EXISTS freeze_Project_update;
CREATE TRIGGER freeze_Project_update BEFORE UPDATE ON Project FOR EACH ROW
BEGIN
  IF OLD.status='ARCHIVED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT'; END IF;
END;
DROP TRIGGER IF EXISTS freeze_Project_delete;
CREATE TRIGGER freeze_Project_delete BEFORE DELETE ON Project FOR EACH ROW
BEGIN
  IF OLD.status='ARCHIVED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT'; END IF;
END;
ALTER TABLE Project MODIFY COLUMN status ENUM('PLANNING','ACTIVE','ON_HOLD','COMPLETED','PENDING_ACCEPTANCE','ARCHIVED') NOT NULL DEFAULT 'PLANNING';
