-- Additive, replay-safe. No UPDATE of historical tasks, signatures or frozen evidence.
SET @task_plan_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND COLUMN_NAME='completionRoundId')=0, 'ALTER TABLE Task ADD COLUMN completionRoundId CHAR(36) NULL', 'SELECT 1');
PREPARE task_plan_stmt FROM @task_plan_ddl; EXECUTE task_plan_stmt; DEALLOCATE PREPARE task_plan_stmt;
-- Generated status cannot be forgotten by an import, API or worker. No fake dates/hours.
SET @task_plan_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='Task' AND COLUMN_NAME='planningStatus')=0, 'ALTER TABLE Task ADD COLUMN planningStatus VARCHAR(16) GENERATED ALWAYS AS (CASE WHEN plannedStartDate IS NOT NULL AND dueDate IS NOT NULL AND estimateHours IS NOT NULL AND estimateHours > 0 AND plannedStartDate <= dueDate THEN ''SCHEDULED'' ELSE ''UNSCHEDULED'' END) STORED', 'SELECT 1');
PREPARE task_plan_stmt FROM @task_plan_ddl; EXECUTE task_plan_stmt; DEALLOCATE PREPARE task_plan_stmt;
