-- Additive status compatibility; existing ON_HOLD/COMPLETED rows are never auto-archived.

ALTER TABLE Project MODIFY COLUMN status ENUM('PLANNING','ACTIVE','ON_HOLD','COMPLETED','PENDING_ACCEPTANCE','ARCHIVED') NOT NULL DEFAULT 'PLANNING';

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND COLUMN_NAME='rowVersion')=0, 'ALTER TABLE Project ADD COLUMN `rowVersion` INTEGER UNSIGNED NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND COLUMN_NAME='currentAcceptanceId')=0, 'ALTER TABLE Project ADD COLUMN `currentAcceptanceId` CHAR(36) NULL', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND COLUMN_NAME='archivedAt')=0, 'ALTER TABLE Project ADD COLUMN `archivedAt` DATETIME(3) NULL', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND COLUMN_NAME='archivedById')=0, 'ALTER TABLE Project ADD COLUMN `archivedById` CHAR(36) NULL', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

CREATE TABLE IF NOT EXISTS `ProjectAcceptance` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `round` INTEGER UNSIGNED NOT NULL,
    `requestKey` CHAR(36) NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED',
    `submittedById` CHAR(36) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `snapshot` JSON NOT NULL,
    `snapshotSha256` CHAR(64) NOT NULL,
    `qaApprovedById` CHAR(36) NULL,
    `qaApprovedAt` DATETIME(3) NULL,
    `reviewComment` TEXT NULL,
    `closedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ProjectAcceptance_projectId_round_key`(`projectId`, `round`),
    UNIQUE INDEX `ProjectAcceptance_projectId_requestKey_key`(`projectId`, `requestKey`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ProjectAcceptance_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ProjectAcceptance_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ProjectAcceptance_qaApprovedById_fkey` FOREIGN KEY (`qaApprovedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ProjectNotification` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `acceptanceId` CHAR(36) NOT NULL,
    `recipientId` CHAR(36) NOT NULL,
    `type` VARCHAR(32) NOT NULL DEFAULT 'PROJECT_ARCHIVED',
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectNotification_recipientId_readAt_createdAt_idx`(`recipientId`, `readAt`, `createdAt`),
    UNIQUE INDEX `ProjectNotification_recipientId_acceptanceId_key`(`recipientId`, `acceptanceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ProjectNotification_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ProjectNotification_acceptanceId_fkey` FOREIGN KEY (`acceptanceId`) REFERENCES `ProjectAcceptance`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `ProjectNotification_recipientId_fkey` FOREIGN KEY (`recipientId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND INDEX_NAME='Project_currentAcceptanceId_key')=0, 'CREATE UNIQUE INDEX Project_currentAcceptanceId_key ON Project(currentAcceptanceId)', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND CONSTRAINT_NAME='Project_currentAcceptanceId_fkey')=0, 'ALTER TABLE Project ADD CONSTRAINT Project_currentAcceptanceId_fkey FOREIGN KEY (currentAcceptanceId) REFERENCES ProjectAcceptance(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND CONSTRAINT_NAME='Project_archivedById_fkey')=0, 'ALTER TABLE Project ADD CONSTRAINT Project_archivedById_fkey FOREIGN KEY (archivedById) REFERENCES User(id) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Project' AND CONSTRAINT_NAME='Project_ownerId_fkey')>0, 'ALTER TABLE `Project` DROP FOREIGN KEY `Project_ownerId_fkey`', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

ALTER TABLE `Project` ADD CONSTRAINT `Project_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND CONSTRAINT_NAME='Task_assigneeId_fkey')>0, 'ALTER TABLE `Task` DROP FOREIGN KEY `Task_assigneeId_fkey`', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

ALTER TABLE `Task` ADD CONSTRAINT `Task_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND CONSTRAINT_NAME='Task_requirementId_fkey')>0, 'ALTER TABLE `Task` DROP FOREIGN KEY `Task_requirementId_fkey`', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

ALTER TABLE `Task` ADD CONSTRAINT `Task_requirementId_fkey` FOREIGN KEY (`requirementId`) REFERENCES `Requirement`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='TaskDependency' AND CONSTRAINT_NAME='TaskDependency_taskId_fkey')>0, 'ALTER TABLE `TaskDependency` DROP FOREIGN KEY `TaskDependency_taskId_fkey`', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

ALTER TABLE `TaskDependency` ADD CONSTRAINT `TaskDependency_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='AIRecommendation' AND CONSTRAINT_NAME='AIRecommendation_reviewedById_fkey')>0, 'ALTER TABLE `AIRecommendation` DROP FOREIGN KEY `AIRecommendation_reviewedById_fkey`', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

ALTER TABLE `AIRecommendation` ADD CONSTRAINT `AIRecommendation_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

SET @closure_ddl = IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='AiSuggestion' AND CONSTRAINT_NAME='AiSuggestion_reviewedById_fkey')>0, 'ALTER TABLE `AiSuggestion` DROP FOREIGN KEY `AiSuggestion_reviewedById_fkey`', 'SELECT 1');
PREPARE closure_stmt FROM @closure_ddl; EXECUTE closure_stmt; DEALLOCATE PREPARE closure_stmt;

ALTER TABLE `AiSuggestion` ADD CONSTRAINT `AiSuggestion_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

DROP PROCEDURE IF EXISTS medpm_assert_project_write;

CREATE PROCEDURE medpm_assert_project_write(IN target_id CHAR(36))
BEGIN
  DECLARE current_status VARCHAR(32) DEFAULT NULL;
  SELECT status INTO current_status FROM Project WHERE id = target_id FOR UPDATE;
  IF current_status = 'ARCHIVED' THEN
    SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO = 1644, MESSAGE_TEXT = 'ER_ARCHIVED_PROJECT';
  END IF;
END;

DROP TRIGGER IF EXISTS `freeze_Task_insert`;

CREATE TRIGGER `freeze_Task_insert` BEFORE INSERT ON `Task` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Task_update`;

CREATE TRIGGER `freeze_Task_update` BEFORE UPDATE ON `Task` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Task_delete`;

CREATE TRIGGER `freeze_Task_delete` BEFORE DELETE ON `Task` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Requirement_insert`;

CREATE TRIGGER `freeze_Requirement_insert` BEFORE INSERT ON `Requirement` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Requirement_update`;

CREATE TRIGGER `freeze_Requirement_update` BEFORE UPDATE ON `Requirement` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Requirement_delete`;

CREATE TRIGGER `freeze_Requirement_delete` BEFORE DELETE ON `Requirement` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AIRecommendation_insert`;

CREATE TRIGGER `freeze_AIRecommendation_insert` BEFORE INSERT ON `AIRecommendation` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AIRecommendation_update`;

CREATE TRIGGER `freeze_AIRecommendation_update` BEFORE UPDATE ON `AIRecommendation` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AIRecommendation_delete`;

CREATE TRIGGER `freeze_AIRecommendation_delete` BEFORE DELETE ON `AIRecommendation` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AiSuggestion_insert`;

CREATE TRIGGER `freeze_AiSuggestion_insert` BEFORE INSERT ON `AiSuggestion` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AiSuggestion_update`;

CREATE TRIGGER `freeze_AiSuggestion_update` BEFORE UPDATE ON `AiSuggestion` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AiSuggestion_delete`;

CREATE TRIGGER `freeze_AiSuggestion_delete` BEFORE DELETE ON `AiSuggestion` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskScanSchedule_insert`;

CREATE TRIGGER `freeze_RiskScanSchedule_insert` BEFORE INSERT ON `RiskScanSchedule` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskScanSchedule_update`;

CREATE TRIGGER `freeze_RiskScanSchedule_update` BEFORE UPDATE ON `RiskScanSchedule` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskScanSchedule_delete`;

CREATE TRIGGER `freeze_RiskScanSchedule_delete` BEFORE DELETE ON `RiskScanSchedule` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskScanJob_insert`;

CREATE TRIGGER `freeze_RiskScanJob_insert` BEFORE INSERT ON `RiskScanJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskScanJob_update`;

CREATE TRIGGER `freeze_RiskScanJob_update` BEFORE UPDATE ON `RiskScanJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskScanJob_delete`;

CREATE TRIGGER `freeze_RiskScanJob_delete` BEFORE DELETE ON `RiskScanJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Document_insert`;

CREATE TRIGGER `freeze_Document_insert` BEFORE INSERT ON `Document` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Document_update`;

CREATE TRIGGER `freeze_Document_update` BEFORE UPDATE ON `Document` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Document_delete`;

CREATE TRIGGER `freeze_Document_delete` BEFORE DELETE ON `Document` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Deliverable_insert`;

CREATE TRIGGER `freeze_Deliverable_insert` BEFORE INSERT ON `Deliverable` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=NEW.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Deliverable_update`;

CREATE TRIGGER `freeze_Deliverable_update` BEFORE UPDATE ON `Deliverable` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=OLD.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=NEW.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Deliverable_delete`;

CREATE TRIGGER `freeze_Deliverable_delete` BEFORE DELETE ON `Deliverable` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=OLD.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_MeetingRecord_insert`;

CREATE TRIGGER `freeze_MeetingRecord_insert` BEFORE INSERT ON `MeetingRecord` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_MeetingRecord_update`;

CREATE TRIGGER `freeze_MeetingRecord_update` BEFORE UPDATE ON `MeetingRecord` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_MeetingRecord_delete`;

CREATE TRIGGER `freeze_MeetingRecord_delete` BEFORE DELETE ON `MeetingRecord` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_ProjectMember_insert`;

CREATE TRIGGER `freeze_ProjectMember_insert` BEFORE INSERT ON `ProjectMember` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_ProjectMember_update`;

CREATE TRIGGER `freeze_ProjectMember_update` BEFORE UPDATE ON `ProjectMember` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_ProjectMember_delete`;

CREATE TRIGGER `freeze_ProjectMember_delete` BEFORE DELETE ON `ProjectMember` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_DocumentChunk_insert`;

CREATE TRIGGER `freeze_DocumentChunk_insert` BEFORE INSERT ON `DocumentChunk` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_DocumentChunk_update`;

CREATE TRIGGER `freeze_DocumentChunk_update` BEFORE UPDATE ON `DocumentChunk` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_DocumentChunk_delete`;

CREATE TRIGGER `freeze_DocumentChunk_delete` BEFORE DELETE ON `DocumentChunk` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_SyncFailure_insert`;

CREATE TRIGGER `freeze_SyncFailure_insert` BEFORE INSERT ON `SyncFailure` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_SyncFailure_update`;

CREATE TRIGGER `freeze_SyncFailure_update` BEFORE UPDATE ON `SyncFailure` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = NEW.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_SyncFailure_delete`;

CREATE TRIGGER `freeze_SyncFailure_delete` BEFORE DELETE ON `SyncFailure` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = OLD.projectId;
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_TaskDependency_insert`;

CREATE TRIGGER `freeze_TaskDependency_insert` BEFORE INSERT ON `TaskDependency` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=NEW.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=NEW.dependsOnTaskId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_TaskDependency_update`;

CREATE TRIGGER `freeze_TaskDependency_update` BEFORE UPDATE ON `TaskDependency` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=OLD.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=OLD.dependsOnTaskId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=NEW.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=NEW.dependsOnTaskId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_TaskDependency_delete`;

CREATE TRIGGER `freeze_TaskDependency_delete` BEFORE DELETE ON `TaskDependency` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=OLD.taskId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Task WHERE id=OLD.dependsOnTaskId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_TestCase_insert`;

CREATE TRIGGER `freeze_TestCase_insert` BEFORE INSERT ON `TestCase` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Requirement WHERE id=NEW.requirementId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_TestCase_update`;

CREATE TRIGGER `freeze_TestCase_update` BEFORE UPDATE ON `TestCase` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = (SELECT projectId FROM Requirement WHERE id=OLD.requirementId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Requirement WHERE id=NEW.requirementId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_TestCase_delete`;

CREATE TRIGGER `freeze_TestCase_delete` BEFORE DELETE ON `TestCase` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Requirement WHERE id=OLD.requirementId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_ComplianceFindingReview_insert`;

CREATE TRIGGER `freeze_ComplianceFindingReview_insert` BEFORE INSERT ON `ComplianceFindingReview` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=NEW.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_ComplianceFindingReview_update`;

CREATE TRIGGER `freeze_ComplianceFindingReview_update` BEFORE UPDATE ON `ComplianceFindingReview` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=OLD.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=NEW.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_ComplianceFindingReview_delete`;

CREATE TRIGGER `freeze_ComplianceFindingReview_delete` BEFORE DELETE ON `ComplianceFindingReview` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=OLD.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_DocumentParseJob_insert`;

CREATE TRIGGER `freeze_DocumentParseJob_insert` BEFORE INSERT ON `DocumentParseJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_DocumentParseJob_update`;

CREATE TRIGGER `freeze_DocumentParseJob_update` BEFORE UPDATE ON `DocumentParseJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_DocumentParseJob_delete`;

CREATE TRIGGER `freeze_DocumentParseJob_delete` BEFORE DELETE ON `DocumentParseJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AssetSourceJob_insert`;

CREATE TRIGGER `freeze_AssetSourceJob_insert` BEFORE INSERT ON `AssetSourceJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AssetSourceJob_update`;

CREATE TRIGGER `freeze_AssetSourceJob_update` BEFORE UPDATE ON `AssetSourceJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=NEW.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_AssetSourceJob_delete`;

CREATE TRIGGER `freeze_AssetSourceJob_delete` BEFORE DELETE ON `AssetSourceJob` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM Document WHERE id=OLD.documentId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskNotification_insert`;

CREATE TRIGGER `freeze_RiskNotification_insert` BEFORE INSERT ON `RiskNotification` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=NEW.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_RiskNotification_update`;

CREATE TRIGGER `freeze_RiskNotification_update` BEFORE UPDATE ON `RiskNotification` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF;
  IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.userId <=> OLD.userId) OR NOT (NEW.suggestionId <=> OLD.suggestionId) OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=OLD.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=NEW.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
  END IF;
END;

DROP TRIGGER IF EXISTS `freeze_RiskNotification_delete`;

CREATE TRIGGER `freeze_RiskNotification_delete` BEFORE DELETE ON `RiskNotification` FOR EACH ROW BEGIN
  DECLARE freeze_project_id CHAR(36);
  SET freeze_project_id = (SELECT projectId FROM AiSuggestion WHERE id=OLD.suggestionId);
  CALL medpm_assert_project_write(freeze_project_id);
END;

DROP TRIGGER IF EXISTS `freeze_Project_update`;

CREATE TRIGGER `freeze_Project_update` BEFORE UPDATE ON Project FOR EACH ROW BEGIN IF OLD.status='ARCHIVED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT'; END IF; END;

DROP TRIGGER IF EXISTS `freeze_Project_delete`;

CREATE TRIGGER `freeze_Project_delete` BEFORE DELETE ON Project FOR EACH ROW BEGIN IF OLD.status='ARCHIVED' THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ARCHIVED_PROJECT'; END IF; END;

DROP TRIGGER IF EXISTS freeze_User_id_update;

CREATE TRIGGER freeze_User_id_update BEFORE UPDATE ON User FOR EACH ROW BEGIN IF NOT (NEW.id <=> OLD.id) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_BUSINESS_ID_IMMUTABLE'; END IF; END;

DROP TRIGGER IF EXISTS `freeze_ProjectAcceptance_insert`;

CREATE TRIGGER `freeze_ProjectAcceptance_insert` BEFORE INSERT ON ProjectAcceptance FOR EACH ROW BEGIN
  CALL medpm_assert_project_write(NEW.projectId);
END;

DROP TRIGGER IF EXISTS `freeze_ProjectAcceptance_update`;

CREATE TRIGGER `freeze_ProjectAcceptance_update` BEFORE UPDATE ON ProjectAcceptance FOR EACH ROW BEGIN
  IF NOT (NEW.`id` <=> OLD.`id`) OR NOT (NEW.`projectId` <=> OLD.`projectId`) OR NOT (NEW.`round` <=> OLD.`round`) OR NOT (NEW.`requestKey` <=> OLD.`requestKey`) OR NOT (NEW.`submittedById` <=> OLD.`submittedById`) OR NOT (NEW.`submittedAt` <=> OLD.`submittedAt`) OR NOT (NEW.`snapshot` <=> OLD.`snapshot`) OR NOT (NEW.`snapshotSha256` <=> OLD.`snapshotSha256`) THEN SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ACCEPTANCE_IMMUTABLE'; END IF;
  CALL medpm_assert_project_write(OLD.projectId);
  CALL medpm_assert_project_write(NEW.projectId);
END;

DROP TRIGGER IF EXISTS `freeze_ProjectAcceptance_delete`;

CREATE TRIGGER `freeze_ProjectAcceptance_delete` BEFORE DELETE ON ProjectAcceptance FOR EACH ROW BEGIN
  SIGNAL SQLSTATE '45000' SET MYSQL_ERRNO=1644, MESSAGE_TEXT='ER_ACCEPTANCE_IMMUTABLE';
END;
