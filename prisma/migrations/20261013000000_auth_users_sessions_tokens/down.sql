-- Structural rollback. Any sessions, reset tokens, and account-auth metadata
-- created after this migration will be removed.
DROP TABLE IF EXISTS `PasswordResetToken`;
DROP TABLE IF EXISTS `Session`;

DROP INDEX `User_isSystem_idx` ON `User`;

ALTER TABLE `User`
    DROP COLUMN `lockedUntil`,
    DROP COLUMN `failedLoginCount`,
    DROP COLUMN `lastLoginAt`,
    DROP COLUMN `status`,
    DROP COLUMN `isSystem`,
    DROP COLUMN `passwordHash`;
