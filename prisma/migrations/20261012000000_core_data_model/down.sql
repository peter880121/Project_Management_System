-- Structural rollback for an empty/new stage-02 deployment. Dropping the new
-- domain tables or added columns discards data written after this migration.
ALTER TABLE `AuditLog` DROP FOREIGN KEY `AuditLog_actorId_fkey`;
ALTER TABLE `Task` DROP FOREIGN KEY `Task_requirementId_fkey`;
ALTER TABLE `Project` DROP FOREIGN KEY `Project_ownerId_fkey`;

DROP TABLE IF EXISTS `SyncFailure`;
DROP TABLE IF EXISTS `AiSuggestion`;
DROP TABLE IF EXISTS `TestCase`;
DROP TABLE IF EXISTS `Requirement`;

ALTER TABLE `Document`
    DROP COLUMN `parsedText`,
    DROP COLUMN `filename`,
    CHANGE COLUMN `minioKey` `objectKey` VARCHAR(512) NOT NULL;

ALTER TABLE `Task`
    DROP INDEX `Task_assigneeId_status_idx`,
    DROP INDEX `Task_dueDate_status_idx`,
    DROP INDEX `Task_requirementId_status_idx`,
    DROP COLUMN `requirementId`,
    DROP COLUMN `estimateHours`,
    DROP COLUMN `dueDate`;

ALTER TABLE `Project`
    DROP INDEX `Project_ownerId_status_idx`,
    DROP COLUMN `ownerId`,
    DROP COLUMN `status`,
    CHANGE COLUMN `description` `summary` TEXT NULL;
