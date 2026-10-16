-- AlterTable
ALTER TABLE `Task` ADD COLUMN `requirementReviewedAt` DATETIME(3) NULL,
    ADD COLUMN `requirementReviewedById` CHAR(36) NULL,
    ADD COLUMN `reviewedRequirementVersion` INTEGER UNSIGNED NULL;

-- AlterTable
ALTER TABLE `TestCase` ADD COLUMN `requirementReviewedAt` DATETIME(3) NULL,
    ADD COLUMN `requirementReviewedById` CHAR(36) NULL,
    ADD COLUMN `reviewedRequirementVersion` INTEGER UNSIGNED NULL;

-- CreateTable
CREATE TABLE `ComplianceFindingReview` (
    `id` CHAR(36) NOT NULL,
    `suggestionId` CHAR(36) NOT NULL,
    `findingKey` VARCHAR(191) NOT NULL,
    `decision` ENUM('CONFIRMED', 'DISMISSED') NOT NULL,
    `note` VARCHAR(2000) NOT NULL,
    `reviewedById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ComplianceFindingReview_reviewedById_createdAt_idx`(`reviewedById`, `createdAt`),
    UNIQUE INDEX `ComplianceFindingReview_suggestionId_findingKey_key`(`suggestionId`, `findingKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_requirementReviewedById_fkey` FOREIGN KEY (`requirementReviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TestCase` ADD CONSTRAINT `TestCase_requirementReviewedById_fkey` FOREIGN KEY (`requirementReviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplianceFindingReview` ADD CONSTRAINT `ComplianceFindingReview_suggestionId_fkey` FOREIGN KEY (`suggestionId`) REFERENCES `AiSuggestion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ComplianceFindingReview` ADD CONSTRAINT `ComplianceFindingReview_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
