CREATE TABLE `RiskScanSchedule` (
 `id` CHAR(36) NOT NULL, `projectId` CHAR(36) NOT NULL, `configuredById` CHAR(36) NOT NULL,
 `enabled` BOOLEAN NOT NULL DEFAULT false, `intervalMinutes` INTEGER UNSIGNED NOT NULL DEFAULT 60,
 `version` INTEGER UNSIGNED NOT NULL DEFAULT 1, `nextRunAt` DATETIME(3) NOT NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), UNIQUE INDEX `RiskScanSchedule_projectId_key` (`projectId`), INDEX `RiskScanSchedule_enabled_nextRunAt_idx` (`enabled`,`nextRunAt`),
 CONSTRAINT `RiskScanSchedule_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `RiskScanSchedule_configuredById_fkey` FOREIGN KEY (`configuredById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
CREATE TABLE `RiskScanJob` (
 `id` CHAR(36) NOT NULL, `scheduleId` CHAR(36) NOT NULL, `scheduleVersion` INTEGER UNSIGNED NOT NULL, `projectId` CHAR(36) NOT NULL,
 `dueAt` DATETIME(3) NOT NULL, `nextRunAt` DATETIME(3) NOT NULL,
 `status` ENUM('QUEUED','RUNNING','SUCCEEDED','FAILED','SKIPPED') NOT NULL DEFAULT 'QUEUED',
 `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0, `leaseToken` CHAR(36) NULL, `leaseUntil` DATETIME(3) NULL,
 `errorCode` VARCHAR(100) NULL, `batchId` CHAR(36) NULL, `suggestionCount` INTEGER UNSIGNED NULL, `completedAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), UNIQUE INDEX `RiskScanJob_scheduleId_dueAt_key` (`scheduleId`,`dueAt`),
 INDEX `RiskScanJob_status_nextRunAt_leaseUntil_idx` (`status`,`nextRunAt`,`leaseUntil`), INDEX `RiskScanJob_projectId_createdAt_idx` (`projectId`,`createdAt`),
 CONSTRAINT `RiskScanJob_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `RiskScanSchedule` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `RiskScanJob_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
CREATE TABLE `RiskNotification` (
 `id` CHAR(36) NOT NULL, `userId` CHAR(36) NOT NULL, `suggestionId` CHAR(36) NOT NULL, `readAt` DATETIME(3) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`),
 UNIQUE INDEX `RiskNotification_userId_suggestionId_key` (`userId`,`suggestionId`), INDEX `RiskNotification_userId_readAt_createdAt_idx` (`userId`,`readAt`,`createdAt`), INDEX `RiskNotification_suggestionId_idx` (`suggestionId`),
 CONSTRAINT `RiskNotification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `RiskNotification_suggestionId_fkey` FOREIGN KEY (`suggestionId`) REFERENCES `AiSuggestion` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
