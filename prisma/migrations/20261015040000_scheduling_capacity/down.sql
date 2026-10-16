-- Stop application first; back up planning/capacity data before rollback.
DROP TABLE `MemberWeeklyCapacity`;
ALTER TABLE `Task` DROP COLUMN `plannedStartDate`, DROP COLUMN `scheduleVersion`;
