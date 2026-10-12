-- Extend the scaffold schema without replacing existing user, project, task,
-- audit, document, or AI recommendation records.

ALTER TABLE `Project`
    CHANGE COLUMN `summary` `description` TEXT NULL,
    ADD COLUMN `status` ENUM('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED') NOT NULL DEFAULT 'PLANNING',
    ADD COLUMN `ownerId` CHAR(36) NULL,
    ADD INDEX `Project_ownerId_status_idx` (`ownerId`, `status`);

ALTER TABLE `Task`
    ADD COLUMN `estimateHours` DECIMAL(8, 2) NULL,
    ADD COLUMN `dueDate` DATETIME(3) NULL,
    ADD COLUMN `requirementId` CHAR(36) NULL,
    ADD INDEX `Task_assigneeId_status_idx` (`assigneeId`, `status`),
    ADD INDEX `Task_dueDate_status_idx` (`dueDate`, `status`),
    ADD INDEX `Task_requirementId_status_idx` (`requirementId`, `status`);

ALTER TABLE `Document`
    CHANGE COLUMN `objectKey` `minioKey` VARCHAR(512) NOT NULL,
    ADD COLUMN `filename` VARCHAR(512) NULL,
    ADD COLUMN `parsedText` LONGTEXT NULL;

UPDATE `Document`
SET `filename` = CASE
    WHEN LOCATE('/', `minioKey`) = 0 THEN `minioKey`
    ELSE SUBSTRING_INDEX(`minioKey`, '/', -1)
END;

ALTER TABLE `Document`
    MODIFY COLUMN `filename` VARCHAR(512) NOT NULL;

CREATE TABLE `Requirement` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `version` INT UNSIGNED NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED') NOT NULL DEFAULT 'DRAFT',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Requirement_projectId_title_version_key` (`projectId`, `title`, `version`),
    INDEX `Requirement_projectId_status_idx` (`projectId`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Requirement_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `TestCase` (
    `id` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `status` ENUM('NOT_RUN', 'PASSED', 'FAILED', 'BLOCKED') NOT NULL DEFAULT 'NOT_RUN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `TestCase_requirementId_status_idx` (`requirementId`, `status`),
    PRIMARY KEY (`id`),
    CONSTRAINT `TestCase_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `AiSuggestion` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `type` ENUM('WBS', 'ESTIMATE', 'RISK', 'AUDIT_SUMMARY') NOT NULL,
    `input` JSON NOT NULL,
    `output` JSON NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AiSuggestion_projectId_status_createdAt_idx` (`projectId`, `status`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AiSuggestion_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `AiSuggestion_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `SyncFailure` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `entityType` VARCHAR(100) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    `target` VARCHAR(100) NOT NULL,
    `payload` JSON NOT NULL,
    `error` TEXT NOT NULL,
    `retryCount` INT UNSIGNED NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `SyncFailure_target_retryCount_createdAt_idx` (`target`, `retryCount`, `createdAt`),
    INDEX `SyncFailure_entityType_entityId_idx` (`entityType`, `entityId`),
    INDEX `SyncFailure_projectId_createdAt_idx` (`projectId`, `createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `SyncFailure_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

ALTER TABLE `Project`
    ADD CONSTRAINT `Project_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Task`
    ADD CONSTRAINT `Task_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `AuditLog`
    ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
