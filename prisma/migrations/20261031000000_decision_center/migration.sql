-- AlterTable
SET @decision_ddl=IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='AuditLog' AND COLUMN_NAME='actorRole')=0,'ALTER TABLE `AuditLog` ADD COLUMN `actorRole` ENUM(''ADMIN'', ''PM'', ''MEMBER'', ''QA'', ''PMO'') NULL','SELECT 1');
PREPARE decision_stmt FROM @decision_ddl; EXECUTE decision_stmt; DEALLOCATE PREPARE decision_stmt;

-- CreateTable
CREATE TABLE IF NOT EXISTS `DecisionSnapshot` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `day` DATETIME(3) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `projectStatus` VARCHAR(32) NOT NULL,
    `taskTotal` INTEGER NOT NULL,
    `taskDone` INTEGER NOT NULL,
    `overdueTasks` INTEGER NOT NULL,
    `openRequirements` INTEGER NOT NULL,

    INDEX `DecisionSnapshot_day_projectId_idx`(`day`, `projectId`),
    UNIQUE INDEX `DecisionSnapshot_projectId_day_key`(`projectId`, `day`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
SET @decision_ddl=IF((SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='DecisionSnapshot_projectId_fkey')=0,'ALTER TABLE `DecisionSnapshot` ADD CONSTRAINT `DecisionSnapshot_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE','SELECT 1');
PREPARE decision_stmt FROM @decision_ddl; EXECUTE decision_stmt; DEALLOCATE PREPARE decision_stmt;

-- Historical audit rows remain NULL. Capture the real database role at INSERT time.
DROP TRIGGER IF EXISTS audit_capture_actor_role;
CREATE TRIGGER audit_capture_actor_role BEFORE INSERT ON AuditLog FOR EACH ROW SET NEW.actorRole=(SELECT role FROM User WHERE id=NEW.actorId);

DROP TRIGGER IF EXISTS decision_snapshot_update;
CREATE TRIGGER decision_snapshot_update BEFORE UPDATE ON DecisionSnapshot FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_DECISION_SNAPSHOT_IMMUTABLE';

DROP TRIGGER IF EXISTS decision_snapshot_delete;
CREATE TRIGGER decision_snapshot_delete BEFORE DELETE ON DecisionSnapshot FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ER_DECISION_SNAPSHOT_IMMUTABLE';
