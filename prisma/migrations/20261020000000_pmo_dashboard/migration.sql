-- Additive: existing roles and all evidence remain unchanged.
ALTER TABLE `User` MODIFY COLUMN `role` ENUM('ADMIN','PM','MEMBER','QA','PMO') NOT NULL DEFAULT 'MEMBER';

SET @dashboard_ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND INDEX_NAME='Project_status_archivedAt_idx')=0, 'CREATE INDEX Project_status_archivedAt_idx ON Project(status, archivedAt)', 'SELECT 1');
PREPARE dashboard_stmt FROM @dashboard_ddl; EXECUTE dashboard_stmt; DEALLOCATE PREPARE dashboard_stmt;
SET @dashboard_ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='AiSuggestion' AND INDEX_NAME='AiSuggestion_projectId_type_status_createdAt_idx')=0, 'CREATE INDEX AiSuggestion_projectId_type_status_createdAt_idx ON AiSuggestion(projectId, type, status, createdAt)', 'SELECT 1');
PREPARE dashboard_stmt FROM @dashboard_ddl; EXECUTE dashboard_stmt; DEALLOCATE PREPARE dashboard_stmt;
SET @dashboard_ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Deliverable' AND INDEX_NAME='Deliverable_createdAt_idx')=0, 'CREATE INDEX Deliverable_createdAt_idx ON Deliverable(createdAt)', 'SELECT 1');
PREPARE dashboard_stmt FROM @dashboard_ddl; EXECUTE dashboard_stmt; DEALLOCATE PREPARE dashboard_stmt;
