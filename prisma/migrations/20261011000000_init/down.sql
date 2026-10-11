-- Irreversible data loss: only use to undo the initial migration in a disposable environment.
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `AIRecommendation`, `Document`, `Task`, `AuditLog`, `User`, `Project`;
SET FOREIGN_KEY_CHECKS = 1;
