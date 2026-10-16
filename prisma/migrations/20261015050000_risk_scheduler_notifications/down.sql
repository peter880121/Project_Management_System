-- Stop workers/application and back up schedules, jobs and notification state first.
DROP TABLE `RiskNotification`;
DROP TABLE `RiskScanJob`;
DROP TABLE `RiskScanSchedule`;
