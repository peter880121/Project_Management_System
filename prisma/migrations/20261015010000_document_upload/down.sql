-- Drops upload metadata only. Existing Document rows, MinIO objects and AuditLog survive.
ALTER TABLE `Document` DROP FOREIGN KEY `Document_uploadedById_fkey`;
ALTER TABLE `Document` DROP INDEX `Document_projectId_uploadKey_key`, DROP INDEX `Document_uploadedById_fkey`,
  DROP COLUMN `errorCode`, DROP COLUMN `fileSize`, DROP COLUMN `sha256`, DROP COLUMN `storageStatus`,
  DROP COLUMN `updatedAt`, DROP COLUMN `uploadKey`, DROP COLUMN `uploadedAt`, DROP COLUMN `uploadedById`;
