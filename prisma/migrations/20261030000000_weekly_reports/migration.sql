-- Additive reporting tables. Existing project assets and audit evidence are untouched.
-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReportPeriod` (
    `weekStart` DATETIME(3) NOT NULL,
    `deadline` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`weekStart`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReportExpectation` (
    `id` CHAR(36) NOT NULL,
    `authorId` CHAR(36) NOT NULL,
    `weekStart` DATETIME(3) NOT NULL,
    `role` ENUM('ADMIN', 'PM', 'MEMBER', 'QA', 'PMO') NOT NULL,
    `deadline` DATETIME(3) NOT NULL,
    `exemptReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WeeklyReportExpectation_weekStart_deadline_idx`(`weekStart`, `deadline`),
    UNIQUE INDEX `WeeklyReportExpectation_authorId_weekStart_key`(`authorId`, `weekStart`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReport` (
    `id` CHAR(36) NOT NULL,
    `authorId` CHAR(36) NOT NULL,
    `weekStart` DATETIME(3) NOT NULL,
    `state` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `rowVersion` INTEGER NOT NULL DEFAULT 1,
    `submittedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WeeklyReport_weekStart_state_idx`(`weekStart`, `state`),
    UNIQUE INDEX `WeeklyReport_authorId_weekStart_key`(`authorId`, `weekStart`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReportSection` (
    `id` CHAR(36) NOT NULL,
    `reportId` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NULL,
    `projectName` VARCHAR(191) NOT NULL,
    `summary` TEXT NOT NULL,

    INDEX `WeeklyReportSection_reportId_idx`(`reportId`),
    INDEX `WeeklyReportSection_projectId_reportId_idx`(`projectId`, `reportId`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReportItem` (
    `id` CHAR(36) NOT NULL,
    `sectionId` CHAR(36) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `text` TEXT NOT NULL,
    `sourceType` VARCHAR(20) NULL,
    `sourceId` CHAR(36) NULL,
    `targetDate` DATETIME(3) NULL,
    `declaredHours` DECIMAL(6, 2) NULL,

    INDEX `WeeklyReportItem_sectionId_idx`(`sectionId`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReportRevision` (
    `id` CHAR(36) NOT NULL,
    `reportId` CHAR(36) NOT NULL,
    `version` INTEGER NOT NULL,
    `snapshot` JSON NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WeeklyReportRevision_reportId_version_key`(`reportId`, `version`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE IF NOT EXISTS `WeeklyReportReview` (
    `id` CHAR(36) NOT NULL,
    `revisionId` CHAR(36) NOT NULL,
    `sectionId` CHAR(36) NOT NULL,
    `sectionSha256` CHAR(64) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `decision` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(1000) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WeeklyReportReview_sectionId_sectionSha256_idx`(`sectionId`, `sectionSha256`),
    UNIQUE INDEX `WeeklyReportReview_revisionId_sectionId_actorId_key`(`revisionId`, `sectionId`, `actorId`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportExpectation_authorId_fkey')=0, 'ALTER TABLE `WeeklyReportExpectation` ADD CONSTRAINT `WeeklyReportExpectation_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReport_authorId_fkey')=0, 'ALTER TABLE `WeeklyReport` ADD CONSTRAINT `WeeklyReport_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportSection_projectId_fkey')=0, 'ALTER TABLE `WeeklyReportSection` ADD CONSTRAINT `WeeklyReportSection_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportSection_reportId_fkey')=0, 'ALTER TABLE `WeeklyReportSection` ADD CONSTRAINT `WeeklyReportSection_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `WeeklyReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportItem_sectionId_fkey')=0, 'ALTER TABLE `WeeklyReportItem` ADD CONSTRAINT `WeeklyReportItem_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `WeeklyReportSection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportRevision_reportId_fkey')=0, 'ALTER TABLE `WeeklyReportRevision` ADD CONSTRAINT `WeeklyReportRevision_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `WeeklyReport`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportReview_actorId_fkey')=0, 'ALTER TABLE `WeeklyReportReview` ADD CONSTRAINT `WeeklyReportReview_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

-- AddForeignKey
SET @weekly_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='WeeklyReportReview_revisionId_fkey')=0, 'ALTER TABLE `WeeklyReportReview` ADD CONSTRAINT `WeeklyReportReview_revisionId_fkey` FOREIGN KEY (`revisionId`) REFERENCES `WeeklyReportRevision`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE', 'SELECT 1');
PREPARE weekly_stmt FROM @weekly_ddl; EXECUTE weekly_stmt; DEALLOCATE PREPARE weekly_stmt;

DROP TRIGGER IF EXISTS weekly_WeeklyReportRevision_update;
CREATE TRIGGER weekly_WeeklyReportRevision_update BEFORE UPDATE ON `WeeklyReportRevision` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS weekly_WeeklyReportRevision_delete;
CREATE TRIGGER weekly_WeeklyReportRevision_delete BEFORE DELETE ON `WeeklyReportRevision` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS weekly_WeeklyReportReview_update;
CREATE TRIGGER weekly_WeeklyReportReview_update BEFORE UPDATE ON `WeeklyReportReview` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS weekly_WeeklyReportReview_delete;
CREATE TRIGGER weekly_WeeklyReportReview_delete BEFORE DELETE ON `WeeklyReportReview` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS weekly_WeeklyReportPeriod_update;
CREATE TRIGGER weekly_WeeklyReportPeriod_update BEFORE UPDATE ON `WeeklyReportPeriod` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS weekly_WeeklyReportPeriod_delete;
CREATE TRIGGER weekly_WeeklyReportPeriod_delete BEFORE DELETE ON `WeeklyReportPeriod` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_EVIDENCE_IMMUTABLE';

DROP TRIGGER IF EXISTS weekly_WeeklyReportSection_insert;
CREATE TRIGGER weekly_WeeklyReportSection_insert BEFORE INSERT ON `WeeklyReportSection` FOR EACH ROW BEGIN IF EXISTS(SELECT 1 FROM WeeklyReport r WHERE r.id=NEW.reportId AND r.state='SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_SUBMITTED_READONLY'; END IF; END;

DROP TRIGGER IF EXISTS weekly_WeeklyReportSection_update;
CREATE TRIGGER weekly_WeeklyReportSection_update BEFORE UPDATE ON `WeeklyReportSection` FOR EACH ROW BEGIN IF EXISTS(SELECT 1 FROM WeeklyReport r WHERE r.id=NEW.reportId AND r.state='SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_SUBMITTED_READONLY'; END IF; END;

DROP TRIGGER IF EXISTS weekly_WeeklyReportSection_delete;
CREATE TRIGGER weekly_WeeklyReportSection_delete BEFORE DELETE ON `WeeklyReportSection` FOR EACH ROW BEGIN IF EXISTS(SELECT 1 FROM WeeklyReport r WHERE r.id=OLD.reportId AND r.state='SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_SUBMITTED_READONLY'; END IF; END;

DROP TRIGGER IF EXISTS weekly_WeeklyReportItem_insert;
CREATE TRIGGER weekly_WeeklyReportItem_insert BEFORE INSERT ON `WeeklyReportItem` FOR EACH ROW BEGIN IF EXISTS(SELECT 1 FROM WeeklyReportSection s JOIN WeeklyReport r ON r.id=s.reportId WHERE s.id=NEW.sectionId AND r.state='SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_SUBMITTED_READONLY'; END IF; END;

DROP TRIGGER IF EXISTS weekly_WeeklyReportItem_update;
CREATE TRIGGER weekly_WeeklyReportItem_update BEFORE UPDATE ON `WeeklyReportItem` FOR EACH ROW BEGIN IF EXISTS(SELECT 1 FROM WeeklyReportSection s JOIN WeeklyReport r ON r.id=s.reportId WHERE s.id=NEW.sectionId AND r.state='SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_SUBMITTED_READONLY'; END IF; END;

DROP TRIGGER IF EXISTS weekly_WeeklyReportItem_delete;
CREATE TRIGGER weekly_WeeklyReportItem_delete BEFORE DELETE ON `WeeklyReportItem` FOR EACH ROW BEGIN IF EXISTS(SELECT 1 FROM WeeklyReportSection s JOIN WeeklyReport r ON r.id=s.reportId WHERE s.id=OLD.sectionId AND r.state='SUBMITTED') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_WEEKLY_SUBMITTED_READONLY'; END IF; END;
