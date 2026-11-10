-- Stop writers first. Refuse to discard completion-round evidence once used.
SET @task_plan_guard = IF((SELECT COUNT(*) FROM Task WHERE completionRoundId IS NOT NULL)=0, 'SELECT 1', 'SELECT * FROM TASK_PLAN_ROLLBACK_REFUSED_KEEP_ROUND_EVIDENCE');
PREPARE task_plan_stmt FROM @task_plan_guard; EXECUTE task_plan_stmt; DEALLOCATE PREPARE task_plan_stmt;
ALTER TABLE Task DROP COLUMN planningStatus, DROP COLUMN completionRoundId;
