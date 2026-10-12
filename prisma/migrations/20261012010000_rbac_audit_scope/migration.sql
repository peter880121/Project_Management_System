-- Preserve project-level audit filtering while keeping global user/permission
-- events unscoped. Existing entity records are associated with their project.
ALTER TABLE `AuditLog`
    ADD COLUMN `projectId` CHAR(36) NULL,
    ADD INDEX `AuditLog_projectId_createdAt_idx` (`projectId`, `createdAt`),
    ADD INDEX `AuditLog_action_createdAt_idx` (`action`, `createdAt`);

UPDATE `AuditLog` AS audit
LEFT JOIN `Project` AS project_entity
    ON audit.`entityType` = 'Project' AND audit.`entityId` = project_entity.`id`
LEFT JOIN `Task` AS task_entity
    ON audit.`entityType` = 'Task' AND audit.`entityId` = task_entity.`id`
LEFT JOIN `Requirement` AS requirement_entity
    ON audit.`entityType` = 'Requirement' AND audit.`entityId` = requirement_entity.`id`
LEFT JOIN `TestCase` AS test_case_entity
    ON audit.`entityType` = 'TestCase' AND audit.`entityId` = test_case_entity.`id`
LEFT JOIN `Requirement` AS test_case_requirement
    ON test_case_entity.`requirementId` = test_case_requirement.`id`
LEFT JOIN `Document` AS document_entity
    ON audit.`entityType` = 'Document' AND audit.`entityId` = document_entity.`id`
LEFT JOIN `AiSuggestion` AS suggestion_entity
    ON audit.`entityType` = 'AiSuggestion' AND audit.`entityId` = suggestion_entity.`id`
LEFT JOIN `AIRecommendation` AS legacy_suggestion_entity
    ON audit.`entityType` = 'AIRecommendation' AND audit.`entityId` = legacy_suggestion_entity.`id`
LEFT JOIN `SyncFailure` AS sync_failure_entity
    ON audit.`entityType` = 'SyncFailure' AND audit.`entityId` = sync_failure_entity.`id`
SET audit.`projectId` = COALESCE(
    project_entity.`id`,
    task_entity.`projectId`,
    requirement_entity.`projectId`,
    test_case_requirement.`projectId`,
    document_entity.`projectId`,
    suggestion_entity.`projectId`,
    legacy_suggestion_entity.`projectId`,
    sync_failure_entity.`projectId`
)
WHERE audit.`projectId` IS NULL;

ALTER TABLE `AuditLog`
    ADD CONSTRAINT `AuditLog_projectId_fkey`
    FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER `AuditLog_prevent_update`
BEFORE UPDATE ON `AuditLog`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog rows are immutable';

CREATE TRIGGER `AuditLog_prevent_delete`
BEFORE DELETE ON `AuditLog`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog rows are immutable';
