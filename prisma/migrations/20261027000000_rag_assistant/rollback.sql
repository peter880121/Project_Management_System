-- Refuse to remove persisted conversations or their audit evidence.
DROP PROCEDURE IF EXISTS rag_assistant_rollback_check;
CREATE PROCEDURE rag_assistant_rollback_check()
BEGIN
 IF EXISTS(SELECT 1 FROM RagConversation LIMIT 1) OR EXISTS(SELECT 1 FROM AuditLog WHERE entityType IN ('RagConversation','RagMessage') LIMIT 1) THEN
  SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='RAG_ROLLBACK_BLOCKED_PRESERVE_EVIDENCE';
 END IF;
END;
CALL rag_assistant_rollback_check();
DROP PROCEDURE rag_assistant_rollback_check;
DROP TABLE RagCitation;
DROP TABLE RagMessage;
DROP TABLE RagConversation;
