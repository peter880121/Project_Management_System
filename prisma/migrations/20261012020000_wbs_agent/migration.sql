ALTER TABLE `Task`
    ADD COLUMN `actualHours` DECIMAL(8, 2) NULL,
    ADD COLUMN `completedAt` DATETIME(3) NULL,
    ADD INDEX `Task_projectId_status_completedAt_idx` (`projectId`, `status`, `completedAt`);

CREATE TABLE `TaskDependency` (
    `id` CHAR(36) NOT NULL,
    `taskId` CHAR(36) NOT NULL,
    `dependsOnTaskId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `TaskDependency_taskId_dependsOnTaskId_key` (`taskId`, `dependsOnTaskId`),
    INDEX `TaskDependency_dependsOnTaskId_idx` (`dependsOnTaskId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `TaskDependency_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `Task` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `TaskDependency_dependsOnTaskId_fkey` FOREIGN KEY (`dependsOnTaskId`) REFERENCES `Task` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
