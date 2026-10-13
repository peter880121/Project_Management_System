-- Authentication foundation. Existing accounts remain passwordless until
-- seed/backfill; a later migration will make passwordHash required.
ALTER TABLE `User`
    ADD COLUMN `passwordHash` VARCHAR(255) NULL,
    ADD COLUMN `isSystem` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `status` ENUM('ACTIVE', 'DISABLED', 'PENDING') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `lastLoginAt` DATETIME(3) NULL,
    ADD COLUMN `failedLoginCount` INT NOT NULL DEFAULT 0,
    ADD COLUMN `lockedUntil` DATETIME(3) NULL;

CREATE INDEX `User_isSystem_idx` ON `User` (`isSystem`);

CREATE TABLE `Session` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `ip` VARCHAR(45) NULL,
    `userAgent` VARCHAR(512) NULL,
    UNIQUE INDEX `Session_tokenHash_key` (`tokenHash`),
    INDEX `Session_userId_expiresAt_idx` (`userId`, `expiresAt`),
    INDEX `Session_expiresAt_idx` (`expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `PasswordResetToken` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PasswordResetToken_tokenHash_key` (`tokenHash`),
    INDEX `PasswordResetToken_userId_expiresAt_idx` (`userId`, `expiresAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `PasswordResetToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;
