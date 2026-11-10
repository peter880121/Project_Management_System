-- CreateTable
CREATE TABLE IF NOT EXISTS `AuditIssue` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `fingerprint` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    `severity` VARCHAR(12) NOT NULL DEFAULT 'MEDIUM',
    `assignedToId` CHAR(36) NULL,
    `dueDate` DATETIME(3) NULL,
    `rowVersion` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AuditIssue_projectId_status_createdAt_idx`(`projectId`, `status`, `createdAt`),
    INDEX `AuditIssue_assignedToId_status_idx`(`assignedToId`, `status`),
    UNIQUE INDEX `AuditIssue_projectId_fingerprint_key`(`projectId`, `fingerprint`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `AuditIssueOccurrence` (
    `id` CHAR(36) NOT NULL,
    `issueId` CHAR(36) NOT NULL,
    `summaryId` CHAR(36) NOT NULL,
    `findingKey` VARCHAR(191) NOT NULL,
    `evidence` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditIssueOccurrence_issueId_createdAt_idx`(`issueId`, `createdAt`),
    UNIQUE INDEX `AuditIssueOccurrence_summaryId_findingKey_key`(`summaryId`, `findingKey`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `AuditIssueEvent` (
    `id` CHAR(36) NOT NULL,
    `issueId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `action` VARCHAR(24) NOT NULL,
    `fromStatus` VARCHAR(24) NOT NULL,
    `toStatus` VARCHAR(24) NOT NULL,
    `note` VARCHAR(2000) NOT NULL,
    `evidence` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditIssueEvent_issueId_createdAt_idx`(`issueId`, `createdAt`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
SET @audit_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='AuditIssue_projectId_fkey')=0,'ALTER TABLE `AuditIssue` ADD CONSTRAINT `AuditIssue_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE audit_stmt FROM @audit_ddl; EXECUTE audit_stmt; DEALLOCATE PREPARE audit_stmt;

-- AddForeignKey
SET @audit_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='AuditIssue_assignedToId_fkey')=0,'ALTER TABLE `AuditIssue` ADD CONSTRAINT `AuditIssue_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE audit_stmt FROM @audit_ddl; EXECUTE audit_stmt; DEALLOCATE PREPARE audit_stmt;

-- AddForeignKey
SET @audit_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='AuditIssueOccurrence_issueId_fkey')=0,'ALTER TABLE `AuditIssueOccurrence` ADD CONSTRAINT `AuditIssueOccurrence_issueId_fkey` FOREIGN KEY (`issueId`) REFERENCES `AuditIssue`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE audit_stmt FROM @audit_ddl; EXECUTE audit_stmt; DEALLOCATE PREPARE audit_stmt;

-- AddForeignKey
SET @audit_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='AuditIssueOccurrence_summaryId_fkey')=0,'ALTER TABLE `AuditIssueOccurrence` ADD CONSTRAINT `AuditIssueOccurrence_summaryId_fkey` FOREIGN KEY (`summaryId`) REFERENCES `AiSuggestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE audit_stmt FROM @audit_ddl; EXECUTE audit_stmt; DEALLOCATE PREPARE audit_stmt;

-- AddForeignKey
SET @audit_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='AuditIssueEvent_issueId_fkey')=0,'ALTER TABLE `AuditIssueEvent` ADD CONSTRAINT `AuditIssueEvent_issueId_fkey` FOREIGN KEY (`issueId`) REFERENCES `AuditIssue`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE audit_stmt FROM @audit_ddl; EXECUTE audit_stmt; DEALLOCATE PREPARE audit_stmt;

-- AddForeignKey
SET @audit_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='AuditIssueEvent_actorId_fkey')=0,'ALTER TABLE `AuditIssueEvent` ADD CONSTRAINT `AuditIssueEvent_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE audit_stmt FROM @audit_ddl; EXECUTE audit_stmt; DEALLOCATE PREPARE audit_stmt;


DROP TRIGGER IF EXISTS audit_auditissueoccurrence_update;
CREATE TRIGGER audit_auditissueoccurrence_update BEFORE UPDATE ON `AuditIssueOccurrence` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_AUDIT_ISSUE_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS audit_auditissueoccurrence_delete;
CREATE TRIGGER audit_auditissueoccurrence_delete BEFORE DELETE ON `AuditIssueOccurrence` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_AUDIT_ISSUE_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS audit_auditissueevent_update;
CREATE TRIGGER audit_auditissueevent_update BEFORE UPDATE ON `AuditIssueEvent` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_AUDIT_ISSUE_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS audit_auditissueevent_delete;
CREATE TRIGGER audit_auditissueevent_delete BEFORE DELETE ON `AuditIssueEvent` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_AUDIT_ISSUE_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS audit_issue_delete;
CREATE TRIGGER audit_issue_delete BEFORE DELETE ON AuditIssue FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_AUDIT_ISSUE_IMMUTABLE';
