-- AlterTable
ALTER TABLE `Document` ADD COLUMN `errorCode` VARCHAR(100) NULL,
    ADD COLUMN `fileSize` INTEGER UNSIGNED NULL,
    ADD COLUMN `sha256` CHAR(64) NULL,
    ADD COLUMN `storageStatus` ENUM('LEGACY', 'UPLOADING', 'AVAILABLE', 'FAILED') NOT NULL DEFAULT 'LEGACY',
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `uploadKey` CHAR(36) NULL,
    ADD COLUMN `uploadedAt` DATETIME(3) NULL,
    ADD COLUMN `uploadedById` CHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Document_projectId_uploadKey_key` ON `Document`(`projectId`, `uploadKey`);

-- AddForeignKey
ALTER TABLE `Document` ADD CONSTRAINT `Document_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
