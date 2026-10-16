ALTER TABLE `Task`
  ADD COLUMN `plannedStartDate` DATETIME(3) NULL,
  ADD COLUMN `scheduleVersion` INTEGER UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE `MemberWeeklyCapacity` (
  `id` CHAR(36) NOT NULL,
  `userId` CHAR(36) NOT NULL,
  `weekStart` DATETIME(3) NOT NULL,
  `hours` DECIMAL(6,2) NULL,
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `MemberWeeklyCapacity_userId_weekStart_key` (`userId`, `weekStart`),
  INDEX `MemberWeeklyCapacity_weekStart_idx` (`weekStart`),
  CONSTRAINT `MemberWeeklyCapacity_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
