-- AlterTable
ALTER TABLE `Document` ADD COLUMN `parseStatus` ENUM('NOT_REQUESTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'NOT_REQUESTED',
    ADD COLUMN `parseVersion` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    ADD COLUMN `parsedAt` DATETIME(3) NULL,
    ADD COLUMN `parsedVersion` INTEGER UNSIGNED NULL;

-- CreateTable
CREATE TABLE `DocumentParseJob` (
    `id` CHAR(36) NOT NULL,
    `documentId` CHAR(36) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL,
    `requestedById` CHAR(36) NOT NULL,
    `requestKey` CHAR(36) NOT NULL,
    `status` ENUM('NOT_REQUESTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `phase` VARCHAR(32) NOT NULL DEFAULT 'RESERVE',
    `provider` VARCHAR(64) NOT NULL DEFAULT 'mineru-cloud-v4',
    `modelVersion` VARCHAR(64) NOT NULL,
    `sourceSha256` CHAR(64) NOT NULL,
    `sourceFilename` VARCHAR(512) NOT NULL,
    `sourceSize` INTEGER UNSIGNED NOT NULL,
    `remoteBatchId` VARCHAR(191) NULL,
    `uploadUrl` TEXT NULL,
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `errorCode` VARCHAR(100) NULL,
    `nextRunAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deadlineAt` DATETIME(3) NOT NULL,
    `leaseToken` CHAR(36) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `resultKey` VARCHAR(512) NULL,
    `resultSha256` CHAR(64) NULL,
    `markdown` LONGTEXT NULL,
    `blocks` JSON NULL,
    `ip` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `DocumentParseJob_status_nextRunAt_leaseUntil_idx`(`status`, `nextRunAt`, `leaseUntil`),
    INDEX `DocumentParseJob_requestedById_idx`(`requestedById`),
    UNIQUE INDEX `DocumentParseJob_documentId_version_key`(`documentId`, `version`),
    UNIQUE INDEX `DocumentParseJob_documentId_requestKey_key`(`documentId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

-- AddForeignKey
ALTER TABLE `DocumentParseJob` ADD CONSTRAINT `DocumentParseJob_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DocumentParseJob` ADD CONSTRAINT `DocumentParseJob_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
