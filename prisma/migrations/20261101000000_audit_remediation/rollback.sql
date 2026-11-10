-- Run only in an empty deployment. Preserve production evidence; forward-fix after first use.
DROP PROCEDURE IF EXISTS rollback_audit_remediation;
CREATE PROCEDURE rollback_audit_remediation()
BEGIN
  IF (SELECT COUNT(*) FROM AuditIssue) + (SELECT COUNT(*) FROM AuditIssueOccurrence) + (SELECT COUNT(*) FROM AuditIssueEvent) > 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Audit evidence exists; rollback refused';
  END IF;
  DROP TABLE AuditIssueEvent;
  DROP TABLE AuditIssueOccurrence;
  DROP TABLE AuditIssue;
END;
CALL rollback_audit_remediation();
DROP PROCEDURE rollback_audit_remediation;
