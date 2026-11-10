DROP PROCEDURE IF EXISTS medpm_meeting_attachment_rollback_check;
CREATE PROCEDURE medpm_meeting_attachment_rollback_check()
BEGIN
  IF EXISTS(SELECT 1 FROM Document WHERE meetingAttachmentId IS NOT NULL LIMIT 1)
    OR EXISTS(SELECT 1 FROM AuditLog WHERE action='MEETING_ATTACHMENT_ADDED' LIMIT 1) THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644,MESSAGE_TEXT='MEETING_ATTACHMENT_ROLLBACK_BLOCKED_PRESERVE_EVIDENCE';
  END IF;
END;
CALL medpm_meeting_attachment_rollback_check();
DROP PROCEDURE medpm_meeting_attachment_rollback_check;
ALTER TABLE Document DROP FOREIGN KEY Document_meetingAttachmentId_fkey;
DROP INDEX Document_meetingAttachmentId_createdAt_idx ON Document;
ALTER TABLE Document DROP COLUMN meetingAttachmentId;
