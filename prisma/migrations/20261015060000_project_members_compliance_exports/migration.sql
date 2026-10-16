CREATE TABLE `ProjectMember` (
 `id` CHAR(36) NOT NULL, `projectId` CHAR(36) NOT NULL, `userId` CHAR(36) NOT NULL, `active` BOOLEAN NOT NULL DEFAULT true,
 `version` INTEGER UNSIGNED NOT NULL DEFAULT 1, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), UNIQUE INDEX `ProjectMember_projectId_userId_key` (`projectId`,`userId`), INDEX `ProjectMember_userId_active_projectId_idx` (`userId`,`active`,`projectId`),
 CONSTRAINT `ProjectMember_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `ProjectMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
-- Retain explicit legacy responsibility only. Do not grant all users access to all projects.
INSERT INTO `ProjectMember` (`id`,`projectId`,`userId`,`active`,`version`,`updatedAt`)
 SELECT UUID(), participants.projectId, participants.userId, true, 1, CURRENT_TIMESTAMP(3)
 FROM (SELECT id AS projectId, ownerId AS userId FROM Project WHERE ownerId IS NOT NULL
       UNION SELECT projectId, assigneeId AS userId FROM Task WHERE assigneeId IS NOT NULL) participants;
CREATE TABLE `ComplianceExport` (
 `id` CHAR(36) NOT NULL, `projectId` CHAR(36) NOT NULL, `actorId` CHAR(36) NOT NULL, `requestKey` CHAR(36) NOT NULL,
 `format` VARCHAR(16) NOT NULL, `status` ENUM('GENERATING','AVAILABLE','FAILED') NOT NULL DEFAULT 'GENERATING',
 `scope` JSON NOT NULL, `minioKey` VARCHAR(512) NOT NULL, `sha256` CHAR(64) NOT NULL, `fileSize` INTEGER UNSIGNED NOT NULL, `errorCode` VARCHAR(100) NULL,
 `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
 PRIMARY KEY (`id`), UNIQUE INDEX `ComplianceExport_projectId_requestKey_key` (`projectId`,`requestKey`), INDEX `ComplianceExport_projectId_createdAt_idx` (`projectId`,`createdAt`),
 CONSTRAINT `ComplianceExport_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT `ComplianceExport_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
