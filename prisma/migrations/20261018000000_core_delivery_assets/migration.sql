-- Additive migration. No existing rows, constraints, or audit records are removed.


SET @asset_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Task' AND COLUMN_NAME = 'requiresDeliverable') = 0, 'ALTER TABLE `Task` ADD COLUMN `requiresDeliverable` BOOLEAN NOT NULL DEFAULT false', 'SELECT 1');
PREPARE asset_stmt FROM @asset_ddl; EXECUTE asset_stmt; DEALLOCATE PREPARE asset_stmt;


SET @asset_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Document' AND COLUMN_NAME = 'documentType') = 0, 'ALTER TABLE `Document` ADD COLUMN `documentType` VARCHAR(32) NOT NULL DEFAULT ''DOCUMENT''', 'SELECT 1');
PREPARE asset_stmt FROM @asset_ddl; EXECUTE asset_stmt; DEALLOCATE PREPARE asset_stmt;


SET @asset_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Document' AND COLUMN_NAME = 'visibleRoles') = 0, 'ALTER TABLE `Document` ADD COLUMN `visibleRoles` JSON NOT NULL DEFAULT (''["ADMIN","PM","QA","MEMBER"]'')', 'SELECT 1');
PREPARE asset_stmt FROM @asset_ddl; EXECUTE asset_stmt; DEALLOCATE PREPARE asset_stmt;


CREATE TABLE IF NOT EXISTS `Deliverable` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NULL,
    `documentId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `seriesId` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `status` ENUM('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `createdById` CHAR(36) NOT NULL,
    `submittedAt` DATETIME(3) NULL,
    `submittedById` CHAR(36) NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewComment` TEXT NULL,
    `rowVersion` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Deliverable_documentId_key`(`documentId`),
    INDEX `Deliverable_projectId_taskId_status_idx`(`projectId`, `taskId`, `status`),
    INDEX `Deliverable_projectId_createdAt_idx`(`projectId`, `createdAt`),
    UNIQUE INDEX `Deliverable_projectId_seriesId_version_key`(`projectId`, `seriesId`, `version`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Deliverable_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `Deliverable_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `Deliverable_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `Deliverable_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `Deliverable_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `Deliverable_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `MeetingRecord` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `meetingDate` DATETIME(3) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `actionItems` JSON NOT NULL,
    `createdById` CHAR(36) NOT NULL,
    `requestKey` CHAR(36) NOT NULL,
    `visibleRoles` JSON NOT NULL,
    `documentId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MeetingRecord_documentId_key`(`documentId`),
    INDEX `MeetingRecord_projectId_meetingDate_idx`(`projectId`, `meetingDate`),
    UNIQUE INDEX `MeetingRecord_projectId_requestKey_key`(`projectId`, `requestKey`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MeetingRecord_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `MeetingRecord_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `MeetingRecord_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `AssetSourceJob` (
    `id` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `nextRunAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leaseToken` CHAR(36) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AssetSourceJob_documentId_key`(`documentId`),
    INDEX `AssetSourceJob_status_nextRunAt_leaseUntil_idx`(`status`, `nextRunAt`, `leaseUntil`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AssetSourceJob_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
