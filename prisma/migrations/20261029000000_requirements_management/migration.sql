-- Additive and replayable. Legacy requirements remain unmanaged and unchanged.

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='approvedVersion')=0, 'ALTER TABLE `Requirement` ADD COLUMN `approvedVersion` INTEGER UNSIGNED NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='category')=0, 'ALTER TABLE `Requirement` ADD COLUMN `category` VARCHAR(24) NOT NULL DEFAULT ''FUNCTIONAL''', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='completedAt')=0, 'ALTER TABLE `Requirement` ADD COLUMN `completedAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='createdById')=0, 'ALTER TABLE `Requirement` ADD COLUMN `createdById` CHAR(36) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='discoveryPhase')=0, 'ALTER TABLE `Requirement` ADD COLUMN `discoveryPhase` VARCHAR(50) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='draftVersion')=0, 'ALTER TABLE `Requirement` ADD COLUMN `draftVersion` INTEGER UNSIGNED NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='dueDate')=0, 'ALTER TABLE `Requirement` ADD COLUMN `dueDate` DATETIME(3) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='managed')=0, 'ALTER TABLE `Requirement` ADD COLUMN `managed` BOOLEAN NOT NULL DEFAULT false', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='number')=0, 'ALTER TABLE `Requirement` ADD COLUMN `number` VARCHAR(32) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='ownerId')=0, 'ALTER TABLE `Requirement` ADD COLUMN `ownerId` CHAR(36) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='priority')=0, 'ALTER TABLE `Requirement` ADD COLUMN `priority` VARCHAR(16) NOT NULL DEFAULT ''SHOULD''', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='riskLevel')=0, 'ALTER TABLE `Requirement` ADD COLUMN `riskLevel` VARCHAR(16) NOT NULL DEFAULT ''NORMAL''', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='rowVersion')=0, 'ALTER TABLE `Requirement` ADD COLUMN `rowVersion` INTEGER UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='targetRelease')=0, 'ALTER TABLE `Requirement` ADD COLUMN `targetRelease` VARCHAR(100) NULL', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND COLUMN_NAME='workflowState')=0, 'ALTER TABLE `Requirement` ADD COLUMN `workflowState` VARCHAR(32) NOT NULL DEFAULT ''DRAFT''', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

CREATE TABLE IF NOT EXISTS `RequirementIntake` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `source` VARCHAR(24) NOT NULL,
    `sourceReference` VARCHAR(191) NULL,
    `requester` VARCHAR(191) NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
    `reason` TEXT NULL,
    `requirementId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `rowVersion` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `requestKey` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RequirementIntake_projectId_state_createdAt_idx`(`projectId`, `state`, `createdAt`),
    UNIQUE INDEX `RequirementIntake_projectId_requestKey_key`(`projectId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequirementRevision` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `acceptanceCriteria` TEXT NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `metadata` JSON NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequirementRevision_projectId_createdAt_idx`(`projectId`, `createdAt`),
    UNIQUE INDEX `RequirementRevision_requirementId_version_key`(`requirementId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequirementChangeRequest` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NOT NULL,
    `fromVersion` INTEGER UNSIGNED NOT NULL,
    `previousState` VARCHAR(32) NOT NULL,
    `reason` TEXT NOT NULL,
    `impact` JSON NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RequirementChangeRequest_projectId_requirementId_state_idx`(`projectId`, `requirementId`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequirementTaskLink` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequirementTaskLink_projectId_taskId_idx`(`projectId`, `taskId`),
    UNIQUE INDEX `RequirementTaskLink_requirementId_taskId_key`(`requirementId`, `taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequirementDecision` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NOT NULL,
    `revisionNumber` INTEGER UNSIGNED NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `comment` TEXT NOT NULL,
    `evidence` JSON NOT NULL,
    `requestKey` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequirementDecision_requirementId_createdAt_idx`(`requirementId`, `createdAt`),
    UNIQUE INDEX `RequirementDecision_projectId_requestKey_key`(`projectId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `TestExecution` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NOT NULL,
    `revisionId` CHAR(36) NOT NULL,
    `testCaseId` CHAR(36) NOT NULL,
    `testCaseSha256` CHAR(64) NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `comment` TEXT NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `documentSha256` CHAR(64) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TestExecution_projectId_requirementId_revisionId_idx`(`projectId`, `requirementId`, `revisionId`),
    INDEX `TestExecution_testCaseId_createdAt_idx`(`testCaseId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequirementBaseline` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `ordinal` INTEGER UNSIGNED NOT NULL,
    `entries` JSON NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RequirementBaseline_projectId_createdAt_idx`(`projectId`, `createdAt`),
    UNIQUE INDEX `RequirementBaseline_projectId_ordinal_key`(`projectId`, `ordinal`),
    UNIQUE INDEX `RequirementBaseline_projectId_name_key`(`projectId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `RequirementAttachment` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `requirementId` CHAR(36) NULL,
    `revisionId` CHAR(36) NULL,
    `intakeId` CHAR(36) NULL,
    `filename` VARCHAR(191) NOT NULL,
    `mediaType` VARCHAR(100) NOT NULL,
    `minioKey` VARCHAR(512) NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `fileSize` INTEGER UNSIGNED NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `RequirementAttachment_minioKey_key`(`minioKey`),
    INDEX `RequirementAttachment_projectId_requirementId_revisionId_idx`(`projectId`, `requirementId`, `revisionId`),
    INDEX `RequirementAttachment_intakeId_idx`(`intakeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND INDEX_NAME='Requirement_projectId_workflowState_dueDate_idx')=0, 'CREATE INDEX `Requirement_projectId_workflowState_dueDate_idx` ON `Requirement`(`projectId`, `workflowState`, `dueDate`)', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Requirement' AND INDEX_NAME='Requirement_projectId_number_key')=0, 'CREATE UNIQUE INDEX `Requirement_projectId_number_key` ON `Requirement`(`projectId`, `number`)', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementIntake' AND CONSTRAINT_NAME='RequirementIntake_requirementId_fkey')=0, 'ALTER TABLE `RequirementIntake` ADD CONSTRAINT `RequirementIntake_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementIntake' AND CONSTRAINT_NAME='RequirementIntake_projectId_fkey')=0, 'ALTER TABLE `RequirementIntake` ADD CONSTRAINT `RequirementIntake_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementRevision' AND CONSTRAINT_NAME='RequirementRevision_requirementId_fkey')=0, 'ALTER TABLE `RequirementRevision` ADD CONSTRAINT `RequirementRevision_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementRevision' AND CONSTRAINT_NAME='RequirementRevision_projectId_fkey')=0, 'ALTER TABLE `RequirementRevision` ADD CONSTRAINT `RequirementRevision_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementChangeRequest' AND CONSTRAINT_NAME='RequirementChangeRequest_requirementId_fkey')=0, 'ALTER TABLE `RequirementChangeRequest` ADD CONSTRAINT `RequirementChangeRequest_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementChangeRequest' AND CONSTRAINT_NAME='RequirementChangeRequest_projectId_fkey')=0, 'ALTER TABLE `RequirementChangeRequest` ADD CONSTRAINT `RequirementChangeRequest_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementTaskLink' AND CONSTRAINT_NAME='RequirementTaskLink_requirementId_fkey')=0, 'ALTER TABLE `RequirementTaskLink` ADD CONSTRAINT `RequirementTaskLink_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementTaskLink' AND CONSTRAINT_NAME='RequirementTaskLink_projectId_fkey')=0, 'ALTER TABLE `RequirementTaskLink` ADD CONSTRAINT `RequirementTaskLink_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementTaskLink' AND CONSTRAINT_NAME='RequirementTaskLink_taskId_fkey')=0, 'ALTER TABLE `RequirementTaskLink` ADD CONSTRAINT `RequirementTaskLink_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementDecision' AND CONSTRAINT_NAME='RequirementDecision_requirementId_fkey')=0, 'ALTER TABLE `RequirementDecision` ADD CONSTRAINT `RequirementDecision_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementDecision' AND CONSTRAINT_NAME='RequirementDecision_projectId_fkey')=0, 'ALTER TABLE `RequirementDecision` ADD CONSTRAINT `RequirementDecision_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='TestExecution' AND CONSTRAINT_NAME='TestExecution_requirementId_fkey')=0, 'ALTER TABLE `TestExecution` ADD CONSTRAINT `TestExecution_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='TestExecution' AND CONSTRAINT_NAME='TestExecution_revisionId_fkey')=0, 'ALTER TABLE `TestExecution` ADD CONSTRAINT `TestExecution_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `RequirementRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='TestExecution' AND CONSTRAINT_NAME='TestExecution_projectId_fkey')=0, 'ALTER TABLE `TestExecution` ADD CONSTRAINT `TestExecution_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='TestExecution' AND CONSTRAINT_NAME='TestExecution_testCaseId_fkey')=0, 'ALTER TABLE `TestExecution` ADD CONSTRAINT `TestExecution_testCaseId_fkey` FOREIGN KEY (`testCaseId`) REFERENCES `TestCase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='TestExecution' AND CONSTRAINT_NAME='TestExecution_documentId_fkey')=0, 'ALTER TABLE `TestExecution` ADD CONSTRAINT `TestExecution_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementBaseline' AND CONSTRAINT_NAME='RequirementBaseline_projectId_fkey')=0, 'ALTER TABLE `RequirementBaseline` ADD CONSTRAINT `RequirementBaseline_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementAttachment' AND CONSTRAINT_NAME='RequirementAttachment_requirementId_fkey')=0, 'ALTER TABLE `RequirementAttachment` ADD CONSTRAINT `RequirementAttachment_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementAttachment' AND CONSTRAINT_NAME='RequirementAttachment_revisionId_fkey')=0, 'ALTER TABLE `RequirementAttachment` ADD CONSTRAINT `RequirementAttachment_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `RequirementRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementAttachment' AND CONSTRAINT_NAME='RequirementAttachment_intakeId_fkey')=0, 'ALTER TABLE `RequirementAttachment` ADD CONSTRAINT `RequirementAttachment_intakeId_fkey` FOREIGN KEY (`intakeId`) REFERENCES `RequirementIntake`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

SET @req_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='RequirementAttachment' AND CONSTRAINT_NAME='RequirementAttachment_projectId_fkey')=0, 'ALTER TABLE `RequirementAttachment` ADD CONSTRAINT `RequirementAttachment_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE req_stmt FROM @req_ddl; EXECUTE req_stmt; DEALLOCATE PREPARE req_stmt;

DROP TRIGGER IF EXISTS freeze_RequirementIntake_insert;
CREATE TRIGGER freeze_RequirementIntake_insert BEFORE INSERT ON `RequirementIntake` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementIntake_update;
CREATE TRIGGER freeze_RequirementIntake_update BEFORE UPDATE ON `RequirementIntake` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementIntake_delete;
CREATE TRIGGER freeze_RequirementIntake_delete BEFORE DELETE ON `RequirementIntake` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementRevision_insert;
CREATE TRIGGER freeze_RequirementRevision_insert BEFORE INSERT ON `RequirementRevision` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); IF NOT EXISTS(SELECT 1 FROM Requirement r WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; END;

DROP TRIGGER IF EXISTS freeze_RequirementRevision_update;
CREATE TRIGGER freeze_RequirementRevision_update BEFORE UPDATE ON `RequirementRevision` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementRevision_delete;
CREATE TRIGGER freeze_RequirementRevision_delete BEFORE DELETE ON `RequirementRevision` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementChangeRequest_insert;
CREATE TRIGGER freeze_RequirementChangeRequest_insert BEFORE INSERT ON `RequirementChangeRequest` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); IF NOT EXISTS(SELECT 1 FROM Requirement r WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; END;

DROP TRIGGER IF EXISTS freeze_RequirementChangeRequest_update;
CREATE TRIGGER freeze_RequirementChangeRequest_update BEFORE UPDATE ON `RequirementChangeRequest` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementChangeRequest_delete;
CREATE TRIGGER freeze_RequirementChangeRequest_delete BEFORE DELETE ON `RequirementChangeRequest` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementTaskLink_insert;
CREATE TRIGGER freeze_RequirementTaskLink_insert BEFORE INSERT ON `RequirementTaskLink` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); IF NOT EXISTS(SELECT 1 FROM Requirement r WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; IF NOT EXISTS(SELECT 1 FROM Task t WHERE t.id=NEW.taskId AND t.projectId=NEW.projectId AND t.status<>'CANCELLED') THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; END;

DROP TRIGGER IF EXISTS freeze_RequirementTaskLink_update;
CREATE TRIGGER freeze_RequirementTaskLink_update BEFORE UPDATE ON `RequirementTaskLink` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementTaskLink_delete;
CREATE TRIGGER freeze_RequirementTaskLink_delete BEFORE DELETE ON `RequirementTaskLink` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementDecision_insert;
CREATE TRIGGER freeze_RequirementDecision_insert BEFORE INSERT ON `RequirementDecision` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); IF NOT EXISTS(SELECT 1 FROM Requirement r WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; END;

DROP TRIGGER IF EXISTS freeze_RequirementDecision_update;
CREATE TRIGGER freeze_RequirementDecision_update BEFORE UPDATE ON `RequirementDecision` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementDecision_delete;
CREATE TRIGGER freeze_RequirementDecision_delete BEFORE DELETE ON `RequirementDecision` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_TestExecution_insert;
CREATE TRIGGER freeze_TestExecution_insert BEFORE INSERT ON `TestExecution` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); IF NOT EXISTS(SELECT 1 FROM Requirement r WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; IF NOT EXISTS(SELECT 1 FROM RequirementRevision v JOIN TestCase t ON t.requirementId=v.requirementId JOIN Document d ON d.id=NEW.documentId WHERE v.id=NEW.revisionId AND v.requirementId=NEW.requirementId AND v.projectId=NEW.projectId AND t.id=NEW.testCaseId AND d.projectId=NEW.projectId AND d.storageStatus='AVAILABLE') THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; END;

DROP TRIGGER IF EXISTS freeze_TestExecution_update;
CREATE TRIGGER freeze_TestExecution_update BEFORE UPDATE ON `TestExecution` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_TestExecution_delete;
CREATE TRIGGER freeze_TestExecution_delete BEFORE DELETE ON `TestExecution` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementBaseline_insert;
CREATE TRIGGER freeze_RequirementBaseline_insert BEFORE INSERT ON `RequirementBaseline` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); END;

DROP TRIGGER IF EXISTS freeze_RequirementBaseline_update;
CREATE TRIGGER freeze_RequirementBaseline_update BEFORE UPDATE ON `RequirementBaseline` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementBaseline_delete;
CREATE TRIGGER freeze_RequirementBaseline_delete BEFORE DELETE ON `RequirementBaseline` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementAttachment_insert;
CREATE TRIGGER freeze_RequirementAttachment_insert BEFORE INSERT ON `RequirementAttachment` FOR EACH ROW BEGIN CALL medpm_assert_project_write(NEW.projectId); IF NEW.requirementId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Requirement r WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_SCOPE'; END IF; IF (NEW.intakeId IS NULL AND NEW.requirementId IS NULL) OR (NEW.intakeId IS NOT NULL AND NEW.requirementId IS NOT NULL) OR (NEW.requirementId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM Requirement r JOIN RequirementRevision v ON v.requirementId=r.id AND v.version=r.draftVersion WHERE r.id=NEW.requirementId AND r.projectId=NEW.projectId AND r.workflowState='DRAFT' AND v.id=NEW.revisionId)) OR (NEW.intakeId IS NOT NULL AND NOT EXISTS(SELECT 1 FROM RequirementIntake i WHERE i.id=NEW.intakeId AND i.projectId=NEW.projectId AND i.state IN ('SUBMITTED','CLARIFYING'))) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_ATTACHMENT_LOCKED'; END IF; END;

DROP TRIGGER IF EXISTS freeze_RequirementAttachment_update;
CREATE TRIGGER freeze_RequirementAttachment_update BEFORE UPDATE ON `RequirementAttachment` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); CALL medpm_assert_project_write(NEW.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;

DROP TRIGGER IF EXISTS freeze_RequirementAttachment_delete;
CREATE TRIGGER freeze_RequirementAttachment_delete BEFORE DELETE ON `RequirementAttachment` FOR EACH ROW BEGIN CALL medpm_assert_project_write(OLD.projectId); SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_REQUIREMENT_EVIDENCE_IMMUTABLE'; END;
