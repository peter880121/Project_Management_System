-- Structural rollback: dropping TaskDependency removes accepted WBS dependency links,
-- and dropping these columns discards actual-hour and completion-time history.
DROP TABLE IF EXISTS `TaskDependency`;

ALTER TABLE `Task`
    DROP INDEX `Task_projectId_status_completedAt_idx`,
    DROP COLUMN `completedAt`,
    DROP COLUMN `actualHours`;
