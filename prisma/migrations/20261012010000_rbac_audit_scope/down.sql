DROP TRIGGER IF EXISTS `AuditLog_prevent_delete`;
DROP TRIGGER IF EXISTS `AuditLog_prevent_update`;

ALTER TABLE `AuditLog`
    DROP FOREIGN KEY `AuditLog_projectId_fkey`,
    DROP INDEX `AuditLog_projectId_createdAt_idx`,
    DROP INDEX `AuditLog_action_createdAt_idx`,
    DROP COLUMN `projectId`;
