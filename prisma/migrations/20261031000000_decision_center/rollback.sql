-- Only an empty feature rollout can be rolled back; preserve captured evidence.
DROP PROCEDURE IF EXISTS medpm_decision_rollback;
CREATE PROCEDURE medpm_decision_rollback() BEGIN
IF EXISTS(SELECT 1 FROM DecisionSnapshot) OR EXISTS(SELECT 1 FROM AuditLog WHERE actorRole IS NOT NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Decision evidence exists; rollback refused'; END IF;
DROP TRIGGER IF EXISTS audit_capture_actor_role;
DROP TABLE DecisionSnapshot;
ALTER TABLE AuditLog DROP COLUMN actorRole;
END;
CALL medpm_decision_rollback();
DROP PROCEDURE medpm_decision_rollback;
