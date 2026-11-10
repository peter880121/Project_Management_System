-- Refuse to discard any reporting data. For populated systems use a forward migration.
DROP PROCEDURE IF EXISTS medpm_weekly_rollback;
CREATE PROCEDURE medpm_weekly_rollback() BEGIN
IF EXISTS(SELECT 1 FROM `WeeklyReportReview`) OR EXISTS(SELECT 1 FROM `WeeklyReportRevision`) OR EXISTS(SELECT 1 FROM `WeeklyReportItem`) OR EXISTS(SELECT 1 FROM `WeeklyReportSection`) OR EXISTS(SELECT 1 FROM `WeeklyReport`) OR EXISTS(SELECT 1 FROM `WeeklyReportExpectation`) OR EXISTS(SELECT 1 FROM `WeeklyReportPeriod`) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Weekly report data exists; rollback refused'; END IF;
DROP TABLE `WeeklyReportReview`;
DROP TABLE `WeeklyReportRevision`;
DROP TABLE `WeeklyReportItem`;
DROP TABLE `WeeklyReportSection`;
DROP TABLE `WeeklyReport`;
DROP TABLE `WeeklyReportExpectation`;
DROP TABLE `WeeklyReportPeriod`;
END;
CALL medpm_weekly_rollback();
DROP PROCEDURE medpm_weekly_rollback;
