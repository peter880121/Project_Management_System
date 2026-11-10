-- Additive, replayable; historical documents remain unassociated (NULL).
SET @meeting_attachment_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Document' AND COLUMN_NAME='meetingAttachmentId')=0,'ALTER TABLE Document ADD COLUMN meetingAttachmentId CHAR(36) NULL','SELECT 1');
PREPARE meeting_attachment_stmt FROM @meeting_attachment_ddl; EXECUTE meeting_attachment_stmt; DEALLOCATE PREPARE meeting_attachment_stmt;
SET @meeting_attachment_ddl=IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Document' AND INDEX_NAME='Document_meetingAttachmentId_createdAt_idx')=0,'CREATE INDEX Document_meetingAttachmentId_createdAt_idx ON Document(meetingAttachmentId,createdAt)','SELECT 1');
PREPARE meeting_attachment_stmt FROM @meeting_attachment_ddl; EXECUTE meeting_attachment_stmt; DEALLOCATE PREPARE meeting_attachment_stmt;
SET @meeting_attachment_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Document' AND CONSTRAINT_NAME='Document_meetingAttachmentId_fkey')=0,'ALTER TABLE Document ADD CONSTRAINT Document_meetingAttachmentId_fkey FOREIGN KEY(meetingAttachmentId) REFERENCES MeetingRecord(id) ON DELETE RESTRICT ON UPDATE RESTRICT','SELECT 1');
PREPARE meeting_attachment_stmt FROM @meeting_attachment_ddl; EXECUTE meeting_attachment_stmt; DEALLOCATE PREPARE meeting_attachment_stmt;
-- Document already participates in the shared project freeze triggers. No new bypass.
